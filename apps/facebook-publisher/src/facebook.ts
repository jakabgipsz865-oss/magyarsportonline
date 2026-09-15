import type { SocialPost, SocialPostRepository } from "@magyarsportonline/db";

export interface FacebookQueueMessage {
  socialPostId: string;
  storyId: string;
  storyVersionId: string;
  canonicalUrl: string;
}

export interface QueueMessage<T> {
  body: T;
  attempts: number;
  ack(): void;
  retry(options?: { delaySeconds?: number }): void;
}

interface FacebookPublisherEnv {
  FACEBOOK_AUTO_PUBLISH?: string;
  FACEBOOK_PAGE_ID?: string;
  FACEBOOK_PAGE_ACCESS_TOKEN?: string;
  META_GRAPH_API_VERSION: string;
}

interface Logger {
  info(data: Record<string, unknown>, message: string): void;
  error(data: Record<string, unknown>, message: string): void;
}

interface PublisherDeps {
  repository: Pick<
    SocialPostRepository,
    "getById" | "claimFacebookForPosting" | "markPosted" | "markFailed"
  >;
  fetch: typeof fetch;
  logger: Logger;
}

interface GraphError {
  message?: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  is_transient?: boolean;
}

type FailureCode =
  | "facebook_auth_failed"
  | "facebook_permission_denied"
  | "facebook_rate_limited"
  | "facebook_temporary_error"
  | "facebook_network_ambiguous"
  | "facebook_invalid_response";

const RATE_LIMIT_CODES = new Set([4, 17, 32, 613]);
const TEMPORARY_CODES = new Set([1, 2, 341]);

function isExpectedMessage(body: unknown): body is FacebookQueueMessage {
  if (!body || typeof body !== "object") return false;
  const value = body as Record<string, unknown>;
  return (
    typeof value["socialPostId"] === "string" &&
    typeof value["storyId"] === "string" &&
    typeof value["storyVersionId"] === "string" &&
    typeof value["canonicalUrl"] === "string"
  );
}

function classifyGraphError(response: Response, error: GraphError | undefined): FailureCode {
  if (response.status === 429 || (error?.code && RATE_LIMIT_CODES.has(error.code)))
    return "facebook_rate_limited";
  if (error?.code === 190 || response.status === 401) return "facebook_auth_failed";
  if (error?.code === 10 || error?.code === 200 || response.status === 403)
    return "facebook_permission_denied";
  if (error?.is_transient || (error?.code && TEMPORARY_CODES.has(error.code)))
    return "facebook_temporary_error";
  return "facebook_invalid_response";
}

function graphErrorMessage(error: GraphError | undefined, status: number): string {
  return (error?.message ?? `Meta Graph API returned HTTP ${status}`).slice(0, 500);
}

function validPost(post: SocialPost, message: FacebookQueueMessage): boolean {
  return (
    post.platform === "facebook" &&
    post.storyId === message.storyId &&
    post.storyVersionId === message.storyVersionId &&
    post.canonicalUrl === message.canonicalUrl &&
    post.canonicalUrl.startsWith("https://magyarsportonline.hu/hir/")
  );
}

export async function processFacebookMessage(
  message: QueueMessage<unknown>,
  env: FacebookPublisherEnv,
  deps: PublisherDeps,
): Promise<void> {
  if (!isExpectedMessage(message.body)) {
    deps.logger.error(
      { reasonCode: "facebook_invalid_response" },
      "invalid Facebook queue message",
    );
    message.ack();
    return;
  }
  const queued = message.body;
  const post = await deps.repository.getById(queued.socialPostId);
  if (!post || !validPost(post, queued)) {
    if (post)
      await deps.repository.markFailed(
        post.id,
        "facebook_invalid_response",
        "Queue payload does not match the persisted social post",
      );
    message.ack();
    return;
  }

  if (post.status === "posted" || post.status === "retracted") {
    deps.logger.info(
      { reasonCode: "facebook_duplicate_skipped", storyId: post.storyId },
      "Facebook duplicate skipped",
    );
    message.ack();
    return;
  }
  if (post.status === "posting") {
    await deps.repository.markFailed(
      post.id,
      "facebook_network_ambiguous",
      "A previous delivery stopped after claiming the post; automatic repost is blocked",
    );
    message.ack();
    return;
  }
  if (env.FACEBOOK_AUTO_PUBLISH !== "true") {
    message.ack();
    return;
  }
  if (!env.FACEBOOK_PAGE_ID || !env.FACEBOOK_PAGE_ACCESS_TOKEN) {
    await deps.repository.markFailed(
      post.id,
      "facebook_auth_failed",
      "Facebook Page credentials are not configured",
    );
    message.ack();
    return;
  }

  const claimed = await deps.repository.claimFacebookForPosting(post.id);
  if (!claimed) {
    deps.logger.info(
      { reasonCode: "facebook_duplicate_skipped", storyId: post.storyId },
      "Facebook post was already claimed or exhausted retries",
    );
    message.ack();
    return;
  }

  let response: Response;
  try {
    response = await deps.fetch(
      `https://graph.facebook.com/${env.META_GRAPH_API_VERSION}/${encodeURIComponent(env.FACEBOOK_PAGE_ID)}/feed`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${env.FACEBOOK_PAGE_ACCESS_TOKEN}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ message: claimed.postText, link: claimed.canonicalUrl! }),
        signal: AbortSignal.timeout(15_000),
      },
    );
  } catch {
    await deps.repository.markFailed(
      claimed.id,
      "facebook_network_ambiguous",
      "Meta delivery ended without a definitive response",
    );
    message.ack();
    return;
  }

  let body: { id?: unknown; error?: GraphError } = {};
  try {
    body = (await response.json()) as typeof body;
  } catch {
    // A missing/invalid body is ambiguous even on HTTP 2xx, so never retry it.
  }
  if (response.ok && typeof body.id === "string" && body.id.length > 0) {
    await deps.repository.markPosted(claimed.id, body.id);
    deps.logger.info(
      { reasonCode: "facebook_posted", storyId: claimed.storyId, externalPostId: body.id },
      "Facebook Page post created",
    );
    message.ack();
    return;
  }

  const reasonCode = classifyGraphError(response, body.error);
  await deps.repository.markFailed(
    claimed.id,
    reasonCode,
    graphErrorMessage(body.error, response.status),
  );
  if (
    (reasonCode === "facebook_rate_limited" || reasonCode === "facebook_temporary_error") &&
    message.attempts <= 3
  ) {
    message.retry({ delaySeconds: Math.min(900, 60 * 2 ** (message.attempts - 1)) });
    return;
  }
  message.ack();
}

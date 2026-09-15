import { getCloudflareContext } from "@opennextjs/cloudflare/cloudflare-context";
import { createRepositories } from "./db";
import { env } from "./env";
import { getLogger } from "./logger";

const MAX_LEAD_LENGTH = 500;

export interface FacebookQueueMessage {
  socialPostId: string;
  storyId: string;
  storyVersionId: string;
  canonicalUrl: string;
}

export interface FacebookPublicationInput {
  storyId: string;
  storyVersionId: string;
  slug: string;
  titleHu: string;
  leadHu: string;
  publishedAt: Date;
  status: string;
}

interface QueueBinding {
  send(message: FacebookQueueMessage): Promise<unknown>;
}

interface FacebookPostRecord {
  id: string;
  storyId: string;
  storyVersionId: string;
  canonicalUrl: string | null;
}

interface FacebookSocialPostStore {
  createFacebookQueued(input: {
    storyId: string;
    storyVersionId: string;
    postText: string;
    canonicalUrl: string;
  }): Promise<{ post: FacebookPostRecord; created: boolean }>;
  markEnqueued(id: string): Promise<void>;
  listPendingFacebookEnqueue(limit?: number): Promise<FacebookPostRecord[]>;
}

interface FacebookPublicationDeps {
  enabled: boolean;
  activationStart: Date;
  siteUrl: string;
  socialPostRepository: FacebookSocialPostStore;
  queue: QueueBinding;
}

function shortenLead(lead: string): string {
  const normalized = lead.trim().replace(/\s+/g, " ");
  if (normalized.length <= MAX_LEAD_LENGTH) return normalized;
  const candidate = normalized.slice(0, MAX_LEAD_LENGTH - 1);
  const lastSpace = candidate.lastIndexOf(" ");
  return `${candidate.slice(0, lastSpace > 350 ? lastSpace : candidate.length).trimEnd()}…`;
}

export function buildFacebookPostText(input: {
  titleHu: string;
  leadHu: string;
  canonicalUrl: string;
}): string {
  return `⚽ ${input.titleHu.trim()}\n\n${shortenLead(input.leadHu)}\n\n👇 Részletek:\n${input.canonicalUrl}`;
}

function queueBinding(): QueueBinding {
  const queue = getCloudflareContext().env.FACEBOOK_QUEUE as QueueBinding | undefined;
  if (!queue) throw new Error("FACEBOOK_QUEUE binding is not configured");
  return queue;
}

function defaultDeps(): FacebookPublicationDeps {
  return {
    enabled: env.FACEBOOK_AUTO_PUBLISH,
    activationStart: env.FACEBOOK_AUTO_PUBLISH_START_AT,
    siteUrl: env.SITE_URL,
    socialPostRepository: createRepositories().socialPostRepository,
    queue: queueBinding(),
  };
}

export async function enqueueFacebookPublication(
  input: FacebookPublicationInput,
  deps: FacebookPublicationDeps = defaultDeps(),
): Promise<"disabled" | "before_activation" | "duplicate" | "enqueued"> {
  if (!deps.enabled) return "disabled";
  if (input.status !== "published") return "disabled";
  if (input.publishedAt < deps.activationStart) return "before_activation";

  const canonicalUrl = new URL(`/hir/${encodeURIComponent(input.slug)}`, deps.siteUrl).toString();
  const result = await deps.socialPostRepository.createFacebookQueued({
    storyId: input.storyId,
    storyVersionId: input.storyVersionId,
    canonicalUrl,
    postText: buildFacebookPostText({
      titleHu: input.titleHu,
      leadHu: input.leadHu,
      canonicalUrl,
    }),
  });
  if (!result.created) {
    getLogger().info(
      { reasonCode: "facebook_duplicate_skipped", storyId: input.storyId },
      "facebook publication duplicate skipped",
    );
    return "duplicate";
  }

  await deps.queue.send({
    socialPostId: result.post.id,
    storyId: input.storyId,
    storyVersionId: input.storyVersionId,
    canonicalUrl,
  });
  await deps.socialPostRepository.markEnqueued(result.post.id);
  return "enqueued";
}

/** Facebook is a best-effort asynchronous side effect and cannot fail Story publication. */
export async function enqueueFacebookPublicationSafely(
  input: FacebookPublicationInput,
  deps?: FacebookPublicationDeps,
): Promise<void> {
  if (!deps && !env.FACEBOOK_AUTO_PUBLISH) return;
  try {
    await enqueueFacebookPublication(input, deps);
  } catch (error) {
    getLogger().error(
      {
        storyId: input.storyId,
        error: error instanceof Error ? error.message : String(error),
      },
      "facebook publication enqueue failed; Story remains published",
    );
  }
}

export async function enqueuePendingFacebookPosts(
  deps: FacebookPublicationDeps = defaultDeps(),
): Promise<{ disabled: boolean; enqueued: number }> {
  if (!deps.enabled) return { disabled: true, enqueued: 0 };
  const pending = await deps.socialPostRepository.listPendingFacebookEnqueue(25);
  let enqueued = 0;
  for (const post of pending) {
    if (!post.canonicalUrl) continue;
    await deps.queue.send({
      socialPostId: post.id,
      storyId: post.storyId,
      storyVersionId: post.storyVersionId,
      canonicalUrl: post.canonicalUrl,
    });
    await deps.socialPostRepository.markEnqueued(post.id);
    enqueued += 1;
  }
  return { disabled: false, enqueued };
}

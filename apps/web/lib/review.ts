import { readModelProjector } from "@magyarsportonline/agents";
import { createEventEnvelope } from "@magyarsportonline/events";
import { createRepositories, type Repositories } from "./db";
import { getLogger } from "./logger";

export type ReviewDecisionResult =
  | { ok: true }
  | { ok: false; error: "not_found" | "already_resolved" };

/**
 * Kézi jóváhagyás a review queue-ból (docs/architecture/02-agents.md §2.7):
 * pontosan ugyanazt a publikálási utat járja be, mint az automatikus Publish
 * Gate — verzió megjelölése publikáltként, Story `published` státusz, majd a
 * `story_read_model` CQRS-projekció frissítése —, csak az emberi döntés
 * váltja ki, nem a determinisztikus szabály.
 */
export async function approveReviewItem(
  itemId: string,
  repos: Repositories = createRepositories(),
): Promise<ReviewDecisionResult> {
  const item = await repos.reviewQueueRepository.getById(itemId);
  if (!item) {
    return { ok: false, error: "not_found" };
  }
  if (item.status !== "pending") {
    return { ok: false, error: "already_resolved" };
  }

  const publishedAt = new Date();
  await repos.storyVersionRepository.markPublished(item.storyVersionId);
  await repos.storyRepository.publish(item.storyId, item.storyVersionId, publishedAt);
  await repos.reviewQueueRepository.resolve(itemId, "approved");

  await readModelProjector.handleStoryPublished(
    {
      storyRepository: repos.storyRepository,
      storyVersionRepository: repos.storyVersionRepository,
      storySourceRepository: repos.storySourceRepository,
      storyReadModelRepository: repos.storyReadModelRepository,
      logger: getLogger(),
    },
    {
      ...createEventEnvelope({ correlationId: crypto.randomUUID() }),
      type: "story/published",
      payload: { story_id: item.storyId, story_version_id: item.storyVersionId },
    },
  );

  getLogger().info({ itemId, storyId: item.storyId }, "review queue item approved and published");
  return { ok: true };
}

/**
 * Kézi elutasítás: a tétel `rejected`, a Story `retracted` státuszba kerül —
 * nem törlünk semmit (nem destruktív), a read modelbe sosem kerül be.
 */
export async function rejectReviewItem(
  itemId: string,
  repos: Repositories = createRepositories(),
): Promise<ReviewDecisionResult> {
  const item = await repos.reviewQueueRepository.getById(itemId);
  if (!item) {
    return { ok: false, error: "not_found" };
  }
  if (item.status !== "pending") {
    return { ok: false, error: "already_resolved" };
  }

  await repos.reviewQueueRepository.resolve(itemId, "rejected");
  await repos.storyRepository.updateStatus(item.storyId, "retracted");

  getLogger().info({ itemId, storyId: item.storyId }, "review queue item rejected");
  return { ok: true };
}

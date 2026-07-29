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
      storyCredibilityHistoryRepository: repos.storyCredibilityHistoryRepository,
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

/** A "Később" gomb ideje — elég rövid ahhoz, hogy még aznap visszakerüljön a szerkesztő elé, nem egy határozatlan idejű elrejtés. */
const SNOOZE_HOURS = 4;

/**
 * "Később" a review UI-n: a tétel `pending` marad (nincs approve/reject
 * döntés), csak egy időre kikerül az alapértelmezett nézetből — a
 * `listPending()` `snoozedUntil`-szűrése miatt (2026-07-29).
 */
export async function snoozeReviewItem(
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

  const until = new Date(Date.now() + SNOOZE_HOURS * 60 * 60 * 1000);
  await repos.reviewQueueRepository.snooze(itemId, until);
  return { ok: true };
}

export type EditContentResult =
  | { ok: true }
  | { ok: false; error: "not_found" | "already_resolved" | "already_published" };

/**
 * Emberi szerkesztés jóváhagyás előtt (2026-07-29, "kézzelfogható admin
 * dashboard" sprint): a `storyVersions.updateDraftContent`-et használja —
 * ugyanazt az utat, amit az Editorial Rewrite Agent is —, mert az már eleve
 * `WHERE is_published = false`-ra korlátoz, így egy már publikált verzió
 * sosem írható felül utólag. Nem dönt (approve/reject) — a szerkesztő ezután
 * külön hívja a jóváhagyást.
 */
export async function editReviewItemContent(
  itemId: string,
  content: { titleHu: string; leadHu: string; bodyHu: string },
  repos: Repositories = createRepositories(),
): Promise<EditContentResult> {
  const item = await repos.reviewQueueRepository.getById(itemId);
  if (!item) {
    return { ok: false, error: "not_found" };
  }
  if (item.status !== "pending") {
    return { ok: false, error: "already_resolved" };
  }

  const version = await repos.storyVersionRepository.getById(item.storyVersionId);
  const wasUpdated = await repos.storyVersionRepository.updateDraftContent(item.storyVersionId, {
    titleHu: content.titleHu,
    leadHu: content.leadHu,
    bodyHu: content.bodyHu,
    editorialRewriteApplied: version?.editorialRewriteApplied ?? false,
  });
  if (!wasUpdated) {
    return { ok: false, error: "already_published" };
  }

  getLogger().info({ itemId, storyId: item.storyId }, "review queue item content edited by human");
  return { ok: true };
}

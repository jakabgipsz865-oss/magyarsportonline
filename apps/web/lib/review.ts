import { hungarianWriter, publishGate, readModelProjector } from "@magyarsportonline/agents";
import type { EditorialCorrectionCategory, EditorialCorrectionInput } from "@magyarsportonline/db";
import { createEventEnvelope } from "@magyarsportonline/events";
import { createRepositories, type Repositories } from "./db";
import { getLogger } from "./logger";

export type ReviewDecisionResult =
  | { ok: true }
  | { ok: false; error: "not_found" | "already_resolved" }
  | {
      ok: false;
      error: "publication_blocked";
      blockers: publishGate.PublicationBlocker[];
    };

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

  const [story, version, facts, sourceCount, fullArticleSourceCount] = await Promise.all([
    repos.storyRepository.getById(item.storyId),
    repos.storyVersionRepository.getById(item.storyVersionId),
    repos.factRepository.listByStoryId(item.storyId),
    repos.storySourceRepository.countByStoryId(item.storyId),
    repos.storySourceRepository.countFullArticleByStoryId(item.storyId),
  ]);
  if (!story || !version) {
    return { ok: false, error: "not_found" };
  }

  const readiness = publishGate.assessPublicationReadiness({
    titleHu: version.titleHu,
    leadHu: version.leadHu,
    bodyHu: version.bodyHu,
    facts: facts.map(hungarianWriter.toWriterFact),
    isAiGenerated: version.isAiGenerated,
    factConsistencyScore:
      version.factConsistencyScore === null ? null : Number(version.factConsistencyScore),
    selfCheckFallback: version.selfCheckFallback,
    credibilityScore: story.credibilityScore,
    sourceCount,
    fullArticleSourceCount,
  });
  if (!readiness.passed) {
    getLogger().warn(
      { itemId, storyId: item.storyId, blockers: readiness.blockers },
      "review queue approval blocked by fresh publication readiness assessment",
    );
    return { ok: false, error: "publication_blocked", blockers: readiness.blockers };
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
  | { ok: true; correctionsCreated: number }
  | { ok: false; error: "not_found" | "already_resolved" | "already_published" };

export interface TeachableEditOptions {
  enabled: boolean;
  category: EditorialCorrectionCategory;
  originalContextEn: string;
}

interface EditableContent {
  titleHu: string;
  leadHu: string;
  bodyHu: string;
}

const MAX_AUTOMATIC_CORRECTIONS_PER_EDIT = 12;
const MAX_TRAINING_SENTENCE_CHARS = 1_500;
const MAX_ORIGINAL_CONTEXT_CHARS = 4_000;

function splitTrainingSentences(value: string): string[] {
  return value
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function normalizedSentence(value: string): string {
  return value.toLocaleLowerCase("hu-HU").replace(/\s+/g, " ").trim();
}

/** LCS-alapú mondatdiff: csak tényleges rossz→jó párokat tanít, puszta beszúrást/törlést nem. */
function changedSentencePairs(before: string, after: string): Array<[string, string]> {
  const oldSentences = splitTrainingSentences(before);
  const newSentences = splitTrainingSentences(after);
  const rows = oldSentences.length + 1;
  const columns = newSentences.length + 1;
  const lcs = Array.from({ length: rows }, () => Array<number>(columns).fill(0));
  for (let oldIndex = oldSentences.length - 1; oldIndex >= 0; oldIndex -= 1) {
    for (let newIndex = newSentences.length - 1; newIndex >= 0; newIndex -= 1) {
      lcs[oldIndex]![newIndex] =
        normalizedSentence(oldSentences[oldIndex]!) === normalizedSentence(newSentences[newIndex]!)
          ? 1 + lcs[oldIndex + 1]![newIndex + 1]!
          : Math.max(lcs[oldIndex + 1]![newIndex]!, lcs[oldIndex]![newIndex + 1]!);
    }
  }

  const pairs: Array<[string, string]> = [];
  let oldIndex = 0;
  let newIndex = 0;
  while (oldIndex < oldSentences.length || newIndex < newSentences.length) {
    if (
      oldIndex < oldSentences.length &&
      newIndex < newSentences.length &&
      normalizedSentence(oldSentences[oldIndex]!) === normalizedSentence(newSentences[newIndex]!)
    ) {
      oldIndex += 1;
      newIndex += 1;
      continue;
    }

    const oldChunk: string[] = [];
    const newChunk: string[] = [];
    while (oldIndex < oldSentences.length || newIndex < newSentences.length) {
      if (
        oldIndex < oldSentences.length &&
        newIndex < newSentences.length &&
        normalizedSentence(oldSentences[oldIndex]!) === normalizedSentence(newSentences[newIndex]!)
      ) {
        break;
      }
      if (
        newIndex >= newSentences.length ||
        (oldIndex < oldSentences.length &&
          lcs[oldIndex + 1]![newIndex]! >= lcs[oldIndex]![newIndex + 1]!)
      ) {
        oldChunk.push(oldSentences[oldIndex]!);
        oldIndex += 1;
      } else {
        newChunk.push(newSentences[newIndex]!);
        newIndex += 1;
      }
    }
    if (oldChunk.length > 0 && newChunk.length > 0) {
      const pairCount = Math.max(oldChunk.length, newChunk.length);
      for (let index = 0; index < pairCount; index += 1) {
        const oldSentence = oldChunk[Math.min(index, oldChunk.length - 1)]!;
        const newSentence = newChunk[Math.min(index, newChunk.length - 1)]!;
        if (normalizedSentence(oldSentence) !== normalizedSentence(newSentence)) {
          pairs.push([oldSentence, newSentence]);
        }
      }
    }
  }
  return pairs;
}

export function buildTeachableCorrectionsFromEdit(input: {
  storyId: string;
  before: EditableContent;
  after: EditableContent;
  category: EditorialCorrectionCategory;
  originalContextEn: string;
}): EditorialCorrectionInput[] {
  const originalSentenceEn = input.originalContextEn.trim().slice(0, MAX_ORIGINAL_CONTEXT_CHARS);
  if (!originalSentenceEn) return [];
  const pairs = [
    ...changedSentencePairs(input.before.titleHu, input.after.titleHu),
    ...changedSentencePairs(input.before.leadHu, input.after.leadHu),
    ...changedSentencePairs(input.before.bodyHu, input.after.bodyHu),
  ];
  return pairs.slice(0, MAX_AUTOMATIC_CORRECTIONS_PER_EDIT).map(([current, corrected]) => ({
    storyId: input.storyId,
    category: input.category,
    termEn: null,
    originalSentenceEn,
    currentSentenceHu: current.slice(0, MAX_TRAINING_SENTENCE_CHARS),
    correctedSentenceHu: corrected.slice(0, MAX_TRAINING_SENTENCE_CHARS),
    note: "Normál admin review során automatikusan mentett szerkesztői javítás.",
  }));
}

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
  content: EditableContent,
  repos: Repositories = createRepositories(),
  teach: TeachableEditOptions = {
    enabled: false,
    category: "style",
    originalContextEn: "",
  },
): Promise<EditContentResult> {
  const item = await repos.reviewQueueRepository.getById(itemId);
  if (!item) {
    return { ok: false, error: "not_found" };
  }
  if (item.status !== "pending") {
    return { ok: false, error: "already_resolved" };
  }

  const version = await repos.storyVersionRepository.getById(item.storyVersionId);
  const facts = await repos.factRepository.listByStoryId(item.storyId);
  const quality = hungarianWriter.assessContentQuality({
    titleHu: content.titleHu,
    leadHu: content.leadHu,
    bodyHu: content.bodyHu,
    facts: facts.map(hungarianWriter.toWriterFact),
  });
  const wasUpdated = await repos.storyVersionRepository.updateDraftContent(item.storyVersionId, {
    titleHu: content.titleHu,
    leadHu: content.leadHu,
    bodyHu: content.bodyHu,
    editorialRewriteApplied: version?.editorialRewriteApplied ?? false,
    qualityIssues: quality.issues,
  });
  if (!wasUpdated) {
    return { ok: false, error: "already_published" };
  }

  let correctionsCreated = 0;
  if (teach.enabled && version) {
    const corrections = buildTeachableCorrectionsFromEdit({
      storyId: item.storyId,
      before: {
        titleHu: version.titleHu,
        leadHu: version.leadHu,
        bodyHu: version.bodyHu,
      },
      after: content,
      category: teach.category,
      originalContextEn: teach.originalContextEn,
    });
    for (const correction of corrections) {
      await repos.editorialCorrectionRepository.create(correction);
      correctionsCreated += 1;
    }
  }

  getLogger().info(
    { itemId, storyId: item.storyId, correctionsCreated },
    "review queue item content edited by human",
  );
  return { ok: true, correctionsCreated };
}

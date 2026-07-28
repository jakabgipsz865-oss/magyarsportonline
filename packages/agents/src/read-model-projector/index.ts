import type {
  StoryCredibilityHistoryRepository,
  StoryReadModelRepository,
  StoryRepository,
  StorySourceRepository,
  StoryVersionRepository,
} from "@magyarsportonline/db";
import type { SportsNewsEvent } from "@magyarsportonline/events";
import type { Logger } from "@magyarsportonline/observability";
import { toBodyHtml } from "./body-html";

export * from "./body-html";

export const PROJECTOR_VERSION = "read-model-projector@0.1.0";

export interface ReadModelProjectorDeps {
  storyRepository: Pick<StoryRepository, "getById">;
  storyVersionRepository: Pick<StoryVersionRepository, "listByStoryId">;
  storySourceRepository: Pick<StorySourceRepository, "summaryByStoryId">;
  storyCredibilityHistoryRepository: Pick<StoryCredibilityHistoryRepository, "listByStoryId">;
  storyReadModelRepository: Pick<StoryReadModelRepository, "upsert">;
  logger: Logger;
}

type Trigger = Extract<SportsNewsEvent, { type: "story/published" }>;

/**
 * CQRS read-model projector (docs/architecture/01-data-model.md §1.5.2,
 * 09-architecture-review.md §5) — deliberately NOT an "agent" in the
 * `agent_runs`/`withAgentRun` sense: it's a purely infrastructural
 * event-consumer, not a business decision-maker, so it has no `agent_runs`
 * audit entry of its own. Rebuilds the full `story_read_model` row from the
 * normalized write-side tables on every `story/published` — a full rebuild
 * rather than an incremental patch, which is simpler and cheap at MVP
 * volume (see docs/architecture/07-scalability.md for when that stops being
 * true).
 */
export async function handleStoryPublished(
  deps: ReadModelProjectorDeps,
  event: Trigger,
): Promise<void> {
  const story = await deps.storyRepository.getById(event.payload.story_id);
  if (!story) {
    throw new Error(`Story "${event.payload.story_id}" not found`);
  }
  if (!story.slug) {
    throw new Error(`Published Story "${story.id}" has no slug — SEO Agent should have run first`);
  }

  const versions = await deps.storyVersionRepository.listByStoryId(story.id);
  const publishedVersion =
    versions.find((version) => version.id === event.payload.story_version_id) ??
    [...versions].reverse().find((version) => version.isPublished);
  if (!publishedVersion) {
    throw new Error(`No published StoryVersion found for Story "${story.id}"`);
  }

  const sourcesSummary = await deps.storySourceRepository.summaryByStoryId(story.id);
  const versionHistorySummary = versions
    .filter((version) => version.isPublished)
    .map((version) => ({
      version_number: version.versionNumber,
      created_at: version.createdAt.toISOString(),
      change_summary: version.changeSummaryHu,
    }));

  // Hitelességi mutató v1 (2026-07-28) — a `stories.credibility*` mezők a
  // legutolsó számítást tükrözik, a `story_credibility_history` a teljes
  // "hitelességi változások története" nézetet adja a publikus oldalnak.
  const credibilityHistory = await deps.storyCredibilityHistoryRepository.listByStoryId(story.id);
  const credibilitySummary =
    story.credibilityScore === null
      ? null
      : {
          score: story.credibilityScore,
          band: story.credibilityBand,
          labelHu: story.credibilityLabelHu,
          justificationHu: story.credibilityJustificationHu,
          officialConfirmed: story.credibilityOfficialConfirmed,
          corroboratingSourceCount: story.credibilityCorroboratingCount,
          updatedAt: story.credibilityUpdatedAt?.toISOString() ?? null,
          history: credibilityHistory.map((entry) => ({
            score: entry.score,
            band: entry.band,
            labelHu: entry.labelHu,
            recordedAt: entry.recordedAt.toISOString(),
          })),
        };

  await deps.storyReadModelRepository.upsert({
    storyId: story.id,
    slug: story.slug,
    titleHu: publishedVersion.titleHu,
    leadHu: publishedVersion.leadHu,
    bodyHtml: toBodyHtml(publishedVersion.bodyHu),
    imageUrl: story.imageUrl,
    isAiGenerated: publishedVersion.isAiGenerated,
    metaDescription: publishedVersion.metaDescription,
    structuredData: publishedVersion.structuredData,
    sourcesSummary,
    tags: [],
    category: null,
    confidenceScore: story.confidenceScore,
    isDeveloping: story.isDeveloping,
    publishedAt: story.publishedAt ?? new Date(),
    lastUpdatedAt: new Date(),
    versionHistorySummary,
    credibilitySummary,
  });

  deps.logger.info(
    { storyId: story.id, slug: story.slug, versionId: publishedVersion.id },
    "story read model projected",
  );
}

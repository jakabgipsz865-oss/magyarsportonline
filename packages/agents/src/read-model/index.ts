import { schema, type Database } from "@magyarsportonline/db";
import type { Logger } from "@magyarsportonline/observability";
import { eq } from "drizzle-orm";
import type { RecordAgentRun } from "../telemetry/agent-run-recorder.js";
import { runWithTelemetry } from "../telemetry/run-with-telemetry.js";

export interface ReadModelInput {
  storyId: string;
  correlationId: string;
}

/** Minimal, safe paragraph wrap — not a full markdown/rich-text pipeline (out of MVP scope). */
function toBodyHtml(bodyHu: string): string {
  return bodyHu
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0)
    .map((paragraph) => `<p>${paragraph}</p>`)
    .join("\n");
}

/**
 * CQRS read-model projector (docs/architecture/01-data-model.md §1.5.2,
 * 09-architecture-review.md §5). Deliberately a plain function called
 * directly at the end of the pipeline, not an event-subscriber — see
 * docs/adr/0005-mvp-direct-orchestration-no-queue.md. The public frontend
 * (apps/web) reads ONLY `story_read_model`, never the write-side tables
 * directly, so this is the single place responsible for keeping that
 * projection in sync with `stories`/`story_versions`.
 */
export async function projectStoryReadModel(
  deps: { db: Database; logger: Logger; recordAgentRun: RecordAgentRun },
  input: ReadModelInput,
): Promise<void> {
  return runWithTelemetry(
    deps,
    {
      agentName: "read-model-projector",
      triggerEvent: "story/published",
      correlationId: input.correlationId,
      storyId: input.storyId,
    },
    async ({ log }) => {
      const story = await deps.db.query.stories.findFirst({
        where: eq(schema.stories.id, input.storyId),
      });
      if (!story?.currentVersionId || !story.slug) {
        log.warn(
          { storyId: input.storyId },
          "Story has no published version/slug yet — skipping read-model projection",
        );
        return;
      }

      const currentVersion = await deps.db.query.storyVersions.findFirst({
        where: eq(schema.storyVersions.id, story.currentVersionId),
      });
      if (!currentVersion) {
        throw new Error(`current_version_id ${story.currentVersionId} not found`);
      }

      const allVersions = await deps.db
        .select({
          versionNumber: schema.storyVersions.versionNumber,
          createdAt: schema.storyVersions.createdAt,
          changeSummaryHu: schema.storyVersions.changeSummaryHu,
          isPublished: schema.storyVersions.isPublished,
        })
        .from(schema.storyVersions)
        .where(eq(schema.storyVersions.storyId, input.storyId));
      const versionHistorySummary = allVersions
        .filter((v) => v.isPublished)
        .sort((a, b) => a.versionNumber - b.versionNumber)
        .map((v) => ({
          versionNumber: v.versionNumber,
          createdAt: v.createdAt.toISOString(),
          changeSummary: v.changeSummaryHu,
        }));

      const sourceRows = await deps.db
        .select({
          name: schema.sources.name,
          sourceUrl: schema.rawArticles.sourceUrl,
          firstSeenAt: schema.storySources.linkedAt,
        })
        .from(schema.storySources)
        .innerJoin(schema.rawArticles, eq(schema.storySources.rawArticleId, schema.rawArticles.id))
        .innerJoin(schema.sources, eq(schema.rawArticles.sourceId, schema.sources.id))
        .where(eq(schema.storySources.storyId, input.storyId));
      const sourcesSummary = sourceRows.map((row) => ({
        name: row.name,
        url: row.sourceUrl,
        firstSeenAt: row.firstSeenAt.toISOString(),
      }));

      await deps.db
        .insert(schema.storyReadModel)
        .values({
          storyId: story.id,
          slug: story.slug,
          titleHu: currentVersion.titleHu,
          leadHu: currentVersion.leadHu,
          bodyHtml: toBodyHtml(currentVersion.bodyHu),
          confidenceScore: story.confidenceScore,
          isDeveloping: story.isDeveloping,
          publishedAt: story.publishedAt ?? new Date(),
          lastUpdatedAt: story.lastUpdatedAt,
          sourcesSummary,
          tags: [],
          versionHistorySummary,
        })
        .onConflictDoUpdate({
          target: schema.storyReadModel.storyId,
          set: {
            titleHu: currentVersion.titleHu,
            leadHu: currentVersion.leadHu,
            bodyHtml: toBodyHtml(currentVersion.bodyHu),
            confidenceScore: story.confidenceScore,
            isDeveloping: story.isDeveloping,
            lastUpdatedAt: story.lastUpdatedAt,
            sourcesSummary,
            versionHistorySummary,
          },
        });

      log.info({ storyId: input.storyId, slug: story.slug }, "read model projected");
    },
  );
}

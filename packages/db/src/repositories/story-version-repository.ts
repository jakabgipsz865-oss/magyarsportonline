import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { Database } from "../client";
import { stories, storyVersions } from "../schema/index";

export type StoryVersion = typeof storyVersions.$inferSelect;

export interface NewStoryVersionInput {
  titleHu: string;
  leadHu: string;
  bodyHu: string;
  changeSummaryHu: string | null;
  generatedByModel: string;
  isAiGenerated: boolean;
  promptVersion: string;
  factConsistencyScore: number;
  /** True when the consistency check came from an error fallback instead of a real verifier response. */
  selfCheckFallback: boolean;
  /** Content Quality Gate findings (packages/agents/hungarian-writer/quality-gate.ts) — null/empty means no issues found. */
  qualityIssues?: unknown[] | null;
}

export interface LatestVersionSummary {
  storyId: string;
  versionId: string;
  titleHu: string;
  leadHu: string;
  bodyHu: string;
  generatedByModel: string;
  isAiGenerated: boolean;
}

/**
 * Bounded-context repository for the Hungarian Writer and Publish Gate
 * agents (docs/architecture/02-agents.md §2.5, §2.7).
 */
export class StoryVersionRepository {
  constructor(private readonly db: Database) {}

  /**
   * Assigns `version_number` inside a transaction that locks the parent
   * `stories` row with `SELECT ... FOR UPDATE` (docs/architecture/01-data-model.md
   * §1.5.1, 03-event-flow.md §3.7) instead of an application-side `max+1`
   * read, so two concurrent updates to the same Story cannot compute the
   * same version number.
   */
  async createNextVersion(storyId: string, input: NewStoryVersionInput): Promise<StoryVersion> {
    return this.db.transaction(async (tx) => {
      const [storyRow] = await tx
        .select({ id: stories.id, versionCount: stories.versionCount })
        .from(stories)
        .where(eq(stories.id, storyId))
        .for("update");
      if (!storyRow) {
        throw new Error(`Story "${storyId}" not found`);
      }

      const versionNumber = storyRow.versionCount + 1;
      const [version] = await tx
        .insert(storyVersions)
        .values({
          storyId,
          versionNumber,
          titleHu: input.titleHu,
          leadHu: input.leadHu,
          bodyHu: input.bodyHu,
          changeSummaryHu: input.changeSummaryHu,
          generatedByModel: input.generatedByModel,
          isAiGenerated: input.isAiGenerated,
          promptVersion: input.promptVersion,
          factConsistencyScore: input.factConsistencyScore.toFixed(3),
          selfCheckFallback: input.selfCheckFallback,
          qualityIssues:
            input.qualityIssues && input.qualityIssues.length > 0 ? input.qualityIssues : null,
        })
        .returning();
      if (!version) {
        throw new Error("StoryVersion insert returned no row");
      }

      await tx.update(stories).set({ versionCount: versionNumber }).where(eq(stories.id, storyId));
      return version;
    });
  }

  async getById(versionId: string): Promise<StoryVersion | null> {
    const [row] = await this.db
      .select()
      .from(storyVersions)
      .where(eq(storyVersions.id, versionId))
      .limit(1);
    return row ?? null;
  }

  /** Latest version regardless of publish state — used for the "what changed" diff. */
  async getLatest(storyId: string): Promise<StoryVersion | null> {
    const [row] = await this.db
      .select()
      .from(storyVersions)
      .where(eq(storyVersions.storyId, storyId))
      .orderBy(desc(storyVersions.versionNumber))
      .limit(1);
    return row ?? null;
  }

  async getLatestPublished(storyId: string): Promise<StoryVersion | null> {
    const [row] = await this.db
      .select()
      .from(storyVersions)
      .where(and(eq(storyVersions.storyId, storyId), eq(storyVersions.isPublished, true)))
      .orderBy(desc(storyVersions.versionNumber))
      .limit(1);
    return row ?? null;
  }

  /**
   * Editorial Rewrite Agent's write path (packages/agents/src/editorial-rewrite)
   * — the ONE narrow, deliberate exception to `story_versions`' otherwise
   * immutable-history invariant (see the table comment). Guarded by
   * `WHERE is_published = false` so a version already shown to readers can
   * never be rewritten after the fact; only the still-in-flight draft this
   * pipeline stage is polishing before Publish Gate sees it. Returns false
   * (no-op) if the version was already published by the time this runs,
   * so the caller can log instead of silently losing the rewrite.
   */
  async updateDraftContent(
    versionId: string,
    content: {
      titleHu: string;
      leadHu: string;
      bodyHu: string;
      editorialRewriteApplied: boolean;
      /** Fresh assessment for this exact edited content; null means it passed. */
      qualityIssues?: unknown[] | null;
    },
  ): Promise<boolean> {
    const rows = await this.db
      .update(storyVersions)
      .set({
        titleHu: content.titleHu,
        leadHu: content.leadHu,
        bodyHu: content.bodyHu,
        editorialRewriteApplied: content.editorialRewriteApplied,
        ...(content.qualityIssues !== undefined
          ? {
              qualityIssues:
                content.qualityIssues && content.qualityIssues.length > 0
                  ? content.qualityIssues
                  : null,
            }
          : {}),
      })
      .where(and(eq(storyVersions.id, versionId), eq(storyVersions.isPublished, false)))
      .returning({ id: storyVersions.id });
    return rows.length > 0;
  }

  async markPublished(versionId: string): Promise<void> {
    await this.db
      .update(storyVersions)
      .set({ isPublished: true })
      .where(eq(storyVersions.id, versionId));
  }

  /** Full, ascending version history for a Story — the Timeline UI's data source. */
  async listByStoryId(storyId: string): Promise<StoryVersion[]> {
    return this.db
      .select()
      .from(storyVersions)
      .where(eq(storyVersions.storyId, storyId))
      .orderBy(asc(storyVersions.versionNumber));
  }

  /**
   * Story ids whose *latest* version was produced by the given model label —
   * used to find safe reprocessing candidates once a previously-failing LLM
   * provider starts working again (e.g. `NO_LLM_MODEL_LABEL` after a
   * misconfigured Cloudflare token gets fixed). Only the latest version
   * counts: a Story already re-written by a real provider via corroboration
   * must not be reprocessed again.
   */
  async listStoryIdsWithLatestModel(model: string): Promise<string[]> {
    const latestPerStory = this.db
      .select({
        storyId: storyVersions.storyId,
        maxVersion: sql<number>`max(${storyVersions.versionNumber})`.as("max_version"),
      })
      .from(storyVersions)
      .groupBy(storyVersions.storyId)
      .as("latest");

    const rows = await this.db
      .select({ storyId: storyVersions.storyId })
      .from(storyVersions)
      .innerJoin(
        latestPerStory,
        and(
          eq(storyVersions.storyId, latestPerStory.storyId),
          eq(storyVersions.versionNumber, latestPerStory.maxVersion),
        ),
      )
      .where(eq(storyVersions.generatedByModel, model));

    return rows.map((row) => row.storyId);
  }

  /**
   * Latest version per Story with the fields needed to run the Content
   * Quality Gate heuristics against already-stored content (packages/agents
   * hungarian-writer/quality-gate.ts) — used to find reprocessing candidates
   * beyond the No-LLM-labeled ones (e.g. a real provider call that produced
   * an empty or still-English title).
   */
  async listLatestVersionSummaries(): Promise<LatestVersionSummary[]> {
    const latestPerStory = this.db
      .select({
        storyId: storyVersions.storyId,
        maxVersion: sql<number>`max(${storyVersions.versionNumber})`.as("max_version"),
      })
      .from(storyVersions)
      .groupBy(storyVersions.storyId)
      .as("latest");

    const rows = await this.db
      .select({
        storyId: storyVersions.storyId,
        versionId: storyVersions.id,
        titleHu: storyVersions.titleHu,
        leadHu: storyVersions.leadHu,
        bodyHu: storyVersions.bodyHu,
        generatedByModel: storyVersions.generatedByModel,
        isAiGenerated: storyVersions.isAiGenerated,
      })
      .from(storyVersions)
      .innerJoin(
        latestPerStory,
        and(
          eq(storyVersions.storyId, latestPerStory.storyId),
          eq(storyVersions.versionNumber, latestPerStory.maxVersion),
        ),
      );

    return rows;
  }

  /**
   * Idempotent correctness backfill (Content Quality & Reliability
   * Hardening sprint): a now-fixed labeling bug in the Hungarian Writer
   * Agent (packages/agents hungarian-writer/index.ts `isAiGenerated`) used
   * to mark a version as `NO_LLM_MODEL_LABEL`/`isAiGenerated: false` purely
   * because the *self-check* step fell back to No-LLM, even when the
   * *generation* step itself produced real AI content. This detects those
   * mislabeled rows (generated_by_model = No-LLM label, but the lead is NOT
   * the deterministic No-LLM disclaimer text — a genuine No-LLM row always
   * has that exact lead) and corrects both columns. Safe to run repeatedly:
   * once corrected, a row no longer matches the WHERE clause. Never touches
   * title_hu/lead_hu/body_hu — only the two label columns.
   */
  async backfillMislabeledAiGenerated(
    correctModelLabel: string,
    noLlmModelLabel: string,
    noLlmDisclaimerText: string,
  ): Promise<number> {
    const rows = await this.db
      .update(storyVersions)
      .set({ isAiGenerated: true, generatedByModel: correctModelLabel })
      .where(
        and(
          eq(storyVersions.generatedByModel, noLlmModelLabel),
          sql`${storyVersions.leadHu} <> ${noLlmDisclaimerText}`,
        ),
      )
      .returning({ id: storyVersions.id });

    return rows.length;
  }
}

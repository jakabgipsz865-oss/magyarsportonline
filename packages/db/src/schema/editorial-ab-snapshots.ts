import { boolean, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { stories } from "./stories";

/**
 * Persisted, human-reviewable snapshot of the Editorial Rewrite A/B tool's
 * latest result for a Story (docs/editorial-style-guide.md sprint,
 * "editorial-ab-review" admin page). One row PER STORY, upserted every time
 * that story is reprocessed — this is deliberately NOT an append-only run
 * log: the admin page only ever needs "the latest known A/B comparison for
 * this story", never a full history of every test run.
 *
 * This table is exclusively a read-only review aid. It is never read by the
 * public site, never referenced by `story_versions`, and writing to it can
 * never publish or alter anything a reader sees — see
 * `/api/internal/editorial-ab-review` and `/internal/editorial-ab-review`.
 */
export const editorialAbSnapshots = pgTable("editorial_ab_snapshots", {
  storyId: uuid("story_id")
    .primaryKey()
    .references(() => stories.id),
  titleA: text("title_a").notNull(),
  leadA: text("lead_a").notNull(),
  bodyA: text("body_a").notNull(),
  titleB: text("title_b").notNull(),
  leadB: text("lead_b").notNull(),
  bodyB: text("body_b").notNull(),
  rewriteAccepted: boolean("rewrite_accepted").notNull(),
  /** "fact_check_failed" | "fallback" | null (accepted) */
  rejectionKind: text("rejection_kind"),
  rejectionReason: jsonb("rejection_reason"),
  qualityA: jsonb("quality_a").notNull(),
  qualityB: jsonb("quality_b").notNull(),
  /** JudgeVerdict | null — supplementary signal only, never the deciding factor. */
  judge: jsonb("judge"),
  perCallUsage: jsonb("per_call_usage").notNull(),
  totalUsage: jsonb("total_usage").notNull(),
  durationMs: integer("duration_ms").notNull(),
  /** Matched FOOTBALL_LEXICON entries (packages/agents/src/shared/football-lexicon.ts) for this article. */
  lexiconMatches: jsonb("lexicon_matches").notNull().default([]),
  /** Original English source article(s) this story was built from — {titleOriginal, bodyOriginal, sourceUrl, sourceName}[]. */
  originalSources: jsonb("original_sources").notNull().default([]),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { storyMatchDecisionEnum, storyMatchReviewStatusEnum } from "./enums";
import { rawArticles } from "./raw-articles";
import { stories } from "./stories";

/**
 * Persisted audit trail for EVERY Story-matching decision the scored,
 * multi-factor matcher makes (2026-07-29, "téves Story-összevonás
 * megszüntetése" sprint, packages/agents/src/deduplication/story-match.ts,
 * rule 7: "Minden merge-döntéshez tárold: match score; egyező entitások;
 * eltérő entitások; döntési indok; automatikus vagy kézi döntés.").
 *
 * Replaces the earlier, read-time-recomputed `merge-audit.ts` approach
 * (docs/open-decisions.md #12 follow-up) — this table stores the ACTUAL
 * decision made at ingest time, not a best-effort reconstruction of it.
 */
export const storyMatchDecisions = pgTable(
  "story_match_decisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    rawArticleId: uuid("raw_article_id")
      .notNull()
      .references(() => rawArticles.id),
    /** The best-scoring candidate considered, if any (may differ from resultingStoryId when decision="needs_review", since that case never merges). */
    candidateStoryId: uuid("candidate_story_id").references(() => stories.id),
    /** The Story the article actually ended up in — known immediately for auto_merge (= candidateStoryId); filled in by the Story Merge Agent once created for needs_review/auto_new_story. */
    resultingStoryId: uuid("resulting_story_id").references(() => stories.id),
    matchScore: integer("match_score").notNull(),
    hasSpecificSharedEntity: boolean("has_specific_shared_entity").notNull(),
    matchedEntities: jsonb("matched_entities").notNull().default([]),
    differingEntities: jsonb("differing_entities").notNull().default([]),
    sportMismatch: boolean("sport_mismatch").notNull().default(false),
    decision: storyMatchDecisionEnum("decision").notNull(),
    decisionReasonHu: text("decision_reason_hu").notNull(),
    reviewStatus: storyMatchReviewStatusEnum("review_status"),
    reviewedBy: uuid("reviewed_by"),
    reviewNote: text("review_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (table) => [
    index("story_match_decisions_decision_review_status_idx").on(
      table.decision,
      table.reviewStatus,
    ),
    index("story_match_decisions_raw_article_id_idx").on(table.rawArticleId),
  ],
);

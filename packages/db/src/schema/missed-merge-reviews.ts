import { integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { missedMergeCandidateTypeEnum, missedMergeReviewDecisionEnum } from "./enums";
import { stories } from "./stories";

/**
 * Persisted missed-merge candidate pairs + manual review decisions
 * (2026-07-29, "admin merge-review felület" sprint, docs/open-decisions.md
 * #14 follow-up) — the scored matcher (story-match.ts) only ever compares a
 * FRESH incoming article against existing Stories, so it can never itself
 * discover that two ALREADY-CREATED Stories should probably have been one.
 * `computeMissedMergeCandidatePairs` (packages/agents/src/deduplication/
 * missed-merge-candidates.ts) finds such pairs by re-scanning `story_entities`
 * for Stories sharing a specific (team/player/coach) entity on the same or
 * an adjacent UTC day, and this table is where a human's decision on each
 * pair is recorded — permanently, as a label, never auto-executed.
 *
 * `storyAId`/`storyBId` are always stored with the lexicographically
 * smaller UUID first (enforced by the repository, not the DB) so the same
 * pair can never be inserted twice in swapped order; the unique index below
 * is the actual guarantee against duplicate rows for a re-surfaced pair.
 *
 * A `decision` of `null` means still pending human review. Recording
 * `merge`/`keep_separate`/`uncertain` here does NOT itself merge, split, or
 * otherwise touch the two Stories' data — it is purely a label for the
 * regression test suite and for a future precision/recall report gated on
 * having enough manually-verified decisions (never a manufactured number).
 */
export const missedMergeReviews = pgTable(
  "missed_merge_reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storyAId: uuid("story_a_id")
      .notNull()
      .references(() => stories.id),
    storyBId: uuid("story_b_id")
      .notNull()
      .references(() => stories.id),
    candidateType: missedMergeCandidateTypeEnum("candidate_type").notNull(),
    matchScore: integer("match_score").notNull(),
    matchedEntities: jsonb("matched_entities").notNull().default([]),
    differingEntities: jsonb("differing_entities").notNull().default([]),
    decisionReasonHu: text("decision_reason_hu").notNull(),
    decision: missedMergeReviewDecisionEnum("decision"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionNoteHu: text("decision_note_hu"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("missed_merge_reviews_pair_idx").on(table.storyAId, table.storyBId)],
);

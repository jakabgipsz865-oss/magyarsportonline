import type { StoryMatchDecisionKind, StoryMatchReviewStatus } from "@magyarsportonline/shared";
import { and, desc, eq, gte, inArray, isNull } from "drizzle-orm";
import type { Database } from "../client";
import {
  entities as entitiesTable,
  rawArticles,
  storyEntities,
  storyMatchDecisions,
  stories,
} from "../schema/index";

export type StoryMatchDecisionRow = typeof storyMatchDecisions.$inferSelect;

export interface CandidateStoryEntityRow {
  entityId: string;
  type: string;
  nameCanonical: string;
  role: "subject" | "opponent" | "mentioned";
}

export interface CandidateStoryRow {
  storyId: string;
  canonicalTitle: string;
  lastUpdatedAt: Date;
  entities: CandidateStoryEntityRow[];
  rawArticleSourceUrls: string[];
}

export interface RecordDecisionInput {
  rawArticleId: string;
  candidateStoryId: string | null;
  /** Known immediately for auto_merge (= candidateStoryId); null for needs_review/auto_new_story until the Story Merge Agent creates the Story. */
  resultingStoryId: string | null;
  matchScore: number;
  hasSpecificSharedEntity: boolean;
  matchedEntities: unknown;
  differingEntities: unknown;
  sportMismatch: boolean;
  decision: StoryMatchDecisionKind;
  decisionReasonHu: string;
  reviewStatus: StoryMatchReviewStatus | null;
}

/**
 * Bounded-context repository for the scored, multi-factor Story matcher
 * (2026-07-29, "téves Story-összevonás megszüntetése" sprint,
 * packages/agents/src/deduplication/story-match.ts).
 */
export class StoryMatchRepository {
  constructor(private readonly db: Database) {}

  /**
   * Candidate Stories sharing at least one of the given SPECIFIC
   * (team/player) entity ids, restricted to recently-updated Stories so an
   * ancient, unrelated Story mentioning the same player years ago can't
   * become a candidate. Returns each candidate's full entity set (for
   * scoring) and its contributing raw articles' source URLs (for sport
   * inference) — callers should keep `specificEntityIds` small (typically
   * 0-3 per article).
   */
  async findCandidateStories(
    specificEntityIds: string[],
    sinceDate: Date,
  ): Promise<CandidateStoryRow[]> {
    if (specificEntityIds.length === 0) {
      return [];
    }

    const candidateStoryIdRows = await this.db
      .selectDistinct({ storyId: storyEntities.storyId })
      .from(storyEntities)
      .innerJoin(stories, eq(storyEntities.storyId, stories.id))
      .where(
        and(
          inArray(storyEntities.entityId, specificEntityIds),
          gte(stories.lastUpdatedAt, sinceDate),
        ),
      );

    const storyIds = candidateStoryIdRows.map((row) => row.storyId);
    if (storyIds.length === 0) {
      return [];
    }

    const [storyRows, entityRows, articleRows] = await Promise.all([
      this.db.select().from(stories).where(inArray(stories.id, storyIds)),
      this.db
        .select({
          storyId: storyEntities.storyId,
          entityId: storyEntities.entityId,
          role: storyEntities.role,
          type: entitiesTable.type,
          nameCanonical: entitiesTable.nameCanonical,
        })
        .from(storyEntities)
        .innerJoin(entitiesTable, eq(storyEntities.entityId, entitiesTable.id))
        .where(inArray(storyEntities.storyId, storyIds)),
      this.db
        .select({ storyId: rawArticles.storyId, sourceUrl: rawArticles.sourceUrl })
        .from(rawArticles)
        .where(inArray(rawArticles.storyId, storyIds)),
    ]);

    return storyRows.map((story) => ({
      storyId: story.id,
      canonicalTitle: story.canonicalTitle,
      lastUpdatedAt: story.lastUpdatedAt,
      entities: entityRows
        .filter((row) => row.storyId === story.id)
        .map((row) => ({
          entityId: row.entityId,
          type: row.type,
          nameCanonical: row.nameCanonical,
          role: row.role,
        })),
      rawArticleSourceUrls: articleRows
        .filter((row) => row.storyId === story.id)
        .map((row) => row.sourceUrl),
    }));
  }

  async recordDecision(input: RecordDecisionInput): Promise<string> {
    const [row] = await this.db
      .insert(storyMatchDecisions)
      .values({
        rawArticleId: input.rawArticleId,
        candidateStoryId: input.candidateStoryId,
        resultingStoryId: input.resultingStoryId,
        matchScore: input.matchScore,
        hasSpecificSharedEntity: input.hasSpecificSharedEntity,
        matchedEntities: input.matchedEntities,
        differingEntities: input.differingEntities,
        sportMismatch: input.sportMismatch,
        decision: input.decision,
        decisionReasonHu: input.decisionReasonHu,
        reviewStatus: input.reviewStatus,
      })
      .returning();
    if (!row) {
      throw new Error("story_match_decisions insert returned no row");
    }
    return row.id;
  }

  /** Called by the Story Merge Agent once a needs_review/auto_new_story decision's Story actually exists. */
  async setResultingStory(rawArticleId: string, resultingStoryId: string): Promise<void> {
    await this.db
      .update(storyMatchDecisions)
      .set({ resultingStoryId })
      .where(
        and(
          eq(storyMatchDecisions.rawArticleId, rawArticleId),
          isNull(storyMatchDecisions.resultingStoryId),
        ),
      );
  }

  /** Pending manual-review queue (rule 6) — admin listing / proof-report use. */
  async listPendingReview(limit: number): Promise<StoryMatchDecisionRow[]> {
    return this.db
      .select()
      .from(storyMatchDecisions)
      .where(
        and(
          eq(storyMatchDecisions.decision, "needs_review"),
          eq(storyMatchDecisions.reviewStatus, "pending"),
        ),
      )
      .orderBy(desc(storyMatchDecisions.createdAt))
      .limit(limit);
  }

  /** All decisions, most recent first — proof-report precision/recall breakdown. */
  async listRecent(limit: number): Promise<StoryMatchDecisionRow[]> {
    return this.db
      .select()
      .from(storyMatchDecisions)
      .orderBy(desc(storyMatchDecisions.createdAt))
      .limit(limit);
  }
}

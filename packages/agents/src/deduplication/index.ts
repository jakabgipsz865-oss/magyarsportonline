import {
  computeFingerprint,
  type EntityRepository,
  type RawArticleRepository,
  type StoryMatchRepository,
} from "@magyarsportonline/db";
import { createEventEnvelope, type SportsNewsEvent } from "@magyarsportonline/events";
import type { Logger } from "@magyarsportonline/observability";
import type { AgentRunRecorder } from "../shared/with-agent-run";
import { withAgentRun } from "../shared/with-agent-run";
import { toDateBucket } from "./date-bucket";
import { decideStoryMatch, type CandidateStoryMatchInput } from "./story-match";
import { extractEntityMentions } from "./entity-mentions";
import { inferSportFromUrl } from "./sport";

export * from "./date-bucket";
export * from "./entity-matcher";
export * from "./entity-mentions";
export * from "./merge-audit";
export * from "./sport";
export * from "./story-match";

export const AGENT_VERSION = "deduplication@0.2.0";

/** How far back a candidate Story can have last updated and still be considered for matching — bounds the lookup query and keeps an ancient, unrelated mention of the same player from becoming a candidate. */
const CANDIDATE_LOOKBACK_MS = 3 * 24 * 60 * 60 * 1000;

export interface Emitter {
  emit(event: unknown): Promise<void>;
}

export interface DeduplicationDeps {
  rawArticleRepository: Pick<RawArticleRepository, "getById">;
  entityRepository: Pick<EntityRepository, "listAll">;
  storyMatchRepository: Pick<StoryMatchRepository, "findCandidateStories" | "recordDecision">;
  agentRunRepository: AgentRunRecorder;
  dispatcher: Emitter;
  logger: Logger;
  /**
   * MVP-only coarse category input for the fingerprint (docs/adr/0005-mvp-end-to-end-scope-cuts.md
   * decision 2) — NOT the same thing as `Story.category_id` (that's the SEO
   * Agent's taxonomy assignment, Fázis 8).
   */
  defaultCategorySlug: string;
}

type SourceArticleIngestedEvent = Extract<SportsNewsEvent, { type: "source/article.ingested" }>;

/**
 * Deduplication Agent (docs/architecture/02-agents.md §2.2), rewritten
 * 2026-07-29 ("téves Story-összevonás megszüntetése" sprint) to do REAL
 * scored, multi-factor Story matching instead of a single deterministic
 * (category, primary-entity, day) fingerprint hash — that scheme's single
 * generic "primary entity" (picked by type-priority over the ENTIRE
 * title+body) caused a real production false-merge: 16 unrelated Sky
 * Sports/BBC articles (darts, golf, cricket, racing, F1, tennis, boxing, a
 * football quiz) collapsed into one Story purely because each one's
 * scraped body text happened to contain "Premier League" somewhere
 * (docs/open-decisions.md #12 follow-up).
 *
 * The new flow, per article:
 * 1. Extract every known entity mentioned in the TITLE/LEAD ONLY (never the
 *    full body — `entity-mentions.ts`), infer the sport vertical from the
 *    article's own URL (`sport.ts`), compute the day bucket.
 * 2. Look up candidate Stories sharing at least one SPECIFIC (team/player)
 *    entity, within a recent time window.
 * 3. Score every candidate (`story-match.ts`) and decide: `auto_merge`
 *    (requires a specific shared entity plus enough corroboration),
 *    `needs_review` (specific shared entity, not enough corroboration —
 *    does NOT merge), or `auto_new_story` (everything else, including any
 *    competition/league-only match or a sport mismatch).
 * 4. Persist the FULL decision to `story_match_decisions` (match score,
 *    matched/differing entities, sport mismatch, decision, rationale,
 *    auto/manual) — this is now the actual audit trail the proof report
 *    reads, not a read-time recomputation.
 *
 * `match_type`/`story_id`/`candidates`/`fingerprint_hash` map onto the
 * pre-existing event schema's MATCH/AMBIGUOUS/NEW_STORY vocabulary
 * (packages/events/src/catalog.ts) — that contract already anticipated
 * real scored matching; this MVP had just always reported NEW_STORY.
 * `fingerprint_hash` is still populated (now from sport + the best specific
 * entity + day bucket, never a generic entity) as a soft, informational
 * dedup key the Story Merge Agent uses to serialize concurrent NEW_STORY
 * creation attempts for the auto_new_story/needs_review paths — it is NOT
 * used to look up or match an existing Story anymore (that decision is
 * made here, by the scorer, against real entity data).
 */
export async function handleSourceArticleIngested(
  deps: DeduplicationDeps,
  event: SourceArticleIngestedEvent,
): Promise<void> {
  await withAgentRun(
    {
      agentRunRepository: deps.agentRunRepository,
      agentName: "deduplication",
      correlationId: event.correlation_id,
      triggerEvent: event.type,
    },
    async () => {
      const rawArticle = await deps.rawArticleRepository.getById(event.payload.raw_article_id);
      if (!rawArticle) {
        throw new Error(`RawArticle "${event.payload.raw_article_id}" not found`);
      }

      const entities = await deps.entityRepository.listAll();
      const mentions = extractEntityMentions(rawArticle, entities);
      const sport = inferSportFromUrl(rawArticle.sourceUrl);
      const dateBucket = toDateBucket(rawArticle.publishedAtSource ?? rawArticle.ingestedAt);

      const specificEntityIds = [
        ...new Set(
          mentions
            .filter((m) => m.entity.type === "team" || m.entity.type === "player")
            .map((m) => m.entity.entityId),
        ),
      ];
      const sinceDate = new Date(Date.now() - CANDIDATE_LOOKBACK_MS);
      const candidateRows =
        specificEntityIds.length > 0
          ? await deps.storyMatchRepository.findCandidateStories(specificEntityIds, sinceDate)
          : [];

      const candidates: CandidateStoryMatchInput[] = candidateRows.map((row) => ({
        storyId: row.storyId,
        entities: row.entities.map((e) => ({
          entity: { entityId: e.entityId, type: e.type, nameCanonical: e.nameCanonical },
          role: e.role,
        })),
        sport: row.rawArticleSourceUrls.map(inferSportFromUrl).find((s) => s !== null) ?? null,
        dateBucket: toDateBucket(row.lastUpdatedAt),
      }));

      const decision = decideStoryMatch({ mentions, sport, dateBucket }, candidates);

      const bestSpecificEntityId =
        mentions.find((m) => m.entity.type === "team" || m.entity.type === "player")?.entity
          .entityId ?? `no-entity:${rawArticle.titleOriginal.toLowerCase()}`;
      const fingerprintHash = computeFingerprint({
        category: sport ?? deps.defaultCategorySlug,
        primaryEntityId: bestSpecificEntityId,
        dateBucket,
      });

      // auto_merge already knows its resulting story (= the candidate being
      // merged into); needs_review/auto_new_story only get one once the
      // Story Merge Agent actually creates the Story.
      await deps.storyMatchRepository.recordDecision({
        rawArticleId: rawArticle.id,
        candidateStoryId: decision.candidateStoryId,
        resultingStoryId: decision.kind === "auto_merge" ? decision.candidateStoryId : null,
        matchScore: decision.score,
        hasSpecificSharedEntity: decision.matchedEntities.some(
          (e) => e.type === "team" || e.type === "player",
        ),
        matchedEntities: decision.matchedEntities,
        differingEntities: decision.differingEntities,
        sportMismatch: decision.sportMismatch,
        decision: decision.kind,
        decisionReasonHu: decision.decisionReasonHu,
        reviewStatus: decision.kind === "needs_review" ? "pending" : null,
      });

      const matchType =
        decision.kind === "auto_merge"
          ? ("MATCH" as const)
          : decision.kind === "needs_review"
            ? ("AMBIGUOUS" as const)
            : ("NEW_STORY" as const);

      await deps.dispatcher.emit({
        ...createEventEnvelope({ correlationId: event.correlation_id }),
        type: "story/candidate.identified",
        payload: {
          raw_article_id: rawArticle.id,
          match_type: matchType,
          ...(matchType === "MATCH" && decision.candidateStoryId
            ? { story_id: decision.candidateStoryId }
            : {}),
          ...(matchType === "AMBIGUOUS" && decision.candidateStoryId
            ? { candidates: [{ story_id: decision.candidateStoryId, score: decision.score / 100 }] }
            : {}),
          fingerprint_hash: fingerprintHash,
        },
      });

      deps.logger.info(
        {
          correlationId: event.correlation_id,
          rawArticleId: rawArticle.id,
          decision: decision.kind,
          score: decision.score,
          sport,
        },
        "story match decision",
      );
    },
  );
}

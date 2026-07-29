import type { StoryMatchDecisionKind } from "@magyarsportonline/shared";
import type { MatchedEntity } from "./entity-matcher";
import type { EntityMention } from "./entity-mentions";

export type { StoryMatchDecisionKind };

/** Types a scored match can treat as identifying a SPECIFIC subject (team/player/coach). Coach mentions are seeded as "player"-type entities — the taxonomy has no separate coach type. */
const SPECIFIC_ENTITY_TYPES = new Set(["team", "player"]);
/** Types that alone are never a sufficient reason to merge two Stories (rule 1: competition-only match must never auto-merge). */
const GENERIC_ENTITY_TYPES = new Set(["competition", "league", "venue"]);

export interface ArticleMatchInput {
  mentions: EntityMention[];
  sport: string | null;
  dateBucket: string;
}

/** A candidate existing Story's aggregate entity set — `role` mirrors `story_entities.role` ("subject" for entities found in some contributing article's title/lead, "mentioned" otherwise). */
export interface CandidateStoryEntity {
  entity: MatchedEntity;
  role: "subject" | "opponent" | "mentioned";
}

export interface CandidateStoryMatchInput {
  storyId: string;
  entities: CandidateStoryEntity[];
  sport: string | null;
  dateBucket: string;
}

export interface StoryMatchScore {
  candidateStoryId: string;
  score: number;
  hasSpecificSharedEntity: boolean;
  matchedEntities: MatchedEntity[];
  differingEntities: MatchedEntity[];
  sportMismatch: boolean;
}

const AUTO_MERGE_THRESHOLD = 65;

function isSpecific(entity: MatchedEntity): boolean {
  return SPECIFIC_ENTITY_TYPES.has(entity.type);
}

function isGeneric(entity: MatchedEntity): boolean {
  return GENERIC_ENTITY_TYPES.has(entity.type);
}

function daysBetweenBuckets(a: string, b: string): number {
  const DAY_MS = 24 * 60 * 60 * 1000;
  return Math.abs(Date.parse(`${a}T00:00:00.000Z`) - Date.parse(`${b}T00:00:00.000Z`)) / DAY_MS;
}

/**
 * Scores one candidate Story against a new article's title/lead entity
 * mentions (2026-07-29, "téves Story-összevonás megszüntetése" sprint).
 * Deterministic and explainable by design, matching the rest of this
 * codebase's "no invented probabilistic confidence" discipline (see
 * merge-audit.ts) — every point added/withheld has a concrete, testable
 * reason, not a model output.
 *
 * Hard rules (non-negotiable, checked before any scoring arithmetic):
 * - Rule 5: a known sport mismatch forces score 0, no shared entity.
 * - Rules 1+2: `hasSpecificSharedEntity` is FALSE whenever the only overlap
 *   is generic (competition/league/venue) — the caller MUST treat that as
 *   never auto-mergeable, regardless of how high the numeric score gets
 *   from date/generic corroboration alone (capped well under the
 *   auto-merge threshold by construction below, but the boolean is the
 *   real, explicit gate — see `decideStoryMatch`).
 */
export function scoreStoryMatch(
  article: ArticleMatchInput,
  candidate: CandidateStoryMatchInput,
): StoryMatchScore {
  const sportMismatch =
    article.sport !== null && candidate.sport !== null && article.sport !== candidate.sport;

  if (sportMismatch) {
    return {
      candidateStoryId: candidate.storyId,
      score: 0,
      hasSpecificSharedEntity: false,
      matchedEntities: [],
      differingEntities: [],
      sportMismatch: true,
    };
  }

  const articleEntities = article.mentions.map((m) => m.entity);
  const candidateEntities = candidate.entities.map((e) => e.entity);
  const candidateEntityIds = new Set(candidateEntities.map((e) => e.entityId));
  const articleEntityIds = new Set(articleEntities.map((e) => e.entityId));

  const shared = articleEntities.filter((e) => candidateEntityIds.has(e.entityId));
  const sharedSpecific = shared.filter(isSpecific);
  const sharedGeneric = shared.filter(isGeneric);

  const differing = [
    ...articleEntities.filter((e) => isSpecific(e) && !candidateEntityIds.has(e.entityId)),
    ...candidateEntities.filter((e) => isSpecific(e) && !articleEntityIds.has(e.entityId)),
  ];

  let score = 0;
  if (sharedSpecific.length >= 2) {
    score += 75;
  } else if (sharedSpecific.length === 1) {
    score += 50;
  }

  if (article.dateBucket === candidate.dateBucket) {
    score += 15;
  } else if (daysBetweenBuckets(article.dateBucket, candidate.dateBucket) <= 1) {
    score += 5;
  }

  if (sharedGeneric.length > 0) {
    score += 10;
  }

  return {
    candidateStoryId: candidate.storyId,
    score: Math.min(score, 100),
    hasSpecificSharedEntity: sharedSpecific.length >= 1,
    matchedEntities: shared,
    differingEntities: differing,
    sportMismatch: false,
  };
}

export interface StoryMatchDecision {
  kind: StoryMatchDecisionKind;
  /** The story to merge into (kind="auto_merge") or the best candidate flagged for manual review (kind="needs_review"); null for auto_new_story. */
  candidateStoryId: string | null;
  score: number;
  matchedEntities: MatchedEntity[];
  differingEntities: MatchedEntity[];
  sportMismatch: boolean;
  /** Every candidate considered, sorted best-first — for the "needs_review" candidates list and the audit trail (rule 7). */
  allScores: StoryMatchScore[];
  decisionReasonHu: string;
}

/**
 * Picks the best-scoring candidate (if any) and turns it into a decision.
 * Rules 1+2+6 are enforced HERE, explicitly, not just implied by score
 * thresholds: `auto_merge` requires `hasSpecificSharedEntity === true` on
 * the winning candidate — a candidate that only shares a generic
 * competition/league entity, no matter how many other candidates or how
 * high the date/generic-corroboration bonuses push its score, can never
 * reach `auto_merge`. An uncertain case (has a specific shared entity, but
 * not enough corroboration to clear the auto-merge bar) becomes
 * `needs_review`, never a silent merge.
 */
export function decideStoryMatch(
  article: ArticleMatchInput,
  candidates: CandidateStoryMatchInput[],
): StoryMatchDecision {
  const allScores = candidates
    .map((candidate) => scoreStoryMatch(article, candidate))
    .sort((a, b) => b.score - a.score);

  const best = allScores[0];

  if (!best || !best.hasSpecificSharedEntity) {
    return {
      kind: "auto_new_story",
      candidateStoryId: null,
      score: best?.score ?? 0,
      matchedEntities: best?.matchedEntities ?? [],
      differingEntities: best?.differingEntities ?? [],
      sportMismatch: best?.sportMismatch ?? false,
      allScores,
      decisionReasonHu:
        candidates.length === 0
          ? "Nincs jelölt Story a friss cikk cím/lead-jében talált specifikus (csapat/játékos) entitásokhoz — új Story jön létre."
          : "A legjobban egyező jelölt Story is csak általános (verseny/liga/helyszín) entitást osztott meg a friss cikkel, specifikus (csapat/játékos) egyezés nélkül — ez önmagában soha nem elég az automatikus összevonáshoz, így új Story jön létre.",
    };
  }

  if (best.score >= AUTO_MERGE_THRESHOLD) {
    return {
      kind: "auto_merge",
      candidateStoryId: best.candidateStoryId,
      score: best.score,
      matchedEntities: best.matchedEntities,
      differingEntities: best.differingEntities,
      sportMismatch: false,
      allScores,
      decisionReasonHu: `Legalább egy specifikus (csapat/játékos) közös entitás (${best.matchedEntities
        .filter((e) => SPECIFIC_ENTITY_TYPES.has(e.type))
        .map((e) => e.nameCanonical)
        .join(
          ", ",
        )}) és elegendő megerősítő jel (${best.score}/100 pont) miatt automatikusan összevonva.`,
    };
  }

  return {
    kind: "needs_review",
    candidateStoryId: best.candidateStoryId,
    score: best.score,
    matchedEntities: best.matchedEntities,
    differingEntities: best.differingEntities,
    sportMismatch: false,
    allScores,
    decisionReasonHu: `Van specifikus közös entitás (${best.matchedEntities
      .filter((e) => SPECIFIC_ENTITY_TYPES.has(e.type))
      .map((e) => e.nameCanonical)
      .join(
        ", ",
      )}), de a pontszám (${best.score}/100) nem éri el az automatikus összevonáshoz szükséges ${AUTO_MERGE_THRESHOLD} pontot — kézi review-ba került, a rendszer NEM vonta össze automatikusan.`,
  };
}

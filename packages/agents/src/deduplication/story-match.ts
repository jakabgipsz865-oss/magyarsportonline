import type { StoryMatchDecisionKind } from "@magyarsportonline/shared";
import type { MatchedEntity } from "./entity-matcher";
import type { EntityMention } from "./entity-mentions";

export type { StoryMatchDecisionKind };

/**
 * Types a scored match can treat as identifying a SPECIFIC subject (team,
 * player, or coach) — 2026-07-29 "specifikus entitásfelismerés bővítése"
 * sprint added `coach` as its own entity type (previously coach mentions
 * had nowhere to go in the taxonomy). These are the ONLY types that can
 * ever gate an auto_merge (rules 1+2).
 */
const SPECIFIC_ENTITY_TYPES = new Set(["team", "player", "coach"]);
/** Types that alone are never a sufficient reason to merge two Stories (rule 1: competition-only match must never auto-merge). */
const GENERIC_ENTITY_TYPES = new Set(["competition", "league", "venue"]);

export function isSpecificEntityType(type: string): boolean {
  return SPECIFIC_ENTITY_TYPES.has(type);
}

export function isGenericEntityType(type: string): boolean {
  return GENERIC_ENTITY_TYPES.has(type);
}

function isSpecific(entity: MatchedEntity): boolean {
  return isSpecificEntityType(entity.type);
}

function isGeneric(entity: MatchedEntity): boolean {
  return isGenericEntityType(entity.type);
}

export interface ArticleMatchInput {
  mentions: EntityMention[];
  sport: string | null;
  dateBucket: string;
  /** Competition round/matchday label, if one could be extracted from the title/lead (e.g. "6. forduló", "Quarter-final") — see `extractRoundLabel`. Supplementary corroboration only, never a gate. */
  roundLabel?: string | null;
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
  roundLabel?: string | null;
}

export interface StoryMatchScore {
  candidateStoryId: string;
  score: number;
  hasSpecificSharedEntity: boolean;
  matchedEntities: MatchedEntity[];
  differingEntities: MatchedEntity[];
  sportMismatch: boolean;
}

/** Exported for the admin triage classifier (2026-07-29), which reuses this same bar to flag two ALREADY-CREATED Stories as confident duplicates. */
export const AUTO_MERGE_THRESHOLD = 65;

/** Exported for `missed-merge-candidates.ts`, which needs the same day-distance test to classify a pair as "exact" (same day) vs "adjacent" (1 day apart). */
export function daysBetweenBuckets(a: string, b: string): number {
  const DAY_MS = 24 * 60 * 60 * 1000;
  return Math.abs(Date.parse(`${a}T00:00:00.000Z`) - Date.parse(`${b}T00:00:00.000Z`)) / DAY_MS;
}

/**
 * A competition round/matchday descriptor, extracted from an article's
 * title/lead (2026-07-29, "specifikus entitásfelismerés bővítése" sprint,
 * rule: "versenysorozat és forduló"). Deliberately narrow — English/Hungarian
 * literal patterns only, no fuzzy inference. Used ONLY as supplementary
 * corroboration (never a gate): two articles sharing both a competition
 * entity AND the same round label is a stronger "same real event" signal
 * than sharing the competition alone, but still nowhere near sufficient by
 * itself (rule 1 still applies — competition+round is still just generic
 * context, capped well under the auto-merge threshold by construction in
 * `scoreStoryMatch`).
 */
const ROUND_PATTERNS: RegExp[] = [
  /\b(\d+)(?:st|nd|rd|th)?\s*(?:matchday|gameweek|round)\b/i,
  /\b(?:matchday|gameweek|round)\s*(\d+)\b/i,
  // No trailing \b: JS regex `\b` treats accented letters like "ó" as
  // non-word characters without the unicode-property-escape form, so
  // `forduló\b` fails to match when followed by whitespace (both sides of
  // the boundary end up "non-word"). Dropping it is safe here — a false
  // match on a longer word containing "forduló" as a prefix is a
  // non-issue for this supplementary, never-gating signal.
  /\b(\d+)\.\s*forduló/i,
  /\bquarter-?final\b/i,
  /\bsemi-?final\b/i,
  /\b(?<!quarter-|semi-)\bfinal\b/i,
];

export function extractRoundLabel(text: string): string | null {
  for (const pattern of ROUND_PATTERNS) {
    const match = pattern.exec(text);
    if (match) {
      return match[0].toLowerCase().trim();
    }
  }
  return null;
}

/**
 * Human-readable classification of WHICH kind of specific evidence a match
 * is built on (2026-07-29 sprint, rule: "entitástípusonkénti egyezés" in the
 * proof report) — reporting/explainability only, does not affect the
 * scoring or gating decision above.
 */
export type MatchCategory =
  | "same_team"
  | "same_match"
  | "same_player_or_coach"
  | "transfer_pair"
  | "multiple_specific"
  | "none";

export const MATCH_CATEGORY_LABELS_HU: Record<MatchCategory, string> = {
  same_team: "ugyanaz a csapat",
  same_match: "ugyanaz a mérkőzés (2+ közös csapat)",
  same_player_or_coach: "ugyanaz a játékos/edző",
  transfer_pair: "átigazolási szereplőpár (játékos/edző + csapat)",
  multiple_specific: "több specifikus közös entitás",
  none: "nincs specifikus közös entitás",
};

export function classifyMatchCategory(matchedEntities: MatchedEntity[]): MatchCategory {
  const specific = matchedEntities.filter(isSpecific);
  const teams = specific.filter((e) => e.type === "team");
  const personEntities = specific.filter((e) => e.type === "player" || e.type === "coach");

  if (specific.length === 0) {
    return "none";
  }
  if (teams.length >= 2) {
    return "same_match";
  }
  if (teams.length === 1 && personEntities.length >= 1) {
    return "transfer_pair";
  }
  if (teams.length === 1 && personEntities.length === 0) {
    return "same_team";
  }
  if (teams.length === 0 && personEntities.length === 1) {
    return "same_player_or_coach";
  }
  return "multiple_specific";
}

/**
 * Auto-merge needs evidence that identifies the same real-world event, not
 * merely the same subject. A single team/player/coach can generate several
 * unrelated stories on the same day, so date proximity cannot promote that
 * weak overlap into a silent merge.
 */
export function hasStrongEventIdentity(matchedEntities: MatchedEntity[]): boolean {
  const specific = matchedEntities.filter(isSpecific);
  const teams = specific.filter((entity) => entity.type === "team");
  const people = specific.filter((entity) => entity.type === "player" || entity.type === "coach");

  return teams.length >= 2 || (teams.length >= 1 && people.length >= 1);
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
    // Same competition AND same round/matchday is meaningfully stronger
    // corroboration than the competition alone — still just generic
    // context (never gates auto_merge on its own), so a small bonus only.
    if (article.roundLabel && candidate.roundLabel && article.roundLabel === candidate.roundLabel) {
      score += 5;
    }
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
  matchCategory: MatchCategory;
}

/**
 * Picks the best-scoring candidate (if any) and turns it into a decision.
 * Rules 1+2+6 are enforced HERE, explicitly, not just implied by score
 * thresholds: `auto_merge` requires both a high score and a strong event
 * identity (two shared teams, or a shared team plus a shared player/coach).
 * A competition-only overlap creates a new Story; a single shared
 * team/player/coach is uncertain and becomes `needs_review`, even on the
 * same day.
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
      matchCategory: "none",
      decisionReasonHu:
        candidates.length === 0
          ? "Nincs jelölt Story a friss cikk cím/lead-jében talált specifikus (csapat/játékos/edző) entitásokhoz — új Story jön létre."
          : "A legjobban egyező jelölt Story is csak általános (verseny/liga/helyszín) entitást osztott meg a friss cikkel, specifikus (csapat/játékos/edző) egyezés nélkül — ez önmagában soha nem elég az automatikus összevonáshoz, így új Story jön létre.",
    };
  }

  const matchCategory = classifyMatchCategory(best.matchedEntities);
  const strongEventIdentity = hasStrongEventIdentity(best.matchedEntities);
  const specificNames = best.matchedEntities
    .filter((e) => isSpecificEntityType(e.type))
    .map((e) => e.nameCanonical)
    .join(", ");

  if (best.score >= AUTO_MERGE_THRESHOLD && strongEventIdentity) {
    return {
      kind: "auto_merge",
      candidateStoryId: best.candidateStoryId,
      score: best.score,
      matchedEntities: best.matchedEntities,
      differingEntities: best.differingEntities,
      sportMismatch: false,
      allScores,
      matchCategory,
      decisionReasonHu: `Erős eseményazonosság (${specificNames}) és elegendő megerősítő jel (${best.score}/100 pont, kategória: ${MATCH_CATEGORY_LABELS_HU[matchCategory]}) miatt automatikusan összevonva.`,
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
    matchCategory,
    decisionReasonHu: strongEventIdentity
      ? `Van erős eseményazonosság (${specificNames}, kategória: ${MATCH_CATEGORY_LABELS_HU[matchCategory]}), de a pontszám (${best.score}/100) nem éri el az automatikus összevonáshoz szükséges ${AUTO_MERGE_THRESHOLD} pontot — kézi review-ba került, a rendszer NEM vonta össze automatikusan.`
      : `A közös specifikus entitás (${specificNames}, kategória: ${MATCH_CATEGORY_LABELS_HU[matchCategory]}) önmagában nem bizonyítja, hogy ugyanarról az eseményről van szó — kézi review-ba került, a rendszer NEM vonta össze automatikusan.`,
  };
}

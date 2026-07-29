import type { CandidateStoryRow } from "@magyarsportonline/db";
import type { MissedMergeCandidateType } from "@magyarsportonline/shared";
import { toDateBucket } from "./date-bucket";
import type { MatchedEntity } from "./entity-matcher";
import { inferSportFromUrl } from "./sport";
import {
  daysBetweenBuckets,
  extractRoundLabel,
  isSpecificEntityType,
  scoreStoryMatch,
  type ArticleMatchInput,
  type CandidateStoryEntity,
  type CandidateStoryMatchInput,
} from "./story-match";

export interface MissedMergeCandidatePair {
  storyAId: string;
  storyBId: string;
  candidateType: MissedMergeCandidateType;
  matchScore: number;
  matchedEntities: MatchedEntity[];
  differingEntities: MatchedEntity[];
  decisionReasonHu: string;
}

interface StoryComparison {
  storyId: string;
  dateBucket: string;
  sport: string | null;
  roundLabel: string | null;
  entities: CandidateStoryEntity[];
}

function toComparison(row: CandidateStoryRow): StoryComparison {
  return {
    storyId: row.storyId,
    dateBucket: toDateBucket(row.lastUpdatedAt),
    sport: row.rawArticleSourceUrls.map(inferSportFromUrl).find((s) => s !== null) ?? null,
    roundLabel: extractRoundLabel(row.canonicalTitle),
    entities: row.entities.map((e) => ({
      entity: { entityId: e.entityId, type: e.type, nameCanonical: e.nameCanonical },
      role: e.role,
    })),
  };
}

/**
 * Finds pairs of ALREADY-CREATED Stories the live matcher never had a
 * chance to compare against each other, because it only ever scores a
 * fresh incoming article against existing candidate Stories — never one
 * existing Story against another (2026-07-29, "admin merge-review
 * felület" sprint, docs/open-decisions.md #14 follow-up).
 *
 * A pair is surfaced when the two Stories share at least one SPECIFIC
 * (team/player/coach) entity AND fall on the same UTC day ("exact") or
 * adjacent days ("adjacent") — anything further apart is not surfaced.
 * Each pair's `matchScore`/`matchedEntities`/`differingEntities` come from
 * the SAME `scoreStoryMatch` the live pipeline uses (treating one Story's
 * entity set as the "article" side), so a human reviewing these sees
 * exactly the number the live system would have produced had it compared
 * these two directly.
 *
 * Deliberately does NOT decide anything — every pair returned here is, by
 * construction, something the automatic system cannot and will not
 * auto-merge (it never compares two existing Stories), so a human decision
 * is the only path forward for each one.
 */
export function computeMissedMergeCandidatePairs(
  rows: CandidateStoryRow[],
): MissedMergeCandidatePair[] {
  const comparisons = rows.map(toComparison);
  const byId = new Map(comparisons.map((c) => [c.storyId, c]));

  const storyIdsBySpecificEntity = new Map<string, Set<string>>();
  for (const comparison of comparisons) {
    for (const mention of comparison.entities) {
      if (!isSpecificEntityType(mention.entity.type)) {
        continue;
      }
      const set = storyIdsBySpecificEntity.get(mention.entity.entityId) ?? new Set<string>();
      set.add(comparison.storyId);
      storyIdsBySpecificEntity.set(mention.entity.entityId, set);
    }
  }

  const seenPairs = new Set<string>();
  const pairs: Array<[string, string]> = [];
  for (const storyIds of storyIdsBySpecificEntity.values()) {
    const ids = [...storyIds];
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const idA = ids[i]!;
        const idB = ids[j]!;
        const [first, second] = idA < idB ? [idA, idB] : [idB, idA];
        const key = `${first}|${second}`;
        if (!seenPairs.has(key)) {
          seenPairs.add(key);
          pairs.push([first, second]);
        }
      }
    }
  }

  const results: MissedMergeCandidatePair[] = [];
  for (const [storyAId, storyBId] of pairs) {
    const a = byId.get(storyAId);
    const b = byId.get(storyBId);
    if (!a || !b) {
      continue;
    }

    const dayDiff = daysBetweenBuckets(a.dateBucket, b.dateBucket);
    let candidateType: MissedMergeCandidateType;
    if (dayDiff === 0) {
      candidateType = "exact";
    } else if (dayDiff <= 1) {
      candidateType = "adjacent";
    } else {
      continue;
    }

    const articleInput: ArticleMatchInput = {
      mentions: a.entities.map((e) => ({ entity: e.entity, location: "title" as const })),
      sport: a.sport,
      dateBucket: a.dateBucket,
      roundLabel: a.roundLabel,
    };
    const candidateInput: CandidateStoryMatchInput = {
      storyId: b.storyId,
      entities: b.entities,
      sport: b.sport,
      dateBucket: b.dateBucket,
      roundLabel: b.roundLabel,
    };
    const score = scoreStoryMatch(articleInput, candidateInput);

    // Invariant check: both sides came from the same specific-entity index
    // above, so this should always hold — but never silently surface a
    // pair as a "missed merge candidate" if it somehow doesn't.
    if (!score.hasSpecificSharedEntity) {
      continue;
    }

    const specificNames = score.matchedEntities
      .filter((e) => isSpecificEntityType(e.type))
      .map((e) => e.nameCanonical)
      .join(", ");
    const dayPhraseHu =
      candidateType === "exact" ? "ugyanarra a napra esik" : "egymást követő napokra esik";
    const decisionReasonHu =
      `Közös specifikus (csapat/játékos/edző) entitás: ${specificNames}. A két Story ${dayPhraseHu} ` +
      `(pontszám: ${score.score}/100) — a rendszer két MÁR LÉTEZŐ Storyt sosem hasonlít össze és ` +
      `vonhat össze automatikusan (kizárólag egy friss cikket egy meglévő Story-val), ezért ez a pár ` +
      `csak kézi döntéssel dönthető el.`;

    results.push({
      storyAId,
      storyBId,
      candidateType,
      matchScore: score.score,
      matchedEntities: score.matchedEntities,
      differingEntities: score.differingEntities,
      decisionReasonHu,
    });
  }

  return results.sort((x, y) => y.matchScore - x.matchScore);
}

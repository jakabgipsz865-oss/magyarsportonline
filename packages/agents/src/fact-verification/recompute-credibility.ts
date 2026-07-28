import type {
  FactRepository,
  StoryCredibilityHistoryRepository,
  StoryRepository,
  StorySourceRepository,
} from "@magyarsportonline/db";
import { mergeClaims, type FactWithSource } from "./claim-merge";
import { computeCredibilityScore } from "./credibility-score";
import { sourceReliabilityScore } from "./confidence-score";

export interface RecomputeCredibilityDeps {
  factRepository: Pick<FactRepository, "listByStoryId" | "bumpCorroboration">;
  storySourceRepository: Pick<StorySourceRepository, "sourcesWithMetaByStoryId">;
  storyRepository: Pick<StoryRepository, "getById" | "updateCredibilityResult">;
  storyCredibilityHistoryRepository: Pick<StoryCredibilityHistoryRepository, "insert">;
}

function quoteOf(payload: unknown): string | null {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "quote_original" in payload &&
    typeof (payload as { quote_original: unknown }).quote_original === "string"
  ) {
    const quote = (payload as { quote_original: string }).quote_original;
    return quote.length > 0 ? quote : null;
  }
  return null;
}

/**
 * A Hitelességi mutató v1 megosztott számító magja (2026-07-28-i sprint) —
 * MINDIG az adatbázis JELENLEGI állapotából olvas (nem a hívó memóriájában
 * lévő, esetleg elavult adatokból), ezért ugyanaz a függvény biztonságosan
 * hívható:
 *   1) a Fact Verification Agent futása után (friss állítások + kontradikció-jelölés
 *      már perzisztálva), és
 *   2) az admin "Újraszámolás" műveletéből, miután egy szerkesztő kizárt egy
 *      forrást vagy egy állítást — ilyenkor ez a függvény a MARADÉK,
 *      nem-kizárt adatokból számol újra.
 *
 * Szándékos egyszerűsítés: a kizárt kontradikció-jelzéseket NEM vonja
 * vissza (a `facts.is_contradicted` "ragadós" — egyszer beállítva marad,
 * amíg egy ember explicit nem törli) — ezt lásd docs/open-decisions.md.
 */
export async function recomputeCredibilityForStory(
  deps: RecomputeCredibilityDeps,
  storyId: string,
): Promise<{
  score: number;
  band: string;
  labelHu: string;
  justificationHu: string;
  officialConfirmed: boolean;
  corroboratingSourceCount: number;
}> {
  const story = await deps.storyRepository.getById(storyId);
  if (!story) {
    throw new Error(`Story "${storyId}" not found`);
  }

  const allFacts = await deps.factRepository.listByStoryId(storyId);
  const facts = allFacts.filter((fact) => !fact.excluded);

  const sourceMeta = await deps.storySourceRepository.sourcesWithMetaByStoryId(storyId);
  const activeSourceMetaByRawArticleId = new Map(
    sourceMeta.filter((meta) => !meta.excluded).map((meta) => [meta.rawArticleId, meta]),
  );

  const factsWithSource: FactWithSource[] = [];
  for (const fact of facts) {
    const meta = activeSourceMetaByRawArticleId.get(fact.rawArticleId);
    if (!meta) {
      // The fact's raw article's source link was excluded — this claim no
      // longer contributes to corroboration counting or the credibility
      // score, though the Fact row itself is left untouched.
      continue;
    }
    factsWithSource.push({
      id: fact.id,
      factType: fact.factType,
      payload: fact.payload,
      sourceId: meta.sourceId,
    });
  }

  // Minden újraszámoláskor a TÉNYLEGES, jelenlegi megerősítés-számra
  // frissítünk — lefelé is, nem csak felfelé —, mert egy admin kizárhat egy
  // forrást, ami korábban megerősített egy állítást; ilyenkor a
  // `corroborationCount`-nak vissza kell esnie, különben elavult (túl
  // magas) értéket mutatna a mezőn.
  const claimMerge = mergeClaims(factsWithSource);
  const currentCorroborationByFactId = new Map(
    facts.map((fact) => [fact.id, fact.corroborationCount]),
  );
  for (const [factId, count] of claimMerge.corroboratingSourceCountByFactId) {
    if (currentCorroborationByFactId.get(factId) !== count) {
      await deps.factRepository.bumpCorroboration(factId, count);
    }
  }

  const activeMetas = [...activeSourceMetaByRawArticleId.values()];
  const officialSourcePresent = activeMetas.some(
    (meta) =>
      meta.category === "official" || meta.category === "league" || meta.category === "club",
  );
  const reliabilityWeight = sourceReliabilityScore(activeMetas.map((meta) => meta.reliabilityTier));
  const hasContradiction = facts.some((fact) => fact.isContradicted);
  const hasDirectQuoteOrDocument = facts.some(
    (fact) => fact.factType === "quote" && quoteOf(fact.payload) !== null,
  );

  const credibility = computeCredibilityScore({
    officialSourcePresent,
    independentCorroboratingSourceCount: claimMerge.maxCorroboratingSourceCount,
    sourceReliabilityWeight: reliabilityWeight,
    hasDirectQuoteOrDocument,
    hasContradiction,
    isDeveloping: story.isDeveloping,
    priorUpdateCount: story.versionCount,
  });

  const result = {
    score: credibility.score,
    band: credibility.band.slug,
    labelHu: credibility.band.labelHu,
    justificationHu: credibility.justificationHu,
    officialConfirmed: officialSourcePresent,
    corroboratingSourceCount: claimMerge.maxCorroboratingSourceCount,
  };

  await deps.storyRepository.updateCredibilityResult(storyId, result);
  await deps.storyCredibilityHistoryRepository.insert({
    storyId,
    score: result.score,
    band: result.band,
    labelHu: result.labelHu,
    justificationHu: result.justificationHu,
    officialConfirmed: result.officialConfirmed,
    corroboratingSourceCount: result.corroboratingSourceCount,
    source: "auto",
  });

  return result;
}

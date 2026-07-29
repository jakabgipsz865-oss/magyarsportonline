import { deduplication, factVerification } from "@magyarsportonline/agents";
import type { FactWithSourceInfo } from "@magyarsportonline/db";
import { NextResponse, type NextRequest } from "next/server";
import { createRepositories } from "../../../../lib/db";
import { env } from "../../../../lib/env";
import { getLogger } from "../../../../lib/logger";

const {
  FACT_TYPE_LABELS_HU,
  buildContradictionDetails,
  buildSourceBreakdown,
  quoteOf,
  rawDetailOf,
} = factVerification;

const { auditStoryMerge, entityMatchesText } = deduplication;
type MergeAuditResult = deduplication.MergeAuditResult;

/**
 * "Bizonyító riport" (2026-07-28, kibővítve 2026-07-29) — a felhasználó
 * explicit kérésére: mutassa meg, Storynként, hogy a Hitelesség-magyarázat
 * réteg valódi (nem csak demo-) adatokon értelmesen működik, ÉS hogy a
 * több forrásból épült Story-k TÉNYLEG ugyanarról az eseményről szólnak
 * (nem csak azt bizonyítja, hogy két forrás neve szerepel egy Storyban).
 *
 * A KÖZVETLEN write-oldali táblákból olvas (nem a `story_read_model`-ből),
 * mert `FORCE_REVIEW_MODE=true` miatt a Story-k `pending_review`
 * státuszban maradnak, sosem kerülnek projektálásra — enélkül a riport
 * üres lenne minden még nem manuálisan jóváhagyott Storyra.
 *
 * A `mergeAudit` mező ŐSZINTÉN NEM egy kitalált numerikus "összefésülési
 * confidence"-t ad — a rendszer maga sem számol ilyet (lásd
 * packages/agents/src/deduplication/merge-audit.ts megjegyzését): a
 * párosítás egy DETERMINISZTIKUS fingerprint-egyezés (elsődleges entitás +
 * napi UTC blokk). A riport ezt a tényleges alapot mutatja be
 * bizonyítékként, forrásonként újraszámolva — a "tényleg ugyanarról szól-e"
 * szemantikai kérdést a riportot olvasó embernek kell megválaszolnia.
 *
 * Auth: ugyanaz a `Bearer CRON_SECRET` konvenció, mint a többi `/api/internal/*`
 * végponté.
 */
export const maxDuration = 60;

function claimDetailHu(fact: FactWithSourceInfo): string {
  if (fact.factType === "quote") {
    return quoteOf(fact.payload) ?? rawDetailOf(fact.payload) ?? "(nincs részlet)";
  }
  return rawDetailOf(fact.payload) ?? quoteOf(fact.payload) ?? "(nincs részlet)";
}

/** A Story domináns (leggyakoribb) fact_type-ja — az "eseménytípus" közelítése, LLM-hívás nélkül. */
function dominantFactType(facts: FactWithSourceInfo[]): string | null {
  if (facts.length === 0) return null;
  const counts = new Map<string, number>();
  for (const fact of facts) {
    counts.set(fact.factType, (counts.get(fact.factType) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = -1;
  for (const fact of facts) {
    const count = counts.get(fact.factType) ?? 0;
    if (count > bestCount) {
      best = fact.factType;
      bestCount = count;
    }
  }
  return best;
}

/** A domináns fact_type egy reprezentatív, lehetőleg nem-ellentmondó, legjobban megerősített állítása — a "fő állítás". */
function mainClaimHu(facts: FactWithSourceInfo[], dominantType: string | null): string | null {
  if (dominantType === null) return null;
  const candidates = facts.filter((fact) => fact.factType === dominantType);
  const nonContradicted = candidates.filter((fact) => !fact.isContradicted);
  const pool = nonContradicted.length > 0 ? nonContradicted : candidates;
  const best = [...pool].sort((a, b) => b.corroborationCount - a.corroborationCount)[0];
  return best ? claimDetailHu(best) : null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function daysBetween(bucketA: string, bucketB: string): number {
  return (
    Math.abs(Date.parse(`${bucketA}T00:00:00.000Z`) - Date.parse(`${bucketB}T00:00:00.000Z`)) /
    DAY_MS
  );
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const scanLimit = Number(url.searchParams.get("scanLimit") ?? "100");
  const includeSingleSource = url.searchParams.get("includeSingleSource") === "true";
  if (!Number.isInteger(scanLimit) || scanLimit < 1 || scanLimit > 300) {
    return NextResponse.json({ error: "invalid scanLimit (1-300)" }, { status: 400 });
  }

  try {
    const {
      storyRepository,
      storySourceRepository,
      storyCredibilityHistoryRepository,
      factRepository,
      rawArticleRepository,
      entityRepository,
    } = createRepositories();

    const [stories, entities] = await Promise.all([
      storyRepository.listRecent(scanLimit),
      entityRepository.listAll(),
    ]);

    const dualSourceStories = [];
    let singleSourceCount = 0;
    let storiesWithContradictionCount = 0;
    // Total raw-article count per source name, across every scanned Story
    // (both single- and dual-source) — an operational tally, not a merge
    // signal. Only covers the `scanLimit` most recently updated Stories.
    const articleCountBySourceName = new Map<string, number>();
    // For missed-merge detection across ALL scanned stories (not just the
    // dual-source ones) — keyed by the recomputed (entityId, dateBucket)
    // fingerprint basis, so we can spot stories that SHOULD have merged
    // (same key) but ended up as separate Stories.
    const byFingerprintKey = new Map<
      string,
      Array<{ storyId: string; title: string; slug: string | null; sourceNames: string[] }>
    >();
    const byEntityId = new Map<
      string,
      Array<{
        storyId: string;
        title: string;
        slug: string | null;
        dateBucket: string;
        sourceNames: string[];
      }>
    >();

    for (const story of stories) {
      const [sourcesSummary, factsWithSourceInfo, credibilityHistory, rawArticles] =
        await Promise.all([
          storySourceRepository.summaryByStoryId(story.id),
          factRepository.listByStoryIdWithSourceName(story.id),
          storyCredibilityHistoryRepository.listByStoryId(story.id),
          rawArticleRepository.listByStoryId(story.id),
        ]);

      const distinctSourceNames = new Set(sourcesSummary.map((source) => source.name));
      const sourceCount = distinctSourceNames.size;
      const sourceNameByUrl = new Map(sourcesSummary.map((s) => [s.url, s.name]));

      for (const article of rawArticles) {
        const name = sourceNameByUrl.get(article.sourceUrl);
        if (name) {
          articleCountBySourceName.set(name, (articleCountBySourceName.get(name) ?? 0) + 1);
        }
      }

      // Merge-justification: recompute, per contributing raw article, the
      // same deterministic fingerprint basis the pipeline used at ingest
      // time (packages/agents/src/deduplication/merge-audit.ts).
      const mergeAudit: MergeAuditResult = auditStoryMerge(
        rawArticles.map((article) => ({
          sourceName: sourceNameByUrl.get(article.sourceUrl) ?? "(ismeretlen forrás)",
          sourceUrl: article.sourceUrl,
          titleOriginal: article.titleOriginal,
          bodyOriginal: article.bodyOriginal,
          publishedAtSource: article.publishedAtSource,
          ingestedAt: article.ingestedAt,
        })),
        entities,
      );

      if (mergeAudit.sharedEntity && mergeAudit.sharedDateBucket) {
        const key = `${mergeAudit.sharedEntity.entityId}|${mergeAudit.sharedDateBucket}`;
        const list = byFingerprintKey.get(key) ?? [];
        list.push({
          storyId: story.id,
          title: story.canonicalTitle,
          slug: story.slug,
          sourceNames: [...distinctSourceNames],
        });
        byFingerprintKey.set(key, list);

        const entityList = byEntityId.get(mergeAudit.sharedEntity.entityId) ?? [];
        entityList.push({
          storyId: story.id,
          title: story.canonicalTitle,
          slug: story.slug,
          dateBucket: mergeAudit.sharedDateBucket,
          sourceNames: [...distinctSourceNames],
        });
        byEntityId.set(mergeAudit.sharedEntity.entityId, entityList);
      }

      if (sourceCount < 2 && !includeSingleSource) {
        singleSourceCount += 1;
        continue;
      }

      const contradictions = buildContradictionDetails(factsWithSourceInfo);
      const hasContradiction = contradictions.length > 0;
      if (hasContradiction) {
        storiesWithContradictionCount += 1;
      }
      const latestHistory = credibilityHistory.at(-1);
      const explanation = latestHistory?.explanation as
        | { sourceBreakdown?: unknown; contradictions?: unknown; scoreBreakdown?: unknown }
        | null
        | undefined;

      const resolutionHu = hasContradiction
        ? "A rendszer nem dönt egyik forrás javára sem: mindkét (vagy több) állítást megjeleníti a forrás nevével, és az adott tényt 'nem megerősítettnek' jelöli — ez -30 pontot von le a hitelességi pontszámból, amíg egy szerkesztő fel nem oldja."
        : sourceCount >= 2
          ? "Nem volt ellentmondás a források között — a független források megegyező állításai növelik a hitelességi pontszámot."
          : "Egyetlen forrásból épült fel, nincs mivel összevetni.";

      const dominantType = dominantFactType(factsWithSourceInfo);
      const eventTimeFact = factsWithSourceInfo.find((fact) => fact.factType === "event_time");
      const combinedText = rawArticles.map((a) => `${a.titleOriginal} ${a.bodyOriginal}`).join(" ");
      const involvedEntities = entities
        .filter((entity) => entityMatchesText(entity, combinedText))
        .map((entity) => ({ nameCanonical: entity.nameCanonical, type: entity.type }));

      dualSourceStories.push({
        storyId: story.id,
        slug: story.slug,
        title: story.canonicalTitle,
        sourceCount,
        sourceNames: [...distinctSourceNames],
        claims: factsWithSourceInfo.map((fact) => ({
          factType: fact.factType,
          factTypeLabelHu: FACT_TYPE_LABELS_HU[fact.factType] ?? fact.factType,
          detailHu: claimDetailHu(fact),
          sourceName: fact.sourceName,
          isContradicted: fact.isContradicted,
        })),
        hasContradiction,
        contradictions,
        resolutionHu,
        finalScore: story.credibilityScore,
        band: story.credibilityBand,
        labelHu: story.credibilityLabelHu,
        justificationHu: story.credibilityJustificationHu,
        scoreBreakdown: (explanation?.scoreBreakdown as unknown[] | undefined) ?? [],
        sourceBreakdown:
          (explanation?.sourceBreakdown as unknown[] | undefined) ??
          buildSourceBreakdown(factsWithSourceInfo),
        // --- Esemény-azonosítási bizonyíték (2026-07-29) ---
        eventIdentity: {
          eventTypeHu: dominantType ? (FACT_TYPE_LABELS_HU[dominantType] ?? dominantType) : null,
          mainClaimHu: mainClaimHu(factsWithSourceInfo, dominantType),
          eventTimeDetailHu: eventTimeFact ? claimDetailHu(eventTimeFact) : null,
          involvedEntities,
          perSourceUrls: rawArticles.map((a) => ({
            sourceName: sourceNameByUrl.get(a.sourceUrl) ?? "(ismeretlen forrás)",
            sourceUrl: a.sourceUrl,
            titleOriginal: a.titleOriginal,
            publishedAtSource: a.publishedAtSource?.toISOString() ?? null,
          })),
          mergeAudit,
        },
      });
    }

    // Missed-merge candidates: stories that, by the CURRENT entity table,
    // recompute to the exact same (entity, day) fingerprint basis but ended
    // up as separate Stories — a strong signal the fingerprint drifted
    // between their ingest times (see merge-audit.ts doc comment).
    const missedMergeExact = [...byFingerprintKey.values()]
      .filter((group) => new Set(group.map((g) => g.storyId)).size > 1)
      .map((group) => ({ stories: group }));

    // Softer candidates: same entity, ADJACENT day buckets (<=1 day apart),
    // different Stories — plausible same-event coverage that fell on
    // opposite sides of the UTC day-bucket boundary. Presented for manual
    // review, not asserted as certain.
    const missedMergeCandidates: Array<{
      entityId: string;
      stories: Array<{
        storyId: string;
        title: string;
        slug: string | null;
        dateBucket: string;
        sourceNames: string[];
      }>;
    }> = [];
    for (const [entityId, group] of byEntityId) {
      const byStory = new Map(group.map((g) => [g.storyId, g]));
      const distinct = [...byStory.values()];
      for (let i = 0; i < distinct.length; i++) {
        for (let j = i + 1; j < distinct.length; j++) {
          const a = distinct[i]!;
          const b = distinct[j]!;
          if (a.dateBucket === b.dateBucket) continue; // already covered by missedMergeExact
          if (daysBetween(a.dateBucket, b.dateBucket) <= 1) {
            missedMergeCandidates.push({ entityId, stories: [a, b] });
          }
        }
      }
    }

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      storiesScanned: stories.length,
      dualOrMoreSourceStoriesFound: dualSourceStories.length,
      singleSourceStoriesSkipped: singleSourceCount,
      storiesWithContradictionCount,
      articleCountBySourceName: Object.fromEntries(articleCountBySourceName),
      stories: dualSourceStories,
      missedMergeExact,
      missedMergeCandidates,
    });
  } catch (error) {
    getLogger().error(
      { error: error instanceof Error ? error.message : String(error) },
      "credibility-proof-report failed",
    );
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "credibility-proof-report failed" },
      { status: 500 },
    );
  }
}

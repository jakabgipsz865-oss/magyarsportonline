import { factVerification } from "@magyarsportonline/agents";
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
type FactForExplanation = factVerification.FactForExplanation;

/**
 * "Bizonyító riport" (2026-07-28) — a felhasználó explicit kérésére: mutassa
 * meg, Storynként, hogy a Hitelesség-magyarázat réteg valódi (nem csak
 * demo-) adatokon értelmesen működik. A KÖZVETLEN write-oldali táblákból
 * olvas (nem a `story_read_model`-ből), mert `FORCE_REVIEW_MODE=true` miatt
 * a Story-k `pending_review` státuszban maradnak, sosem kerülnek
 * projektálásra — enélkül a riport üres lenne minden még nem manuálisan
 * jóváhagyott Storyra.
 *
 * Auth: ugyanaz a `Bearer CRON_SECRET` konvenció, mint a többi `/api/internal/*`
 * végponté.
 */
export const maxDuration = 60;

function claimDetailHu(fact: FactForExplanation): string {
  if (fact.factType === "quote") {
    return quoteOf(fact.payload) ?? rawDetailOf(fact.payload) ?? "(nincs részlet)";
  }
  return rawDetailOf(fact.payload) ?? quoteOf(fact.payload) ?? "(nincs részlet)";
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
    } = createRepositories();

    const stories = await storyRepository.listRecent(scanLimit);

    const dualSourceStories = [];
    let singleSourceCount = 0;

    for (const story of stories) {
      const [sourcesSummary, factsWithSourceInfo, credibilityHistory] = await Promise.all([
        storySourceRepository.summaryByStoryId(story.id),
        factRepository.listByStoryIdWithSourceName(story.id),
        storyCredibilityHistoryRepository.listByStoryId(story.id),
      ]);

      const distinctSourceNames = new Set(sourcesSummary.map((source) => source.name));
      const sourceCount = distinctSourceNames.size;

      if (sourceCount < 2 && !includeSingleSource) {
        singleSourceCount += 1;
        continue;
      }

      const contradictions = buildContradictionDetails(factsWithSourceInfo);
      const hasContradiction = contradictions.length > 0;
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
      });
    }

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      storiesScanned: stories.length,
      dualOrMoreSourceStoriesFound: dualSourceStories.length,
      singleSourceStoriesSkipped: singleSourceCount,
      stories: dualSourceStories,
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

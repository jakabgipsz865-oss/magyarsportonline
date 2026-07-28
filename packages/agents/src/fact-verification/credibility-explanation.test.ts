import { describe, expect, it } from "vitest";
import { mergeClaims } from "./claim-merge";
import {
  buildContradictionDetails,
  buildScoreBreakdown,
  buildSourceBreakdown,
  reliabilityDisplayScore,
  winningGroupSourceNames,
  type FactForExplanation,
} from "./credibility-explanation";

function fact(overrides: Partial<FactForExplanation>): FactForExplanation {
  return {
    id: "fact-1",
    factType: "score",
    payload: { detail_hu: "3-1" },
    isContradicted: false,
    sourceId: "source-1",
    sourceName: "BBC Sport",
    category: "trusted_media",
    reliabilityTier: "B",
    trustBaseline: null,
    ...overrides,
  };
}

describe("reliabilityDisplayScore", () => {
  it("prefers the documented trustBaseline over the tier default", () => {
    expect(reliabilityDisplayScore("B", 82)).toBe(82);
  });

  it("falls back to a tier-based default when trustBaseline is undocumented", () => {
    expect(reliabilityDisplayScore("A", null)).toBe(95);
    expect(reliabilityDisplayScore("B", null)).toBe(70);
    expect(reliabilityDisplayScore("C", null)).toBe(40);
  });
});

describe("buildSourceBreakdown", () => {
  it("groups facts by source and counts them", () => {
    const facts = [
      fact({ id: "1", sourceId: "bbc", sourceName: "BBC Sport" }),
      fact({ id: "2", sourceId: "bbc", sourceName: "BBC Sport" }),
      fact({ id: "3", sourceId: "sky", sourceName: "Sky Sports" }),
    ];
    const result = buildSourceBreakdown(facts);
    expect(result).toHaveLength(2);
    const bbc = result.find((r) => r.sourceId === "bbc");
    expect(bbc?.factCount).toBe(2);
    expect(bbc?.factCountLabelHu).toBe("2 állítás");
  });

  it("labels official-category sources with 'hivatalos közlemény' phrasing and a yellow badge", () => {
    const facts = [
      fact({
        id: "1",
        sourceId: "club",
        sourceName: "Liverpool FC",
        category: "club",
        reliabilityTier: "A",
      }),
    ];
    const result = buildSourceBreakdown(facts);
    expect(result[0]?.factCountLabelHu).toBe("1 hivatalos közlemény");
    expect(result[0]?.badgeEmoji).toBe("🟡");
  });

  it("uses a green badge for trusted media sources", () => {
    const result = buildSourceBreakdown([fact({ category: "trusted_media" })]);
    expect(result[0]?.badgeEmoji).toBe("🟢");
  });

  it("uses the documented trustBaseline for reliabilityDisplayScore when present", () => {
    const result = buildSourceBreakdown([fact({ trustBaseline: 88 })]);
    expect(result[0]?.reliabilityDisplayScore).toBe(88);
  });
});

describe("buildContradictionDetails", () => {
  it("returns no contradictions when all sources agree", () => {
    const facts = [
      fact({ id: "1", sourceName: "BBC Sport", payload: { detail_hu: "35 millió euró" } }),
      fact({ id: "2", sourceName: "Sky Sports", payload: { detail_hu: "35 millió euró" } }),
    ];
    expect(buildContradictionDetails(facts)).toEqual([]);
  });

  it("details a transfer-fee disagreement with both sources' exact claims and an unconfirmed status", () => {
    const facts = [
      fact({
        id: "1",
        factType: "transfer_status",
        sourceName: "Sky Sports",
        payload: { detail_hu: "35 millió euróért igazolt át" },
      }),
      fact({
        id: "2",
        factType: "transfer_status",
        sourceName: "BBC Sport",
        payload: { detail_hu: "40 millió euróért igazolt át" },
      }),
    ];
    const result = buildContradictionDetails(facts);
    expect(result).toHaveLength(1);
    expect(result[0]?.factTypeLabelHu).toBe("átigazolási részlet");
    expect(result[0]?.claims).toEqual(
      expect.arrayContaining([
        { sourceName: "Sky Sports", detailHu: "35 millió euróért igazolt át" },
        { sourceName: "BBC Sport", detailHu: "40 millió euróért igazolt át" },
      ]),
    );
    expect(result[0]?.statusHu).toBe("Nem megerősített átigazolási részlet");
  });

  it("ignores quote/other fact types even when they technically disagree", () => {
    const facts = [
      fact({ id: "1", factType: "quote", payload: { detail_hu: "Az egyik idézet" } }),
      fact({ id: "2", factType: "quote", payload: { detail_hu: "Egy másik idézet" } }),
    ];
    expect(buildContradictionDetails(facts)).toEqual([]);
  });
});

describe("buildScoreBreakdown", () => {
  it("produces a labeled, source-attributed entry for each positive factor", () => {
    const entries = buildScoreBreakdown({
      officialSourcePresent: true,
      officialSourceNames: ["Liverpool FC"],
      corroboratingSourceNames: ["BBC Sport", "Sky Sports"],
      reliabilitySummaryHu: "BBC Sport: A, Sky Sports: B",
      reliabilityPoints: 17,
      hasDirectQuoteOrDocument: true,
      hasContradiction: false,
      contradictionSourceNames: [],
      isDeveloping: false,
      priorUpdateCount: 1,
    });

    expect(entries.find((e) => e.labelHu.includes("Hivatalos forrás"))).toMatchObject({
      points: 25,
    });
    expect(entries.find((e) => e.labelHu.includes("független forrás"))).toMatchObject({
      points: 15,
    });
    expect(entries.find((e) => e.labelHu.includes("megbízhatóság"))).toMatchObject({ points: 17 });
    expect(entries.find((e) => e.labelHu.includes("idézet"))).toMatchObject({ points: 10 });
    expect(entries.some((e) => e.points < 0)).toBe(false);
  });

  it("adds a negative, source-attributed entry when there's a contradiction", () => {
    const entries = buildScoreBreakdown({
      officialSourcePresent: false,
      officialSourceNames: [],
      corroboratingSourceNames: ["BBC Sport"],
      reliabilitySummaryHu: "BBC Sport: B",
      reliabilityPoints: 14,
      hasDirectQuoteOrDocument: false,
      hasContradiction: true,
      contradictionSourceNames: ["BBC Sport", "Sky Sports"],
      isDeveloping: true,
      priorUpdateCount: 0,
    });

    const contradictionEntry = entries.find((e) => e.points < 0);
    expect(contradictionEntry?.points).toBe(-30);
    expect(contradictionEntry?.labelHu).toContain("BBC Sport");
    expect(contradictionEntry?.labelHu).toContain("Sky Sports");
  });
});

describe("winningGroupSourceNames", () => {
  it("returns an empty list when no claim has more than 1 corroborating source", () => {
    const facts = [
      fact({ id: "1", sourceId: "sky", sourceName: "Sky Sports", payload: { detail_hu: "35M" } }),
      fact({ id: "2", sourceId: "bbc", sourceName: "BBC Sport", payload: { detail_hu: "40M" } }),
    ];
    const claimMerge = mergeClaims(facts);
    expect(claimMerge.maxCorroboratingSourceCount).toBe(1);
    expect(winningGroupSourceNames(facts, claimMerge)).toEqual([]);
  });

  it("regression: does NOT merge two disagreeing single-source claims into a false 2-source corroboration", () => {
    // This is the exact bug a real Postgres end-to-end run caught: two
    // DIFFERENT, contradicting claims (a transfer fee reported differently
    // by two outlets) each individually have corroboratingSourceCount=1,
    // which used to be naively treated as "both facts tie at the max value
    // of 1" and their source names merged, producing a false "2 independent
    // sources agree" signal even though the sources actually DISAGREE.
    const facts = [
      fact({
        id: "1",
        factType: "transfer_status",
        sourceId: "sky",
        sourceName: "Sky Sports",
        payload: { detail_hu: "35 millió euróért" },
      }),
      fact({
        id: "2",
        factType: "transfer_status",
        sourceId: "bbc",
        sourceName: "BBC Sport",
        payload: { detail_hu: "40 millió euróért" },
      }),
    ];
    const claimMerge = mergeClaims(facts);
    expect(winningGroupSourceNames(facts, claimMerge)).toEqual([]);
  });

  it("correctly identifies the winning group's sources when a real 2-source corroboration exists alongside an unrelated single-source claim", () => {
    const facts = [
      fact({
        id: "1",
        factType: "score",
        sourceId: "sky",
        sourceName: "Sky Sports",
        payload: { detail_hu: "3-1" },
      }),
      fact({
        id: "2",
        factType: "score",
        sourceId: "bbc",
        sourceName: "BBC Sport",
        payload: { detail_hu: "3-1" },
      }),
      fact({
        id: "3",
        factType: "transfer_status",
        sourceId: "sky",
        sourceName: "Sky Sports",
        payload: { detail_hu: "35 millió euróért" },
      }),
    ];
    const claimMerge = mergeClaims(facts);
    expect(claimMerge.maxCorroboratingSourceCount).toBe(2);
    expect(winningGroupSourceNames(facts, claimMerge).sort()).toEqual(["BBC Sport", "Sky Sports"]);
  });
});

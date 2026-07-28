import { describe, expect, it } from "vitest";
import {
  type CorrectionApplicationEvent,
  evaluateCorrectionApplication,
  summarizeCorrectionApplications,
} from "./correction-effectiveness";
import type { EditorialCorrection } from "./editorial-corrections";

function correction(overrides: Partial<EditorialCorrection> = {}): EditorialCorrection {
  return {
    id: "correction-1",
    category: "terminology",
    termEn: "super-sub",
    originalSentenceEn: "He is a real super-sub for this team.",
    currentSentenceHu: "szuper csere",
    correctedSentenceHu: "ütőkártya a cserepadról",
    note: null,
    ...overrides,
  };
}

describe("evaluateCorrectionApplication", () => {
  it("returns 'applied' when only the corrected phrasing appears", () => {
    const result = evaluateCorrectionApplication(
      correction(),
      "A csapat egy igazi ütőkártya a cserepadról nevű játékossal nyert.",
      "He came on as a super-sub again.",
    );
    expect(result?.verdict).toBe("applied");
    expect(result?.evidence).toContain("ütőkártya a cserepadról");
  });

  it("returns 'not_applied' when the old, flagged phrasing recurs", () => {
    const result = evaluateCorrectionApplication(
      correction(),
      "A csapat szuper csere embere döntött a végén.",
      "He came on as a super-sub again.",
    );
    expect(result?.verdict).toBe("not_applied");
    expect(result?.evidence).toContain("szuper csere");
  });

  it("returns 'partial' when both the old and the corrected phrasing appear", () => {
    const result = evaluateCorrectionApplication(
      correction(),
      "Az egyik helyen szuper csere, másutt ütőkártya a cserepadról a leírás.",
      "He came on as a super-sub again.",
    );
    expect(result?.verdict).toBe("partial");
  });

  it("returns 'partial' when the term is relevant in the source but neither exact phrasing matches the output", () => {
    const result = evaluateCorrectionApplication(
      correction(),
      "A csereként beállt játékos megváltoztatta a mérkőzés menetét.",
      "He came on as a real super-sub today.",
    );
    expect(result?.verdict).toBe("partial");
    expect(result?.evidence).toContain("super-sub");
  });

  it("returns null when the correction's topic never comes up", () => {
    const result = evaluateCorrectionApplication(
      correction(),
      "A hazai csapat magabiztosan nyert idegenben.",
      "The home team secured a comfortable away win.",
    );
    expect(result).toBeNull();
  });

  it("is case-insensitive when matching the old/new phrasing", () => {
    const result = evaluateCorrectionApplication(
      correction(),
      "ÜTŐKÁRTYA A CSEREPADRÓL volt a nap hőse.",
      "",
    );
    expect(result?.verdict).toBe("applied");
  });
});

describe("summarizeCorrectionApplications", () => {
  function event(verdict: CorrectionApplicationEvent["verdict"], daysAgo: number) {
    return { verdict, detectedAt: new Date(Date.now() - daysAgo * 86_400_000) };
  }

  it("returns zeroed counts and no trend for an empty event list", () => {
    const summary = summarizeCorrectionApplications([]);
    expect(summary).toEqual({
      totalCount: 0,
      appliedCount: 0,
      partialCount: 0,
      notAppliedCount: 0,
      latestVerdict: null,
      trend: null,
    });
  });

  it("counts each verdict and reports the most recent as latestVerdict", () => {
    const summary = summarizeCorrectionApplications([
      event("not_applied", 5),
      event("applied", 1),
      event("partial", 3),
    ]);
    expect(summary.totalCount).toBe(3);
    expect(summary.appliedCount).toBe(1);
    expect(summary.partialCount).toBe(1);
    expect(summary.notAppliedCount).toBe(1);
    expect(summary.latestVerdict).toBe("applied");
  });

  it("reports 'improved' when the latest verdict outranks the previous one", () => {
    const summary = summarizeCorrectionApplications([event("not_applied", 2), event("applied", 1)]);
    expect(summary.trend).toBe("improved");
  });

  it("reports 'worsened' when the latest verdict underranks the previous one", () => {
    const summary = summarizeCorrectionApplications([event("applied", 2), event("not_applied", 1)]);
    expect(summary.trend).toBe("worsened");
  });

  it("reports 'unchanged' when the latest two verdicts are the same", () => {
    const summary = summarizeCorrectionApplications([event("partial", 2), event("partial", 1)]);
    expect(summary.trend).toBe("unchanged");
  });

  it("returns null trend when there is only a single event", () => {
    const summary = summarizeCorrectionApplications([event("applied", 1)]);
    expect(summary.trend).toBeNull();
  });
});

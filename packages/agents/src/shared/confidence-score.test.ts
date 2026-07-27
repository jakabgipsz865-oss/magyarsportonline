import { describe, expect, it } from "vitest";
import { computeConfidenceScore } from "./confidence-score.js";

describe("computeConfidenceScore", () => {
  it("gives a low score for a single, unstable, developing source", () => {
    const score = computeConfidenceScore({
      independentSourceCount: 1,
      reliabilityTiers: ["B"],
      contradictionCount: 0,
      isDeveloping: true,
    });
    // 0.35*0.3 + 0.25*0.7 + 0.25*1 + 0.15*0.6 = 0.105+0.175+0.25+0.09 = 0.62
    expect(score).toBeCloseTo(0.62, 6);
  });

  it("increases when a second independent source corroborates", () => {
    const oneSource = computeConfidenceScore({
      independentSourceCount: 1,
      reliabilityTiers: ["B"],
      contradictionCount: 0,
      isDeveloping: false,
    });
    const twoSources = computeConfidenceScore({
      independentSourceCount: 2,
      reliabilityTiers: ["B", "B"],
      contradictionCount: 0,
      isDeveloping: false,
    });
    expect(twoSources).toBeGreaterThan(oneSource);
  });

  it("penalizes contradictions", () => {
    const noContradiction = computeConfidenceScore({
      independentSourceCount: 2,
      reliabilityTiers: ["A", "A"],
      contradictionCount: 0,
      isDeveloping: false,
    });
    const withContradiction = computeConfidenceScore({
      independentSourceCount: 2,
      reliabilityTiers: ["A", "A"],
      contradictionCount: 1,
      isDeveloping: false,
    });
    expect(withContradiction).toBeLessThan(noContradiction);
  });

  it("stays within [0, 1]", () => {
    const max = computeConfidenceScore({
      independentSourceCount: 10,
      reliabilityTiers: ["A", "A", "A"],
      contradictionCount: 0,
      isDeveloping: false,
    });
    const min = computeConfidenceScore({
      independentSourceCount: 0,
      reliabilityTiers: [],
      contradictionCount: 10,
      isDeveloping: true,
    });
    expect(max).toBeLessThanOrEqual(1);
    expect(min).toBeGreaterThanOrEqual(0);
  });
});

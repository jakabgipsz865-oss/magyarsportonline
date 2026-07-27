import { describe, expect, it } from "vitest";
import { computeConfidenceScore } from "./confidence-score";

describe("computeConfidenceScore", () => {
  it("scores a single-source, developing, consistent story low", () => {
    const score = computeConfidenceScore({
      sourceCount: 1,
      reliabilityTiers: ["B"],
      hasContradiction: false,
      isDeveloping: true,
    });
    // 0.35*0.3 + 0.25*0.7 + 0.25*1.0 + 0.15*0.6 = 0.105+0.175+0.25+0.09 = 0.62
    expect(score).toBeCloseTo(0.62, 3);
  });

  it("scores higher with 3+ A-tier sources and no contradiction", () => {
    const score = computeConfidenceScore({
      sourceCount: 3,
      reliabilityTiers: ["A", "A", "B"],
      hasContradiction: false,
      isDeveloping: false,
    });
    expect(score).toBeGreaterThan(0.85);
  });

  it("penalizes a contradiction", () => {
    const withContradiction = computeConfidenceScore({
      sourceCount: 2,
      reliabilityTiers: ["A", "A"],
      hasContradiction: true,
      isDeveloping: false,
    });
    const withoutContradiction = computeConfidenceScore({
      sourceCount: 2,
      reliabilityTiers: ["A", "A"],
      hasContradiction: false,
      isDeveloping: false,
    });
    expect(withContradiction).toBeLessThan(withoutContradiction);
  });

  it("clamps to [0, 1]", () => {
    const score = computeConfidenceScore({
      sourceCount: 10,
      reliabilityTiers: ["A", "A", "A"],
      hasContradiction: false,
      isDeveloping: false,
    });
    expect(score).toBeLessThanOrEqual(1);
    expect(score).toBeGreaterThanOrEqual(0);
  });

  it("defaults reliability to 0.5 when no tiers are known", () => {
    const score = computeConfidenceScore({
      sourceCount: 1,
      reliabilityTiers: [],
      hasContradiction: false,
      isDeveloping: true,
    });
    expect(score).toBeCloseTo(0.57, 3);
  });
});

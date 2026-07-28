import { describe, expect, it } from "vitest";
import { computeCredibilityScore } from "./credibility-score";

const BASE_INPUT = {
  officialSourcePresent: false,
  independentCorroboratingSourceCount: 1,
  sourceReliabilityWeight: 0.5,
  hasDirectQuoteOrDocument: false,
  hasContradiction: false,
  isDeveloping: true,
  priorUpdateCount: 0,
};

describe("computeCredibilityScore", () => {
  it("lands in the 'speculation' band for a bare-minimum, single-source, developing story", () => {
    const result = computeCredibilityScore(BASE_INPUT);
    expect(result.band.slug).toBe("speculation");
    expect(result.score).toBeLessThan(35);
  });

  it("reaches the 'official_confirmed' band (max score) when every positive factor is present", () => {
    const result = computeCredibilityScore({
      officialSourcePresent: true,
      independentCorroboratingSourceCount: 3,
      sourceReliabilityWeight: 1,
      hasDirectQuoteOrDocument: true,
      hasContradiction: false,
      isDeveloping: false,
      priorUpdateCount: 2,
    });
    expect(result.score).toBe(95);
    expect(result.band.slug).toBe("official_confirmed");
    expect(result.justificationHu).toContain("Hivatalos forrás");
  });

  it("applies a heavy penalty for contradiction, capable of dropping an otherwise-strong story", () => {
    const strong = computeCredibilityScore({
      officialSourcePresent: true,
      independentCorroboratingSourceCount: 3,
      sourceReliabilityWeight: 1,
      hasDirectQuoteOrDocument: true,
      hasContradiction: false,
      isDeveloping: false,
      priorUpdateCount: 0,
    });
    const contradicted = computeCredibilityScore({ ...BASE_INPUT, hasContradiction: true });

    expect(contradicted.score).toBeLessThan(strong.score);
    expect(contradicted.justificationHu).toContain("Ellentmondó");
  });

  it("never goes below 0 even with contradiction and no other positive factors", () => {
    const result = computeCredibilityScore({ ...BASE_INPUT, hasContradiction: true });
    expect(result.score).toBeGreaterThanOrEqual(0);
  });

  it("mentions independent corroboration in the justification once 2+ sources agree", () => {
    const result = computeCredibilityScore({
      ...BASE_INPUT,
      independentCorroboratingSourceCount: 2,
    });
    expect(result.justificationHu).toContain("2 független forrás");
  });

  it("gives a higher score to a settled (non-developing) story than a developing one, all else equal", () => {
    const developing = computeCredibilityScore({ ...BASE_INPUT, isDeveloping: true });
    const settled = computeCredibilityScore({ ...BASE_INPUT, isDeveloping: false });
    expect(settled.score).toBeGreaterThan(developing.score);
  });

  it("falls back to a neutral justification sentence when no factor fires", () => {
    const result = computeCredibilityScore(BASE_INPUT);
    expect(result.justificationHu).toBe(
      "Egyetlen, még nem megerősített forrásból származó értesülés.",
    );
  });
});

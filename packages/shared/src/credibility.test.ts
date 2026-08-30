import { describe, expect, it } from "vitest";
import { publicCredibilityRating } from "./credibility";

describe("publicCredibilityRating", () => {
  it("rates a contradiction-free single A-tier source as strong, not speculation", () => {
    expect(
      publicCredibilityRating({
        officialConfirmed: false,
        sourceReliabilityTiers: ["A"],
        independentCorroborationCount: 0,
        hasContradiction: false,
      }),
    ).toMatchObject({ level: 4, slug: "strong_source" });
  });

  it("treats only additional independent sources as corroboration", () => {
    const singleSource = publicCredibilityRating({
      officialConfirmed: false,
      sourceReliabilityTiers: ["B"],
      independentCorroborationCount: 0,
      hasContradiction: false,
    });
    const corroborated = publicCredibilityRating({
      officialConfirmed: false,
      sourceReliabilityTiers: ["B", "B"],
      independentCorroborationCount: 1,
      hasContradiction: false,
    });

    expect(singleSource.level).toBe(3);
    expect(corroborated.level).toBe(4);
  });

  it("uses official confirmation as the strongest signal and contradictions as a cap", () => {
    expect(
      publicCredibilityRating({
        officialConfirmed: true,
        sourceReliabilityTiers: ["C"],
        independentCorroborationCount: 0,
        hasContradiction: false,
      }).level,
    ).toBe(5);
    expect(
      publicCredibilityRating({
        officialConfirmed: true,
        sourceReliabilityTiers: ["A"],
        independentCorroborationCount: 2,
        hasContradiction: true,
      }).level,
    ).toBe(2);
  });
});

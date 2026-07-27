import { describe, expect, it } from "vitest";
import { decidePublish } from "./rule";

describe("decidePublish", () => {
  it("auto-publishes low risk, high confidence, no contradiction", () => {
    expect(
      decidePublish({ riskLevel: "low", confidenceScore: 0.7, hasContradiction: false }),
    ).toEqual({
      autoPublish: true,
    });
  });

  it("sends medium/high risk to review as high_risk", () => {
    expect(
      decidePublish({ riskLevel: "medium", confidenceScore: 0.9, hasContradiction: false }),
    ).toEqual({ autoPublish: false, reason: "high_risk" });
    expect(
      decidePublish({ riskLevel: "high", confidenceScore: 0.9, hasContradiction: false }),
    ).toEqual({ autoPublish: false, reason: "high_risk" });
  });

  it("sends a contradiction to review even at low risk and high confidence", () => {
    expect(
      decidePublish({ riskLevel: "low", confidenceScore: 0.9, hasContradiction: true }),
    ).toEqual({
      autoPublish: false,
      reason: "contradiction",
    });
  });

  it("sends below-threshold confidence to review", () => {
    expect(
      decidePublish({ riskLevel: "low", confidenceScore: 0.5, hasContradiction: false }),
    ).toEqual({
      autoPublish: false,
      reason: "low_confidence",
    });
  });

  it("treats exactly the threshold as sufficient", () => {
    expect(
      decidePublish({ riskLevel: "low", confidenceScore: 0.65, hasContradiction: false }),
    ).toEqual({ autoPublish: true });
  });

  it("sends unresolved Content Quality Gate issues to review even at low risk and high confidence", () => {
    expect(
      decidePublish({
        riskLevel: "low",
        confidenceScore: 0.9,
        hasContradiction: false,
        hasQualityIssues: true,
      }),
    ).toEqual({ autoPublish: false, reason: "content_quality_failed" });
  });

  it("forceReviewMode overrides every other condition, including an otherwise-clean low-risk/high-confidence story", () => {
    expect(
      decidePublish({
        riskLevel: "low",
        confidenceScore: 0.9,
        hasContradiction: false,
        forceReviewMode: true,
      }),
    ).toEqual({ autoPublish: false, reason: "force_review_mode" });
  });
});

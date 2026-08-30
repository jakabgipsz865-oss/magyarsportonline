import { describe, expect, it } from "vitest";
import { decidePublish, type PublishDecisionInput } from "./rule";

describe("decidePublish", () => {
  const eligibleSingleSource = {
    publicationReady: true,
    singleSource: { count: 1, fullArticleCount: 1, category: "tabloid" as const },
  };
  const singleSourceInput = (
    overrides: Partial<PublishDecisionInput> = {},
  ): PublishDecisionInput => ({
    riskLevel: "low",
    confidenceScore: 0.545,
    hasContradiction: false,
    ...eligibleSingleSource,
    ...overrides,
  });

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

  it("allows the attributed single-source exception for tabloid and trusted media", () => {
    expect(
      decidePublish({
        riskLevel: "low",
        confidenceScore: 0.545,
        hasContradiction: false,
        ...eligibleSingleSource,
      }),
    ).toEqual({ autoPublish: true });
    expect(
      decidePublish({
        riskLevel: "low",
        confidenceScore: 0.62,
        hasContradiction: false,
        publicationReady: true,
        singleSource: { count: 1, fullArticleCount: 1, category: "trusted_media" },
      }),
    ).toEqual({ autoPublish: true });
  });

  it("blocks the exception for snippet-only, confidence below 0.50, or unsupported category", () => {
    expect(
      decidePublish(
        singleSourceInput({
          singleSource: { count: 1, fullArticleCount: 0, category: "tabloid" },
        }),
      ),
    ).toEqual({ autoPublish: false, reason: "low_confidence" });
    expect(decidePublish(singleSourceInput({ confidenceScore: 0.49 }))).toEqual({
      autoPublish: false,
      reason: "low_confidence",
    });
    expect(
      decidePublish(
        singleSourceInput({
          singleSource: { count: 1, fullArticleCount: 1, category: "official" },
        }),
      ),
    ).toEqual({ autoPublish: false, reason: "low_confidence" });
    expect(
      decidePublish(
        singleSourceInput({
          singleSource: { count: 1, fullArticleCount: 1, category: null },
        }),
      ),
    ).toEqual({ autoPublish: false, reason: "low_confidence" });
  });

  it("does not let the exception bypass risk, contradiction, or quality checks", () => {
    expect(decidePublish(singleSourceInput({ riskLevel: "high" }))).toEqual({
      autoPublish: false,
      reason: "high_risk",
    });
    expect(decidePublish(singleSourceInput({ hasContradiction: true }))).toEqual({
      autoPublish: false,
      reason: "contradiction",
    });
    expect(
      decidePublish(singleSourceInput({ hasQualityIssues: true, publicationReady: false })),
    ).toEqual({ autoPublish: false, reason: "content_quality_failed" });
    expect(decidePublish(singleSourceInput({ forceReviewMode: true }))).toEqual({
      autoPublish: false,
      reason: "force_review_mode",
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

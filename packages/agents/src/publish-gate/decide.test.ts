import { describe, expect, it } from "vitest";
import { decidePublishGate } from "./decide.js";

describe("decidePublishGate", () => {
  it("auto-publishes low risk, high confidence, no contradiction", () => {
    expect(
      decidePublishGate({ confidenceScore: 0.8, riskLevel: "low", hasContradiction: false }),
    ).toEqual({ decision: "auto_publish" });
  });

  it("requires review for anything above low risk, regardless of confidence", () => {
    expect(
      decidePublishGate({ confidenceScore: 0.99, riskLevel: "medium", hasContradiction: false }),
    ).toEqual({ decision: "review_required", reason: "high_risk" });
    expect(
      decidePublishGate({ confidenceScore: 0.99, riskLevel: "high", hasContradiction: false }),
    ).toEqual({ decision: "review_required", reason: "high_risk" });
  });

  it("requires review when there is a contradiction, even at low risk", () => {
    expect(
      decidePublishGate({ confidenceScore: 0.9, riskLevel: "low", hasContradiction: true }),
    ).toEqual({ decision: "review_required", reason: "contradiction" });
  });

  it("requires review when confidence is below the threshold", () => {
    expect(
      decidePublishGate({ confidenceScore: 0.5, riskLevel: "low", hasContradiction: false }),
    ).toEqual({ decision: "review_required", reason: "low_confidence" });
  });

  it("auto-publishes exactly at the confidence threshold", () => {
    expect(
      decidePublishGate({ confidenceScore: 0.65, riskLevel: "low", hasContradiction: false }),
    ).toEqual({ decision: "auto_publish" });
  });
});

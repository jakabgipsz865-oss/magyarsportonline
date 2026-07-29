import { describe, expect, it } from "vitest";
import { classifyStoryTriage, type StoryTriageInput } from "./triage";

function input(overrides: Partial<StoryTriageInput> = {}): StoryTriageInput {
  return {
    isAiGenerated: true,
    qualityIssueKinds: [],
    credibilityScore: 55,
    hasContradiction: false,
    hasAmbiguousMergeDecision: false,
    isConfidentDuplicate: false,
    detectedSport: "football",
    hasAnyRecognizedEntity: true,
    ageDays: 1,
    ...overrides,
  };
}

describe("classifyStoryTriage", () => {
  it("classifies a fully clean Story as ready_for_review", () => {
    const result = classifyStoryTriage(input());
    expect(result.category).toBe("ready_for_review");
  });

  it("classifies a confident duplicate as reject_or_archive, even if it also has quality issues", () => {
    const result = classifyStoryTriage(
      input({ isConfidentDuplicate: true, qualityIssueKinds: ["looks_english"] }),
    );
    expect(result.category).toBe("reject_or_archive");
    expect(result.reasonsHu[0]).toContain("duplikátum");
  });

  it("classifies an off-topic sport (not football) as reject_or_archive", () => {
    const result = classifyStoryTriage(input({ detectedSport: "darts" }));
    expect(result.category).toBe("reject_or_archive");
    expect(result.reasonsHu[0]).toContain("darts");
  });

  it("does not reject when the sport is simply unknown (null) rather than confidently off-topic", () => {
    const result = classifyStoryTriage(input({ detectedSport: null }));
    expect(result.category).toBe("ready_for_review");
  });

  it("classifies a stale Story (>14 days) as reject_or_archive", () => {
    const result = classifyStoryTriage(input({ ageDays: 20 }));
    expect(result.category).toBe("reject_or_archive");
    expect(result.reasonsHu[0]).toContain("20");
  });

  it("classifies a No-LLM (non-AI-generated) Story as auto_repair_required", () => {
    const result = classifyStoryTriage(input({ isAiGenerated: false }));
    expect(result.category).toBe("auto_repair_required");
  });

  it("classifies a Story with quality-gate issues as auto_repair_required", () => {
    const result = classifyStoryTriage(input({ qualityIssueKinds: ["looks_english", "empty"] }));
    expect(result.category).toBe("auto_repair_required");
    expect(result.reasonsHu[0]).toContain("looks_english");
  });

  it("classifies a Story with no credibility score as auto_repair_required", () => {
    const result = classifyStoryTriage(input({ credibilityScore: null }));
    expect(result.category).toBe("auto_repair_required");
  });

  it("auto_repair_required takes priority over a downstream human_decision_required signal", () => {
    const result = classifyStoryTriage(input({ isAiGenerated: false, hasContradiction: true }));
    expect(result.category).toBe("auto_repair_required");
  });

  it("classifies a contradiction (with everything else clean) as human_decision_required", () => {
    const result = classifyStoryTriage(input({ hasContradiction: true }));
    expect(result.category).toBe("human_decision_required");
  });

  it("classifies an ambiguous pending merge decision as human_decision_required", () => {
    const result = classifyStoryTriage(input({ hasAmbiguousMergeDecision: true }));
    expect(result.category).toBe("human_decision_required");
  });

  it("classifies a Story with no recognized entity at all as human_decision_required, not auto-rejected", () => {
    const result = classifyStoryTriage(input({ hasAnyRecognizedEntity: false }));
    expect(result.category).toBe("human_decision_required");
  });

  it("reject_or_archive takes priority over auto_repair_required signals", () => {
    const result = classifyStoryTriage(
      input({ detectedSport: "golf", isAiGenerated: false, credibilityScore: null }),
    );
    expect(result.category).toBe("reject_or_archive");
  });
});

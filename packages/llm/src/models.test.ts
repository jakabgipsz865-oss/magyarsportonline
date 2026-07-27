import { describe, expect, it } from "vitest";
import { estimateCostUsd } from "./models.js";

describe("estimateCostUsd", () => {
  it("computes cost from the pricing table for a known model", () => {
    const cost = estimateCostUsd("claude-haiku-4-5-20251001", 1_000_000, 1_000_000);
    expect(cost).toBe(1 + 5);
  });

  it("scales linearly with token counts", () => {
    const cost = estimateCostUsd("claude-sonnet-5", 500_000, 100_000);
    expect(cost).toBeCloseTo(3 * 0.5 + 15 * 0.1, 6);
  });

  it("returns null for an unknown model instead of guessing", () => {
    expect(estimateCostUsd("some-future-model", 1000, 1000)).toBeNull();
  });
});

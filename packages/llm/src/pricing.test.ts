import { describe, expect, it } from "vitest";
import {
  estimateCloudflareCostUsd,
  estimateGeminiCostUsd,
  estimateNeuronsFromCostUsd,
} from "./pricing";

describe("estimateNeuronsFromCostUsd", () => {
  it("converts $0.011 into 1,000 Neurons (Cloudflare's list price)", () => {
    expect(estimateNeuronsFromCostUsd(0.011)).toBeCloseTo(1000);
  });

  it("derives a Neuron estimate from a real Qwen3 token cost", () => {
    const costUsd = estimateCloudflareCostUsd("@cf/qwen/qwen3-30b-a3b-fp8", 1000, 1000);
    expect(estimateNeuronsFromCostUsd(costUsd)).toBeGreaterThan(0);
  });
});

describe("estimateGeminiCostUsd", () => {
  it("includes the Unified Billing fee for Flash-Lite", () => {
    expect(estimateGeminiCostUsd("gemini-3.5-flash-lite", 1_000_000, 1_000_000)).toBeCloseTo(2.94);
  });
});

import { describe, expect, it } from "vitest";
import {
  BudgetGuardedLlmClient,
  startOfCurrentMonthUtc,
  type BudgetGuardLogger,
  type LlmUsageStore,
} from "./budget-guard";
import type { LlmClient } from "./client";
import { estimateCostUsd, MODEL_PRICING, UNKNOWN_MODEL_PRICING } from "./pricing";

function makeClient(label: string): LlmClient {
  return {
    completeText: () => Promise.resolve({ text: label, inputTokens: 1000, outputTokens: 2000 }),
    completeJson: () =>
      Promise.resolve({ data: { from: label }, inputTokens: 1000, outputTokens: 2000 }),
  };
}

class FakeUsageStore implements LlmUsageStore {
  entries: Array<{ model: string; inputTokens: number; outputTokens: number; costUsd: number }> =
    [];
  constructor(
    private spentUsd = 0,
    private failSum = false,
  ) {}
  sumCostUsdSince(): Promise<number> {
    if (this.failSum) {
      return Promise.reject(new Error("db down"));
    }
    return Promise.resolve(this.spentUsd);
  }
  insert(entry: {
    model: string;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  }): Promise<unknown> {
    this.entries.push(entry);
    return Promise.resolve(entry);
  }
}

const silentLogger: BudgetGuardLogger = { warn: () => undefined, error: () => undefined };

const textRequest = {
  model: "claude-sonnet-5",
  system: "s",
  messages: [{ role: "user" as const, content: "c" }],
  maxTokens: 100,
};

function makeGuard(store: FakeUsageStore, budget = 5) {
  return new BudgetGuardedLlmClient({
    inner: makeClient("inner"),
    fallback: makeClient("fallback"),
    usageStore: store,
    monthlyBudgetUsd: budget,
    logger: silentLogger,
  });
}

describe("estimateCostUsd", () => {
  it("prices known models from the pricing table", () => {
    expect(estimateCostUsd("claude-haiku-4-5", 1_000_000, 1_000_000)).toBeCloseTo(
      MODEL_PRICING["claude-haiku-4-5"]!.inputUsdPerMTok +
        MODEL_PRICING["claude-haiku-4-5"]!.outputUsdPerMTok,
    );
  });

  it("over-estimates unknown models with the conservative fallback tier", () => {
    expect(estimateCostUsd("some-future-model", 1_000_000, 0)).toBeCloseTo(
      UNKNOWN_MODEL_PRICING.inputUsdPerMTok,
    );
  });
});

describe("startOfCurrentMonthUtc", () => {
  it("returns the first day of the month at midnight UTC", () => {
    const start = startOfCurrentMonthUtc(new Date("2026-07-27T18:45:00Z"));
    expect(start.toISOString()).toBe("2026-07-01T00:00:00.000Z");
  });
});

describe("BudgetGuardedLlmClient", () => {
  it("uses the inner client and records usage while under budget", async () => {
    const store = new FakeUsageStore(0);
    const result = await makeGuard(store).completeText(textRequest);
    expect(result.text).toBe("inner");
    expect(store.entries).toHaveLength(1);
    expect(store.entries[0]!.model).toBe("claude-sonnet-5");
    expect(store.entries[0]!.costUsd).toBeCloseTo(estimateCostUsd("claude-sonnet-5", 1000, 2000));
  });

  it("falls back to the No-LLM client once the monthly budget is reached", async () => {
    const store = new FakeUsageStore(5);
    const result = await makeGuard(store, 5).completeText(textRequest);
    expect(result.text).toBe("fallback");
    expect(store.entries).toHaveLength(0);
  });

  it("guards completeJson the same way", async () => {
    const store = new FakeUsageStore(999);
    const result = await makeGuard(store).completeJson({
      ...textRequest,
      jsonSchema: { type: "object", additionalProperties: false },
    });
    expect(result.data).toEqual({ from: "fallback" });
  });

  it("fails closed to the fallback when the budget check itself errors", async () => {
    const store = new FakeUsageStore(0, true);
    const result = await makeGuard(store).completeText(textRequest);
    expect(result.text).toBe("fallback");
  });

  it("still returns the inner result when usage recording fails", async () => {
    const store = new FakeUsageStore(0);
    store.insert = () => Promise.reject(new Error("insert failed"));
    const result = await makeGuard(store).completeText(textRequest);
    expect(result.text).toBe("inner");
  });
});

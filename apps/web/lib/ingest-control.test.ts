import { describe, expect, it } from "vitest";
import { MAX_NEW_ARTICLES_PER_INGEST, calculateIngestBudget } from "./ingest-control";

describe("calculateIngestBudget", () => {
  it("allows the normal bounded batch when the queue has capacity", () => {
    expect(calculateIngestBudget({ pending: 0, inProgress: 0 })).toBe(MAX_NEW_ARTICLES_PER_INGEST);
  });

  it("accounts for downstream fan-out near the pressure limit", () => {
    expect(calculateIngestBudget({ pending: 150, inProgress: 2 })).toBe(8);
  });

  it("pauses ingest while the active backlog is at or above the limit", () => {
    expect(calculateIngestBudget({ pending: 200, inProgress: 0 })).toBe(0);
    expect(calculateIngestBudget({ pending: 1_827, inProgress: 3 })).toBe(0);
  });
});

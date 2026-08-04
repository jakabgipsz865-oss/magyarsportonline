import { describe, expect, it, vi } from "vitest";
import { PipelineJobRepository } from "./pipeline-job-repository";

describe("PipelineJobRepository.findActiveDeferral", () => {
  it("normalizes a raw timestamptz string to Date for the API response", async () => {
    const execute = vi.fn(async () => [{ available_at: "2026-07-31T00:05:00.000Z" }]);
    const repository = new PipelineJobRepository({ execute } as never);

    await expect(repository.findActiveDeferral("[cloudflare_daily_neuron_quota]")).resolves.toEqual(
      new Date("2026-07-31T00:05:00.000Z"),
    );
  });
});

describe("PipelineJobRepository dead-letter recovery", () => {
  it("normalizes grouped diagnostics without exposing event payloads", async () => {
    const execute = vi.fn(async () => [
      { event_type: "story/facts.verified", last_error: "provider timeout", count: "3" },
    ]);
    const repository = new PipelineJobRepository({ execute } as never);

    await expect(repository.getDeadLetterSummary()).resolves.toEqual([
      { eventType: "story/facts.verified", lastError: "provider timeout", count: 3 },
    ]);
  });

  it("returns the exact number of jobs moved back to pending", async () => {
    const execute = vi.fn(async () => [{ id: "job-1" }, { id: "job-2" }]);
    const repository = new PipelineJobRepository({ execute } as never);

    await expect(repository.requeueDeadLetters(100)).resolves.toBe(2);
  });
});

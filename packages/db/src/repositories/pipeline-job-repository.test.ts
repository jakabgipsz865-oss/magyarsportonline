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

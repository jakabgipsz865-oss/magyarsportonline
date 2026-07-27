import { createLogger } from "@magyarsportonline/observability";
import { Writable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { runWithTelemetry } from "./run-with-telemetry.js";
import type { AgentRunRecord } from "./agent-run-recorder.js";

function silentLogger() {
  return createLogger({ destination: new Writable({ write: (_c, _e, cb) => cb() }) });
}

describe("runWithTelemetry", () => {
  it("records a success run with accumulated LLM cost", async () => {
    const records: AgentRunRecord[] = [];
    const recordAgentRun = vi.fn(async (record: AgentRunRecord) => {
      records.push(record);
    });

    const result = await runWithTelemetry(
      { logger: silentLogger(), recordAgentRun },
      {
        agentName: "fact-verification",
        triggerEvent: "story/merge.completed",
        correlationId: "11111111-1111-4111-8111-111111111111",
        storyId: "22222222-2222-4222-8222-222222222222",
      },
      async ({ recordCost }) => {
        recordCost(0.001);
        recordCost(0.002);
        recordCost(undefined);
        return "done";
      },
    );

    expect(result).toBe("done");
    expect(records).toHaveLength(1);
    expect(records[0]?.status).toBe("success");
    expect(records[0]?.llmCostUsd).toBeCloseTo(0.003, 9);
    expect(records[0]?.agentName).toBe("fact-verification");
  });

  it("records an error run and rethrows", async () => {
    const records: AgentRunRecord[] = [];
    const recordAgentRun = vi.fn(async (record: AgentRunRecord) => {
      records.push(record);
    });

    await expect(
      runWithTelemetry(
        { logger: silentLogger(), recordAgentRun },
        {
          agentName: "hungarian-writer",
          triggerEvent: "story/facts.verified",
          correlationId: "11111111-1111-4111-8111-111111111111",
        },
        async () => {
          throw new Error("LLM timeout");
        },
      ),
    ).rejects.toThrow("LLM timeout");

    expect(records).toHaveLength(1);
    expect(records[0]?.status).toBe("error");
    expect(records[0]?.errorMessage).toBe("LLM timeout");
  });

  it("leaves llmCostUsd null when no cost is ever recorded", async () => {
    const records: AgentRunRecord[] = [];
    const recordAgentRun = vi.fn(async (record: AgentRunRecord) => {
      records.push(record);
    });

    await runWithTelemetry(
      { logger: silentLogger(), recordAgentRun },
      {
        agentName: "publish-gate",
        triggerEvent: "story/seo.ready",
        correlationId: "11111111-1111-4111-8111-111111111111",
      },
      async () => "ok",
    );

    expect(records[0]?.llmCostUsd).toBeNull();
  });
});

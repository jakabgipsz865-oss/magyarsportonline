import { schema, type Database } from "@magyarsportonline/db";

export interface AgentRunRecord {
  agentName: string;
  storyId?: string;
  correlationId: string;
  triggerEvent: string;
  status: "success" | "error" | "skipped";
  llmCostUsd?: number | null;
  errorMessage?: string;
}

export type RecordAgentRun = (record: AgentRunRecord) => Promise<void>;

/**
 * Writes to the intentionally thin `agent_runs` table
 * (packages/db/src/schema/agent-runs.ts, docs/architecture/09-architecture-review.md
 * §6) — this is a queryable summary, not the verbose per-run log (that's
 * `@magyarsportonline/observability`, see run-with-telemetry.ts).
 */
export function createAgentRunRecorder(db: Database): RecordAgentRun {
  return async (record) => {
    await db.insert(schema.agentRuns).values({
      agentName: record.agentName,
      storyId: record.storyId,
      correlationId: record.correlationId,
      triggerEvent: record.triggerEvent,
      status: record.status,
      llmCostUsd: record.llmCostUsd != null ? record.llmCostUsd.toFixed(6) : undefined,
      errorMessage: record.errorMessage,
    });
  };
}

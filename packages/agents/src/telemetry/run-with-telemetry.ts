import { createAgentLogger, type Logger } from "@magyarsportonline/observability";
import type { RecordAgentRun } from "./agent-run-recorder.js";

export interface TelemetryHandle {
  log: Logger;
  /** Call once per LLM completion; costs accumulate across calls within one agent run. */
  recordCost(usd: number | null | undefined): void;
}

export interface TelemetryMeta {
  agentName: string;
  triggerEvent: string;
  correlationId: string;
  storyId?: string;
}

/** `exactOptionalPropertyTypes` forbids `{ storyId: undefined }` — this only spreads the key in when it actually has a value. */
function storyIdField(storyId: string | undefined): { storyId: string } | Record<string, never> {
  return storyId !== undefined ? { storyId } : {};
}

/**
 * Wraps every agent invocation with structured logging + a measurable
 * metric (duration, LLM cost, success/error) — docs/architecture/02-agents.md
 * §2.0 requires every agent to log every run; this is the single place that
 * guarantees it instead of relying on each agent to remember.
 */
export async function runWithTelemetry<T>(
  deps: { logger: Logger; recordAgentRun: RecordAgentRun },
  meta: TelemetryMeta,
  fn: (handle: TelemetryHandle) => Promise<T>,
): Promise<T> {
  const log = createAgentLogger(deps.logger, meta.agentName);
  let totalCostUsd: number | null = null;
  const recordCost = (usd: number | null | undefined): void => {
    if (usd == null) {
      return;
    }
    totalCostUsd = (totalCostUsd ?? 0) + usd;
  };

  const startedAt = Date.now();
  log.info(
    { correlationId: meta.correlationId, ...storyIdField(meta.storyId) },
    `${meta.agentName} started`,
  );

  try {
    const result = await fn({ log, recordCost });
    const durationMs = Date.now() - startedAt;
    log.info(
      {
        correlationId: meta.correlationId,
        ...storyIdField(meta.storyId),
        durationMs,
        llmCostUsd: totalCostUsd,
      },
      `${meta.agentName} finished`,
    );
    await deps.recordAgentRun({
      agentName: meta.agentName,
      ...storyIdField(meta.storyId),
      correlationId: meta.correlationId,
      triggerEvent: meta.triggerEvent,
      status: "success",
      llmCostUsd: totalCostUsd,
    });
    return result;
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error(
      {
        correlationId: meta.correlationId,
        ...storyIdField(meta.storyId),
        durationMs,
        error: errorMessage,
      },
      `${meta.agentName} failed`,
    );
    await deps.recordAgentRun({
      agentName: meta.agentName,
      ...storyIdField(meta.storyId),
      correlationId: meta.correlationId,
      triggerEvent: meta.triggerEvent,
      status: "error",
      errorMessage,
    });
    throw error;
  }
}

export interface AgentRunRecorder {
  record(run: {
    agentName: string;
    storyId: string | null;
    correlationId: string;
    triggerEvent: string;
    status: "success" | "error" | "skipped";
    errorMessage?: string | null;
  }): Promise<void>;
}

export interface AgentRunContext {
  agentRunRepository: AgentRunRecorder;
  agentName: string;
  correlationId: string;
  triggerEvent: string;
  storyId?: string | null;
}

/**
 * Common middleware for "every agent run is logged to `agent_runs`"
 * (docs/architecture/02-agents.md §2.0: "ezt a Monitoring & Audit Agent
 * fogyasztja, de maga az írás minden agent felelőssége, közös
 * middleware-ben implementálva, nem duplikált kód"). Every agent entry point
 * wraps its work in this instead of writing to `agent_runs` itself.
 */
export async function withAgentRun<T>(ctx: AgentRunContext, fn: () => Promise<T>): Promise<T> {
  try {
    const result = await fn();
    await ctx.agentRunRepository.record({
      agentName: ctx.agentName,
      storyId: ctx.storyId ?? null,
      correlationId: ctx.correlationId,
      triggerEvent: ctx.triggerEvent,
      status: "success",
    });
    return result;
  } catch (error) {
    await ctx.agentRunRepository.record({
      agentName: ctx.agentName,
      storyId: ctx.storyId ?? null,
      correlationId: ctx.correlationId,
      triggerEvent: ctx.triggerEvent,
      status: "error",
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

import type { Database } from "../client";
import { agentRuns } from "../schema/index";

export type NewAgentRun = typeof agentRuns.$inferInsert;

/**
 * Deliberately thin — per docs/architecture/09-architecture-review.md §6 this
 * table is an auditable summary, NOT the observability log (that's
 * @magyarsportonline/observability's job). One row per agent invocation:
 * name, story, trigger, status, cost, nothing else.
 */
export class AgentRunRepository {
  constructor(private readonly db: Database) {}

  async record(run: NewAgentRun): Promise<void> {
    await this.db.insert(agentRuns).values(run);
  }
}

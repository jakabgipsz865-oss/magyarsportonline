import type { Database } from "../client";
import { agentRuns } from "../schema/index";
import { sql } from "drizzle-orm";

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

  async getRecentHealth(
    since: Date,
  ): Promise<Array<{ agentName: string; completed: number; failed: number }>> {
    const rows = await this.db.execute<{
      agent_name: string;
      completed: number | string;
      failed: number | string;
    }>(sql`SELECT agent_name,
      count(*) FILTER (WHERE status = 'success') AS completed,
      count(*) FILTER (WHERE status = 'error') AS failed
      FROM ${agentRuns}
      WHERE occurred_at >= ${since.toISOString()}::timestamptz
      GROUP BY agent_name ORDER BY agent_name`);
    return rows.map((row) => ({
      agentName: row.agent_name,
      completed: Number(row.completed),
      failed: Number(row.failed),
    }));
  }

  async getLatestFailure(
    agentName: string,
  ): Promise<{ errorMessage: string; occurredAt: Date } | null> {
    const rows = await this.db.execute<{ error_message: string; occurred_at: Date | string }>(sql`
      SELECT error_message, occurred_at
      FROM ${agentRuns}
      WHERE agent_name = ${agentName} AND status = 'error' AND error_message IS NOT NULL
      ORDER BY occurred_at DESC LIMIT 1
    `);
    const row = rows[0];
    if (!row) return null;
    return {
      errorMessage: row.error_message,
      occurredAt: row.occurred_at instanceof Date ? row.occurred_at : new Date(row.occurred_at),
    };
  }
}

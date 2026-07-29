import { sql } from "drizzle-orm";
import type { Database } from "../client";
import { pipelineJobs } from "../schema/index";

export type PipelineJobRow = typeof pipelineJobs.$inferSelect;

/**
 * Bounded-context repository for the async pipeline sprint's durable job
 * queue (2026-07-29, docs/open-decisions.md #12) — see
 * packages/db/src/schema/pipeline-jobs.ts for the full "why". `claimBatch`
 * is the only non-trivial method: it uses a `FOR UPDATE SKIP LOCKED` CTE
 * (Postgres-native, no Redis/SQS needed) so overlapping worker invocations
 * can never claim the same job twice, and reclaims `in_progress` jobs whose
 * lock has gone stale (the worker function that claimed them died without
 * completing) instead of leaving them stuck forever.
 */
export class PipelineJobRepository {
  constructor(private readonly db: Database) {}

  async enqueue(event: unknown): Promise<void> {
    await this.db.insert(pipelineJobs).values({ event });
  }

  /**
   * Atomically claims up to `limit` jobs that are either newly pending and
   * due (`available_at <= now()`), or `in_progress` but abandoned (locked
   * longer than `staleLockMs` ago — the worker that claimed them never
   * called `complete`/`fail`, most likely because the request itself was
   * killed mid-handler). A single `WITH ... FOR UPDATE SKIP LOCKED` CTE
   * statement makes the select-then-update atomic without a separate
   * transaction wrapper. Fresh events are claimed first so a historical
   * retry backlog cannot block newly ingested production news indefinitely;
   * older work remains durable and is drained whenever no fresher job is due.
   */
  async claimBatch(limit: number, staleLockMs: number): Promise<PipelineJobRow[]> {
    const rows = await this.db.execute<PipelineJobRow>(sql`
      WITH claimed AS (
        SELECT id FROM ${pipelineJobs}
        WHERE (status = 'pending' AND available_at <= now())
           OR (status = 'in_progress' AND locked_at < now() - (${staleLockMs}::text || ' milliseconds')::interval)
        ORDER BY created_at DESC, available_at
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE ${pipelineJobs}
      SET status = 'in_progress',
          locked_at = now(),
          attempts = attempts + 1,
          updated_at = now()
      WHERE id IN (SELECT id FROM claimed)
      RETURNING *
    `);
    return [...rows];
  }

  async complete(jobId: string): Promise<void> {
    await this.db.execute(sql`
      UPDATE ${pipelineJobs}
      SET status = 'completed', updated_at = now()
      WHERE id = ${jobId}
    `);
  }

  /**
   * A job that hasn't yet exhausted `max_attempts` goes back to `pending`
   * with `available_at` pushed out by `backoffMs` (the caller computes the
   * backoff curve) — `attempts`/`last_error` already record its history, so
   * no separate "failed" status is needed for a still-retryable job (see
   * the `pipelineJobStatusEnum` doc comment). Only a job that has exhausted
   * its attempts becomes `dead_letter`, permanently.
   */
  async fail(jobId: string, error: string, backoffMs: number): Promise<void> {
    await this.db.execute(sql`
      UPDATE ${pipelineJobs}
      SET status = (CASE WHEN attempts < max_attempts THEN 'pending' ELSE 'dead_letter' END)::pipeline_job_status,
          available_at = now() + (${backoffMs}::text || ' milliseconds')::interval,
          last_error = ${error},
          updated_at = now()
      WHERE id = ${jobId}
    `);
  }
}

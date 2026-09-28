import {
  LostJobClaimError,
  queueEventIdentity,
  type DeadLetterSummary,
  type PipelineJobRow,
  type PipelineQueueStatusCounts,
} from "../repositories/pipeline-job-repository";
import { d1Date, d1Timestamp, type D1Client } from "./client";

interface JobRow {
  id: string;
  event: string;
  status: PipelineJobRow["status"];
  attempts: number;
  max_attempts: number;
  available_at: string;
  locked_at: string | null;
  claim_owner: string | null;
  claim_version: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

function hydrate(row: JobRow): PipelineJobRow {
  return {
    id: row.id,
    event: JSON.parse(row.event) as PipelineJobRow["event"],
    status: row.status,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    availableAt: new Date(row.available_at),
    lockedAt: d1Date(row.locked_at),
    claimOwner: row.claim_owner,
    claimVersion: row.claim_version,
    lastError: row.last_error,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

/**
 * D1 adapter for the existing pipeline_jobs table. Single conditional UPDATE
 * statements provide atomic claims and fencing under D1's serialized writer.
 * Every write after a claim predicates on claim_owner, so a stale invocation
 * cannot finish or release its successor's claim.
 */
export class D1PipelineJobRepository {
  constructor(private readonly db: D1Client) {}

  async enqueue(event: unknown): Promise<void> {
    const id = crypto.randomUUID();
    const now = d1Timestamp(new Date());
    const eventJson = JSON.stringify(event);
    const identity = queueEventIdentity(event);
    if (!identity) {
      await this.db.prepare(`
        INSERT INTO pipeline_jobs (id, event, status, attempts, max_attempts,
          available_at, claim_version, created_at, updated_at)
        VALUES (?, ?, 'pending', 0, 5, ?, 0, ?, ?)
      `).bind(id, eventJson, now, now, now).run();
      return;
    }
    const shape = event as { type: string; payload: Record<string, unknown> };
    await this.db.prepare(`
      INSERT INTO pipeline_jobs (id, event, status, attempts, max_attempts,
        available_at, claim_version, created_at, updated_at)
      SELECT ?, ?, 'pending', 0, 5, ?, 0, ?, ?
      WHERE NOT EXISTS (
        SELECT 1 FROM pipeline_jobs
        WHERE status IN ('pending', 'in_progress')
          AND json_extract(event, '$.type') = ?
          AND json_extract(event, '$.payload') = json(?)
      )
    `).bind(id, eventJson, now, now, now, shape.type,
      JSON.stringify(shape.payload)).run();
  }

  async getStatusCounts(now = new Date(), since = new Date(0)): Promise<PipelineQueueStatusCounts> {
    const staleAt = d1Timestamp(new Date(now.getTime() - 10 * 60_000));
    const sinceAt = d1Timestamp(since);
    const row = await this.db.prepare(`
      SELECT
        sum(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS pending,
        sum(CASE WHEN status='in_progress' THEN 1 ELSE 0 END) AS in_progress,
        sum(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS completed,
        sum(CASE WHEN status='dead_letter' THEN 1 ELSE 0 END) AS dead_letter,
        sum(CASE WHEN status='in_progress' AND locked_at < ? THEN 1 ELSE 0 END) AS stale,
        max(CASE WHEN status='completed' THEN updated_at END) AS last_completed_at
      FROM pipeline_jobs WHERE created_at >= ?
    `).bind(staleAt, sinceAt).first<{
      pending: number | null; in_progress: number | null; completed: number | null;
      dead_letter: number | null; stale: number | null; last_completed_at: string | null;
    }>();
    return {
      pending: row?.pending ?? 0,
      inProgress: row?.in_progress ?? 0,
      completed: row?.completed ?? 0,
      deadLetter: row?.dead_letter ?? 0,
      stale: row?.stale ?? 0,
      lastCompletedAt: d1Date(row?.last_completed_at ?? null),
    };
  }

  async getDeadLetterSummary(limit = 20): Promise<DeadLetterSummary[]> {
    const result = await this.db.prepare(`
      SELECT coalesce(json_extract(event, '$.type'), 'unknown') AS event_type,
        last_error, count(*) AS count
      FROM pipeline_jobs WHERE status = 'dead_letter'
      GROUP BY json_extract(event, '$.type'), last_error
      ORDER BY count(*) DESC, event_type LIMIT ?
    `).bind(Math.max(1, Math.min(limit, 100))).all<{
      event_type: string; last_error: string | null; count: number;
    }>();
    return result.results.map(row => ({ eventType: row.event_type,
      lastError: row.last_error, count: row.count }));
  }

  async requeueDeadLetters(limit: number): Promise<number> {
    const now = d1Timestamp(new Date());
    const result = await this.db.prepare(`
      UPDATE pipeline_jobs
      SET status='pending', attempts=0, available_at=?, locked_at=NULL,
        claim_owner=NULL,
        last_error='[manual_requeue] ' || coalesce(last_error, 'no previous error'),
        updated_at=?
      WHERE id IN (
        SELECT id FROM pipeline_jobs WHERE status='dead_letter'
        ORDER BY created_at ASC LIMIT ?
      ) RETURNING id
    `).bind(now, now, Math.max(1, Math.min(limit, 500))).all<{ id: string }>();
    return result.results.length;
  }

  async claimBatch(
    limit: number, staleLockMs: number, now = new Date(), since = new Date(0),
  ): Promise<PipelineJobRow[]> {
    if (limit <= 0) return [];
    const recoveryLane = Math.floor(now.getTime() / 30_000) % 4 === 0;
    const owner = crypto.randomUUID();
    const nowIso = d1Timestamp(now);
    const staleAt = d1Timestamp(new Date(now.getTime() - staleLockMs));
    const sinceAt = d1Timestamp(since);
    const result = await this.db.prepare(`
      UPDATE pipeline_jobs
      SET status='in_progress', locked_at=?, claim_owner=?,
        claim_version=claim_version+1, attempts=attempts+1, updated_at=?
      WHERE id IN (
        SELECT id FROM pipeline_jobs
        WHERE created_at >= ? AND (
          (status='pending' AND available_at <= ?)
           OR (status='in_progress' AND locked_at < ?)
        )
        ORDER BY
          CASE WHEN ?=0 THEN CASE WHEN status='pending' THEN 0 ELSE 1 END END,
          CASE WHEN ?=1 THEN coalesce(locked_at, created_at) END ASC,
          CASE WHEN ?=0 THEN created_at END DESC
        LIMIT ?
      ) RETURNING *
    `).bind(nowIso, owner, nowIso, sinceAt, nowIso, staleAt,
      Number(recoveryLane), Number(recoveryLane), Number(recoveryLane),
      Math.min(limit, 20)).all<JobRow>();
    return result.results.map(hydrate);
  }

  async hasActiveClaim(jobId: string, owner: string): Promise<boolean> {
    const row = await this.db.prepare(`
      SELECT id FROM pipeline_jobs
      WHERE id=? AND status='in_progress' AND claim_owner=? LIMIT 1
    `).bind(jobId, owner).first<{ id: string }>();
    return row !== null;
  }

  async assertActiveClaim(jobId: string, owner: string): Promise<void> {
    if (!(await this.hasActiveClaim(jobId, owner))) throw new LostJobClaimError();
  }

  async complete(jobId: string, owner: string): Promise<boolean> {
    const row = await this.db.prepare(`
      UPDATE pipeline_jobs SET status='completed', locked_at=NULL,
        claim_owner=NULL, updated_at=?
      WHERE id=? AND status='in_progress' AND claim_owner=? RETURNING id
    `).bind(d1Timestamp(new Date()), jobId, owner).first<{ id: string }>();
    return row !== null;
  }

  async fail(jobId: string, owner: string, error: string, backoffMs: number): Promise<boolean> {
    const now = new Date();
    const row = await this.db.prepare(`
      UPDATE pipeline_jobs
      SET status=CASE WHEN attempts < max_attempts THEN 'pending' ELSE 'dead_letter' END,
        available_at=?, last_error=?, locked_at=NULL, claim_owner=NULL, updated_at=?
      WHERE id=? AND status='in_progress' AND claim_owner=? RETURNING id
    `).bind(d1Timestamp(new Date(now.getTime() + backoffMs)), error,
      d1Timestamp(now), jobId, owner).first<{ id: string }>();
    return row !== null;
  }

  async deferWithoutAttempt(jobId: string, owner: string, reason: string, delayMs: number): Promise<boolean> {
    const now = new Date();
    const row = await this.db.prepare(`
      UPDATE pipeline_jobs
      SET status='pending', attempts=max(attempts-1, 0), available_at=?,
        last_error=?, locked_at=NULL, claim_owner=NULL, updated_at=?
      WHERE id=? AND status='in_progress' AND claim_owner=? RETURNING id
    `).bind(d1Timestamp(new Date(now.getTime() + delayMs)), reason,
      d1Timestamp(now), jobId, owner).first<{ id: string }>();
    return row !== null;
  }

  async findActiveDeferral(errorPrefix: string): Promise<Date | null> {
    const row = await this.db.prepare(`
      SELECT available_at FROM pipeline_jobs
      WHERE status='pending' AND available_at > ? AND last_error LIKE ?
      ORDER BY available_at DESC LIMIT 1
    `).bind(d1Timestamp(new Date()), `${errorPrefix}%`)
      .first<{ available_at: string }>();
    return d1Date(row?.available_at ?? null);
  }
}

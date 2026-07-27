import { createHash } from "node:crypto";

export interface FingerprintInput {
  /** Category slug, e.g. "labdarugas-bl". */
  category: string;
  /** The Story's primary entity (team/competition) id. */
  primaryEntityId: string;
  /**
   * Coarse date bucket (not a precise timestamp) so that the same real-world
   * event reported minutes apart still collides on the same fingerprint.
   * Callers should pass a day-granularity string, e.g. "2026-07-27".
   */
  dateBucket: string;
}

/**
 * Deterministic, coarse "same event" fingerprint used by the Deduplication
 * Agent and the Story-creation advisory lock
 * (docs/architecture/03-event-flow.md §3.7,
 * docs/architecture/01-data-model.md §1.5.1). Intentionally coarse — it is
 * NOT a replacement for the embedding-based semantic dedup match, only a
 * cheap key to serialize concurrent NEW_STORY creation attempts for what is
 * very likely the same event.
 *
 * Pure and deterministic by design so it can be unit-tested without a
 * database; the actual `pg_advisory_xact_lock` usage (see `locking.ts`)
 * requires a live Postgres connection and is exercised by integration tests
 * once the Story Merge Agent exists (Fázis 5).
 */
export function computeFingerprint(input: FingerprintInput): string {
  const normalized = [
    input.category.trim().toLowerCase(),
    input.primaryEntityId.trim().toLowerCase(),
    input.dateBucket.trim(),
  ].join("|");
  return createHash("sha256").update(normalized).digest("hex");
}

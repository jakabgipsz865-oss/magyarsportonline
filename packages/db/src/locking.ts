import { sql } from "drizzle-orm";

/**
 * Minimal shape this helper needs from a Drizzle transaction handle —
 * kept narrow so it can be exercised with a lightweight test double
 * without spinning up Postgres (see locking.test.ts).
 */
export interface SqlExecutor {
  execute(query: ReturnType<typeof sql>): Promise<unknown>;
}

/**
 * Serializes concurrent Story-creation attempts that share the same coarse
 * fingerprint (docs/architecture/03-event-flow.md §3.7,
 * docs/architecture/09-architecture-review.md §9): acquires a
 * transaction-scoped Postgres advisory lock keyed by `hashtext(fingerprint)`
 * before running `fn`, so a second, concurrent call with the same
 * fingerprint blocks until the first transaction commits — at which point it
 * will see the first call's `story_fingerprints` row and can join the
 * existing Story instead of creating a duplicate.
 *
 * Must be called from within an open transaction (`db.transaction(tx => ...)`)
 * — `pg_advisory_xact_lock` is transaction-scoped and releases automatically
 * on commit/rollback, which is exactly the semantics the Story Merge Agent
 * (Fázis 5) needs. This helper only wires up the lock; the actual
 * "does a Story already exist for this fingerprint?" business logic belongs
 * to the Story Merge Agent, not to this package.
 */
export async function withFingerprintLock<T>(
  tx: SqlExecutor,
  fingerprintHash: string,
  fn: () => Promise<T>,
): Promise<T> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${fingerprintHash}))`);
  return fn();
}

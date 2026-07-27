import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabaseClient, type Database } from "./client.js";
import { getTestDatabaseUrl } from "./testing.js";
import { withFingerprintLock } from "./locking.js";

/**
 * Real-Postgres integration test for the advisory-lock mechanism behind the
 * Story-creation race-condition fix (docs/architecture/03-event-flow.md
 * §3.7, 09-architecture-review.md §9). The unit test in locking.test.ts only
 * checks call ordering against a mock — this test proves the actual
 * `pg_advisory_xact_lock` semantics: two concurrent transactions locking the
 * same fingerprint really do serialize, not just "happen to look ordered".
 *
 * Skipped (not failed) when no database is reachable — see CONTRIBUTING.md
 * for how to provision one locally; CI provisions a Postgres service
 * (docs/adr/0008-ci-postgres-service.md).
 */
const databaseUrl = getTestDatabaseUrl();

describe.skipIf(!databaseUrl)("withFingerprintLock (real Postgres)", () => {
  let db: Database;

  beforeAll(() => {
    db = createDatabaseClient(databaseUrl as string);
  });

  afterAll(async () => {
    await db.execute(sql`select 1`);
  });

  it("serializes two concurrent transactions locking the same fingerprint", async () => {
    const events: string[] = [];
    const fingerprint = `test-fp-${Date.now()}`;

    const txA = db.transaction(async (tx) => {
      await withFingerprintLock(tx, fingerprint, async () => {
        events.push("A-acquired");
        await new Promise((resolve) => setTimeout(resolve, 200));
        events.push("A-released");
      });
    });

    // Give txA a head start so it reliably wins the lock first.
    await new Promise((resolve) => setTimeout(resolve, 20));

    const txB = db.transaction(async (tx) => {
      await withFingerprintLock(tx, fingerprint, async () => {
        events.push("B-acquired");
      });
    });

    await Promise.all([txA, txB]);

    // If the lock truly serializes, B can only acquire after A released.
    expect(events).toEqual(["A-acquired", "A-released", "B-acquired"]);
  });

  it("does not block transactions locking a different fingerprint", async () => {
    const events: string[] = [];

    const txA = db.transaction(async (tx) => {
      await withFingerprintLock(tx, `fp-a-${Date.now()}`, async () => {
        events.push("A-acquired");
        await new Promise((resolve) => setTimeout(resolve, 100));
        events.push("A-released");
      });
    });

    await new Promise((resolve) => setTimeout(resolve, 20));

    const txB = db.transaction(async (tx) => {
      await withFingerprintLock(tx, `fp-b-${Date.now()}`, async () => {
        events.push("B-acquired");
      });
    });

    await Promise.all([txA, txB]);

    // Different fingerprint => B should not have to wait for A to release.
    expect(events.indexOf("B-acquired")).toBeLessThan(events.indexOf("A-released"));
  });
});

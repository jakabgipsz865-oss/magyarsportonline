import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDatabaseClient } from "./client";

const url = process.env["MSO_TEST_DATABASE_URL"];

describe.skipIf(!url)("database statement deadline", () => {
  it("cancels a stalled statement on the server", async () => {
    const db = createDatabaseClient(url!, {
      max: 1,
      connectTimeoutSeconds: 2,
      statementTimeoutMs: 100,
    });
    try {
      const startedAt = Date.now();
      await expect(db.execute(sql`SELECT pg_sleep(2)`)).rejects.toThrow(
        /statement timeout|canceling statement/iu,
      );
      expect(Date.now() - startedAt).toBeLessThan(1500);
    } finally {
      await db.$client.end();
    }
  });
});

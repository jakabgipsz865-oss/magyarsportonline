import { createRequire } from "node:module";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import { describe, expect, it } from "vitest";
import type { D1Client, D1Statement } from "./client";
import { D1LlmUsageRepository } from "./llm-usage-repository";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as {
  DatabaseSync: typeof DatabaseSyncType;
};

function fixture(): { db: DatabaseSyncType; d1: D1Client } {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE llm_usage (
    id TEXT PRIMARY KEY, provider TEXT NOT NULL, model TEXT NOT NULL,
    input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL,
    cost_usd TEXT NOT NULL, role TEXT NOT NULL, status TEXT NOT NULL,
    error_code TEXT, raw_article_id TEXT, story_id TEXT, job_id TEXT,
    occurred_at TEXT NOT NULL
  )`);
  const d1: D1Client = {
    prepare(query): D1Statement {
      const statement = db.prepare(query);
      let values: (string | number | null)[] = [];
      return {
        bind(...input) {
          values = input.map(value => typeof value === "boolean" ? Number(value) : value);
          return this;
        },
        async first<T>() { return (statement.get(...values) as T | undefined) ?? null; },
        async all<T>() { return { results: statement.all(...values) as T[] }; },
        async run() { return { meta: { changes: Number(statement.run(...values).changes) } }; },
      };
    },
  };
  return { db, d1 };
}

describe("D1 LLM usage guard", () => {
  it("reserves within a cap, counts failed calls, and releases only unused requests", async () => {
    const { db, d1 } = fixture();
    try {
      const usage = new D1LlmUsageRepository(d1);
      const since = new Date(Date.now() - 60_000);
      const first = await usage.reserveRequest("gemini", "writer", since, 2,
        { role: "primary", rawArticleId: "raw-1" });
      expect(first).toBeTruthy();
      if (!first) throw new Error("Expected a reservation");
      const second = await usage.reserveRequest("gemini", "writer", since, 2);
      expect(second).toBeTruthy();
      expect(await usage.reserveRequest("gemini", "writer", since, 2)).toBeNull();
      await usage.finalizeRequest(first, 120, 50, 0.012345);
      await usage.releaseRequest(first);
      expect(await usage.countSince("gemini", since)).toBe(2);
      expect(await usage.sumCostUsdSince(since)).toBeCloseTo(0.012345);
      if (!second) throw new Error("Expected the second reservation");
      await usage.releaseRequest(second);
      expect(await usage.countSince("gemini", since)).toBe(1);
      const third = await usage.reserveRequest("gemini", "writer", since, 2);
      expect(third).toBeTruthy();
      if (!third) throw new Error("Expected a third reservation");
      await usage.failRequest(third, "provider_timeout");
      await usage.releaseRequest(third);
      expect(await usage.countSince("gemini", since)).toBe(2);
      expect((db.prepare("SELECT role, raw_article_id FROM llm_usage WHERE id=?")
        .get(first) as { role: string; raw_article_id: string })).toEqual({
          role: "primary", raw_article_id: "raw-1",
        });
    } finally {
      db.close();
    }
  });
});

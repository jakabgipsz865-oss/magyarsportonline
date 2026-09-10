import { describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import { StoryReadModelRepository } from "./story-read-model-repository";

// Capture the real Drizzle-generated SQL without opening a database connection.
function capture() {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const client = {
    unsafe: (sql: string, params: unknown[]) => {
      queries.push({ sql, params });
      return { values: async () => [] };
    },
    options: { parsers: {}, serializers: {} },
  };
  return { queries, repo: new StoryReadModelRepository(drizzle(client as never)) };
}

describe("public clean-slate queries", () => {
  it.each(["slug", "list"])(
    "restricts %s to a current v2 projection after the cutoff",
    async (kind) => {
      const { repo, queries } = capture();
      if (kind === "slug") expect(await repo.getBySlug("legacy-url")).toBeNull();
      else expect(await repo.listPublished({ limit: 10, offset: 0 })).toEqual([]);
      expect(queries).toHaveLength(1);
      const query = queries[0]!;
      expect(query.sql).toContain('"version_history_summary" @>');
      expect(query.sql).toContain('"published_at" >=');
      expect(query.params).toContain('[{"prompt_version":"tabloid-hu@2","is_current":true}]');
      expect(query.params).toContain("2026-09-10T20:03:10.000Z");
      expect(query.sql).not.toMatch(/\b(insert|update|delete|join)\b/i);
      if (kind === "slug") expect(query.params).toContain("legacy-url");
      else expect(query.sql.indexOf("where")).toBeLessThan(query.sql.indexOf("limit"));
    },
  );
});

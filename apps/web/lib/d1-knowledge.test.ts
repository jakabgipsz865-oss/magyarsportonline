import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  EDITORIAL_KNOWLEDGE_FORMAT, EDITORIAL_KNOWLEDGE_SCHEMA_VERSION,
  createEditorialKnowledgePackage, type EditorialKnowledgeRecord,
} from "@magyarsportonline/db";
import type { D1Client, D1Statement } from "@magyarsportonline/db/d1";
import { applyD1KnowledgeImport, countD1Knowledge, listD1Knowledge,
  previewD1KnowledgeImport } from "./d1-knowledge";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as {
  DatabaseSync: typeof DatabaseSyncType;
};

function fixture(): { db: DatabaseSyncType; d1: D1Client } {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../../../packages/db/d1/0001_initial.sql", import.meta.url), "utf8"));
  const callbacks = new WeakMap<D1Statement, () => { meta: { changes: number } }>();
  const d1: D1Client = {
    prepare(query) {
      const statement = db.prepare(query);
      let values: (string | number | null)[] = [];
      const bound: D1Statement = {
        bind(...input) { values = input.map(value => typeof value === "boolean" ? Number(value) : value); return this; },
        async first<T>() { return (statement.get(...values) as T | undefined) ?? null; },
        async all<T>() { return { results: statement.all(...values) as T[] }; },
        async run() { return { meta: { changes: Number(statement.run(...values).changes) } }; },
      };
      callbacks.set(bound, () => ({ meta: { changes: Number(statement.run(...values).changes) } }));
      return bound;
    },
    async batch(statements) {
      db.exec("BEGIN");
      try {
        const result = statements.map(item => callbacks.get(item)!());
        db.exec("COMMIT");
        return result;
      } catch (error) { db.exec("ROLLBACK"); throw error; }
    },
  };
  return { db, d1 };
}

function record(revision = 1): EditorialKnowledgeRecord {
  return {
    schema_version: EDITORIAL_KNOWLEDGE_SCHEMA_VERSION,
    stable_key: "football.mwe.clean-sheet", revision,
    knowledge_type: "multi_word_expression", language: { source: "en", target: "hu" },
    sport: "football", contexts: ["match_report"], source_phrase: "clean sheet",
    canonical_hu: revision === 1 ? "kapott gól nélkül" : "nem kapott gólt",
    alternative_hu: [], avoid_hu: ["tiszta lap"], instruction_hu: null,
    match_terms: ["clean sheet"], confidence: 0.99, status: "active",
    provenance: { source: "D1 unit test", source_url: null, license: "editorial-original" },
    editorial_note: null, positive_examples: [], negative_examples: [], replaced_by: null,
  };
}

function pack(item: EditorialKnowledgeRecord) {
  return createEditorialKnowledgePackage({
    format: EDITORIAL_KNOWLEDGE_FORMAT, schema_version: EDITORIAL_KNOWLEDGE_SCHEMA_VERSION,
    package_id: "mso-d1-test", package_version: `1.0.${item.revision}`,
    package_mode: "full", base_package_version: null,
    created_at: "2026-09-28T17:00:00.000Z", record_count: 1, records: [item],
    security: { secrets_included: false },
  });
}

describe("D1 editorial knowledge", () => {
  it("previews, imports, updates, lists and refuses stale content", async () => {
    const { db, d1 } = fixture();
    try {
      const first = pack(record());
      const preview = await previewD1KnowledgeImport(d1, first);
      expect(preview.counts.new).toBe(1);
      expect((await applyD1KnowledgeImport(d1, first, preview.digest)).applied).toBe(true);
      expect(await countD1Knowledge(d1)).toEqual({ active: 1, draft: 0, deprecated: 0 });
      expect((await listD1Knowledge(d1))[0]?.canonical_hu).toBe("kapott gól nélkül");
      expect((await previewD1KnowledgeImport(d1, first)).counts.duplicate).toBe(1);
      const updated = pack(record(2));
      const next = await previewD1KnowledgeImport(d1, updated);
      expect(next.counts.update).toBe(1);
      await applyD1KnowledgeImport(d1, updated, next.digest);
      expect((await listD1Knowledge(d1))[0]?.canonical_hu).toBe("nem kapott gólt");
      expect((await previewD1KnowledgeImport(d1, first)).counts.conflict).toBe(1);
    } finally { db.close(); }
  });
});

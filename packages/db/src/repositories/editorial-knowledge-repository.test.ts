import { describe, expect, it, vi } from "vitest";
import {
  EDITORIAL_KNOWLEDGE_FORMAT,
  EDITORIAL_KNOWLEDGE_SCHEMA_VERSION,
  createEditorialKnowledgePackage,
  hashEditorialKnowledgeRecord,
  type EditorialKnowledgeRecord,
} from "../editorial-knowledge-contract";
import { editorialKnowledgeEntries, editorialKnowledgeImportRuns } from "../schema/index";
import { EditorialKnowledgeRepository } from "./editorial-knowledge-repository";

function record(overrides: Partial<EditorialKnowledgeRecord> = {}): EditorialKnowledgeRecord {
  return {
    schema_version: EDITORIAL_KNOWLEDGE_SCHEMA_VERSION,
    stable_key: "football.mwe.clean-sheet",
    revision: 1,
    knowledge_type: "multi_word_expression",
    language: { source: "en", target: "hu" },
    sport: "football",
    contexts: ["match_report"],
    source_phrase: "clean sheet",
    canonical_hu: "kapott gól nélkül",
    alternative_hu: ["nem kapott gólt"],
    avoid_hu: ["tiszta lap"],
    instruction_hu: null,
    match_terms: ["clean sheet", "kept a clean sheet"],
    confidence: 0.99,
    status: "active",
    provenance: {
      source: "unit test fixture",
      source_url: null,
      license: "editorial-original",
    },
    editorial_note: null,
    positive_examples: [],
    negative_examples: [],
    replaced_by: null,
    ...overrides,
  };
}

function knowledgePackage(records: unknown[]) {
  return createEditorialKnowledgePackage({
    format: EDITORIAL_KNOWLEDGE_FORMAT,
    schema_version: EDITORIAL_KNOWLEDGE_SCHEMA_VERSION,
    package_id: "mso-football-test",
    package_version: "1.0.0",
    package_mode: "full",
    base_package_version: null,
    created_at: "2026-08-29T12:00:00.000Z",
    record_count: records.length,
    records,
    security: { secrets_included: false },
  });
}

interface MemoryState {
  entries: Array<Record<string, unknown>>;
  runs: Array<Record<string, unknown>>;
}

function createMemoryDatabase(
  initialEntries: Array<Record<string, unknown>> = [],
  options: { failAfterEntryWrites?: number } = {},
) {
  let committed: MemoryState = { entries: structuredClone(initialEntries), runs: [] };

  function executor(state: MemoryState) {
    let entryWrites = 0;
    return {
      execute: vi.fn(async () => []),
      select: vi.fn(() => ({
        from: vi.fn(async (table: unknown) =>
          table === editorialKnowledgeEntries ? structuredClone(state.entries) : [],
        ),
      })),
      insert: vi.fn((table: unknown) => ({
        values: vi.fn((values: Record<string, unknown>) => {
          if (table === editorialKnowledgeImportRuns) {
            state.runs.push(structuredClone(values));
            return Promise.resolve();
          }
          if (table !== editorialKnowledgeEntries) throw new Error("unexpected table");
          return {
            onConflictDoUpdate: vi.fn(async () => {
              entryWrites += 1;
              if (
                options.failAfterEntryWrites !== undefined &&
                entryWrites > options.failAfterEntryWrites
              ) {
                throw new Error("injected transaction failure");
              }
              const key = values["stableKey"];
              const index = state.entries.findIndex((item) => item["stableKey"] === key);
              if (index === -1) state.entries.push(structuredClone(values));
              else state.entries[index] = { ...state.entries[index], ...structuredClone(values) };
            }),
          };
        }),
      })),
    };
  }

  const root = executor(committed);
  const db = {
    ...root,
    transaction: vi.fn(async (callback: (tx: ReturnType<typeof executor>) => Promise<unknown>) => {
      const draft = structuredClone(committed);
      const result = await callback(executor(draft));
      committed = draft;
      return result;
    }),
  };

  return {
    db: db as never,
    state: () => structuredClone(committed),
  };
}

function storedRecord(source: EditorialKnowledgeRecord): Record<string, unknown> {
  return {
    stableKey: source.stable_key,
    revision: source.revision,
    knowledgeType: source.knowledge_type,
    sourceLanguage: source.language.source,
    targetLanguage: source.language.target,
    sport: source.sport,
    contentHash: hashEditorialKnowledgeRecord(source),
  };
}

describe("EditorialKnowledgeRepository preview", () => {
  it("classifies a new record as NEW", async () => {
    const memory = createMemoryDatabase();
    const preview = await new EditorialKnowledgeRepository(memory.db).previewImport(
      knowledgePackage([record()]),
    );
    expect(preview.counts).toEqual({ new: 1, update: 0, duplicate: 0, conflict: 0, invalid: 0 });
  });

  it("classifies an identical record as DUPLICATE", async () => {
    const current = record();
    const memory = createMemoryDatabase([storedRecord(current)]);
    const preview = await new EditorialKnowledgeRepository(memory.db).previewImport(
      knowledgePackage([current]),
    );
    expect(preview.counts.duplicate).toBe(1);
  });

  it("classifies a larger revision as UPDATE", async () => {
    const current = record();
    const incoming = record({ revision: 2, canonical_hu: "nem kapott gólt" });
    const memory = createMemoryDatabase([storedRecord(current)]);
    const preview = await new EditorialKnowledgeRepository(memory.db).previewImport(
      knowledgePackage([incoming]),
    );
    expect(preview.counts.update).toBe(1);
  });

  it("classifies changed content at the same revision as CONFLICT", async () => {
    const current = record();
    const incoming = record({ canonical_hu: "nem kapott gólt" });
    const memory = createMemoryDatabase([storedRecord(current)]);
    const preview = await new EditorialKnowledgeRepository(memory.db).previewImport(
      knowledgePackage([incoming]),
    );
    expect(preview.counts.conflict).toBe(1);
  });

  it("classifies a smaller revision as stale CONFLICT", async () => {
    const current = record({ revision: 2 });
    const memory = createMemoryDatabase([storedRecord(current)]);
    const preview = await new EditorialKnowledgeRepository(memory.db).previewImport(
      knowledgePackage([record({ revision: 1 })]),
    );
    expect(preview.counts.conflict).toBe(1);
    expect(preview.decisions[0]?.reason).toContain("stale");
  });

  it("classifies a schema-invalid record as INVALID", async () => {
    const invalid = { ...record(), knowledge_type: "unknown_type" };
    const memory = createMemoryDatabase();
    const preview = await new EditorialKnowledgeRepository(memory.db).previewImport(
      knowledgePackage([invalid]),
    );
    expect(preview.counts.invalid).toBe(1);
    expect(preview.counts.new).toBe(0);
  });
});

describe("EditorialKnowledgeRepository apply", () => {
  it("blocks conflicts without partially importing valid records", async () => {
    const current = record();
    const memory = createMemoryDatabase([storedRecord(current)]);
    const incomingNew = record({
      stable_key: "football.mwe.second-record",
      source_phrase: "second record",
    });
    const packageValue = knowledgePackage([
      incomingNew,
      record({ canonical_hu: "same revision, changed content" }),
    ]);
    const repository = new EditorialKnowledgeRepository(memory.db);
    const preview = await repository.previewImport(packageValue);
    const result = await repository.applyImport(packageValue, preview.digest);

    expect(result.applied).toBe(false);
    expect(result.importStatus).toBe("blocked");
    expect(memory.state().entries).toHaveLength(1);
    expect(memory.state().runs).toHaveLength(1);
  });

  it("blocks invalid records without partially importing valid records", async () => {
    const valid = record();
    const invalid = { ...record({ stable_key: "football.mwe.invalid" }), status: "unknown" };
    const packageValue = knowledgePackage([valid, invalid]);
    const memory = createMemoryDatabase();
    const repository = new EditorialKnowledgeRepository(memory.db);
    const preview = await repository.previewImport(packageValue);
    const result = await repository.applyImport(packageValue, preview.digest);

    expect(result.applied).toBe(false);
    expect(result.counts.invalid).toBe(1);
    expect(memory.state().entries).toHaveLength(0);
  });

  it("commits all successful records and an audit run together", async () => {
    const packageValue = knowledgePackage([
      record(),
      record({
        stable_key: "football.mwe.second-record",
        source_phrase: "second record",
      }),
    ]);
    const memory = createMemoryDatabase();
    const repository = new EditorialKnowledgeRepository(memory.db);
    const preview = await repository.previewImport(packageValue);
    const result = await repository.applyImport(packageValue, preview.digest);

    expect(result.applied).toBe(true);
    expect(result.importStatus).toBe("applied");
    expect(memory.state().entries).toHaveLength(2);
    expect(memory.state().runs).toHaveLength(1);
  });

  it("rolls back every write when a transactional insert fails", async () => {
    const packageValue = knowledgePackage([
      record(),
      record({
        stable_key: "football.mwe.second-record",
        source_phrase: "second record",
      }),
    ]);
    const memory = createMemoryDatabase([], { failAfterEntryWrites: 1 });
    const repository = new EditorialKnowledgeRepository(memory.db);
    const preview = await repository.previewImport(packageValue);

    await expect(repository.applyImport(packageValue, preview.digest)).rejects.toThrow(
      "injected transaction failure",
    );
    expect(memory.state()).toEqual({ entries: [], runs: [] });
  });

  it("re-imports the same package idempotently without duplicate entries", async () => {
    const packageValue = knowledgePackage([record()]);
    const memory = createMemoryDatabase();
    const repository = new EditorialKnowledgeRepository(memory.db);
    const firstPreview = await repository.previewImport(packageValue);
    await repository.applyImport(packageValue, firstPreview.digest);
    const secondPreview = await repository.previewImport(packageValue);
    const second = await repository.applyImport(packageValue, secondPreview.digest);

    expect(second.importStatus).toBe("duplicate");
    expect(second.counts.duplicate).toBe(1);
    expect(memory.state().entries).toHaveLength(1);
  });
});

import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import { RawArticleRepository } from "./raw-article-repository";

describe("RawArticleRepository tabloid proofs", () => {
  it("selects a proof by both language and prompt generation", async () => {
    let predicate: unknown;
    const limit = vi.fn(async () => []);
    const where = vi.fn((input: unknown) => {
      predicate = input;
      return { limit };
    });
    const from = vi.fn(() => ({ where }));
    const repository = new RawArticleRepository({ select: vi.fn(() => ({ from })) } as never);

    await repository.findTabloidProof("en", "tabloid-hu@2");

    const query = new PgDialect().sqlToQuery(predicate as never);
    expect(query.sql).toContain("tabloidProofLanguage");
    expect(query.sql).toContain("tabloidProofGeneration");
    expect(query.params).toEqual(["en", "tabloid-hu@2"]);
  });

  it("claims an expired Writer lease and removes the legacy permanent marker", async () => {
    let updateValue: Record<string, unknown> | undefined;
    let predicate: unknown;
    const returning = vi.fn(async () => [{ id: "raw-1" }]);
    const where = vi.fn((input: unknown) => {
      predicate = input;
      return { returning };
    });
    const set = vi.fn((input: Record<string, unknown>) => {
      updateValue = input;
      return { where };
    });
    const repository = new RawArticleRepository({ update: vi.fn(() => ({ set })) } as never);

    expect(
      await repository.claimTabloidWriter(
        "00000000-0000-0000-0000-000000000001",
        "job-1",
        new Date("2026-09-16T07:00:00Z"),
      ),
    ).toBe(true);

    const dialect = new PgDialect();
    const updateSql = dialect.sqlToQuery(updateValue?.["extractedEntities"] as never);
    const predicateSql = dialect.sqlToQuery(predicate as never);
    expect(updateSql.sql).toContain("tabloidWriterAttempted");
    expect(updateSql.sql).toContain("tabloidWriterLease");
    expect(updateSql.sql.match(/::text/g)).toHaveLength(2);
    expect(updateSql.params).toContain("job-1");
    expect(predicateSql.sql).toContain("expiresAt");
    expect(predicateSql.sql).toContain("<= now()");
  });

  it("releases only the Writer lease owned by the caller", async () => {
    let predicate: unknown;
    const where = vi.fn((input: unknown) => {
      predicate = input;
      return Promise.resolve([]);
    });
    const set = vi.fn(() => ({ where }));
    const repository = new RawArticleRepository({ update: vi.fn(() => ({ set })) } as never);

    await repository.releaseTabloidWriter("00000000-0000-0000-0000-000000000001", "job-1");

    const query = new PgDialect().sqlToQuery(predicate as never);
    expect(query.sql).toContain("tabloidWriterLease");
    expect(query.sql).toContain("owner");
    expect(query.params).toContain("job-1");
  });
});

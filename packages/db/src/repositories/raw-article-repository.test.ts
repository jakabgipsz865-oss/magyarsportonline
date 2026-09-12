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
});

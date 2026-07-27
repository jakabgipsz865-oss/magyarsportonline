import { schema } from "@magyarsportonline/db";
import {
  createTestDatabase,
  getTestDatabaseUrl,
  truncateAllTables,
} from "@magyarsportonline/db/testing";
import type { LlmClient, LlmCompletionResult } from "@magyarsportonline/llm";
import { createLogger } from "@magyarsportonline/observability";
import { eq } from "drizzle-orm";
import { Writable } from "node:stream";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { runHungarianWriterAgent } from "./index.js";
import type { Database } from "@magyarsportonline/db";

const databaseUrl = getTestDatabaseUrl();

describe.skipIf(!databaseUrl)("runHungarianWriterAgent (real Postgres)", () => {
  let db: Database;

  beforeAll(async () => {
    db = await createTestDatabase();
  });

  beforeEach(async () => {
    await truncateAllTables(db);
  });

  function baseDeps() {
    return {
      db,
      logger: createLogger({ destination: new Writable({ write: (_c, _e, cb) => cb() }) }),
      recordAgentRun: async () => {},
    };
  }

  async function seedStoryWithFacts() {
    const [story] = await db
      .insert(schema.stories)
      .values({ canonicalTitle: "Duna FC nyert", status: "fact_checked", isDeveloping: true })
      .returning();
    if (!story) throw new Error("seed failed");
    await db.insert(schema.facts).values({
      storyId: story.id,
      rawArticleId: await seedRawArticleId(story.id),
      factType: "score",
      payload: { home: 2, away: 1 },
    });
    return story;
  }

  async function seedRawArticleId(storyId: string): Promise<string> {
    const [source] = await db
      .insert(schema.sources)
      .values({
        name: `Source ${crypto.randomUUID()}`,
        baseUrl: "https://example.test/feed.xml",
        type: "rss",
        language: "hu",
        licenseType: "public_rss",
        reliabilityTier: "B",
        fetchConfig: {},
        isActive: true,
      })
      .returning();
    if (!source) throw new Error("seed failed");
    const [rawArticle] = await db
      .insert(schema.rawArticles)
      .values({
        sourceId: source.id,
        sourceUrl: `https://example.test/${crypto.randomUUID()}`,
        titleOriginal: "Cim",
        bodyOriginal: "Duna FC 2-1 Tisza SE.",
        language: "hu",
      })
      .returning();
    if (!rawArticle) throw new Error("seed failed");
    await db.insert(schema.storySources).values({
      storyId,
      rawArticleId: rawArticle.id,
      contributionType: "initial",
    });
    return rawArticle.id;
  }

  it("uses the template fallback when no llmClient is provided", async () => {
    const story = await seedStoryWithFacts();

    const result = await runHungarianWriterAgent(baseDeps(), {
      storyId: story.id,
      correlationId: crypto.randomUUID(),
    });

    expect(result.versionNumber).toBe(1);
    expect(result.generatedByModel).toBe("template-fallback-v1");

    const [version] = await db
      .select()
      .from(schema.storyVersions)
      .where(eq(schema.storyVersions.id, result.storyVersionId));
    expect(version?.bodyHu).toContain("2-1");
  });

  it("increments the version number on a second call for the same Story", async () => {
    const story = await seedStoryWithFacts();
    const deps = baseDeps();

    const first = await runHungarianWriterAgent(deps, {
      storyId: story.id,
      correlationId: crypto.randomUUID(),
    });
    const second = await runHungarianWriterAgent(deps, {
      storyId: story.id,
      correlationId: crypto.randomUUID(),
    });

    expect(first.versionNumber).toBe(1);
    expect(second.versionNumber).toBe(2);

    const versions = await db
      .select()
      .from(schema.storyVersions)
      .where(eq(schema.storyVersions.storyId, story.id));
    expect(versions).toHaveLength(2);
  });

  it("uses the LLM path and accepts a consistent self-check on the first attempt", async () => {
    const story = await seedStoryWithFacts();
    let callCount = 0;
    const llmClient: LlmClient = {
      complete: vi.fn(async (): Promise<LlmCompletionResult> => {
        callCount += 1;
        const text =
          callCount === 1
            ? '{"title": "Duna FC nyert", "lead": "2-1", "body": "Duna FC 2-1-re nyert.", "changeSummary": "Kezdeti hir."}'
            : '{"consistent": true, "issues": []}';
        return {
          text,
          model: "claude-sonnet-5",
          inputTokens: 100,
          outputTokens: 50,
          costUsd: 0.001,
        };
      }),
    };

    const result = await runHungarianWriterAgent(
      { ...baseDeps(), llmClient, llmApiKey: "fake-key" },
      { storyId: story.id, correlationId: crypto.randomUUID() },
    );

    expect(result.generatedByModel).toBe("claude-sonnet-5");
    expect(result.factConsistencyScore).toBe(1.0);
    expect(llmClient.complete).toHaveBeenCalledTimes(2); // 1 generation + 1 self-check
  });

  it("retries once when the self-check reports inconsistency, then gives up gracefully", async () => {
    const story = await seedStoryWithFacts();
    const llmClient: LlmClient = {
      complete: vi.fn(async (params): Promise<LlmCompletionResult> => {
        const isSelfCheck = params.system.includes("Ellenőrző");
        const text = isSelfCheck
          ? '{"consistent": false, "issues": ["3-1 nincs a tenyek kozott"]}'
          : '{"title": "Cim", "lead": "3-1", "body": "Duna FC 3-1-re nyert.", "changeSummary": "Kezdeti hir."}';
        return {
          text,
          model: "claude-sonnet-5",
          inputTokens: 100,
          outputTokens: 50,
          costUsd: 0.001,
        };
      }),
    };

    const result = await runHungarianWriterAgent(
      { ...baseDeps(), llmClient, llmApiKey: "fake-key" },
      { storyId: story.id, correlationId: crypto.randomUUID() },
    );

    // Exhausted retries -> keeps the last attempt but with a lowered factConsistencyScore.
    expect(result.factConsistencyScore).toBeLessThan(1.0);
    expect(llmClient.complete).toHaveBeenCalledTimes(4); // 2 attempts x (generate + self-check)
  });
});

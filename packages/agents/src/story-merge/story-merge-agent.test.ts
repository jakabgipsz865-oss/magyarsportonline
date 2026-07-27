import { schema } from "@magyarsportonline/db";
import {
  createTestDatabase,
  getTestDatabaseUrl,
  truncateAllTables,
} from "@magyarsportonline/db/testing";
import { createLogger } from "@magyarsportonline/observability";
import { eq } from "drizzle-orm";
import { Writable } from "node:stream";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runStoryMergeAgent } from "./index.js";
import type { Database } from "@magyarsportonline/db";
import type { DeduplicationResult } from "../deduplication/index.js";

const databaseUrl = getTestDatabaseUrl();

describe.skipIf(!databaseUrl)("runStoryMergeAgent (real Postgres)", () => {
  let db: Database;

  beforeAll(async () => {
    db = await createTestDatabase();
  });

  beforeEach(async () => {
    await truncateAllTables(db);
  });

  function deps() {
    return {
      db,
      logger: createLogger({ destination: new Writable({ write: (_c, _e, cb) => cb() }) }),
      recordAgentRun: async () => {},
    };
  }

  async function seedSourceAndRawArticle(
    reliabilityTier: "A" | "B" | "C",
    title: string,
    body: string,
  ) {
    const [source] = await db
      .insert(schema.sources)
      .values({
        name: `Source ${crypto.randomUUID()}`,
        baseUrl: "https://example.test/feed.xml",
        type: "rss",
        language: "hu",
        licenseType: "public_rss",
        reliabilityTier,
        fetchConfig: {},
        isActive: true,
      })
      .returning();
    if (!source) throw new Error("failed to seed source");

    const [rawArticle] = await db
      .insert(schema.rawArticles)
      .values({
        sourceId: source.id,
        sourceUrl: `https://example.test/${crypto.randomUUID()}`,
        titleOriginal: title,
        bodyOriginal: body,
        language: "hu",
      })
      .returning();
    if (!rawArticle) throw new Error("failed to seed raw article");
    return rawArticle;
  }

  it("creates a new Story for a NEW_STORY dedup result", async () => {
    const rawArticle = await seedSourceAndRawArticle(
      "B",
      "Duna FC nyert",
      "A Duna FC 2-1-re gyozott.",
    );
    const dedup: DeduplicationResult = {
      matchType: "NEW_STORY",
      fingerprintHash: `fp-${crypto.randomUUID()}`,
      matchedEntityIds: [],
    };

    const result = await runStoryMergeAgent(deps(), {
      dedup,
      rawArticle,
      sourceReliabilityTier: "B",
      correlationId: crypto.randomUUID(),
    });

    expect(result.isNewStory).toBe(true);
    expect(result.contributionType).toBe("initial");
    expect(result.requiresFactVerification).toBe(true);

    const [fingerprintRow] = await db
      .select()
      .from(schema.storyFingerprints)
      .where(eq(schema.storyFingerprints.fingerprintHash, dedup.fingerprintHash as string));
    expect(fingerprintRow?.storyId).toBe(result.storyId);
  });

  it("attaches a corroborating article without requiring Fact Verification", async () => {
    const first = await seedSourceAndRawArticle("B", "Duna FC nyert", "Duna FC 2-1 Tisza SE.");
    const dedupNew: DeduplicationResult = {
      matchType: "NEW_STORY",
      fingerprintHash: `fp-${crypto.randomUUID()}`,
      matchedEntityIds: [],
    };
    const created = await runStoryMergeAgent(deps(), {
      dedup: dedupNew,
      rawArticle: first,
      sourceReliabilityTier: "B",
      correlationId: crypto.randomUUID(),
    });

    // Seed a "score" fact for the story so the second article's score-only
    // content counts as corroboration, not new_info.
    await db.insert(schema.facts).values({
      storyId: created.storyId,
      rawArticleId: first.id,
      factType: "score",
      payload: { home: 2, away: 1 },
    });

    const second = await seedSourceAndRawArticle(
      "A",
      "Duna FC nyert - megerosites",
      "Vegeredmeny: Duna FC 2-1 Tisza SE.",
    );
    const result = await runStoryMergeAgent(deps(), {
      dedup: {
        matchType: "MATCH",
        fingerprintHash: null,
        matchedStoryId: created.storyId,
        matchedEntityIds: [],
      },
      rawArticle: second,
      sourceReliabilityTier: "A",
      correlationId: crypto.randomUUID(),
    });

    expect(result.isNewStory).toBe(false);
    expect(result.contributionType).toBe("corroboration");
    expect(result.requiresFactVerification).toBe(false);

    const story = await db.query.stories.findFirst({
      where: eq(schema.stories.id, created.storyId),
    });
    expect(Number(story?.confidenceScore)).toBeGreaterThan(0);
  });

  it("attaches an article with a genuinely new fact type as new_info", async () => {
    const first = await seedSourceAndRawArticle("B", "Duna FC nyert", "Duna FC 2-1 Tisza SE.");
    const created = await runStoryMergeAgent(deps(), {
      dedup: {
        matchType: "NEW_STORY",
        fingerprintHash: `fp-${crypto.randomUUID()}`,
        matchedEntityIds: [],
      },
      rawArticle: first,
      sourceReliabilityTier: "B",
      correlationId: crypto.randomUUID(),
    });
    await db.insert(schema.facts).values({
      storyId: created.storyId,
      rawArticleId: first.id,
      factType: "score",
      payload: { home: 2, away: 1 },
    });

    const second = await seedSourceAndRawArticle(
      "A",
      "Nyilatkozott a Duna FC edzoje",
      'A vezetoedzo szerint: "elegedett vagyok a csapattal".',
    );
    const result = await runStoryMergeAgent(deps(), {
      dedup: {
        matchType: "MATCH",
        fingerprintHash: null,
        matchedStoryId: created.storyId,
        matchedEntityIds: [],
      },
      rawArticle: second,
      sourceReliabilityTier: "A",
      correlationId: crypto.randomUUID(),
    });

    expect(result.contributionType).toBe("new_info");
    expect(result.requiresFactVerification).toBe(true);
  });

  it("serializes two concurrent NEW_STORY attempts sharing a fingerprint into one Story", async () => {
    const fingerprintHash = `fp-race-${crypto.randomUUID()}`;
    const articleA = await seedSourceAndRawArticle("B", "Esemeny A", "Duna FC 2-1 Tisza SE.");
    const articleB = await seedSourceAndRawArticle(
      "B",
      "Esemeny B",
      "Duna FC 2-1 Tisza SE (masik forras).",
    );

    const dedupA: DeduplicationResult = {
      matchType: "NEW_STORY",
      fingerprintHash,
      matchedEntityIds: [],
    };
    const dedupB: DeduplicationResult = {
      matchType: "NEW_STORY",
      fingerprintHash,
      matchedEntityIds: [],
    };

    const [resultA, resultB] = await Promise.all([
      runStoryMergeAgent(deps(), {
        dedup: dedupA,
        rawArticle: articleA,
        sourceReliabilityTier: "B",
        correlationId: crypto.randomUUID(),
      }),
      runStoryMergeAgent(deps(), {
        dedup: dedupB,
        rawArticle: articleB,
        sourceReliabilityTier: "B",
        correlationId: crypto.randomUUID(),
      }),
    ]);

    expect(resultA.storyId).toBe(resultB.storyId);
    const stories = await db.select().from(schema.stories);
    expect(stories).toHaveLength(1);
    const fingerprints = await db.select().from(schema.storyFingerprints);
    expect(fingerprints).toHaveLength(1);
  });
});

import { schema } from "@magyarsportonline/db";
import {
  createTestDatabase,
  getTestDatabaseUrl,
  truncateAllTables,
} from "@magyarsportonline/db/testing";
import { createLogger } from "@magyarsportonline/observability";
import { Writable } from "node:stream";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runDeduplicationAgent } from "./index.js";
import type { Database } from "@magyarsportonline/db";

const databaseUrl = getTestDatabaseUrl();

describe.skipIf(!databaseUrl)("runDeduplicationAgent (real Postgres)", () => {
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

  async function seedEntity(nameCanonical: string) {
    const [entity] = await db
      .insert(schema.entities)
      .values({ type: "team", nameCanonical, nameHu: nameCanonical, aliases: [] })
      .returning();
    if (!entity) throw new Error("failed to seed entity");
    return entity;
  }

  async function insertRawArticle(title: string, body: string, publishedAt: Date) {
    const [source] = await db
      .insert(schema.sources)
      .values({
        name: "Test Source",
        baseUrl: "https://example.test/feed.xml",
        type: "rss",
        language: "hu",
        licenseType: "public_rss",
        reliabilityTier: "B",
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
        publishedAtSource: publishedAt,
      })
      .returning();
    if (!rawArticle) throw new Error("failed to seed raw article");
    return rawArticle;
  }

  it("returns NEW_STORY when no story_fingerprints row exists yet", async () => {
    await seedEntity("Duna FC");
    const rawArticle = await insertRawArticle(
      "Duna FC nyert",
      "A Duna FC 2-1-re gyozott.",
      new Date("2026-07-27T17:00:00Z"),
    );

    const result = await runDeduplicationAgent(deps(), {
      rawArticle,
      categorySlug: "labdarugas",
      correlationId: crypto.randomUUID(),
    });

    expect(result.matchType).toBe("NEW_STORY");
    expect(result.fingerprintHash).not.toBeNull();
    expect(result.matchedEntityIds).toHaveLength(1);
  });

  it("returns MATCH with the existing story when the fingerprint already exists", async () => {
    const entity = await seedEntity("Duna FC");
    const [story] = await db
      .insert(schema.stories)
      .values({ canonicalTitle: "Duna FC nyert", status: "published" })
      .returning();
    if (!story) throw new Error("failed to seed story");

    const rawArticle = await insertRawArticle(
      "Duna FC edzoje nyilatkozott",
      "A Duna FC vezetoedzoje nyilatkozott a gyozelem utan.",
      new Date("2026-07-27T17:42:00Z"),
    );

    const { computeFingerprint } = await import("@magyarsportonline/db");
    const fingerprintHash = computeFingerprint({
      category: "labdarugas",
      primaryEntityId: entity.id,
      dateBucket: "2026-07-27",
    });
    await db.insert(schema.storyFingerprints).values({ fingerprintHash, storyId: story.id });

    const result = await runDeduplicationAgent(deps(), {
      rawArticle,
      categorySlug: "labdarugas",
      correlationId: crypto.randomUUID(),
    });

    expect(result.matchType).toBe("MATCH");
    expect(result.matchedStoryId).toBe(story.id);
  });

  it("returns NEW_STORY without a fingerprint when no entity is recognized", async () => {
    const rawArticle = await insertRawArticle(
      "Teljesen ismeretlen csapat merkozese",
      "Nincs ismert entitas ebben a szovegben.",
      new Date("2026-07-27T17:00:00Z"),
    );

    const result = await runDeduplicationAgent(deps(), {
      rawArticle,
      categorySlug: "labdarugas",
      correlationId: crypto.randomUUID(),
    });

    expect(result.matchType).toBe("NEW_STORY");
    expect(result.fingerprintHash).toBeNull();
    expect(result.matchedEntityIds).toEqual([]);
  });
});

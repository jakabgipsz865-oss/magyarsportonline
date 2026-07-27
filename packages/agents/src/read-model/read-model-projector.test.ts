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
import { projectStoryReadModel } from "./index.js";
import type { Database } from "@magyarsportonline/db";

const databaseUrl = getTestDatabaseUrl();

describe.skipIf(!databaseUrl)("projectStoryReadModel (real Postgres)", () => {
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

  async function seedPublishedStory() {
    const [source] = await db
      .insert(schema.sources)
      .values({
        name: "Demo Forras",
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
        sourceUrl: "https://example.test/cikk-1",
        titleOriginal: "Cim",
        bodyOriginal: "Torzs",
        language: "hu",
      })
      .returning();
    if (!rawArticle) throw new Error("seed failed");

    const [story] = await db
      .insert(schema.stories)
      .values({
        canonicalTitle: "Duna FC nyert",
        status: "published",
        slug: "duna-fc-nyert",
        confidenceScore: "0.620",
        isDeveloping: false,
        publishedAt: new Date(),
      })
      .returning();
    if (!story) throw new Error("seed failed");

    await db.insert(schema.storySources).values({
      storyId: story.id,
      rawArticleId: rawArticle.id,
      contributionType: "initial",
    });

    const [version] = await db
      .insert(schema.storyVersions)
      .values({
        storyId: story.id,
        versionNumber: 1,
        titleHu: "Duna FC nyert",
        leadHu: "A Duna FC 2-1-re gyozott.",
        bodyHu: "A Duna FC 2-1-re gyozott.\n\nReszletek kesobb.",
        changeSummaryHu: "Kezdeti hir.",
        generatedByModel: "template-fallback-v1",
        promptVersion: "v1",
        isPublished: true,
      })
      .returning();
    if (!version) throw new Error("seed failed");

    await db
      .update(schema.stories)
      .set({ currentVersionId: version.id })
      .where(eq(schema.stories.id, story.id));

    return { story, version, source };
  }

  it("creates a read-model row with body HTML and source summary", async () => {
    const { story } = await seedPublishedStory();

    await projectStoryReadModel(deps(), { storyId: story.id, correlationId: crypto.randomUUID() });

    const [readModel] = await db
      .select()
      .from(schema.storyReadModel)
      .where(eq(schema.storyReadModel.storyId, story.id));

    expect(readModel?.slug).toBe("duna-fc-nyert");
    expect(readModel?.bodyHtml).toContain("<p>A Duna FC 2-1-re gyozott.</p>");
    expect(readModel?.bodyHtml).toContain("<p>Reszletek kesobb.</p>");
    const sourcesSummary = readModel?.sourcesSummary as unknown[];
    expect(sourcesSummary).toHaveLength(1);
    const versionHistory = readModel?.versionHistorySummary as unknown[];
    expect(versionHistory).toHaveLength(1);
  });

  it("upserts on a second call instead of erroring on the primary key", async () => {
    const { story } = await seedPublishedStory();
    await projectStoryReadModel(deps(), { storyId: story.id, correlationId: crypto.randomUUID() });

    await db
      .update(schema.stories)
      .set({ confidenceScore: "0.900" })
      .where(eq(schema.stories.id, story.id));

    await projectStoryReadModel(deps(), { storyId: story.id, correlationId: crypto.randomUUID() });

    const rows = await db
      .select()
      .from(schema.storyReadModel)
      .where(eq(schema.storyReadModel.storyId, story.id));
    expect(rows).toHaveLength(1);
    expect(Number(rows[0]?.confidenceScore)).toBeCloseTo(0.9, 3);
  });

  it("skips projection when the Story has no slug/currentVersionId yet", async () => {
    const [story] = await db
      .insert(schema.stories)
      .values({ canonicalTitle: "Meg nincs kesz", status: "draft" })
      .returning();
    if (!story) throw new Error("seed failed");

    await projectStoryReadModel(deps(), { storyId: story.id, correlationId: crypto.randomUUID() });

    const rows = await db.select().from(schema.storyReadModel);
    expect(rows).toHaveLength(0);
  });
});

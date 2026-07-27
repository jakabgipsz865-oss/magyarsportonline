import { schema } from "@magyarsportonline/db";
import {
  createTestDatabase,
  getTestDatabaseUrl,
  truncateAllTables,
} from "@magyarsportonline/db/testing";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getPublishedStoryBySlug, listPublishedStories } from "./stories";
import type { Database } from "@magyarsportonline/db";

const databaseUrl = getTestDatabaseUrl();

describe.skipIf(!databaseUrl)("lib/stories (real Postgres)", () => {
  let db: Database;

  beforeAll(async () => {
    db = await createTestDatabase();
  });

  beforeEach(async () => {
    await truncateAllTables(db);
  });

  async function seedReadModel(slug: string, overrides: Partial<{ publishedAt: Date }> = {}) {
    const [story] = await db
      .insert(schema.stories)
      .values({ canonicalTitle: `Cim ${slug}`, status: "published", slug })
      .returning();
    if (!story) throw new Error("seed failed");

    await db.insert(schema.storyReadModel).values({
      storyId: story.id,
      slug,
      titleHu: `Cim ${slug}`,
      leadHu: "Bevezeto",
      bodyHtml: "<p>Torzs</p>",
      confidenceScore: "0.700",
      isDeveloping: false,
      publishedAt: overrides.publishedAt ?? new Date(),
      sourcesSummary: [
        { name: "Forras", url: "https://example.test", firstSeenAt: new Date().toISOString() },
      ],
      versionHistorySummary: [
        { versionNumber: 1, createdAt: new Date().toISOString(), changeSummary: "Kezdeti." },
      ],
    });
  }

  it("returns null for a slug that has no read-model row", async () => {
    const story = await getPublishedStoryBySlug(db, "nincs-ilyen");
    expect(story).toBeNull();
  });

  it("returns the full detail for a known slug", async () => {
    await seedReadModel("teszt-cikk");
    const story = await getPublishedStoryBySlug(db, "teszt-cikk");
    expect(story?.titleHu).toBe("Cim teszt-cikk");
    expect(story?.confidenceScore).toBeCloseTo(0.7, 3);
    expect(story?.sourcesSummary).toHaveLength(1);
    expect(story?.versionHistory).toHaveLength(1);
  });

  it("lists published stories ordered by most recently updated first", async () => {
    await seedReadModel("regi", { publishedAt: new Date("2026-01-01T00:00:00Z") });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await seedReadModel("uj", { publishedAt: new Date("2026-07-01T00:00:00Z") });

    const stories = await listPublishedStories(db);
    expect(stories.map((s) => s.slug)).toEqual(["uj", "regi"]);
  });
});

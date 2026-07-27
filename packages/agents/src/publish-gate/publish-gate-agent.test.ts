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
import { runPublishGateAgent } from "./index.js";
import type { Database } from "@magyarsportonline/db";

const databaseUrl = getTestDatabaseUrl();

describe.skipIf(!databaseUrl)("runPublishGateAgent (real Postgres)", () => {
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

  async function seedStoryWithVersion() {
    const [story] = await db
      .insert(schema.stories)
      .values({ canonicalTitle: "Cim", status: "seo_ready", slug: "cim" })
      .returning();
    if (!story) throw new Error("seed failed");
    const [version] = await db
      .insert(schema.storyVersions)
      .values({
        storyId: story.id,
        versionNumber: 1,
        titleHu: "Cim",
        leadHu: "Bevezeto",
        bodyHu: "Torzs",
        generatedByModel: "template-fallback-v1",
        promptVersion: "v1",
        isPublished: false,
      })
      .returning();
    if (!version) throw new Error("seed failed");
    return { story, version };
  }

  it("publishes the version and marks the Story published on auto_publish", async () => {
    const { story, version } = await seedStoryWithVersion();

    const decision = await runPublishGateAgent(deps(), {
      storyId: story.id,
      storyVersionId: version.id,
      factVerification: { confidenceScore: 0.8, riskLevel: "low", hasContradiction: false },
      correlationId: crypto.randomUUID(),
    });

    expect(decision.decision).toBe("auto_publish");

    const [updatedStory] = await db
      .select()
      .from(schema.stories)
      .where(eq(schema.stories.id, story.id));
    expect(updatedStory?.status).toBe("published");
    expect(updatedStory?.currentVersionId).toBe(version.id);
    expect(updatedStory?.publishedAt).not.toBeNull();

    const [updatedVersion] = await db
      .select()
      .from(schema.storyVersions)
      .where(eq(schema.storyVersions.id, version.id));
    expect(updatedVersion?.isPublished).toBe(true);
  });

  it("does not overwrite publishedAt on a subsequent auto-published update", async () => {
    const { story, version } = await seedStoryWithVersion();
    const deps1 = deps();
    await runPublishGateAgent(deps1, {
      storyId: story.id,
      storyVersionId: version.id,
      factVerification: { confidenceScore: 0.8, riskLevel: "low", hasContradiction: false },
      correlationId: crypto.randomUUID(),
    });
    const [firstPublish] = await db
      .select()
      .from(schema.stories)
      .where(eq(schema.stories.id, story.id));

    const [version2] = await db
      .insert(schema.storyVersions)
      .values({
        storyId: story.id,
        versionNumber: 2,
        titleHu: "Cim2",
        leadHu: "Bevezeto2",
        bodyHu: "Torzs2",
        generatedByModel: "template-fallback-v1",
        promptVersion: "v1",
        isPublished: false,
      })
      .returning();
    if (!version2) throw new Error("seed failed");

    await new Promise((resolve) => setTimeout(resolve, 10));
    await runPublishGateAgent(deps(), {
      storyId: story.id,
      storyVersionId: version2.id,
      factVerification: { confidenceScore: 0.9, riskLevel: "low", hasContradiction: false },
      correlationId: crypto.randomUUID(),
    });

    const [secondPublish] = await db
      .select()
      .from(schema.stories)
      .where(eq(schema.stories.id, story.id));
    expect(secondPublish?.publishedAt?.getTime()).toBe(firstPublish?.publishedAt?.getTime());
    expect(secondPublish?.currentVersionId).toBe(version2.id);
  });

  it("routes to the review queue instead of publishing when risk is not low", async () => {
    const { story, version } = await seedStoryWithVersion();

    const decision = await runPublishGateAgent(deps(), {
      storyId: story.id,
      storyVersionId: version.id,
      factVerification: { confidenceScore: 0.9, riskLevel: "medium", hasContradiction: false },
      correlationId: crypto.randomUUID(),
    });

    expect(decision).toEqual({ decision: "review_required", reason: "high_risk" });

    const [updatedStory] = await db
      .select()
      .from(schema.stories)
      .where(eq(schema.stories.id, story.id));
    expect(updatedStory?.status).toBe("pending_review");

    const reviewItems = await db.select().from(schema.reviewQueueItems);
    expect(reviewItems).toHaveLength(1);
    expect(reviewItems[0]?.reason).toBe("high_risk");
  });
});

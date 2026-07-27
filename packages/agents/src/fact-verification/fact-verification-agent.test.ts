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
import { runFactVerificationAgent } from "./index.js";
import type { Database } from "@magyarsportonline/db";

const databaseUrl = getTestDatabaseUrl();

describe.skipIf(!databaseUrl)(
  "runFactVerificationAgent (real Postgres, rule-based fallback)",
  () => {
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
        // no llmClient -> exercises the ADR 0007 fallback path
      };
    }

    async function seedStoryWithSource(reliabilityTier: "A" | "B" | "C") {
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

      const [story] = await db
        .insert(schema.stories)
        .values({ canonicalTitle: "Teszt Story", status: "draft", isDeveloping: true })
        .returning();
      if (!story) throw new Error("failed to seed story");

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
      if (!rawArticle) throw new Error("failed to seed raw article");

      await db.insert(schema.storySources).values({
        storyId: story.id,
        rawArticleId: rawArticle.id,
        contributionType: "initial",
      });

      return { story, source, rawArticle };
    }

    it("extracts a score fact and computes a low-risk, positive confidence score", async () => {
      const { story, rawArticle } = await seedStoryWithSource("B");

      const result = await runFactVerificationAgent(deps(), {
        storyId: story.id,
        rawArticle,
        correlationId: crypto.randomUUID(),
      });

      expect(result.riskLevel).toBe("low");
      expect(result.hasContradiction).toBe(false);
      expect(result.extractionMethod).toBe("rule_based_fallback");
      expect(result.confidenceScore).toBeGreaterThan(0);

      const facts = await db.select().from(schema.facts).where(eq(schema.facts.storyId, story.id));
      expect(facts.some((f) => f.factType === "score")).toBe(true);
    });

    it("bumps corroboration_count instead of inserting a duplicate for a matching score", async () => {
      const { story, rawArticle } = await seedStoryWithSource("B");
      await runFactVerificationAgent(deps(), {
        storyId: story.id,
        rawArticle,
        correlationId: crypto.randomUUID(),
      });

      const [secondArticle] = await db
        .insert(schema.rawArticles)
        .values({
          sourceId: rawArticle.sourceId,
          sourceUrl: `https://example.test/${crypto.randomUUID()}`,
          titleOriginal: "Megerosites",
          bodyOriginal: "Vegeredmeny: Duna FC 2-1 Tisza SE.",
          language: "hu",
        })
        .returning();
      if (!secondArticle) throw new Error("seed failed");

      await runFactVerificationAgent(deps(), {
        storyId: story.id,
        rawArticle: secondArticle,
        correlationId: crypto.randomUUID(),
      });

      const facts = await db.select().from(schema.facts).where(eq(schema.facts.storyId, story.id));
      const scoreFacts = facts.filter((f) => f.factType === "score");
      expect(scoreFacts).toHaveLength(1);
      expect(scoreFacts[0]?.corroborationCount).toBe(2);
    });

    it("flags a contradiction and raises risk when scores disagree", async () => {
      const { story, rawArticle } = await seedStoryWithSource("B");
      await runFactVerificationAgent(deps(), {
        storyId: story.id,
        rawArticle,
        correlationId: crypto.randomUUID(),
      });

      const [contradictingArticle] = await db
        .insert(schema.rawArticles)
        .values({
          sourceId: rawArticle.sourceId,
          sourceUrl: `https://example.test/${crypto.randomUUID()}`,
          titleOriginal: "Elteres",
          bodyOriginal: "Vegeredmeny: Duna FC 3-1 Tisza SE.",
          language: "hu",
        })
        .returning();
      if (!contradictingArticle) throw new Error("seed failed");

      const result = await runFactVerificationAgent(deps(), {
        storyId: story.id,
        rawArticle: contradictingArticle,
        correlationId: crypto.randomUUID(),
      });

      expect(result.hasContradiction).toBe(true);
    });

    it("classifies risk as high when injury/death keywords are present", async () => {
      const [source] = await db
        .insert(schema.sources)
        .values({
          name: "Source",
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
      const [story] = await db
        .insert(schema.stories)
        .values({ canonicalTitle: "Serules hir", status: "draft" })
        .returning();
      if (!story) throw new Error("seed failed");
      const [rawArticle] = await db
        .insert(schema.rawArticles)
        .values({
          sourceId: source.id,
          sourceUrl: `https://example.test/${crypto.randomUUID()}`,
          titleOriginal: "Serules",
          bodyOriginal: "A jatekos sulyosan megserult a merkozesen.",
          language: "hu",
        })
        .returning();
      if (!rawArticle) throw new Error("seed failed");
      await db
        .insert(schema.storySources)
        .values({ storyId: story.id, rawArticleId: rawArticle.id, contributionType: "initial" });

      const result = await runFactVerificationAgent(deps(), {
        storyId: story.id,
        rawArticle,
        correlationId: crypto.randomUUID(),
      });

      expect(result.riskLevel).toBe("medium");
    });
  },
);

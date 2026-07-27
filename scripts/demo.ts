#!/usr/bin/env node
/**
 * End-to-end MVP demo (docs/architecture/08-roadmap.md, MVP scope agreed
 * after Fázis 0). One command that walks the full pipeline documented in
 * docs/architecture/02-agents.md and 03-event-flow.md — minus the queue
 * (docs/adr/0005-mvp-direct-orchestration-no-queue.md) — for a single demo
 * event, twice: once from an "initial" source, once from a corroborating
 * source that adds a genuinely new fact (a post-match quote).
 *
 * Usage: `pnpm demo` from the repo root. Requires DATABASE_URL (a reachable
 * Postgres with the pgvector extension available — see CONTRIBUTING.md).
 * ANTHROPIC_API_KEY is optional: without it, the Fact Verification and
 * Hungarian Writer agents run in the explicitly-labeled, non-AI fallback
 * mode from docs/adr/0007-mvp-llm-fallback-mode.md.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDatabaseClient, schema, type Database } from "@magyarsportonline/db";
import { truncateAllTables } from "@magyarsportonline/db/testing";
import { createAnthropicClient, isLlmConfigured } from "@magyarsportonline/llm";
import { createLogger, type Logger } from "@magyarsportonline/observability";
import { eq } from "drizzle-orm";
import {
  createAgentRunRecorder,
  projectStoryReadModel,
  runDeduplicationAgent,
  runFactVerificationAgent,
  runHungarianWriterAgent,
  runPublishGateAgent,
  runSeoAgent,
  runSourceIngestAgent,
  runStoryMergeAgent,
  type RecordAgentRun,
} from "@magyarsportonline/agents";
import { startFixtureServer } from "../packages/agents/src/test-utils/fixture-server.js";
import { seedDemoData } from "./seed.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_FOLDER = path.join(HERE, "..", "packages", "db", "drizzle");
const FIXTURES_DIR = path.join(HERE, "fixtures");

function section(title: string): void {
  console.log(`\n${"═".repeat(70)}\n  ${title}\n${"═".repeat(70)}`);
}

async function processRawArticle(
  deps: {
    db: Database;
    logger: Logger;
    recordAgentRun: RecordAgentRun;
    llmClient?: ReturnType<typeof createAnthropicClient>;
    llmApiKey?: string;
  },
  input: { rawArticleId: string; categorySlug: string },
): Promise<{ storyId: string; slug: string | null; published: boolean } | null> {
  const correlationId = crypto.randomUUID();

  const rawArticle = await deps.db.query.rawArticles.findFirst({
    where: eq(schema.rawArticles.id, input.rawArticleId),
  });
  if (!rawArticle) throw new Error(`RawArticle ${input.rawArticleId} not found`);

  const dedup = await runDeduplicationAgent(deps, {
    rawArticle: {
      id: rawArticle.id,
      titleOriginal: rawArticle.titleOriginal,
      bodyOriginal: rawArticle.bodyOriginal,
      publishedAtSource: rawArticle.publishedAtSource,
      ingestedAt: rawArticle.ingestedAt,
    },
    categorySlug: input.categorySlug,
    correlationId,
  });
  console.log(
    `  → Deduplication: ${dedup.matchType}${dedup.matchedStoryId ? ` (existing story ${dedup.matchedStoryId})` : ""}`,
  );

  const source = await deps.db.query.sources.findFirst({
    where: eq(schema.sources.id, rawArticle.sourceId),
  });
  if (!source) throw new Error("source not found for raw article");

  const merge = await runStoryMergeAgent(deps, {
    dedup,
    rawArticle: {
      id: rawArticle.id,
      titleOriginal: rawArticle.titleOriginal,
      bodyOriginal: rawArticle.bodyOriginal,
    },
    sourceReliabilityTier: source.reliabilityTier,
    correlationId,
  });
  console.log(
    `  → Story Merge: ${merge.isNewStory ? "new Story created" : "attached to existing Story"} (contribution: ${merge.contributionType}) story_id=${merge.storyId}`,
  );

  if (!merge.requiresFactVerification) {
    console.log(
      "  → (pure corroboration — Fact Verification/Writer skipped, confidence score updated directly)",
    );
    return { storyId: merge.storyId, slug: null, published: false };
  }

  const factResult = await runFactVerificationAgent(deps, {
    storyId: merge.storyId,
    rawArticle: {
      id: rawArticle.id,
      titleOriginal: rawArticle.titleOriginal,
      bodyOriginal: rawArticle.bodyOriginal,
    },
    correlationId,
  });
  console.log(
    `  → Fact Verification: confidence=${factResult.confidenceScore.toFixed(3)} risk=${factResult.riskLevel} contradiction=${factResult.hasContradiction} method=${factResult.extractionMethod}`,
  );

  const writerResult = await runHungarianWriterAgent(deps, {
    storyId: merge.storyId,
    correlationId,
  });
  console.log(
    `  → Hungarian Writer: version ${writerResult.versionNumber} written by "${writerResult.generatedByModel}"`,
  );

  const seoResult = await runSeoAgent(deps, { storyId: merge.storyId, correlationId });
  console.log(`  → SEO: slug="${seoResult.slug}"`);

  const gateDecision = await runPublishGateAgent(deps, {
    storyId: merge.storyId,
    storyVersionId: writerResult.storyVersionId,
    factVerification: {
      confidenceScore: factResult.confidenceScore,
      riskLevel: factResult.riskLevel,
      hasContradiction: factResult.hasContradiction,
    },
    correlationId,
  });

  if (gateDecision.decision === "auto_publish") {
    console.log("  → Publish Gate: AUTO-PUBLISHED");
    await projectStoryReadModel(deps, { storyId: merge.storyId, correlationId });
    console.log("  → Read Model: projected for public frontend");
    return { storyId: merge.storyId, slug: seoResult.slug, published: true };
  }

  console.log(`  → Publish Gate: sent to REVIEW QUEUE (reason: ${gateDecision.reason})`);
  return { storyId: merge.storyId, slug: seoResult.slug, published: false };
}

async function main(): Promise<void> {
  const databaseUrl = process.env["DATABASE_URL"];
  if (!databaseUrl) {
    console.error(
      "DATABASE_URL is not set. Point it at a reachable Postgres with the pgvector extension available — see CONTRIBUTING.md.",
    );
    process.exitCode = 1;
    return;
  }

  const anthropicApiKey = process.env["ANTHROPIC_API_KEY"];
  const llmConfigured = isLlmConfigured(anthropicApiKey);

  section("AI-first Sport News Engine — end-to-end MVP demo");
  console.log(
    llmConfigured
      ? "ANTHROPIC_API_KEY found — running with real Claude calls (Fact Verification + Hungarian Writer)."
      : 'ANTHROPIC_API_KEY not set — running in the explicitly-labeled fallback mode (docs/adr/0007-mvp-llm-fallback-mode.md). No AI text will be generated; StoryVersion.generatedByModel will say "template-fallback-v1".',
  );

  const db = createDatabaseClient(databaseUrl);
  const logger = createLogger({ level: (process.env["LOG_LEVEL"] as never) ?? "info" });
  const recordAgentRun = createAgentRunRecorder(db);
  const deps = {
    db,
    logger,
    recordAgentRun,
    ...(llmConfigured
      ? { llmClient: createAnthropicClient(anthropicApiKey), llmApiKey: anthropicApiKey }
      : {}),
  };

  section("Setup: migrations + fixtures + seed data");
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  console.log("Migrations applied.");
  await truncateAllTables(db);
  console.log("Database reset for a clean, reproducible demo run.");

  const fixtureServer = await startFixtureServer(FIXTURES_DIR);
  console.log(`Fixture RSS server running at ${fixtureServer.baseUrl}`);

  const seed = await seedDemoData(db, fixtureServer.baseUrl);
  console.log(
    `Seeded entities (Duna FC, Tisza SE), category "${seed.categorySlug}", and 2 demo Sources.`,
  );

  try {
    section("Step 1 — ingest Forrás A (Demo Sporthír Ügynökség)");
    const ingestA = await runSourceIngestAgent(deps, {
      source: { id: seed.sourceA.id, baseUrl: seed.sourceA.baseUrl, language: "hu" },
      correlationId: crypto.randomUUID(),
    });
    console.log(`  → ${ingestA.newRawArticleIds.length} new RawArticle(s) ingested.`);

    let firstStoryId: string | null = null;
    let firstSlug: string | null = null;
    for (const rawArticleId of ingestA.newRawArticleIds) {
      const result = await processRawArticle(deps, {
        rawArticleId,
        categorySlug: seed.categorySlug,
      });
      if (result) {
        firstStoryId = result.storyId;
        firstSlug = result.slug ?? firstSlug;
      }
    }

    section("Step 2 — ingest Forrás B (Demo Sport Extra, ugyanarról az eseményről)");
    const ingestB = await runSourceIngestAgent(deps, {
      source: { id: seed.sourceB.id, baseUrl: seed.sourceB.baseUrl, language: "hu" },
      correlationId: crypto.randomUUID(),
    });
    console.log(`  → ${ingestB.newRawArticleIds.length} new RawArticle(s) ingested.`);

    for (const rawArticleId of ingestB.newRawArticleIds) {
      await processRawArticle(deps, { rawArticleId, categorySlug: seed.categorySlug });
    }

    section("Eredmény");
    if (!firstStoryId) {
      console.log("Nem jött létre Story — ellenőrizd a fixture-öket és a logokat.");
      return;
    }

    const finalStory = await db.query.stories.findFirst({
      where: eq(schema.stories.id, firstStoryId),
    });
    const versions = await db
      .select()
      .from(schema.storyVersions)
      .where(eq(schema.storyVersions.storyId, firstStoryId));
    versions.sort((a, b) => a.versionNumber - b.versionNumber);

    console.log(`Story: "${finalStory?.canonicalTitle}"`);
    console.log(`  slug: ${finalStory?.slug ?? firstSlug ?? "(nincs)"}`);
    console.log(`  status: ${finalStory?.status}`);
    console.log(`  confidence_score: ${finalStory?.confidenceScore}`);
    console.log(`  version_count: ${versions.length}`);
    console.log("  Timeline:");
    for (const v of versions) {
      console.log(`    v${v.versionNumber} (${v.createdAt.toISOString()}) — ${v.changeSummaryHu}`);
    }

    if (finalStory?.slug) {
      console.log(
        `\nNézd meg a weboldalon: indítsd el \`pnpm dev\`-et egy másik terminálban, majd nyisd meg: http://localhost:3000/hir/${finalStory.slug}`,
      );
    }
  } finally {
    await fixtureServer.close();
    // postgres-js keeps the TCP connection pool open (by design, for reuse
    // in long-lived server processes) — this is a short-lived CLI script,
    // so it must close explicitly or Node never exits.
    await db.$client.end();
  }
}

main().catch((error: unknown) => {
  console.error("Demo failed:", error);
  process.exitCode = 1;
});

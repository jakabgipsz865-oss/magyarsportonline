import path from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDatabaseClient, type Database } from "./client.js";

const MIGRATIONS_FOLDER = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "drizzle");

/**
 * Test-only helper. Unlike `createDatabaseClient` (which deliberately never
 * reads `process.env`, see client.ts), this reads `TEST_DATABASE_URL`
 * directly — it exists purely to make integration test setup convenient
 * (`beforeAll(async () => { db = await createTestDatabase() })`), never used
 * from application code.
 */
export function getTestDatabaseUrl(): string | undefined {
  return process.env["TEST_DATABASE_URL"] ?? process.env["DATABASE_URL"];
}

/** Connects and runs all pending migrations — idempotent, safe to call once per test run. */
export async function createTestDatabase(): Promise<Database> {
  const url = getTestDatabaseUrl();
  if (!url) {
    throw new Error(
      "TEST_DATABASE_URL (or DATABASE_URL) must be set to run @magyarsportonline/db integration tests — see CONTRIBUTING.md",
    );
  }
  const db = createDatabaseClient(url);
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return db;
}

/** Empties every table between tests so each test starts from a clean slate. */
export async function truncateAllTables(db: Database): Promise<void> {
  await db.execute(sql`
    TRUNCATE TABLE
      social_posts, review_queue_items, story_tags, story_entities, facts,
      story_sources, story_read_model, story_fingerprints, story_versions,
      raw_articles, stories, agent_runs, entities, tags, categories, sources
    RESTART IDENTITY CASCADE
  `);
}

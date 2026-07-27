import { schema } from "@magyarsportonline/db";
import {
  createTestDatabase,
  getTestDatabaseUrl,
  truncateAllTables,
} from "@magyarsportonline/db/testing";
import { createLogger } from "@magyarsportonline/observability";
import path from "node:path";
import { Writable } from "node:stream";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startFixtureServer, type FixtureServer } from "../test-utils/fixture-server.js";
import { runSourceIngestAgent } from "./index.js";
import type { Database } from "@magyarsportonline/db";

const FIXTURES_DIR = path.join(import.meta.dirname, "..", "..", "..", "..", "scripts", "fixtures");

const databaseUrl = getTestDatabaseUrl();

describe.skipIf(!databaseUrl)("runSourceIngestAgent (real Postgres + real HTTP)", () => {
  let db: Database;
  let fixtureServer: FixtureServer;

  beforeAll(async () => {
    db = await createTestDatabase();
    fixtureServer = await startFixtureServer(FIXTURES_DIR);
  });

  afterAll(async () => {
    await fixtureServer.close();
  });

  beforeEach(async () => {
    await truncateAllTables(db);
  });

  async function insertDemoSource() {
    const [source] = await db
      .insert(schema.sources)
      .values({
        name: "Demo Sporthír Ügynökség",
        baseUrl: `${fixtureServer.baseUrl}/source-a.xml`,
        type: "rss",
        language: "hu",
        licenseType: "public_rss",
        reliabilityTier: "B",
        fetchConfig: {},
        isActive: true,
      })
      .returning();
    if (!source) throw new Error("failed to insert demo source");
    return source;
  }

  it("ingests a new RawArticle from a real RSS fetch over local HTTP", async () => {
    const source = await insertDemoSource();
    const logger = createLogger({ destination: new Writable({ write: (_c, _e, cb) => cb() }) });
    const recordAgentRun = async () => {};

    const result = await runSourceIngestAgent(
      { db, logger, recordAgentRun },
      { source, correlationId: "11111111-1111-4111-8111-111111111111" },
    );

    expect(result.newRawArticleIds).toHaveLength(1);
    expect(result.skippedExistingCount).toBe(0);

    const rows = await db.select().from(schema.rawArticles);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.titleOriginal).toContain("Duna FC");
    expect(rows[0]?.sourceId).toBe(source.id);
  });

  it("skips already-ingested URLs on a second run", async () => {
    const source = await insertDemoSource();
    const logger = createLogger({ destination: new Writable({ write: (_c, _e, cb) => cb() }) });
    const recordAgentRun = async () => {};
    const deps = { db, logger, recordAgentRun };
    const input = { source, correlationId: "22222222-2222-4222-8222-222222222222" };

    await runSourceIngestAgent(deps, input);
    const second = await runSourceIngestAgent(deps, input);

    expect(second.newRawArticleIds).toHaveLength(0);
    expect(second.skippedExistingCount).toBe(1);

    const rows = await db.select().from(schema.rawArticles);
    expect(rows).toHaveLength(1);
  });
});

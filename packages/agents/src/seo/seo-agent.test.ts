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
import { runSeoAgent } from "./index.js";
import type { Database } from "@magyarsportonline/db";

const databaseUrl = getTestDatabaseUrl();

describe.skipIf(!databaseUrl)("runSeoAgent (real Postgres)", () => {
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

  it("assigns a slug derived from the canonical title", async () => {
    const [story] = await db
      .insert(schema.stories)
      .values({ canonicalTitle: "Duna FC nyert a Tisza SE ellen", status: "written" })
      .returning();
    if (!story) throw new Error("seed failed");

    const result = await runSeoAgent(deps(), {
      storyId: story.id,
      correlationId: crypto.randomUUID(),
    });

    expect(result.slug).toBe("duna-fc-nyert-a-tisza-se-ellen");
    const [row] = await db.select().from(schema.stories).where(eq(schema.stories.id, story.id));
    expect(row?.slug).toBe(result.slug);
  });

  it("appends a numeric suffix when the base slug already exists", async () => {
    await db.insert(schema.stories).values({
      canonicalTitle: "Duplikalt cim",
      status: "published",
      slug: "duplikalt-cim",
    });
    const [story] = await db
      .insert(schema.stories)
      .values({ canonicalTitle: "Duplikalt cim", status: "written" })
      .returning();
    if (!story) throw new Error("seed failed");

    const result = await runSeoAgent(deps(), {
      storyId: story.id,
      correlationId: crypto.randomUUID(),
    });

    expect(result.slug).toBe("duplikalt-cim-2");
  });

  it("never reassigns a slug that is already set", async () => {
    const [story] = await db
      .insert(schema.stories)
      .values({ canonicalTitle: "Cim valtozott azota", status: "updated", slug: "eredeti-slug" })
      .returning();
    if (!story) throw new Error("seed failed");

    const result = await runSeoAgent(deps(), {
      storyId: story.id,
      correlationId: crypto.randomUUID(),
    });

    expect(result.slug).toBe("eredeti-slug");
  });
});

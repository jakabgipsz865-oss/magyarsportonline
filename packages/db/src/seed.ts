import { eq } from "drizzle-orm";
import { createDatabaseClient, type Database } from "./client";
import { categories, entities, sources } from "./schema/index";

/**
 * Local-dev seed data (docs/architecture/08-roadmap.md Fázis 1, 20. lépés).
 * Idempotent — safe to re-run: every insert is guarded by an existence check
 * on a natural key, since none of these tables have a `UNIQUE` constraint to
 * lean on with `onConflictDoNothing` (unlike the join tables, which do).
 *
 * Standalone CLI script, not part of apps/web — reads `DATABASE_URL` from
 * `process.env` directly rather than through apps/web/lib/env.ts, matching
 * `client.ts`'s "usable from any runtime" design (see its module comment).
 */

async function upsertCategory(db: Database, input: { slug: string; nameHu: string }) {
  const [existing] = await db
    .select()
    .from(categories)
    .where(eq(categories.slug, input.slug))
    .limit(1);
  if (existing) {
    return existing;
  }
  const [row] = await db.insert(categories).values(input).returning();
  if (!row) {
    throw new Error(`Failed to seed category "${input.slug}"`);
  }
  return row;
}

async function upsertEntity(
  db: Database,
  input: {
    type: "player" | "team" | "competition" | "league" | "venue";
    nameCanonical: string;
    nameHu: string;
    aliases: string[];
  },
) {
  const [existing] = await db
    .select()
    .from(entities)
    .where(eq(entities.nameCanonical, input.nameCanonical))
    .limit(1);
  if (existing) {
    return existing;
  }
  const [row] = await db.insert(entities).values(input).returning();
  if (!row) {
    throw new Error(`Failed to seed entity "${input.nameCanonical}"`);
  }
  return row;
}

async function upsertSource(
  db: Database,
  input: {
    name: string;
    baseUrl: string;
    type: "rss" | "api" | "scraper";
    language: string;
    licenseType: "public_rss" | "licensed_api" | "scrape_allowed";
    reliabilityTier: "A" | "B" | "C";
    fetchConfig: Record<string, unknown>;
    isActive: boolean;
  },
) {
  const [existing] = await db.select().from(sources).where(eq(sources.name, input.name)).limit(1);
  if (existing) {
    return existing;
  }
  const [row] = await db.insert(sources).values(input).returning();
  if (!row) {
    throw new Error(`Failed to seed source "${input.name}"`);
  }
  return row;
}

export async function seed(db: Database): Promise<void> {
  await upsertCategory(db, { slug: "labdarugas", nameHu: "Labdarúgás" });

  // Small taxonomy covering teams/competitions that show up regularly in the
  // BBC Sport Football feed — enough for the MVP's deterministic alias-lookup
  // entity matching (docs/adr/0005-mvp-end-to-end-scope-cuts.md decision 3).
  // Extending the source base beyond this dev feed means extending this list,
  // not touching any agent's code.
  const teamEntities: Array<{ nameCanonical: string; nameHu: string; aliases: string[] }> = [
    { nameCanonical: "Liverpool FC", nameHu: "Liverpool", aliases: ["Liverpool"] },
    {
      nameCanonical: "Manchester United FC",
      nameHu: "Manchester United",
      aliases: ["Manchester United", "Man Utd", "Man United"],
    },
    {
      nameCanonical: "Manchester City FC",
      nameHu: "Manchester City",
      aliases: ["Manchester City", "Man City"],
    },
    { nameCanonical: "Arsenal FC", nameHu: "Arsenal", aliases: ["Arsenal"] },
    { nameCanonical: "Chelsea FC", nameHu: "Chelsea", aliases: ["Chelsea"] },
    { nameCanonical: "Tottenham Hotspur FC", nameHu: "Tottenham", aliases: ["Tottenham", "Spurs"] },
    { nameCanonical: "Newcastle United FC", nameHu: "Newcastle United", aliases: ["Newcastle"] },
    { nameCanonical: "Real Madrid CF", nameHu: "Real Madrid", aliases: ["Real Madrid"] },
    { nameCanonical: "FC Barcelona", nameHu: "Barcelona", aliases: ["Barcelona", "Barca"] },
    {
      nameCanonical: "FC Bayern München",
      nameHu: "Bayern München",
      aliases: ["Bayern Munich", "Bayern"],
    },
  ];
  for (const team of teamEntities) {
    await upsertEntity(db, { type: "team", ...team });
  }

  const competitionEntities: Array<{ nameCanonical: string; nameHu: string; aliases: string[] }> = [
    {
      nameCanonical: "Premier League",
      nameHu: "Premier League",
      aliases: ["Premier League", "PL"],
    },
    {
      nameCanonical: "UEFA Champions League",
      nameHu: "Bajnokok Ligája",
      aliases: ["Champions League", "BL"],
    },
    { nameCanonical: "FA Cup", nameHu: "FA Kupa", aliases: ["FA Cup"] },
  ];
  for (const competition of competitionEntities) {
    await upsertEntity(db, { type: "competition", ...competition });
  }

  // Dev/demo source only — the actual, licensed source onboarding with legal
  // review is roadmap Fázis 3, 32. lépés, a separate future task. The URL
  // lives here (seed data), never in the Source Ingest Agent's code, so
  // adding the next source is a data change, not a code change.
  await upsertSource(db, {
    name: "BBC Sport - Football",
    baseUrl: "https://www.bbc.co.uk/sport/football",
    type: "rss",
    language: "en",
    licenseType: "public_rss",
    reliabilityTier: "B",
    fetchConfig: { url: "https://feeds.bbci.co.uk/sport/football/rss.xml" },
    isActive: true,
  });
}

async function main(): Promise<void> {
  const connectionString = process.env["DATABASE_URL"];
  if (!connectionString) {
    throw new Error("DATABASE_URL must be set to run the seed script");
  }
  const db = createDatabaseClient(connectionString);
  await seed(db);
  process.stdout.write("Seed completed.\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}

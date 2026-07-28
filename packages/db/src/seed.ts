import { count, eq } from "drizzle-orm";
import { createDatabaseClient, type Database } from "./client";
import { categories, entities, llmUsage, sources, stories, storyReadModel } from "./schema/index";

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
    type: "rss" | "api" | "scraper" | "html" | "social_embed";
    language: string;
    licenseType: "public_rss" | "licensed_api" | "scrape_allowed" | "pending_review";
    reliabilityTier: "A" | "B" | "C";
    fetchConfig: Record<string, unknown>;
    isActive: boolean;
    // Source Registry mezők (2026-07-28, docs/source-registry.md) — mind
    // opcionális, hogy a régebbi hívók ne törjenek el.
    country?: string;
    leagueTags?: Record<string, unknown> | undefined;
    category?: "official" | "league" | "club" | "trusted_media" | "tabloid" | "social" | "data_api";
    contentMode?: "full_text" | "fact_only" | "discovery_only";
    trustBaseline?: number;
    robotsStatus?: string;
    termsStatus?: string;
    extractorName?: string;
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
    // Source Registry mezők — ez az egyetlen ténylegesen bekötött, teljes
    // cikket kinyerő forrás (packages/agents/.../article-fetcher/), így
    // ez a referencia-sor a docs/source-registry.md dokumentált
    // forráscsomag számára.
    country: "GB",
    leagueTags: { leagues: ["premier-league"] },
    category: "trusted_media",
    contentMode: "full_text",
    trustBaseline: 75,
    robotsStatus: "robots.txt nem tiltja az RSS feedet vagy a cikkoldalakat crawler-számára",
    termsStatus:
      "BBC Terms of Use: publikus RSS feed, személyes/nem-kereskedelmi felhasználásra szánt; a teljes cikk átvétele helyett önálló, saját szöveget írunk belőle (Hungarian Writer), forrásmegjelöléssel",
    extractorName: "bbc-sport",
  });

  // Sky Sports — a "Hitelességi mutató v1" sprint kivétele
  // (docs/open-decisions.md), amit a felhasználó explicit engedélyezett:
  // BBC + Sky Sports párost, hogy legyen valódi, két különböző
  // hírportálról származó, ellenőrizhető két-forrásos Story a bizonyító
  // riportban. Minden más médiaforrás egyelőre a lenti
  // `documentedNotWiredSources`-ben marad.
  await upsertSource(db, {
    name: "Sky Sports - Football",
    baseUrl: "https://www.skysports.com/football",
    type: "rss",
    language: "en",
    licenseType: "public_rss",
    reliabilityTier: "B",
    fetchConfig: { url: "https://www.skysports.com/rss/12040" },
    isActive: true,
    country: "GB",
    leagueTags: { leagues: ["premier-league"] },
    category: "trusted_media",
    contentMode: "full_text",
    trustBaseline: 75,
    robotsStatus: "robots.txt nem tiltja az RSS feedet vagy a cikkoldalakat crawler-számára",
    termsStatus:
      "Sky Sports Terms of Use: publikus RSS feed, személyes/nem-kereskedelmi felhasználásra szánt; a teljes cikk átvétele helyett önálló, saját szöveget írunk belőle (Hungarian Writer), forrásmegjelöléssel",
    extractorName: "sky-sports",
  });

  // Dokumentált, de MÉG NEM BEKÖTÖTT Source Registry sorok (docs/source-registry.md) —
  // a 2026-07-28-i többforrásos irány első forráscsomagja. Minden sor
  // `isActive: false` és `licenseType: "pending_review"`, amíg az élő
  // robots.txt/ToS-audit (docs/open-decisions.md 1. és 4. tétel) le nem
  // zajlik, és amíg nincs hozzá megírt ArticleExtractor — a Source Ingest
  // Agent csak `is_active=true` forrásokat kérdez le, tehát ezek a sorok
  // önmagukban nem indítanak élő lekérdezést.
  const documentedNotWiredSources: Array<{
    name: string;
    baseUrl: string;
    type: "rss" | "api" | "scraper" | "html" | "social_embed";
    language: string;
    reliabilityTier: "A" | "B" | "C";
    country: string;
    category: "official" | "league" | "club" | "trusted_media" | "tabloid" | "social" | "data_api";
    contentMode: "full_text" | "fact_only" | "discovery_only";
    trustBaseline: number;
    leagueTags?: Record<string, unknown>;
  }> = [
    // Öt liga hivatalos oldala
    {
      name: "Premier League - hivatalos",
      baseUrl: "https://www.premierleague.com",
      type: "html",
      language: "en",
      reliabilityTier: "A",
      country: "GB",
      category: "league",
      contentMode: "discovery_only",
      trustBaseline: 90,
      leagueTags: { leagues: ["premier-league"] },
    },
    {
      name: "LaLiga - hivatalos",
      baseUrl: "https://www.laliga.com",
      type: "html",
      language: "es",
      reliabilityTier: "A",
      country: "ES",
      category: "league",
      contentMode: "discovery_only",
      trustBaseline: 90,
      leagueTags: { leagues: ["laliga"] },
    },
    {
      name: "Serie A (Lega Serie A) - hivatalos",
      baseUrl: "https://www.legaseriea.it",
      type: "html",
      language: "it",
      reliabilityTier: "A",
      country: "IT",
      category: "league",
      contentMode: "discovery_only",
      trustBaseline: 90,
      leagueTags: { leagues: ["serie-a"] },
    },
    {
      name: "Bundesliga (DFL) - hivatalos",
      baseUrl: "https://www.bundesliga.com",
      type: "html",
      language: "de",
      reliabilityTier: "A",
      country: "DE",
      category: "league",
      contentMode: "discovery_only",
      trustBaseline: 90,
      leagueTags: { leagues: ["bundesliga"] },
    },
    {
      name: "Ligue 1 (LFP) - hivatalos",
      baseUrl: "https://www.ligue1.com",
      type: "html",
      language: "fr",
      reliabilityTier: "A",
      country: "FR",
      category: "league",
      contentMode: "discovery_only",
      trustBaseline: 90,
      leagueTags: { leagues: ["ligue-1"] },
    },
    // Nemzetközi szövetségek
    {
      name: "UEFA - hivatalos",
      baseUrl: "https://www.uefa.com",
      type: "html",
      language: "en",
      reliabilityTier: "A",
      country: "CH",
      category: "official",
      contentMode: "fact_only",
      trustBaseline: 95,
    },
    {
      name: "FIFA - hivatalos",
      baseUrl: "https://www.fifa.com",
      type: "html",
      language: "en",
      reliabilityTier: "A",
      country: "CH",
      category: "official",
      contentMode: "fact_only",
      trustBaseline: 95,
    },
    // Adat-API
    {
      name: "football-data.org",
      baseUrl: "https://www.football-data.org",
      type: "api",
      language: "en",
      reliabilityTier: "A",
      country: "DE",
      category: "data_api",
      contentMode: "fact_only",
      trustBaseline: 90,
    },
    // Média (a BBC Sporton és a Sky Sportson kívül — mindkettő fentebb, ténylegesen bekötve)
    {
      name: "The Guardian - Sport",
      baseUrl: "https://www.theguardian.com/sport",
      type: "api",
      language: "en",
      reliabilityTier: "A",
      country: "GB",
      category: "trusted_media",
      contentMode: "full_text",
      trustBaseline: 85,
    },
    {
      name: "ESPN",
      baseUrl: "https://www.espn.com",
      type: "rss",
      language: "en",
      reliabilityTier: "B",
      country: "US",
      category: "trusted_media",
      contentMode: "full_text",
      trustBaseline: 75,
    },
    {
      name: "Marca",
      baseUrl: "https://www.marca.com",
      type: "rss",
      language: "es",
      reliabilityTier: "B",
      country: "ES",
      category: "trusted_media",
      contentMode: "full_text",
      trustBaseline: 70,
    },
    {
      name: "AS",
      baseUrl: "https://as.com",
      type: "rss",
      language: "es",
      reliabilityTier: "B",
      country: "ES",
      category: "trusted_media",
      contentMode: "full_text",
      trustBaseline: 70,
    },
    {
      name: "Mundo Deportivo",
      baseUrl: "https://www.mundodeportivo.com",
      type: "rss",
      language: "es",
      reliabilityTier: "B",
      country: "ES",
      category: "trusted_media",
      contentMode: "full_text",
      trustBaseline: 70,
    },
    {
      name: "Gazzetta dello Sport",
      baseUrl: "https://www.gazzetta.it",
      type: "rss",
      language: "it",
      reliabilityTier: "B",
      country: "IT",
      category: "trusted_media",
      contentMode: "full_text",
      trustBaseline: 75,
    },
    {
      name: "Corriere dello Sport",
      baseUrl: "https://www.corrieredellosport.it",
      type: "rss",
      language: "it",
      reliabilityTier: "B",
      country: "IT",
      category: "trusted_media",
      contentMode: "full_text",
      trustBaseline: 70,
    },
    {
      name: "Kicker",
      baseUrl: "https://www.kicker.de",
      type: "rss",
      language: "de",
      reliabilityTier: "A",
      country: "DE",
      category: "trusted_media",
      contentMode: "full_text",
      trustBaseline: 85,
    },
    {
      name: "Sport1",
      baseUrl: "https://www.sport1.de",
      type: "rss",
      language: "de",
      reliabilityTier: "B",
      country: "DE",
      category: "trusted_media",
      contentMode: "full_text",
      trustBaseline: 75,
    },
    {
      name: "L'Équipe",
      baseUrl: "https://www.lequipe.fr",
      type: "rss",
      language: "fr",
      reliabilityTier: "A",
      country: "FR",
      category: "trusted_media",
      contentMode: "full_text",
      trustBaseline: 85,
    },
    {
      name: "RMC Sport",
      baseUrl: "https://rmcsport.bfmtv.com",
      type: "html",
      language: "fr",
      reliabilityTier: "B",
      country: "FR",
      category: "trusted_media",
      contentMode: "full_text",
      trustBaseline: 70,
    },
  ];
  for (const source of documentedNotWiredSources) {
    await upsertSource(db, {
      name: source.name,
      baseUrl: source.baseUrl,
      type: source.type,
      language: source.language,
      licenseType: "pending_review",
      reliabilityTier: source.reliabilityTier,
      fetchConfig: {
        note: "Dokumentálva docs/source-registry.md-ben, még nincs bekötve — élő robots.txt/ToS-audit és ArticleExtractor szükséges a bekötés előtt.",
      },
      isActive: false,
      country: source.country,
      leagueTags: source.leagueTags,
      category: source.category,
      contentMode: source.contentMode,
      trustBaseline: source.trustBaseline,
      robotsStatus: "ellenőrizendő élőben a bekötés előtt (lásd docs/open-decisions.md 1. tétel)",
      termsStatus: "ellenőrizendő élőben a bekötés előtt (lásd docs/open-decisions.md 1. tétel)",
    });
  }
}

async function main(): Promise<void> {
  const connectionString = process.env["DATABASE_URL"];
  if (!connectionString) {
    throw new Error("DATABASE_URL must be set to run the seed script");
  }
  const db = createDatabaseClient(connectionString);
  try {
    await seed(db);
    process.stdout.write("Seed completed.\n");
  } finally {
    // postgres.js kapcsolat lezárása nélkül a folyamat sosem lép ki —
    // a CLI-futtatás (és minden rá épülő automatizálás) örökre lógna.
    await db.$client.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}

/** Alap táblaszámlálók a távoli (HTTP-n keresztüli) deploy-ellenőrzéshez — a setup endpoint válasza. */
export async function seedStatus(db: Database): Promise<{
  sources: number;
  categories: number;
  entities: number;
  stories: number;
  storyReadModel: number;
  llmUsageCalls: number;
}> {
  const countOf = async (
    table:
      | typeof sources
      | typeof categories
      | typeof entities
      | typeof stories
      | typeof storyReadModel
      | typeof llmUsage,
  ): Promise<number> => {
    const [row] = await db.select({ value: count() }).from(table);
    return row?.value ?? 0;
  };
  return {
    sources: await countOf(sources),
    categories: await countOf(categories),
    entities: await countOf(entities),
    stories: await countOf(stories),
    storyReadModel: await countOf(storyReadModel),
    llmUsageCalls: await countOf(llmUsage),
  };
}

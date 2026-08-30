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
    type: "player" | "coach" | "team" | "competition" | "league" | "venue";
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
    attributionRule?: string;
    pollingFrequencyMinutes?: number;
    extractorName?: string | null;
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

export const premierLeagueTeamEntities = [
  {
    nameCanonical: "AFC Bournemouth",
    nameHu: "Bournemouth",
    aliases: ["Bournemouth", "AFC Bournemouth", "Cherries"],
  },
  { nameCanonical: "Arsenal FC", nameHu: "Arsenal", aliases: ["Arsenal", "Gunners"] },
  {
    nameCanonical: "Aston Villa FC",
    nameHu: "Aston Villa",
    aliases: ["Aston Villa", "Villa"],
  },
  { nameCanonical: "Brentford FC", nameHu: "Brentford", aliases: ["Brentford", "Bees"] },
  {
    nameCanonical: "Brighton & Hove Albion FC",
    nameHu: "Brighton",
    aliases: ["Brighton", "Brighton & Hove Albion", "Seagulls"],
  },
  { nameCanonical: "Chelsea FC", nameHu: "Chelsea", aliases: ["Chelsea", "Blues"] },
  {
    nameCanonical: "Coventry City FC",
    nameHu: "Coventry City",
    aliases: ["Coventry City", "Coventry", "Sky Blues"],
  },
  {
    nameCanonical: "Crystal Palace FC",
    nameHu: "Crystal Palace",
    aliases: ["Crystal Palace", "Palace", "Eagles"],
  },
  { nameCanonical: "Everton FC", nameHu: "Everton", aliases: ["Everton", "Toffees"] },
  { nameCanonical: "Fulham FC", nameHu: "Fulham", aliases: ["Fulham", "Cottagers"] },
  {
    nameCanonical: "Hull City AFC",
    nameHu: "Hull City",
    aliases: ["Hull City", "Hull", "Tigers"],
  },
  {
    nameCanonical: "Ipswich Town FC",
    nameHu: "Ipswich Town",
    aliases: ["Ipswich Town", "Ipswich", "Tractor Boys"],
  },
  {
    nameCanonical: "Leeds United FC",
    nameHu: "Leeds United",
    aliases: ["Leeds United", "Leeds"],
  },
  { nameCanonical: "Liverpool FC", nameHu: "Liverpool", aliases: ["Liverpool", "Reds"] },
  {
    nameCanonical: "Manchester City FC",
    nameHu: "Manchester City",
    aliases: ["Manchester City", "Man City"],
  },
  {
    nameCanonical: "Manchester United FC",
    nameHu: "Manchester United",
    aliases: ["Manchester United", "Man United", "Man Utd"],
  },
  {
    nameCanonical: "Newcastle United FC",
    nameHu: "Newcastle United",
    aliases: ["Newcastle United", "Newcastle", "Magpies"],
  },
  {
    nameCanonical: "Nottingham Forest FC",
    nameHu: "Nottingham Forest",
    aliases: ["Nottingham Forest", "Forest"],
  },
  {
    nameCanonical: "Sunderland AFC",
    nameHu: "Sunderland",
    aliases: ["Sunderland", "Black Cats"],
  },
  {
    nameCanonical: "Tottenham Hotspur FC",
    nameHu: "Tottenham",
    aliases: ["Tottenham Hotspur", "Tottenham", "Spurs"],
  },
] satisfies Array<{ nameCanonical: string; nameHu: string; aliases: string[] }>;

export const cleanStartSources = [
  {
    name: "BBC Sport - Premier League",
    baseUrl: "https://www.bbc.com/sport/football/premier-league",
    type: "rss",
    language: "en",
    licenseType: "pending_review",
    reliabilityTier: "A",
    fetchConfig: {
      url: "https://feeds.bbci.co.uk/sport/football/premier-league/rss.xml",
      priority: "P0",
      relevanceProfile: "premier_league_core",
      feedEvidence:
        "Direct fetch reached XML endpoint in 2026-08; web tool rejected only because content-type is XML.",
    },
    isActive: false,
    country: "GB",
    leagueTags: { leagues: ["premier-league"] },
    category: "trusted_media",
    contentMode: "discovery_only",
    trustBaseline: 85,
    termsStatus:
      "Reuse/automation terms must be confirmed before activation; keep independent Hungarian rewrite + explicit attribution.",
    attributionRule: "Display BBC Sport as source and preserve source URL.",
    pollingFrequencyMinutes: 2,
    extractorName: "bbc-sport",
  },
  {
    name: "Sky Sports - Football",
    baseUrl: "https://www.skysports.com/football",
    type: "rss",
    language: "en",
    licenseType: "pending_review",
    reliabilityTier: "A",
    fetchConfig: {
      url: "https://www.skysports.com/rss/12040",
      priority: "P0",
      relevanceProfile: "uk_football_core",
      feedEvidence: "Direct fetch reached application/xml RSS endpoint in 2026-08.",
    },
    isActive: false,
    country: "GB",
    leagueTags: { leagues: ["premier-league"] },
    category: "trusted_media",
    contentMode: "discovery_only",
    trustBaseline: 82,
    termsStatus:
      "Reuse/automation terms must be confirmed before activation; independent Hungarian rewrite + attribution only.",
    attributionRule: "Display Sky Sports as source and preserve source URL.",
    pollingFrequencyMinutes: 2,
    extractorName: "sky-sports",
  },
  {
    name: "talkSPORT - Premier League",
    baseUrl: "https://talksport.com/football/premier-league/",
    type: "rss",
    language: "en",
    licenseType: "pending_review",
    reliabilityTier: "B",
    fetchConfig: {
      url: "https://talksport.com/football/premier-league/feed/",
      priority: "P0",
      relevanceProfile: "premier_league_gossip",
      feedEvidence:
        "Current 2026 RSS directories list a dedicated talkSPORT Premier League feed; endpoint requires live onboarding verification.",
    },
    isActive: false,
    country: "GB",
    leagueTags: { leagues: ["premier-league"] },
    category: "trusted_media",
    contentMode: "discovery_only",
    trustBaseline: 72,
    termsStatus: "Pending live ToS/robots/extractor review.",
    attributionRule: "Attribute claims explicitly to talkSPORT when not independently confirmed.",
    pollingFrequencyMinutes: 2,
    extractorName: "structured-news-article",
  },
  {
    name: "Daily Mail - Football",
    baseUrl: "https://www.dailymail.co.uk/sport/football/",
    type: "rss",
    language: "en",
    licenseType: "pending_review",
    reliabilityTier: "C",
    fetchConfig: {
      url: "https://www.dailymail.co.uk/sport/football/index.rss",
      priority: "P1",
      relevanceProfile: "uk_tabloid_football",
      feedEvidence:
        "2026 feed directories and independent live-feed projects list the Daily Mail Football RSS endpoint.",
    },
    isActive: false,
    country: "GB",
    leagueTags: { leagues: ["premier-league"] },
    category: "tabloid",
    contentMode: "discovery_only",
    trustBaseline: 55,
    termsStatus: "Pending live ToS/robots/extractor review.",
    attributionRule:
      "Rumours/exclusives must be explicitly attributed to the Daily Mail unless corroborated.",
    pollingFrequencyMinutes: 3,
    extractorName: "structured-news-article",
  },
  {
    name: "Daily Mirror - Football",
    baseUrl: "https://www.mirror.co.uk/sport/football/",
    type: "rss",
    language: "en",
    licenseType: "pending_review",
    reliabilityTier: "C",
    fetchConfig: {
      url: "https://www.mirror.co.uk/sport/football/?service=rss",
      priority: "P1",
      relevanceProfile: "uk_tabloid_football",
      feedEvidence:
        "FeedSpot's Aug 2026 Daily Mirror directory exposes this Football RSS URL; direct crawler access redirects via Tollbit.",
    },
    isActive: false,
    country: "GB",
    leagueTags: { leagues: ["premier-league"] },
    category: "tabloid",
    contentMode: "discovery_only",
    trustBaseline: 58,
    termsStatus: "Pending live ToS/robots/Tollbit/extractor review.",
    attributionRule:
      "Rumours/exclusives must be explicitly attributed to Mirror Football unless corroborated.",
    pollingFrequencyMinutes: 3,
    extractorName: "structured-news-article",
  },
  {
    name: "The Sun - Football",
    baseUrl: "https://www.thesun.co.uk/sport/football/",
    type: "rss",
    language: "en",
    licenseType: "pending_review",
    reliabilityTier: "C",
    fetchConfig: {
      url: "https://www.thesun.co.uk/sport/football/feed/",
      priority: "P1",
      relevanceProfile: "uk_tabloid_football",
      feedEvidence: "Direct 2026 fetch reached an application/rss+xml endpoint.",
    },
    isActive: false,
    country: "GB",
    leagueTags: { leagues: ["premier-league"] },
    category: "tabloid",
    contentMode: "discovery_only",
    trustBaseline: 48,
    termsStatus: "Pending live ToS/robots/extractor review.",
    attributionRule:
      "Single-source claims must be clearly framed as The Sun reporting/claiming; retain source link.",
    pollingFrequencyMinutes: 3,
    extractorName: "structured-news-article",
  },
  {
    name: "Daily Star - Football",
    baseUrl: "https://www.dailystar.co.uk/sport/football/",
    type: "rss",
    language: "en",
    licenseType: "pending_review",
    reliabilityTier: "C",
    fetchConfig: {
      url: "https://www.dailystar.co.uk/sport/football/?service=rss",
      priority: "P1",
      relevanceProfile: "uk_tabloid_football",
      feedEvidence:
        "FeedSpot's Aug 2026 Daily Star directory exposes this Football RSS URL; crawler is denied by robots.",
    },
    isActive: false,
    country: "GB",
    leagueTags: { leagues: ["premier-league"] },
    category: "tabloid",
    contentMode: "discovery_only",
    trustBaseline: 45,
    termsStatus: "Pending live ToS/robots/extractor review.",
    attributionRule:
      "Single-source claims must be explicitly attributed to Daily Star; never upgrade a rumour to fact.",
    pollingFrequencyMinutes: 3,
    extractorName: "structured-news-article",
  },
  {
    name: "Daily Express - Football",
    baseUrl: "https://www.express.co.uk/sport/football",
    type: "rss",
    language: "en",
    licenseType: "pending_review",
    reliabilityTier: "C",
    fetchConfig: {
      url: "https://feeds.feedburner.com/daily-express-football-news?format=xml",
      priority: "P1",
      relevanceProfile: "uk_tabloid_football",
      feedEvidence:
        "Current Aug 2026 directories still list a Daily Express Football feed via FeedBurner; exact endpoint requires onboarding verification.",
    },
    isActive: false,
    country: "GB",
    leagueTags: { leagues: ["premier-league"] },
    category: "tabloid",
    contentMode: "discovery_only",
    trustBaseline: 52,
    termsStatus: "Pending live ToS/robots/feed/extractor review.",
    attributionRule: "Single-source rumours must be explicitly attributed to Express Sport.",
    pollingFrequencyMinutes: 3,
    extractorName: "structured-news-article",
  },
  {
    name: "CaughtOffside",
    baseUrl: "https://www.caughtoffside.com/",
    type: "rss",
    language: "en",
    licenseType: "pending_review",
    reliabilityTier: "C",
    fetchConfig: {
      url: "https://www.caughtoffside.com/feed/",
      priority: "P1",
      relevanceProfile: "transfer_gossip",
      feedEvidence:
        "Direct 2026 fetch reached an application/rss+xml endpoint; current football/transfer RSS directories list CaughtOffside.",
    },
    isActive: false,
    country: "GB",
    leagueTags: { leagues: ["premier-league"] },
    category: "tabloid",
    contentMode: "discovery_only",
    trustBaseline: 45,
    termsStatus: "Pending live ToS/robots/extractor review.",
    attributionRule: "Treat exclusives/rumours as attributed claims until corroborated.",
    pollingFrequencyMinutes: 3,
    extractorName: "structured-news-article",
  },
  {
    name: "Football365",
    baseUrl: "https://www.football365.com/",
    type: "rss",
    language: "en",
    licenseType: "pending_review",
    reliabilityTier: "B",
    fetchConfig: {
      url: "https://www.football365.com/rss",
      priority: "P1",
      relevanceProfile: "uk_football_gossip",
      feedEvidence: "Direct fetch returned HTTP 200 text/xml with dated article items in 2026-08.",
    },
    isActive: false,
    country: "GB",
    leagueTags: { leagues: ["premier-league"] },
    category: "trusted_media",
    contentMode: "discovery_only",
    trustBaseline: 62,
    termsStatus: "Pending live ToS/robots/extractor review.",
    attributionRule:
      "Attribute rumours; distinguish reported facts from Football365 commentary/opinion.",
    pollingFrequencyMinutes: 3,
    extractorName: "structured-news-article",
  },
  {
    name: "The Guardian - Football",
    baseUrl: "https://www.theguardian.com/football",
    type: "rss",
    language: "en",
    licenseType: "pending_review",
    reliabilityTier: "A",
    fetchConfig: {
      url: "https://www.theguardian.com/football/rss",
      priority: "P2",
      relevanceProfile: "uk_football_core",
      feedEvidence: "Guardian officially documents RSS feeds and /rss section feeds.",
    },
    isActive: false,
    country: "GB",
    leagueTags: { leagues: ["premier-league"] },
    category: "trusted_media",
    contentMode: "discovery_only",
    trustBaseline: 88,
    termsStatus:
      "Guardian help states RSS use is for personal, non-commercial purposes; commercial production use requires separate legal/API review.",
    attributionRule:
      "Do not activate for commercial production without rights review; attribution + link required when used as discovery evidence.",
    pollingFrequencyMinutes: 5,
    extractorName: null,
  },
  {
    name: "GOAL - English News",
    baseUrl: "https://www.goal.com/",
    type: "rss",
    language: "en",
    licenseType: "pending_review",
    reliabilityTier: "B",
    fetchConfig: {
      url: "https://www.goal.com/feeds/en/news",
      priority: "P2",
      relevanceProfile: "global_football_filter_pl",
      feedEvidence:
        "Current RSS lists continue to identify the GOAL English news feed; requires live onboarding verification.",
    },
    isActive: false,
    country: "GB",
    leagueTags: { leagues: ["premier-league"] },
    category: "trusted_media",
    contentMode: "discovery_only",
    trustBaseline: 68,
    termsStatus: "Pending live ToS/robots/feed/extractor review.",
    attributionRule:
      "Preserve GOAL attribution and source URL; filter non-Premier-League content before AI.",
    pollingFrequencyMinutes: 5,
    extractorName: "structured-news-article",
  },
] satisfies Array<Parameters<typeof upsertSource>[1]>;

export async function seed(db: Database): Promise<void> {
  await upsertCategory(db, { slug: "labdarugas", nameHu: "Labdarúgás" });

  for (const team of premierLeagueTeamEntities) {
    await upsertEntity(db, { type: "team", ...team });
  }

  // Player entities (2026-07-29 sprint) — the taxonomy previously had ZERO
  // player-type entities seeded, which meant the "same player/coach"
  // specific-entity rule could never actually engage against real
  // production data. Prominent, currently-newsworthy players (several of
  // which already appeared in real BBC/Sky headlines seen during this
  // sprint's proof-report work), not an exhaustive squad-by-squad list.
  const playerEntities: Array<{ nameCanonical: string; nameHu: string; aliases: string[] }> = [
    { nameCanonical: "Mohamed Salah", nameHu: "Mohamed Szalah", aliases: ["Salah"] },
    { nameCanonical: "Erling Haaland", nameHu: "Erling Haaland", aliases: ["Haaland"] },
    { nameCanonical: "Bukayo Saka", nameHu: "Bukayo Saka", aliases: ["Saka"] },
    { nameCanonical: "Kylian Mbappé", nameHu: "Kylian Mbappé", aliases: ["Mbappe", "Mbappé"] },
    { nameCanonical: "Jude Bellingham", nameHu: "Jude Bellingham", aliases: ["Bellingham"] },
    {
      nameCanonical: "Vinicius Junior",
      nameHu: "Vinicius Junior",
      aliases: ["Vinicius Jr", "Vinicius Junior", "Vini Jr"],
    },
    { nameCanonical: "Jack Grealish", nameHu: "Jack Grealish", aliases: ["Grealish"] },
    { nameCanonical: "Danny Welbeck", nameHu: "Danny Welbeck", aliases: ["Welbeck"] },
    { nameCanonical: "Jordan Henderson", nameHu: "Jordan Henderson", aliases: ["Henderson"] },
    { nameCanonical: "Mason Mount", nameHu: "Mason Mount", aliases: ["Mount"] },
    { nameCanonical: "Federico Chiesa", nameHu: "Federico Chiesa", aliases: ["Chiesa"] },
    { nameCanonical: "João Pedro", nameHu: "João Pedro", aliases: ["Joao Pedro"] },
    { nameCanonical: "Rodri", nameHu: "Rodri", aliases: ["Rodri"] },
    { nameCanonical: "Savinho", nameHu: "Savinho", aliases: ["Savinho"] },
  ];
  for (const player of playerEntities) {
    await upsertEntity(db, { type: "player", ...player });
  }

  // Coach entities (2026-07-29 sprint) — new `entity_type` value; previously
  // coach mentions had no home in the taxonomy at all.
  const coachEntities: Array<{ nameCanonical: string; nameHu: string; aliases: string[] }> = [
    { nameCanonical: "Pep Guardiola", nameHu: "Pep Guardiola", aliases: ["Guardiola"] },
    { nameCanonical: "Mikel Arteta", nameHu: "Mikel Arteta", aliases: ["Arteta"] },
    { nameCanonical: "Xabi Alonso", nameHu: "Xabi Alonso", aliases: ["Alonso"] },
    { nameCanonical: "Andoni Iraola", nameHu: "Andoni Iraola", aliases: ["Iraola"] },
    { nameCanonical: "Derek McInnes", nameHu: "Derek McInnes", aliases: ["McInnes"] },
  ];
  for (const coach of coachEntities) {
    await upsertEntity(db, { type: "coach", ...coach });
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

  // Venue entities (2026-07-29 sprint) — generic corroboration only (rule 1:
  // never sufficient alone), but real, seen-in-production stadium names.
  const venueEntities: Array<{ nameCanonical: string; nameHu: string; aliases: string[] }> = [
    { nameCanonical: "Anfield", nameHu: "Anfield", aliases: ["Anfield"] },
    { nameCanonical: "Old Trafford", nameHu: "Old Trafford", aliases: ["Old Trafford"] },
    { nameCanonical: "Emirates Stadium", nameHu: "Emirates Stadium", aliases: ["Emirates"] },
    {
      nameCanonical: "Santiago Bernabéu",
      nameHu: "Santiago Bernabéu",
      aliases: ["Santiago Bernabeu", "Bernabéu"],
    },
    { nameCanonical: "Etihad Stadium", nameHu: "Etihad Stadium", aliases: ["Etihad"] },
  ];
  for (const venue of venueEntities) {
    await upsertEntity(db, { type: "venue", ...venue });
  }

  for (const source of cleanStartSources) {
    await upsertSource(db, source);
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

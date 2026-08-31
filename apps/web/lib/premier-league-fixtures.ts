import { unstable_cache } from "next/cache";
import { z } from "zod";

const API_BASE = "https://v3.football.api-sports.io";
const PREMIER_LEAGUE_ID = 39;
const CACHE_SECONDS = 30 * 60;
const DISPLAY_LIMIT = 5;
const LIVE_STATUSES = new Set(["1H", "HT", "2H", "ET", "BT", "P", "SUSP", "INT", "LIVE"]);

const responseSchema = z.object({
  errors: z.union([z.record(z.unknown()), z.array(z.unknown())]).optional(),
  results: z.number().optional(),
  paging: z.object({ current: z.number(), total: z.number() }).optional(),
  response: z.array(
    z.object({
      fixture: z.object({
        id: z.number(),
        date: z.string(),
        status: z.object({
          long: z.string(),
          short: z.string(),
          elapsed: z.number().nullable(),
        }),
      }),
      teams: z.object({
        home: z.object({ name: z.string() }),
        away: z.object({ name: z.string() }),
      }),
      goals: z.object({
        home: z.number().nullable(),
        away: z.number().nullable(),
      }),
    }),
  ),
});

export interface PremierLeagueMatch {
  id: number;
  kickoffUtc: string;
  homeTeam: string;
  awayTeam: string;
  homeGoals: number | null;
  awayGoals: number | null;
  statusShort: string;
  statusLong: string;
  elapsed: number | null;
  isLive: boolean;
}

export interface PremierLeaguePanel {
  title: string;
  state: "ready" | "missing_key" | "unavailable";
  matches: PremierLeagueMatch[];
  error: string | null;
  diagnostics: {
    leagueId: number;
    season: number | null;
    from: string | null;
    to: string | null;
    results: number | null;
    paging: { current: number; total: number } | null;
    responseLength: number;
  };
}

function localDate(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Budapest",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function seasonFor(date: Date): number {
  const year = Number(localDate(date).slice(0, 4));
  const month = Number(localDate(date).slice(5, 7));
  return month >= 7 ? year : year - 1;
}

export function selectPremierLeagueMatches(payload: unknown, now = new Date()): PremierLeaguePanel {
  const parsed = responseSchema.parse(payload);
  const errors = parsed.errors;
  if (errors && (Array.isArray(errors) ? errors.length > 0 : Object.keys(errors).length > 0)) {
    throw new Error(`API-Football: ${JSON.stringify(errors)}`);
  }
  const today = localDate(now);
  const matches = parsed.response
    .map(({ fixture, teams, goals }) => ({
      id: fixture.id,
      kickoffUtc: fixture.date,
      homeTeam: teams.home.name,
      awayTeam: teams.away.name,
      homeGoals: goals.home,
      awayGoals: goals.away,
      statusShort: fixture.status.short,
      statusLong: fixture.status.long,
      elapsed: fixture.status.elapsed,
      isLive: LIVE_STATUSES.has(fixture.status.short),
    }))
    .sort(
      (a, b) => Number(b.isLive) - Number(a.isLive) || a.kickoffUtc.localeCompare(b.kickoffUtc),
    );
  const todayMatches = matches.filter((match) => localDate(new Date(match.kickoffUtc)) === today);
  const upcoming = matches.filter((match) => new Date(match.kickoffUtc) > now);

  return {
    title: todayMatches.length ? "Mai Premier League-meccsek" : "Következő Premier League-meccsek",
    state: "ready",
    matches: (todayMatches.length ? todayMatches : upcoming).slice(0, DISPLAY_LIMIT),
    error: null,
    diagnostics: {
      leagueId: PREMIER_LEAGUE_ID,
      season: null,
      from: null,
      to: null,
      results: parsed.results ?? null,
      paging: parsed.paging ?? null,
      responseLength: parsed.response.length,
    },
  };
}

const fetchCurrentSeason = unstable_cache(
  async (): Promise<number> => {
    const apiKey = process.env["API_FOOTBALL_KEY"]?.trim();
    if (!apiKey) throw new Error("API_FOOTBALL_KEY missing");
    const response = await fetch(`${API_BASE}/leagues?id=${PREMIER_LEAGUE_ID}`, {
      headers: { "x-apisports-key": apiKey },
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`API-Football leagues HTTP ${response.status}`);
    const payload = z
      .object({
        errors: z.union([z.record(z.unknown()), z.array(z.unknown())]).optional(),
        response: z.array(
          z.object({
            seasons: z.array(z.object({ year: z.number(), current: z.boolean() })),
          }),
        ),
      })
      .parse(await response.json());
    const errors = payload.errors;
    if (errors && (Array.isArray(errors) ? errors.length : Object.keys(errors).length)) {
      throw new Error(`API-Football leagues: ${JSON.stringify(errors)}`);
    }
    const season = payload.response
      .flatMap((league) => league.seasons)
      .find((item) => item.current);
    if (!season) throw new Error("API-Football returned no current Premier League season");
    return season.year;
  },
  ["premier-league-current-season-v1"],
  { revalidate: 24 * 60 * 60 },
);

const fetchFixtures = unstable_cache(
  async (from: string, to: string, season: number): Promise<PremierLeaguePanel> => {
    const apiKey = process.env["API_FOOTBALL_KEY"]?.trim();
    if (!apiKey) {
      return {
        title: "Premier League-meccsek",
        state: "missing_key",
        matches: [],
        error: "API_FOOTBALL_KEY missing",
        diagnostics: {
          leagueId: PREMIER_LEAGUE_ID,
          season,
          from,
          to,
          results: null,
          paging: null,
          responseLength: 0,
        },
      };
    }
    const url = new URL(`${API_BASE}/fixtures`);
    url.search = new URLSearchParams({
      league: String(PREMIER_LEAGUE_ID),
      season: String(season),
      from,
      to,
      timezone: "Europe/Budapest",
    }).toString();
    const response = await fetch(url, {
      headers: { "x-apisports-key": apiKey },
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`API-Football HTTP ${response.status}`);
    const panel = selectPremierLeagueMatches(await response.json());
    return {
      ...panel,
      diagnostics: { ...panel.diagnostics, season, from, to },
    };
  },
  ["premier-league-fixtures-v1"],
  { revalidate: CACHE_SECONDS },
);

export async function getPremierLeaguePanel(now = new Date()): Promise<PremierLeaguePanel> {
  const from = localDate(now);
  const to = addDays(from, 7);
  let season: number | null = null;
  try {
    season = process.env["API_FOOTBALL_KEY"] ? await fetchCurrentSeason() : seasonFor(now);
    return await fetchFixtures(from, to, season);
  } catch (error) {
    return {
      title: "Premier League-meccsek",
      state: "unavailable",
      matches: [],
      error: error instanceof Error ? error.message : String(error),
      diagnostics: {
        leagueId: PREMIER_LEAGUE_ID,
        season,
        from,
        to,
        results: null,
        paging: null,
        responseLength: 0,
      },
    };
  }
}

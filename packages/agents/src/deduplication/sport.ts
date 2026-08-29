/**
 * Cheap, deterministic sport-vertical inference from a source article's own
 * URL — a hard safety gate for Story matching (2026-07-29, "téves Story-
 * összevonás megszüntetése" sprint): two articles from clearly different
 * sports must never merge into one Story, no matter what entities they
 * share. Confirmed real-production case: BBC's "Who am I? Guess Premier
 * League star" quiz merged with 15 unrelated Sky Sports articles (darts,
 * golf, cricket, horse racing, F1, tennis, boxing) purely because every one
 * of them contained the substring "Premier League" somewhere in scraped
 * body text — the URLs alone (`skysports.com/darts/...`,
 * `skysports.com/golf/...`, etc.) would have caught every one of those as a
 * sport mismatch against the football-quiz article.
 *
 * Deliberately conservative: returns `null` (unknown, never blocks a merge
 * on its own) for any URL shape it doesn't recognize, rather than guessing.
 */
export function inferSportFromUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
  const segments = parsed.pathname.toLowerCase().split("/").filter(Boolean);

  if (hostname === "skysports.com") {
    // https://www.skysports.com/{sport}/news/... — the sport vertical is
    // always the first path segment for Sky Sports's article URLs.
    return segments[0] ?? null;
  }

  if (hostname === "bbc.co.uk" || hostname === "bbc.com") {
    // https://www.bbc.co.uk/sport/{sport}/articles/... — but a lot of BBC
    // Sport URLs are generic (e.g. .../sport/articles/... with no distinct
    // sport segment, or cross-sport roundup pages). Only trust it when the
    // segment right after "sport" is present and isn't itself a generic
    // page type like "articles" or "live".
    const sportIndex = segments.indexOf("sport");
    if (sportIndex === -1) {
      return null;
    }
    const candidate = segments[sportIndex + 1];
    const genericPageTypes = new Set(["articles", "live", "video", "av"]);
    if (!candidate || genericPageTypes.has(candidate)) {
      return null;
    }
    return candidate;
  }

  return null;
}

export interface SportSourceHint {
  name: string;
  baseUrl: string;
  fetchConfig: unknown;
  leagueTags: unknown;
}

/**
 * Some trusted feeds are explicitly football-only while their article URLs
 * are generic (notably BBC `/sport/articles/...`). In that case the Source
 * Registry is the authoritative vertical hint. A sport encoded in the URL
 * still takes precedence at the call site, so a clearly non-football URL can
 * never be made safe by a misconfigured source name.
 */
export function inferSportFromSource(source: SportSourceHint | null): string | null {
  if (!source) return null;
  const registryText = [
    source.name,
    source.baseUrl,
    JSON.stringify(source.fetchConfig),
    JSON.stringify(source.leagueTags),
  ]
    .join(" ")
    .toLowerCase();

  if (
    /(^|[^a-z])(football|soccer)([^a-z]|$)/.test(registryText) ||
    registryText.includes("premier-league") ||
    registryText.includes("premier league")
  ) {
    return "football";
  }
  return null;
}

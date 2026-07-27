import Parser from "rss-parser";

export interface FetchedRssItem {
  title: string;
  link: string;
  contentText: string;
  publishedAt: Date | null;
}

function normalizeText(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

/**
 * Real, generic RSS parsing (rss-parser) — works against any RSS 2.0 feed,
 * live internet URL or local fixture alike (docs/architecture/02-agents.md
 * §2.1). `parseFeedXml` is the same parser used against a raw XML string,
 * which is what makes the fixture-based unit tests below exercise the exact
 * same parsing logic `fetchRssFeed` uses at runtime.
 */
export async function fetchRssFeed(url: string): Promise<FetchedRssItem[]> {
  const parser = new Parser();
  const feed = await parser.parseURL(url);
  return mapFeedItems(feed.items ?? []);
}

export async function parseFeedXml(xml: string): Promise<FetchedRssItem[]> {
  const parser = new Parser();
  const feed = await parser.parseString(xml);
  return mapFeedItems(feed.items ?? []);
}

function mapFeedItems(items: Parser.Item[]): FetchedRssItem[] {
  return items
    .map((item) => ({
      title: normalizeText(item.title ?? ""),
      link: item.link ?? item.guid ?? "",
      contentText: normalizeText(item.contentSnippet ?? item.content ?? item.summary ?? ""),
      publishedAt: item.pubDate ? new Date(item.pubDate) : null,
    }))
    .filter((item) => item.link.length > 0 && item.title.length > 0);
}

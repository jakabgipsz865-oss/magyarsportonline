import Parser from "rss-parser";
import { z } from "zod";
import { withRetry } from "../shared/retry";
import { stripHtml } from "../shared/strip-html";
import type { NormalizedArticle, SourceAdapter } from "./types";

const rssFetchConfigSchema = z.object({ url: z.string().url() });

/** A single `<media:thumbnail url="..." .../>` tag as parsed by rss-parser's customFields (xml2js attribute convention: `$`). */
interface MediaThumbnail {
  $?: { url?: string };
}

interface RssFeedItem {
  link?: string;
  title?: string;
  contentSnippet?: string;
  content?: string;
  isoDate?: string;
  pubDate?: string;
  /** Native rss-parser support, no customFields needed. */
  enclosure?: { url?: string };
  /** BBC-style `<media:thumbnail>` — only present when the parser is configured with the matching customField (see `createDefaultParser` below). Feeds with multiple sizes give an array; a single tag gives one object. */
  mediaThumbnail?: MediaThumbnail | MediaThumbnail[];
}

/** The subset of `rss-parser`'s `Parser` this adapter needs — narrow so tests can inject a fake instead of hitting the network. */
export interface RssParserLike {
  parseURL(url: string): Promise<{ items: RssFeedItem[] }>;
}

function createDefaultParser(): RssParserLike {
  return new Parser({ customFields: { item: [["media:thumbnail", "mediaThumbnail"]] } });
}

function extractImageUrl(item: RssFeedItem): string | null {
  if (item.enclosure?.url) {
    return item.enclosure.url;
  }
  const thumbnail = Array.isArray(item.mediaThumbnail)
    ? item.mediaThumbnail[0]
    : item.mediaThumbnail;
  return thumbnail?.$?.url ?? null;
}

/**
 * RSS `SourceAdapter` (docs/architecture/02-agents.md §2.1 step 1-2: fetch +
 * parse/clean). `fetchConfig` (`Source.fetch_config` jsonb, e.g. `{ "url":
 * "https://feeds.bbci.co.uk/sport/football/rss.xml" }`) is validated here,
 * never assumed — the URL lives in DB-seeded Source data
 * (docs/adr/0005-mvp-end-to-end-scope-cuts.md), not in this file.
 */
export class RssSourceAdapter implements SourceAdapter {
  constructor(private readonly parser: RssParserLike = createDefaultParser()) {}

  async fetch(fetchConfig: unknown): Promise<NormalizedArticle[]> {
    const config = rssFetchConfigSchema.parse(fetchConfig);
    // Átmeneti hálózati hibára (feed pillanatnyi elérhetetlensége) rövid
    // exponenciális backoff-fal újrapróbálkozunk, mielőtt a forrás futását
    // hibásnak jelölnénk.
    const feed = await withRetry(() => this.parser.parseURL(config.url));

    return feed.items
      .map((item): NormalizedArticle | null => {
        const sourceUrl = item.link?.trim();
        const titleOriginal = stripHtml(item.title ?? "");
        if (!sourceUrl || !titleOriginal) {
          return null;
        }
        const bodyOriginal = stripHtml(item.contentSnippet ?? item.content ?? "");
        const dateString = item.isoDate ?? item.pubDate;
        const publishedAtSource = dateString ? new Date(dateString) : null;

        return {
          sourceUrl,
          titleOriginal,
          // Az RSS-feed sosem ad alcímet/szerzőt — ezeket (és a rövid
          // `contentSnippet` helyett a teljes törzset) a Source Fetcher réteg
          // tölti ki, ha talál a forráshoz regisztrált extractort (lásd
          // article-enriching-adapter.ts).
          subtitleOriginal: null,
          bodyOriginal,
          authorOriginal: null,
          publishedAtSource:
            publishedAtSource && !Number.isNaN(publishedAtSource.getTime())
              ? publishedAtSource
              : null,
          imageUrl: extractImageUrl(item),
        };
      })
      .filter((article): article is NormalizedArticle => article !== null);
  }
}

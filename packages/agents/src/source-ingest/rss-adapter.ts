import Parser from "rss-parser";
import {
  imageDimension,
  remoteImageUrl,
  selectRemoteImage,
  type RemoteImage,
} from "./remote-image";
import { z } from "zod";
import { withRetry } from "../shared/retry";
import { stripHtml } from "../shared/strip-html";
import type { NormalizedArticle, SourceAdapter } from "./types";

const rssFetchConfigSchema = z.object({ url: z.string().url() });

/** A single `<media:thumbnail url="..." .../>` tag as parsed by rss-parser's customFields (xml2js attribute convention: `$`). */
interface MediaThumbnail {
  $?: { url?: string; width?: string; height?: string; type?: string; medium?: string };
}

interface RssFeedItem {
  link?: string;
  guid?: string;
  "content:encoded"?: string;
  title?: string;
  contentSnippet?: string;
  content?: string;
  isoDate?: string;
  pubDate?: string;
  /** Native rss-parser support, no customFields needed. */
  enclosure?: { url?: string; width?: string; height?: string; type?: string };
  enclosures?: MediaThumbnail[];
  mediaContent?: MediaThumbnail | MediaThumbnail[];
  /** BBC-style `<media:thumbnail>` — only present when the parser is configured with the matching customField (see `createDefaultParser` below). Feeds with multiple sizes give an array; a single tag gives one object. */
  mediaThumbnail?: MediaThumbnail | MediaThumbnail[];
}

/** The subset of `rss-parser`'s `Parser` this adapter needs — narrow so tests can inject a fake instead of hitting the network. */
export interface RssParserLike {
  parseURL(url: string): Promise<{ items: RssFeedItem[] }>;
}

export function createDefaultParser(): RssParserLike {
  return new Parser({
    timeout: 8000,
    customFields: {
      item: [
        ["media:thumbnail", "mediaThumbnail", { keepArray: true }],
        ["media:content", "mediaContent", { keepArray: true }],
        ["enclosure", "enclosures", { keepArray: true }],
      ],
    },
  });
}

function extractImageCandidates(item: RssFeedItem): RemoteImage[] {
  const candidates: RemoteImage[] = [];
  const add = (attributes: MediaThumbnail["$"], source: RemoteImage["source"]) => {
    if (!attributes || !remoteImageUrl(attributes.url)) return;
    if (attributes.type && !attributes.type.startsWith("image/")) return;
    if (attributes.medium && attributes.medium !== "image") return;
    candidates.push({
      url: attributes.url!,
      source,
      width: imageDimension(attributes.width),
      height: imageDimension(attributes.height),
    });
  };
  const many = (value: MediaThumbnail | MediaThumbnail[] | undefined) =>
    Array.isArray(value) ? value : value ? [value] : [];
  for (const image of many(item.mediaContent)) add(image.$, "media:content");
  for (const image of many(item.mediaThumbnail)) add(image.$, "thumbnail");
  for (const image of item.enclosures ?? []) add(image.$, "enclosure");
  add(item.enclosure, "enclosure");
  return candidates;
}

function parsePublishedDate(value: string | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(
    value
      .replace(/\sBST$/, " +0100")
      .replace(/\sCEST$/, " +0200")
      .replace(/\sCET$/, " +0100"),
  );
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * RSS `SourceAdapter` (docs/architecture/02-agents.md §2.1 step 1-2: fetch +
 * parse/clean). `fetchConfig` (`Source.fetch_config` jsonb, e.g. `{ "url":
 * "https://feeds.bbci.co.uk/sport/football/rss.xml" }`) is validated here,
 * never assumed — the URL lives in DB-seeded Source data
 * (docs/adr/0005-mvp-end-to-end-scope-cuts.md), not in this file.
 */
export class RssSourceAdapter implements SourceAdapter {
  constructor(
    private readonly parser: RssParserLike = createDefaultParser(),
    private readonly retry = true,
  ) {}

  async fetch(fetchConfig: unknown): Promise<NormalizedArticle[]> {
    const config = rssFetchConfigSchema.parse(fetchConfig);
    // Átmeneti hálózati hibára (feed pillanatnyi elérhetetlensége) rövid
    // exponenciális backoff-fal újrapróbálkozunk, mielőtt a forrás futását
    // hibásnak jelölnénk.
    const feed = this.retry
      ? await withRetry(() => this.parser.parseURL(config.url))
      : await this.parser.parseURL(config.url);

    return feed.items
      .map((item): NormalizedArticle | null => {
        const sourceUrl = item.link?.trim();
        const titleOriginal = stripHtml(item.title ?? "");
        if (!sourceUrl || !/^https?:\/\//i.test(sourceUrl) || !titleOriginal) {
          return null;
        }
        const bodyOriginal = stripHtml(
          item["content:encoded"] ?? item.content ?? item.contentSnippet ?? "",
        );
        const publishedAtSource = parsePublishedDate(item.isoDate ?? item.pubDate);

        const imageCandidates = extractImageCandidates(item);
        const image = selectRemoteImage(imageCandidates);
        return {
          sourceUrl,
          ...(item.guid ? { guid: item.guid } : {}),
          titleOriginal,
          // Az RSS-feed sosem ad alcímet/szerzőt — ezeket (és a rövid
          // `contentSnippet` helyett a teljes törzset) a Source Fetcher réteg
          // tölti ki, ha talál a forráshoz regisztrált extractort (lásd
          // article-enriching-adapter.ts).
          subtitleOriginal: null,
          bodyOriginal,
          authorOriginal: null,
          publishedAtSource,
          imageUrl: image?.url ?? null,
          ...(imageCandidates.length ? { imageCandidates } : {}),
          ...(image ? { image } : {}),
          contentOrigin: "rss_snippet",
        };
      })
      .filter((article): article is NormalizedArticle => article !== null);
  }
}

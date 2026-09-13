import Parser from "rss-parser";
import { load } from "cheerio";
import { sourceImageIdentityKey, type SourceInlineImage } from "@magyarsportonline/shared";
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

function extractImage(item: RssFeedItem): RemoteImage | null {
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
  return selectRemoteImage(candidates);
}

function largestSrcsetUrl(value: string | undefined): string | null {
  if (!value) return null;
  return (
    value
      // Preserve commas inside image URLs; srcset candidate separators carry
      // following whitespace on the publisher feeds we accept.
      .split(/,\s+(?=\S)/)
      .map((item) => {
        const [url, descriptor = ""] = item.trim().split(/\s+/, 2);
        const width = Number(descriptor.replace(/w$/, ""));
        return { url, width: Number.isFinite(width) ? width : 0 };
      })
      .filter((item): item is { url: string; width: number } => Boolean(item.url))
      .sort((a, b) => b.width - a.width)[0]?.url ?? null
  );
}

/** Keep source-body images as remote embeds; never download or rewrite the file URL. */
export function extractInlineImages(html: string, articleUrl?: string): SourceInlineImage[] {
  if (!html.includes("<img")) return [];
  const $ = load(html);
  const images: SourceInlineImage[] = [];
  const seen = new Set<string>();
  $("img").each((_, element) => {
    if (images.length >= 8) return;
    const image = $(element);
    const candidate =
      largestSrcsetUrl(image.attr("srcset") ?? image.attr("data-srcset")) ??
      image.attr("src") ??
      image.attr("data-src");
    if (!candidate) return;
    let resolved = candidate;
    try {
      if (!/^https?:\/\//i.test(candidate)) {
        if (!articleUrl) return;
        resolved = new URL(candidate, articleUrl).href;
      }
    } catch {
      return;
    }
    const url = remoteImageUrl(resolved);
    const identity = url ? sourceImageIdentityKey(url) : null;
    if (!url || !identity || seen.has(identity)) return;
    const width = imageDimension(image.attr("width"));
    const height = imageDimension(image.attr("height"));
    if ((width !== null && width < 300) || (height !== null && height < 180)) return;
    const figure = image.closest("figure");
    const clean = (value: string | undefined): string | null => {
      const text = stripHtml(value ?? "").trim();
      return text.length > 0 ? text : null;
    };
    const caption = clean(figure.find("figcaption").first().text());
    const credit = clean(
      image.attr("data-credit") ?? figure.find(".credit, .photo-credit, .copyright").first().text(),
    );
    seen.add(identity);
    images.push({
      url,
      alt: clean(image.attr("alt")),
      caption,
      credit,
      width,
      height,
    });
  });
  return images;
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
        const sourceBody = item["content:encoded"] ?? item.content ?? item.contentSnippet ?? "";
        const bodyOriginal = stripHtml(sourceBody);
        const publishedAtSource = parsePublishedDate(item.isoDate ?? item.pubDate);

        const image = extractImage(item);
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
          ...(image ? { image } : {}),
          inlineImages: extractInlineImages(sourceBody, sourceUrl),
          contentOrigin: "rss_snippet",
        };
      })
      .filter((article): article is NormalizedArticle => article !== null);
  }
}

import * as cheerio from "cheerio";
import { textOrNull } from "../html-cleaning";
import type { ArticleExtractor, FetchedArticle } from "../types";

export const STRUCTURED_NEWS_DOMAINS = [
  "talksport.com",
  "dailymail.co.uk",
  "dailymail.com",
  "mirror.co.uk",
  "thesun.co.uk",
  "dailystar.co.uk",
  "express.co.uk",
  "caughtoffside.com",
  "football365.com",
  "goal.com",
] as const;

type JsonObject = Record<string, unknown>;

function supportsDomain(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return STRUCTURED_NEWS_DOMAINS.some(
      (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
    );
  } catch {
    return false;
  }
}

function articleType(value: unknown): boolean {
  const types = Array.isArray(value) ? value : [value];
  return types.some((type) => {
    const name = typeof type === "string" ? type.split(/[/#]/).at(-1) : null;
    return name === "NewsArticle" || name === "Article";
  });
}

function collectArticles(value: unknown, output: JsonObject[]): void {
  if (Array.isArray(value)) {
    value.forEach((item) => collectArticles(item, output));
    return;
  }
  if (!value || typeof value !== "object") return;
  const object = value as JsonObject;
  if (articleType(object["@type"])) output.push(object);
  if (Array.isArray(object["@graph"])) collectArticles(object["@graph"], output);
}

function cleanText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return textOrNull(cheerio.load(value).text());
}

function authorText(value: unknown): string | null {
  const authors = Array.isArray(value) ? value : [value];
  const names = authors
    .map((author) =>
      typeof author === "string"
        ? cleanText(author)
        : author && typeof author === "object"
          ? cleanText((author as JsonObject)["name"])
          : null,
    )
    .filter((name): name is string => Boolean(name));
  return names.length > 0 ? names.join(", ") : null;
}

function toFetchedArticle(candidate: JsonObject): FetchedArticle | null {
  const titleOriginal = cleanText(candidate["headline"]);
  const bodyOriginal = cleanText(candidate["articleBody"]);
  if (
    !titleOriginal ||
    titleOriginal.length < 10 ||
    !bodyOriginal ||
    bodyOriginal.length < 300 ||
    bodyOriginal.split(/\s+/).length < 40
  ) {
    return null;
  }
  const rawDate = candidate["datePublished"];
  const parsedDate = typeof rawDate === "string" ? new Date(rawDate) : null;
  return {
    titleOriginal,
    subtitleOriginal: null,
    bodyOriginal,
    authorOriginal: authorText(candidate["author"]),
    publishedAtSource: parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate : null,
  };
}

function semanticArticle(html: string): FetchedArticle | null {
  const $ = cheerio.load(html);
  $("script,style,noscript,nav,header,footer,aside,form,svg").remove();
  const roots = $("article, main").toArray();
  const bodies = roots.map((root) => {
    const paragraphs: string[] = [];
    const seen = new Set<string>();
    $(root)
      .find("p")
      .each((_, element) => {
        const text = textOrNull($(element).text());
        if (!text || text.length < 40 || seen.has(text)) return;
        seen.add(text);
        paragraphs.push(text);
      });
    return { root: $(root), body: paragraphs.join("\n\n") };
  });
  const selected = bodies.sort((a, b) => b.body.length - a.body.length)[0];
  if (!selected) return null;
  const bodyOriginal = selected.body;
  const titleOriginal =
    textOrNull(selected.root.find("h1").first().text()) ??
    textOrNull($("h1").first().text()) ??
    textOrNull($('meta[property="og:title"]').attr("content"));
  if (!titleOriginal || titleOriginal.length < 10 || bodyOriginal.length < 300) return null;
  const rawDate =
    $('meta[property="article:published_time"]').attr("content") ??
    $("time[datetime]").first().attr("datetime");
  const parsedDate = rawDate ? new Date(rawDate) : null;
  return {
    titleOriginal,
    subtitleOriginal: null,
    bodyOriginal,
    authorOriginal: textOrNull($('meta[name="author"]').attr("content")),
    publishedAtSource: parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate : null,
  };
}

export const structuredNewsArticleExtractor: ArticleExtractor = {
  name: "structured-news-article",
  supports: supportsDomain,
  extract(html, url) {
    if (!supportsDomain(url)) return null;
    try {
      const $ = cheerio.load(html);
      const candidates: JsonObject[] = [];
      $('script[type="application/ld+json"]').each((_, element) => {
        try {
          collectArticles(JSON.parse($(element).text()) as unknown, candidates);
        } catch {
          // Egy hibás JSON-LD blokk nem teszi használhatatlanná a többit.
        }
      });
      return (
        candidates
          .map(toFetchedArticle)
          .filter((article): article is FetchedArticle => article !== null)
          .sort((left, right) => right.bodyOriginal.length - left.bodyOriginal.length)[0] ??
        semanticArticle(html)
      );
    } catch {
      return null;
    }
  },
};

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
  "sportbible.com",
  "metro.co.uk",
  "okdiario.com",
  "mundodeportivo.com",
  "golssip.it",
  "sport.virgilio.it",
  "tuttosport.com",
  "gazzetta.it",
  "corrieredellosport.it",
  "bild.de",
  "sportbild.bild.de",
  "krone.at",
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

function semanticArticle(html: string, url: string, headlineHint: string | null): FetchedArticle | null {
  const $ = cheerio.load(html);
  const titleOriginal = headlineHint ??
    textOrNull($("h1").first().text()) ??
    textOrNull($('meta[property="og:title"]').attr("content"));
  $("script,style,noscript,nav,footer,aside,form,svg,.related,[class*=recommend],[class*=comment]").remove();
  const paragraphs = (elements: ReturnType<typeof $>) => {
    const seen = new Set<string>();
    const parts: string[] = [];
    elements.each((_, element) => {
      const text = textOrNull($(element).text());
      if (!text || text.length < 40 || seen.has(text)) return;
      seen.add(text);
      parts.push(text);
    });
    return parts.join("\n\n");
  };
  const hostname = new URL(url).hostname.toLowerCase();
  let bodyOriginal: string;
  if (hostname === "dailymail.com" || hostname.endsWith(".dailymail.com") || hostname === "dailymail.co.uk" || hostname.endsWith(".dailymail.co.uk")) {
    const root = $('[itemprop="articleBody"]').first();
    bodyOriginal = paragraphs(root.find("p"));
  } else if (hostname === "krone.at" || hostname.endsWith(".krone.at")) {
    bodyOriginal = paragraphs($(".box.c_tinymce_lead p, .box.c_tinymce p"));
  } else {
    const roots = $("article").length ? $("article").toArray() : $("main").toArray();
    const titleKey = (titleOriginal ?? "").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    const candidates = roots.map((root) => {
      const node = $(root);
      const heading = (textOrNull(node.find("h1").first().text()) ?? "")
        .toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
      const body = paragraphs(node.find("p"));
      const score = (heading && (heading === titleKey || titleKey.includes(heading) || heading.includes(titleKey)) ? 100 : 0)
        + (heading ? 20 : 0) + (node.is("article") ? 10 : 0);
      return { body, score };
    }).filter((candidate) => candidate.body.length >= 300);
    bodyOriginal = candidates.sort((a, b) => b.score - a.score)[0]?.body ?? "";
  }
  if (!titleOriginal || titleOriginal.length < 10 || bodyOriginal.length < 300 || bodyOriginal.split(/\s+/).length < 40) return null;
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
      const headlineHint = candidates.map((candidate) => cleanText(candidate["headline"]))
        .find((headline): headline is string => Boolean(headline && headline.length >= 10)) ?? null;
      const semantic = semanticArticle(html, url, headlineHint);
      if (semantic) return semantic;
      return candidates.map(toFetchedArticle)
        .find((article): article is FetchedArticle => article !== null) ?? null;
    } catch {
      return null;
    }
  },
};

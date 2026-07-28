import * as cheerio from "cheerio";
import type { ArticleExtractor } from "../types";
import { joinParagraphs, textOrNull } from "../html-cleaning";

const BBC_DOMAINS = ["bbc.co.uk", "bbc.com"];

/**
 * BBC (News/Sport) jelenlegi ("Simorgh") SSR-sablonjának ismert
 * szelektorai — több jelölt mezőnként, hogy egy kisebb markup-változás ne
 * törje el azonnal a kinyerést. FONTOS, ŐSZINTE MEGJEGYZÉS: ez a sandbox
 * nem ér el kifelé élő internetet (a `bbc.co.uk` közvetlen letöltése innen
 * 403-at ad a proxyn), ezért ezeket a szelektorokat NEM lehetett élő BBC
 * HTML ellen leellenőrizni menet közben — a tudásom szerinti, jelenlegi
 * BBC-sablonra épülnek. A valódi bizonyítás egy külön, internet-eléréssel
 * futó GitHub Actions workflow-ban történik (lásd
 * .github/workflows/bbc-extractor-diagnostic.yml), ami egy VALÓS, aktuális
 * BBC Sport cikken futtatja ezt a kódot. Ha a szelektorok elavultak, az
 * `extract` biztonságosan `null`-t ad vissza (lásd lent), ami a pipeline-t
 * sosem állítja le — csak az RSS-snippet fallback aktiválódik.
 */
const TITLE_SELECTORS = ["h1#main-heading", "article h1", "main h1", "h1"];
const BODY_PARAGRAPH_SELECTORS = ['[data-component="text-block"] p', "article p"];
const SUBTITLE_SELECTORS = ['[data-component="subheadline-block"]', "article p.subheadline"];
const AUTHOR_SELECTORS = [
  '[data-component="byline-block"] span',
  '[data-component="byline-block"]',
];
const TIME_SELECTOR = "time[datetime]";

function firstNonEmptyMatch($: cheerio.CheerioAPI, selectors: string[]) {
  for (const selector of selectors) {
    const found = $(selector).first();
    if (found.length > 0 && textOrNull(found.text())) {
      return found;
    }
  }
  return null;
}

/**
 * Referencia-implementáció (2026-07-28-i "Source Fetcher" sprint) — az
 * ELSŐ, ténylegesen bekötött forrás-extractor. A cikktörzset kizárólag a
 * `[data-component="text-block"]` blokkok `<p>` elemeiből építi fel — ez
 * eleve kizárja a képeket (`data-component="image-block"`), a kapcsolódó
 * tartalmat és a reklámblokkokat, mert azokat sosem választjuk ki
 * (allow-list, nem blacklist-alapú tisztítás).
 */
export const bbcSportExtractor: ArticleExtractor = {
  name: "bbc-sport",

  supports(url) {
    try {
      const hostname = new URL(url).hostname.toLowerCase();
      return BBC_DOMAINS.some((domain) => hostname === domain || hostname === `www.${domain}`);
    } catch {
      return false;
    }
  },

  extract(html) {
    const $ = cheerio.load(html);

    const titleEl = firstNonEmptyMatch($, TITLE_SELECTORS);
    const titleOriginal = textOrNull(titleEl?.text());
    if (!titleOriginal) {
      return null;
    }

    const paragraphs: string[] = [];
    for (const selector of BODY_PARAGRAPH_SELECTORS) {
      const found = $(selector);
      if (found.length > 0) {
        found.each((_, el) => {
          const text = $(el).text();
          if (text.trim().length > 0) {
            paragraphs.push(text);
          }
        });
        break; // csak az első ténylegesen találatot adó szelektort használjuk
      }
    }
    const bodyOriginal = joinParagraphs(paragraphs);
    if (bodyOriginal.length === 0) {
      return null;
    }

    const subtitleEl = firstNonEmptyMatch($, SUBTITLE_SELECTORS);
    const authorEl = firstNonEmptyMatch($, AUTHOR_SELECTORS);
    const datetimeAttr = $(TIME_SELECTOR).first().attr("datetime");
    const publishedAtSource = datetimeAttr ? new Date(datetimeAttr) : null;

    return {
      titleOriginal,
      subtitleOriginal: textOrNull(subtitleEl?.text()),
      bodyOriginal,
      authorOriginal: textOrNull(authorEl?.text()),
      publishedAtSource:
        publishedAtSource && !Number.isNaN(publishedAtSource.getTime()) ? publishedAtSource : null,
    };
  },
};

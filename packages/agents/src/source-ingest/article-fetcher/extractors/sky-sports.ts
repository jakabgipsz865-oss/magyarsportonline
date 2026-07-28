import * as cheerio from "cheerio";
import type { ArticleExtractor } from "../types";
import { joinParagraphs, textOrNull } from "../html-cleaning";

const SKY_SPORTS_DOMAINS = ["skysports.com"];

/**
 * Sky Sports jelenlegi SSR-sablonjának ismert szelektorai — több jelölt
 * mezőnként, ugyanaz a védekező minta, mint a `bbc-sport.ts`-ben. ŐSZINTE
 * MEGJEGYZÉS: ez a sandbox nem ér el kifelé élő internetet, ezért ezeket a
 * szelektorokat NEM lehetett élő Sky Sports HTML ellen leellenőrizni menet
 * közben. A valódi bizonyítás egy külön, internet-eléréssel futó GitHub
 * Actions workflow-ban történik (lásd
 * .github/workflows/sky-sports-extractor-diagnostic.yml). Ha a szelektorok
 * elavultak, az `extract` biztonságosan `null`-t ad vissza, ami a
 * pipeline-t sosem állítja le — csak az RSS-snippet fallback aktiválódik.
 */
const TITLE_SELECTORS = ["h1.sdc-article-header__title", "article h1", "main h1", "h1"];
const BODY_PARAGRAPH_SELECTORS = [
  '[data-testid="article-body"] p',
  ".sdc-article-body p",
  "article p",
];
const SUBTITLE_SELECTORS = [
  "p.sdc-article-header__standfirst",
  '[data-testid="article-standfirst"]',
];
const AUTHOR_SELECTORS = [
  ".sdc-article-header__author-name",
  '[data-testid="article-author"]',
  ".sdc-article-byline__author",
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
 * Sky Sports extractor (2026-07-28-i "Hitelességi mutató" sprint kivétele —
 * a felhasználó explicit engedélyezte a BBC+Sky Sports páros bekötését,
 * hogy legyen valódi, két különböző hírportálról származó, ellenőrizhető
 * két-forrásos Story). A cikktörzset kizárólag a cikktest konténer(ek) `<p>`
 * elemeiből építi fel — ugyanaz az allow-list, nem blacklist-alapú
 * megközelítés, mint a BBC extractornál.
 */
export const skySportsExtractor: ArticleExtractor = {
  name: "sky-sports",

  supports(url) {
    try {
      const hostname = new URL(url).hostname.toLowerCase();
      return SKY_SPORTS_DOMAINS.some(
        (domain) => hostname === domain || hostname === `www.${domain}`,
      );
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

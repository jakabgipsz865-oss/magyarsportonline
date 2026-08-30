/**
 * "Source Fetcher" réteg (2026-07-28-i sprint) — az RSS csak egy rövid
 * összefoglalót ad (`contentSnippet`), ami a Fact Verification Agent
 * számára gyakran nem elég részletes anyag. Ez a réteg letölti magát a
 * cikkoldalt, és egy, a KONKRÉT forráshoz (nem általános web scraperként!)
 * igazított extractorral kinyeri a teljes, tisztított törzset.
 */

export interface FetchedArticle {
  titleOriginal: string;
  /** Alcím/standfirst, ha a forrás megadja — sok sportoldal nem közöl ilyet. */
  subtitleOriginal: string | null;
  /** Teljes, tisztított cikktörzs — bekezdésekre tagolva, képek/reklámok/kapcsolódó-tartalom blokkok nélkül. */
  bodyOriginal: string;
  /** Szerző neve, ha a forrás megadja — pl. a BBC Sport legtöbb híre névtelen. */
  authorOriginal: string | null;
  publishedAtSource: Date | null;
  /** A ténylegesen kinyert szöveges oldal URL-je, ha eltér az RSS-linktől. */
  resolvedUrl?: string;
}

/**
 * Egy konkrét forráshoz (pl. BBC Sport) igazított kinyerő. Minden
 * extractor a saját, ismert HTML-szerkezetéhez van kötve — ez SZÁNDÉKOSAN
 * nem egy általános readability-algoritmus, mert egy site-specifikus
 * extractor sokkal megbízhatóbban tudja megkülönböztetni a cikktörzset a
 * navigációtól/reklámoktól/kapcsolódó tartalomtól, mint egy heurisztika.
 */
export interface ArticleExtractor {
  /** Rövid, egyedi azonosító naplózáshoz (pl. "bbc-sport"). */
  readonly name: string;
  /** Igaz, ha ez az extractor tudja kezelni a megadott cikk-URL domainjét. */
  supports(url: string): boolean;
  /** Egy ismert oldaltípusból egyértelműen kapcsolt, azonos forrású szöveges URL. */
  resolveUrl?(html: string, url: string): string | null;
  /**
   * A letöltött nyers HTML-ből próbál kinyerni egy FetchedArticle-t.
   * `null`-t ad vissza (SOSEM dob hibát), ha a várt szerkezet nem
   * található (pl. a site megváltoztatta a sablonját) — ez a hívó számára
   * ugyanaz a jel, mint egy hálózati hiba: essen vissza az RSS snippetre.
   */
  extract(html: string, url: string): FetchedArticle | null;
}

/** Tesztelhetőség kedvéért absztrahált HTTP-letöltés — a valódi implementáció natív `fetch`-et használ (lásd article-fetcher.ts `HttpHtmlFetcher`). */
export interface HtmlFetcher {
  fetch(url: string): Promise<string>;
}

/**
 * Egyszeri diagnosztikai script (2026-07-28-i "Source Fetcher" sprint) —
 * ELLENŐRZI, hogy a bbcSportExtractor VALÓBAN működik egy ÉLŐ, aktuális BBC
 * Sport cikken. Ez a sandbox, amiben ez a kód íródott, nem ér el kifelé
 * élő internetet (a bbc.co.uk közvetlen letöltése innen 403-at ad a
 * proxyn) — ezt a scriptet ezért a GitHub Actions futtatja
 * (.github/workflows/bbc-extractor-diagnostic.yml), aminek van valódi
 * internet-hozzáférése. Sosem ír adatbázisba.
 *
 * Menet: 1) lekéri a valódi BBC Sport football RSS feedet, 2) veszi az
 * első item linkjét, 3) ténylegesen letölti azt az oldalt, 4) lefuttatja
 * rajta a bbcSportExtractor-t, 5) kiírja az eredményt (vagy a null-t, ha a
 * szerkezet nem egyezett).
 */
import { RssSourceAdapter } from "./../rss-adapter";
import { HttpHtmlFetcher } from "./article-fetcher";
import { bbcSportExtractor } from "./extractors/bbc-sport";

const BBC_FOOTBALL_RSS_URL = "https://feeds.bbci.co.uk/sport/football/rss.xml";

function print(line: string): void {
  process.stdout.write(`${line}\n`);
}

async function main(): Promise<void> {
  const rssAdapter = new RssSourceAdapter();
  const articles = await rssAdapter.fetch({ url: BBC_FOOTBALL_RSS_URL });
  if (articles.length === 0) {
    console.error("FAIL: the BBC football RSS feed returned no items.");
    process.exitCode = 1;
    return;
  }

  const [first] = articles;
  const target = first!;
  print(`RSS item: "${target.titleOriginal}"`);
  print(`URL: ${target.sourceUrl}`);
  print(`RSS snippet length: ${target.bodyOriginal.length} chars`);

  if (!bbcSportExtractor.supports(target.sourceUrl)) {
    console.error(`FAIL: bbcSportExtractor.supports() returned false for ${target.sourceUrl}`);
    process.exitCode = 1;
    return;
  }

  const htmlFetcher = new HttpHtmlFetcher();
  const html = await htmlFetcher.fetch(target.sourceUrl);
  print(`Downloaded HTML length: ${html.length} chars`);

  const extracted = bbcSportExtractor.extract(html, target.sourceUrl);
  if (!extracted) {
    console.error(
      "FAIL: bbcSportExtractor.extract() returned null — the site's markup no longer matches the known selectors. This is a SAFE failure (the real pipeline would fall back to the RSS snippet), but the extractor needs updating.",
    );
    process.exitCode = 1;
    return;
  }

  print("PASS: full article extracted successfully.");
  print(`  title: ${extracted.titleOriginal}`);
  print(`  subtitle: ${extracted.subtitleOriginal ?? "(none)"}`);
  print(`  author: ${extracted.authorOriginal ?? "(none)"}`);
  print(`  publishedAt: ${extracted.publishedAtSource?.toISOString() ?? "(none)"}`);
  print(
    `  body length: ${extracted.bodyOriginal.length} chars (RSS snippet was ${target.bodyOriginal.length} chars)`,
  );
  print(`  body preview: ${extracted.bodyOriginal.slice(0, 500)}...`);

  if (extracted.bodyOriginal.length <= target.bodyOriginal.length) {
    console.warn(
      "WARNING: the extracted full-article body is not longer than the RSS snippet — this defeats the purpose of the Source Fetcher layer, investigate the selectors.",
    );
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("FAIL: unexpected error:", error);
  process.exitCode = 1;
});

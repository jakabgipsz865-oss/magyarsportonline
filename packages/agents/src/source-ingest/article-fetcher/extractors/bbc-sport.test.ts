import { describe, expect, it } from "vitest";
import { bbcSportExtractor } from "./bbc-sport";

/**
 * Ez a fixture a BBC jelenlegi (2026-07-28-i sprint idején ismert)
 * "Simorgh" sablonjának szerkezetét modellezi — de mivel ez a sandbox nem
 * ér el kifelé élő internetet, ez NEM helyettesíti a valós BBC HTML elleni
 * ellenőrzést. Ez a teszt csak azt bizonyítja, hogy az extractor LOGIKÁJA
 * (a megadott szelektorokkal) helyesen működik — a valós BBC-kompatibilitás
 * bizonyítéka a .github/workflows/bbc-extractor-diagnostic.yml, ami egy
 * ÉLŐ, aktuális BBC Sport cikken fut, valódi internet-hozzáféréssel.
 */
const SAMPLE_HTML = `
<html>
  <body>
    <main>
      <article>
        <h1 id="main-heading">Liverpool win dramatic derby against Everton</h1>
        <div data-component="byline-block"><span>By Alex Reporter</span></div>
        <time datetime="2026-07-28T18:30:00.000Z">28 July 2026</time>
        <div data-component="text-block"><p>Liverpool came from behind to beat Everton 3-2 at Anfield.</p></div>
        <div data-component="image-block"><img src="photo.jpg" alt="Match action" /></div>
        <div data-component="text-block"><p>The result keeps them top of the table heading into the international break.</p></div>
        <div data-component="links-block"><a href="/related">Related story</a></div>
      </article>
    </main>
  </body>
</html>
`;

describe("bbcSportExtractor.supports", () => {
  it("matches bbc.co.uk and www.bbc.co.uk URLs", () => {
    expect(bbcSportExtractor.supports("https://www.bbc.co.uk/sport/football/articles/abc123")).toBe(
      true,
    );
    expect(bbcSportExtractor.supports("https://bbc.co.uk/sport/football/articles/abc123")).toBe(
      true,
    );
  });

  it("matches bbc.com URLs", () => {
    expect(bbcSportExtractor.supports("https://www.bbc.com/sport/football/articles/abc123")).toBe(
      true,
    );
  });

  it("does not match unrelated domains", () => {
    expect(bbcSportExtractor.supports("https://www.skysports.com/football/news/1")).toBe(false);
  });

  it("returns false for an invalid URL instead of throwing", () => {
    expect(bbcSportExtractor.supports("not a url")).toBe(false);
  });
});

describe("bbcSportExtractor.extract", () => {
  it("extracts title, author, published date, and the full body from text-block paragraphs only", () => {
    const result = bbcSportExtractor.extract(SAMPLE_HTML, "https://www.bbc.co.uk/sport/football/1");

    expect(result).not.toBeNull();
    expect(result?.titleOriginal).toBe("Liverpool win dramatic derby against Everton");
    expect(result?.authorOriginal).toBe("By Alex Reporter");
    expect(result?.publishedAtSource).toEqual(new Date("2026-07-28T18:30:00.000Z"));
    expect(result?.bodyOriginal).toBe(
      "Liverpool came from behind to beat Everton 3-2 at Anfield.\n\nThe result keeps them top of the table heading into the international break.",
    );
  });

  it("excludes image captions and related-content links from the body", () => {
    const result = bbcSportExtractor.extract(SAMPLE_HTML, "https://www.bbc.co.uk/sport/football/1");
    expect(result?.bodyOriginal).not.toContain("Match action");
    expect(result?.bodyOriginal).not.toContain("Related story");
  });

  it("returns null when no title can be found (unexpected/changed markup)", () => {
    const result = bbcSportExtractor.extract(
      "<html><body><p>no heading here</p></body></html>",
      "https://www.bbc.co.uk/x",
    );
    expect(result).toBeNull();
  });

  it("returns null when no body paragraphs are found (unexpected/changed markup)", () => {
    const html = `<article><h1 id="main-heading">Title only</h1></article>`;
    const result = bbcSportExtractor.extract(html, "https://www.bbc.co.uk/x");
    expect(result).toBeNull();
  });

  it("returns null author/subtitle/publishedAt when those elements are absent, without failing the whole extraction", () => {
    const html = `
      <article>
        <h1 id="main-heading">Minimal article</h1>
        <div data-component="text-block"><p>Just one paragraph, no byline or date.</p></div>
      </article>
    `;
    const result = bbcSportExtractor.extract(html, "https://www.bbc.co.uk/x");
    expect(result).not.toBeNull();
    expect(result?.authorOriginal).toBeNull();
    expect(result?.subtitleOriginal).toBeNull();
    expect(result?.publishedAtSource).toBeNull();
    expect(result?.bodyOriginal).toBe("Just one paragraph, no byline or date.");
  });
});

describe("bbcSportExtractor.resolveUrl", () => {
  it("resolves a BBC video item to its single related match report", () => {
    const videoUrl = "https://www.bbc.com/sport/football/videos/cx2zvzpdyjdo?at_medium=RSS";
    const reportUrl = "https://www.bbc.com/sport/football/live/cmq8jxqj2vpet";
    const html = `
      <nav><a href="/sport/football/articles/ce8e6y90g2jo">Follow Your Team</a></nav>
      <main><a href="/sport/football/live/cmq8jxqj2vpet">MATCH REPORT: Leeds United 1-1 Brentford</a></main>
    `;

    expect(bbcSportExtractor.resolveUrl?.(html, videoUrl)).toBe(reportUrl);
  });

  it("does not resolve non-video pages or ambiguous report links", () => {
    const ambiguous = `
      <a href="/sport/football/live/first">First report</a>
      <a href="/sport/football/live/second">Second report</a>
    `;
    expect(
      bbcSportExtractor.resolveUrl?.(
        ambiguous,
        "https://www.bbc.com/sport/football/videos/cx2zvzpdyjdo",
      ),
    ).toBeNull();
    expect(
      bbcSportExtractor.resolveUrl?.(
        '<a href="/sport/football/live/only">Report</a>',
        "https://www.bbc.com/sport/football/articles/current",
      ),
    ).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { skySportsExtractor } from "./sky-sports";

/**
 * Ez a fixture a Sky Sports jelenlegi (2026-07-28-i sprint idején ismert)
 * sablonjának szerkezetét modellezi — de mivel ez a sandbox nem ér el
 * kifelé élő internetet, ez NEM helyettesíti a valós Sky Sports HTML elleni
 * ellenőrzést. Ez a teszt csak azt bizonyítja, hogy az extractor LOGIKÁJA
 * (a megadott szelektorokkal) helyesen működik — a valós Sky Sports-
 * kompatibilitás bizonyítéka a
 * .github/workflows/sky-sports-extractor-diagnostic.yml, ami egy ÉLŐ,
 * aktuális Sky Sports cikken fut, valódi internet-hozzáféréssel.
 */
const SAMPLE_HTML = `
<html>
  <body>
    <main>
      <article>
        <h1 class="sdc-article-header__title">Liverpool win dramatic derby against Everton</h1>
        <p class="sdc-article-header__standfirst">Reds go top after late winner at Anfield</p>
        <div class="sdc-article-byline"><span class="sdc-article-header__author-name">Alex Reporter</span></div>
        <time datetime="2026-07-28T18:30:00.000Z">28 July 2026</time>
        <div data-testid="article-body">
          <p>Liverpool came from behind to beat Everton 3-2 at Anfield.</p>
          <p>The result keeps them top of the table heading into the international break.</p>
        </div>
        <div class="sdc-article-related"><a href="/related">Related story</a></div>
      </article>
    </main>
  </body>
</html>
`;

describe("skySportsExtractor.supports", () => {
  it("matches skysports.com and www.skysports.com URLs", () => {
    expect(skySportsExtractor.supports("https://www.skysports.com/football/news/1")).toBe(true);
    expect(skySportsExtractor.supports("https://skysports.com/football/news/1")).toBe(true);
  });

  it("does not match unrelated domains", () => {
    expect(skySportsExtractor.supports("https://www.bbc.co.uk/sport/football")).toBe(false);
  });

  it("returns false for an invalid URL instead of throwing", () => {
    expect(skySportsExtractor.supports("not a url")).toBe(false);
  });
});

describe("skySportsExtractor.extract", () => {
  it("extracts title, subtitle, author, published date, and the full body", () => {
    const result = skySportsExtractor.extract(
      SAMPLE_HTML,
      "https://www.skysports.com/football/news/1",
    );

    expect(result).not.toBeNull();
    expect(result?.titleOriginal).toBe("Liverpool win dramatic derby against Everton");
    expect(result?.subtitleOriginal).toBe("Reds go top after late winner at Anfield");
    expect(result?.authorOriginal).toBe("Alex Reporter");
    expect(result?.publishedAtSource).toEqual(new Date("2026-07-28T18:30:00.000Z"));
    expect(result?.bodyOriginal).toBe(
      "Liverpool came from behind to beat Everton 3-2 at Anfield.\n\nThe result keeps them top of the table heading into the international break.",
    );
  });

  it("excludes related-content links from the body", () => {
    const result = skySportsExtractor.extract(
      SAMPLE_HTML,
      "https://www.skysports.com/football/news/1",
    );
    expect(result?.bodyOriginal).not.toContain("Related story");
  });

  it("returns null when no title can be found (unexpected/changed markup)", () => {
    const result = skySportsExtractor.extract(
      "<html><body><p>no heading here</p></body></html>",
      "https://www.skysports.com/x",
    );
    expect(result).toBeNull();
  });

  it("returns null when no body paragraphs are found (unexpected/changed markup)", () => {
    const html = `<article><h1 class="sdc-article-header__title">Title only</h1></article>`;
    const result = skySportsExtractor.extract(html, "https://www.skysports.com/x");
    expect(result).toBeNull();
  });

  it("returns null author/subtitle/publishedAt when those elements are absent, without failing the whole extraction", () => {
    const html = `
      <article>
        <h1 class="sdc-article-header__title">Minimal article</h1>
        <div data-testid="article-body"><p>Just one paragraph, no byline or date.</p></div>
      </article>
    `;
    const result = skySportsExtractor.extract(html, "https://www.skysports.com/x");
    expect(result).not.toBeNull();
    expect(result?.authorOriginal).toBeNull();
    expect(result?.subtitleOriginal).toBeNull();
    expect(result?.publishedAtSource).toBeNull();
    expect(result?.bodyOriginal).toBe("Just one paragraph, no byline or date.");
  });
});

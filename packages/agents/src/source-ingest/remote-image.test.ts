import { describe, expect, it, vi } from "vitest";
import {
  articleMediaFromHtml,
  fetchArticleImage,
  fetchArticleMedia,
  imageFromHtml,
} from "./remote-image";

describe("remote image metadata only", () => {
  it("chooses declared large OG over a small image and keeps the exact signed URL", () => {
    const url = "https://cdn.publisher.test/photo.jpg?w=1600&sig=abc%2Fxyz";
    const html = `<meta property="og:image" content="https://cdn.publisher.test/small.jpg"><meta property="og:image:width" content="150"><meta property="og:image:height" content="84"><meta property="og:image" content="${url}"><meta property="og:image:width" content="1600"><meta property="og:image:height" content="900">`;
    expect(imageFromHtml(html, "https://publisher.test/story")).toEqual({
      url,
      width: 1600,
      height: 900,
      source: "og",
    });
  });
  it("rejects known tiny images even when twitter repeats the URL without dimensions", () => {
    expect(
      imageFromHtml(
        '<meta property="og:image" content="https://publisher.test/small.jpg"><meta property="og:image:width" content="300"><meta name="twitter:image" content="https://publisher.test/small.jpg">',
        "https://publisher.test/story",
      ),
    ).toBeNull();
  });
  it("reads article JSON-LD images with dimensions", () => {
    expect(
      imageFromHtml(
        '<script type="application/ld+json">{"@graph":[{"@type":"NewsArticle","image":{"url":"https://cdn.publisher.test/large.jpg","width":1920,"height":1080}}]}</script>',
        "https://publisher.test/story",
      ),
    ).toMatchObject({ source: "json-ld", width: 1920, height: 1080 });
  });
  it("keeps the primary and ordered body images without downloading them", () => {
    const media = articleMediaFromHtml(
      '<meta property="og:image" content="https://cdn.publisher.test/hero.jpg"><article><p>Long source article paragraph with enough text to select this article root.<img src="https://cdn.publisher.test/body.jpg" alt="Body image" width="1200" height="700"></p></article>',
      "https://publisher.test/story",
    );
    expect(media.inlineImages).toEqual([
      expect.objectContaining({ url: "https://cdn.publisher.test/hero.jpg" }),
      expect.objectContaining({
        url: "https://cdn.publisher.test/body.jpg",
        alt: "Body image",
      }),
    ]);
  });
  it("extracts lazy-loaded source-body images", () => {
    const media = articleMediaFromHtml(
      '<article><p>Long source article paragraph with enough text to select this article root.<img data-src="https://cdn.publisher.test/lazy.jpg" alt="Lazy photo" width="1200" height="700"></p></article>',
      "https://publisher.test/story",
    );
    expect(media.inlineImages).toEqual([
      expect.objectContaining({ url: "https://cdn.publisher.test/lazy.jpg", alt: "Lazy photo" }),
    ]);
  });
  it("preserves commas inside BILD srcset URLs", () => {
    const media = articleMediaFromHtml(
      '<article><p>Article text.<img src="https://images.bild.de/story/hash,photo?w=992" srcset="https://images.bild.de/story/hash,photo?w=656 656w, https://images.bild.de/story/hash,photo?w=992 992w" width="992" height="558"></p></article>',
      "https://www.bild.de/story",
    );
    expect(media.inlineImages).toEqual([
      expect.objectContaining({ url: "https://images.bild.de/story/hash,photo?w=992" }),
    ]);
  });
  it("collapses presentation variants of the same body image", () => {
    const media = articleMediaFromHtml(
      '<article><p>Article text.<img src="https://i2-prod.mirror.test/article1.ece/ALTERNATES/s1200d/1_photo.jpg" width="1200" height="800"><img src="https://i2-prod.mirror.test/article1.ece/ALTERNATES/s1200f/1_photo.jpg" width="1200" height="800"></p></article>',
      "https://mirror.test/story",
    );
    expect(media.inlineImages).toHaveLength(1);
  });
  it("does not extract paywalled metadata", () => {
    expect(
      imageFromHtml(
        '<meta property="og:image" content="https://publisher.test/large.jpg"><script type="application/ld+json">{"@type":"NewsArticle","isAccessibleForFree":false}</script>',
        "https://publisher.test/story",
      ),
    ).toBeNull();
  });
  it("makes exactly one HTML request and never fetches the image URL", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('<meta property="og:image" content="https://cdn.publisher.test/large.jpg">', {
        headers: { "Content-Type": "text/html" },
      }),
    );
    expect(
      await fetchArticleImage(
        "https://publisher.test/story",
        "https://publisher.test/feed",
        fetcher,
      ),
    ).toMatchObject({ url: "https://cdn.publisher.test/large.jpg" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://publisher.test/story");
  });
  it("accepts an article on a publisher subdomain and records an inspected image-free page", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("<article><p>Text only.</p></article>", {
        headers: { "Content-Type": "text/html" },
      }),
    );
    await expect(
      fetchArticleMedia(
        "https://sportbild.bild.de/fussball/story",
        "https://www.bild.de/feed/alles.xml",
        fetcher,
      ),
    ).resolves.toEqual({ primary: null, inlineImages: [] });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([403, 302])("does not bypass HTTP %s", async (status) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response("", { status, headers: { Location: "https://publisher.test/login" } }),
      );
    expect(
      await fetchArticleImage(
        "https://publisher.test/story",
        "https://publisher.test/feed",
        fetcher,
      ),
    ).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("does not read binary responses or fetch an unrelated/internal URL", async () => {
    const binary = new Response("binary", { headers: { "Content-Type": "image/jpeg" } });
    const text = vi.spyOn(binary, "text");
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(binary);
    expect(
      await fetchArticleImage("https://publisher.test/a", "https://publisher.test/feed", fetcher),
    ).toBeNull();
    expect(text).not.toHaveBeenCalled();
    fetcher.mockClear();
    expect(
      await fetchArticleImage("http://127.0.0.1/a", "https://publisher.test/feed", fetcher),
    ).toBeNull();
    expect(
      await fetchArticleImage("https://other.test/a", "https://publisher.test/feed", fetcher),
    ).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });
});

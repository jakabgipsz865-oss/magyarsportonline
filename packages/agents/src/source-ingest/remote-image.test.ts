import { describe, expect, it, vi } from "vitest";
import { fetchArticleImage, imageFromHtml } from "./remote-image";

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

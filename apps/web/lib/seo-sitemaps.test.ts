import { describe, expect, it } from "vitest";
import { listAllPublicStories, listRecentPublicStories, renderNewsSitemap } from "./seo-sitemaps";

const now = new Date("2026-09-29T12:00:00.000Z");

function story(index: number, publishedAt = now) {
  return {
    slug: `story-${index}`,
    titleHu: `Cikk ${index}`,
    publishedAt,
    lastUpdatedAt: publishedAt,
  };
}

function readerFor(rows: ReturnType<typeof story>[]) {
  const requests: Array<{ limit: number; offset: number }> = [];
  return {
    requests,
    async listPublished(params: { limit: number; offset: number }) {
      requests.push(params);
      return rows.slice(params.offset, params.offset + params.limit);
    },
  };
}

describe("public SEO sitemaps", () => {
  it("includes every public article across page boundaries, including beyond the old 1000 cap", async () => {
    const reader = readerFor(Array.from({ length: 1251 }, (_, index) => story(index)));
    const rows = await listAllPublicStories(reader);

    expect(rows).toHaveLength(1251);
    expect(new Set(rows.map((row) => row.slug)).size).toBe(1251);
    expect(rows.at(-1)?.slug).toBe("story-1250");
    expect(reader.requests.map((request) => request.offset)).toEqual([
      0, 250, 500, 750, 1000, 1250,
    ]);
  });

  it("includes exactly the previous 48 hours, excludes future rows, and stops at 1000 news items", async () => {
    const recent = Array.from({ length: 1200 }, (_, index) => story(index));
    const reader = readerFor([
      story(-1, new Date(now.getTime() + 1000)),
      ...recent,
      story(1200, new Date(now.getTime() - 48 * 60 * 60 * 1000)),
      story(1201, new Date(now.getTime() - 48 * 60 * 60 * 1000 - 1)),
    ]);
    const rows = await listRecentPublicStories(reader, now);

    expect(rows).toHaveLength(1000);
    expect(rows[0]?.slug).toBe("story-0");
    expect(rows.at(-1)?.slug).toBe("story-999");
    expect(reader.requests).toHaveLength(5);

    const boundaryReader = readerFor([
      story(1, new Date(now.getTime() - 48 * 60 * 60 * 1000)),
      story(2, new Date(now.getTime() - 48 * 60 * 60 * 1000 - 1)),
    ]);
    expect((await listRecentPublicStories(boundaryReader, now)).map((row) => row.slug)).toEqual([
      "story-1",
    ]);
  });

  it("renders an escaped Google News XML entry with the original publication time", () => {
    const xml = renderNewsSitemap(
      [{ ...story(1), slug: "a&b", titleHu: 'A & B <futball> "hír"' }],
      "https://mso24.hu",
    );

    expect(xml).toContain('xmlns:news="http://www.google.com/schemas/sitemap-news/0.9"');
    expect(xml).toContain("<loc>https://mso24.hu/hir/a&amp;b</loc>");
    expect(xml).toContain("<news:name>MSO24</news:name>");
    expect(xml).toContain("<news:language>hu</news:language>");
    expect(xml).toContain(
      "<news:publication_date>2026-09-29T12:00:00.000Z</news:publication_date>",
    );
    expect(xml).toContain("<news:title>A &amp; B &lt;futball&gt; &quot;hír&quot;</news:title>");
  });
});

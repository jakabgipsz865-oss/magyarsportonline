import type { StoryReadModelRow } from "@magyarsportonline/db";
import { escapeXml } from "./xml";

type SitemapStory = Pick<StoryReadModelRow, "slug" | "titleHu" | "publishedAt" | "lastUpdatedAt">;
type PublicStoryReader = {
  listPublished(params: { limit: number; offset: number }): Promise<SitemapStory[]>;
};

const PAGE_SIZE = 250;
const NEWS_LIMIT = 1000;
const NEWS_WINDOW_MS = 48 * 60 * 60 * 1000;

/** The repository applies the same public filter as the article page. */
export async function listAllPublicStories(reader: PublicStoryReader): Promise<SitemapStory[]> {
  const stories: SitemapStory[] = [];
  for (;;) {
    const page = await reader.listPublished({ limit: PAGE_SIZE, offset: stories.length });
    stories.push(...page);
    if (page.length < PAGE_SIZE) return stories;
  }
}

/** Rows are ordered by publishedAt descending by both public repositories. */
export async function listRecentPublicStories(
  reader: PublicStoryReader,
  now: Date,
): Promise<SitemapStory[]> {
  const stories: SitemapStory[] = [];
  const earliest = now.getTime() - NEWS_WINDOW_MS;
  let offset = 0;

  for (;;) {
    const page = await reader.listPublished({ limit: PAGE_SIZE, offset });
    for (const story of page) {
      const published = story.publishedAt.getTime();
      if (published < earliest) return stories;
      if (published > now.getTime()) continue;
      stories.push(story);
      if (stories.length === NEWS_LIMIT) return stories;
    }
    if (page.length < PAGE_SIZE) return stories;
    offset += page.length;
  }
}

export function renderNewsSitemap(stories: SitemapStory[], siteUrl: string): string {
  const urls = stories.map((story) =>
    [
      "  <url>",
      `    <loc>${escapeXml(`${siteUrl}/hir/${story.slug}`)}</loc>`,
      "    <news:news>",
      "      <news:publication>",
      "        <news:name>MSO24</news:name>",
      "        <news:language>hu</news:language>",
      "      </news:publication>",
      `      <news:publication_date>${story.publishedAt.toISOString()}</news:publication_date>`,
      `      <news:title>${escapeXml(story.titleHu)}</news:title>`,
      "    </news:news>",
      "  </url>",
    ].join("\n"),
  );

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">',
    ...urls,
    "</urlset>",
    "",
  ].join("\n");
}

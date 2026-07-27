import { createRepositories } from "../../lib/db";
import { env } from "../../lib/env";
import { toStorySummaryView } from "../../lib/story-view";
import { escapeXml } from "../../lib/xml";

export const dynamic = "force-dynamic";

const FEED_ITEM_LIMIT = 50;

/**
 * Publikus RSS 2.0 feed a publikált Story-kból (SEO/szindikáció,
 * docs/architecture/08-roadmap.md Fázis 8) — kizárólag a
 * `story_read_model` projekcióból olvas.
 */
export async function GET(): Promise<Response> {
  const { storyReadModelRepository } = createRepositories();
  const rows = await storyReadModelRepository.listPublished({ limit: FEED_ITEM_LIMIT, offset: 0 });
  const stories = rows.map(toStorySummaryView);

  const items = stories
    .map((story) => {
      const url = `${env.SITE_URL}/hir/${story.slug}`;
      return [
        "    <item>",
        `      <title>${escapeXml(story.title)}</title>`,
        `      <link>${escapeXml(url)}</link>`,
        `      <guid isPermaLink="true">${escapeXml(url)}</guid>`,
        `      <description>${escapeXml(story.lead)}</description>`,
        `      <pubDate>${new Date(story.publishedAt).toUTCString()}</pubDate>`,
        "    </item>",
      ].join("\n");
    })
    .join("\n");

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0">',
    "  <channel>",
    "    <title>magyarsportonline.hu</title>",
    `    <link>${escapeXml(env.SITE_URL)}</link>`,
    "    <description>AI-támogatott, Story-alapú sporthírek</description>",
    "    <language>hu</language>",
    items,
    "  </channel>",
    "</rss>",
    "",
  ].join("\n");

  return new Response(xml, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
}

import { createPublicRepositories } from "../../lib/db";
import { env } from "../../lib/env";
import { listRecentPublicStories, renderNewsSitemap } from "../../lib/seo-sitemaps";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const { storyReadModelRepository } = createPublicRepositories();
  const stories = await listRecentPublicStories(storyReadModelRepository, new Date());
  return new Response(renderNewsSitemap(stories, env.SITE_URL), {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
}

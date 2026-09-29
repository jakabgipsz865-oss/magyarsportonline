import type { MetadataRoute } from "next";
import { createPublicRepositories } from "../lib/db";
import { env } from "../lib/env";
import { listAllPublicStories } from "../lib/seo-sitemaps";

// DB-driven — minden lekéréskor a friss publikált állományból épül.
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const { storyReadModelRepository } = createPublicRepositories();
  const rows = await listAllPublicStories(storyReadModelRepository);

  return [
    {
      url: env.SITE_URL,
      lastModified: rows[0]?.lastUpdatedAt ?? new Date(),
      changeFrequency: "hourly",
      priority: 1,
    },
    ...rows.map((row) => ({
      url: `${env.SITE_URL}/hir/${row.slug}`,
      lastModified: row.lastUpdatedAt,
      changeFrequency: "daily" as const,
      priority: 0.8,
    })),
  ];
}

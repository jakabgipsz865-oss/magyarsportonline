import type { MetadataRoute } from "next";
import { createRepositories } from "../lib/db";
import { env } from "../lib/env";

// DB-driven — minden lekéréskor a friss publikált állományból épül.
export const dynamic = "force-dynamic";

const MAX_SITEMAP_ENTRIES = 1000;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const { storyReadModelRepository } = createRepositories();
  const rows = await storyReadModelRepository.listPublished({
    limit: MAX_SITEMAP_ENTRIES,
    offset: 0,
  });

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

import type { MetadataRoute } from "next";
import { env } from "../lib/env";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Belső/adminisztratív felületek sosem indexelhetők.
        disallow: ["/admin/", "/api/", "/internal/"],
      },
    ],
    sitemap: `${env.SITE_URL}/sitemap.xml`,
  };
}

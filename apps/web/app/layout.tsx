import type { Metadata } from "next";
import type { ReactNode } from "react";
import { SiteHeader } from "../components/site-header";
import { bodyFont, displayFont, monoFont } from "../lib/fonts";
import { env } from "../lib/env";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(env.SITE_URL),
  title: {
    default: "MSO24 — Futballhírek",
    template: "%s — MSO24",
  },
  description: "Friss nemzetközi futballhírek magyarul, közvetlenül az eredeti források alapján.",
  alternates: {
    types: { "application/rss+xml": [{ url: "/rss.xml", title: "MSO24 RSS" }] },
  },
  openGraph: {
    type: "website",
    siteName: "MSO24",
    locale: "hu_HU",
  },
};

export default function RootLayout({ children }: { children: ReactNode }): ReactNode {
  return (
    <html lang="hu" className={`${displayFont.variable} ${bodyFont.variable} ${monoFont.variable}`}>
      <body>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "WebSite",
              name: "MSO24",
              url: env.SITE_URL,
              inLanguage: "hu",
            }).replace(/</g, "\\u003c"),
          }}
        />
        <SiteHeader />
        {children}
      </body>
    </html>
  );
}

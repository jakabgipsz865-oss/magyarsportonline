import type { Metadata } from "next";
import type { ReactNode } from "react";
import { SiteHeader } from "../components/site-header";
import { bodyFont, displayFont, monoFont } from "../lib/fonts";
import { env } from "../lib/env";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(env.SITE_URL),
  title: {
    default: "MagyarSportOnline — Futballbulvár",
    template: "%s — MagyarSportOnline",
  },
  description:
    "Friss futballbulvár magyarul: személyes történetek, botrányok és pályán kívüli események.",
  alternates: {
    types: { "application/rss+xml": [{ url: "/rss.xml", title: "MagyarSportOnline RSS" }] },
  },
  openGraph: {
    type: "website",
    siteName: "MagyarSportOnline",
    locale: "hu_HU",
  },
};

export default function RootLayout({ children }: { children: ReactNode }): ReactNode {
  return (
    <html lang="hu" className={`${displayFont.variable} ${bodyFont.variable} ${monoFont.variable}`}>
      <body>
        <SiteHeader />
        {children}
      </body>
    </html>
  );
}

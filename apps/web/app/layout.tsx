import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { env } from "../lib/env";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(env.SITE_URL),
  title: {
    default: "magyarsportonline.hu — AI-alapú sporthírek",
    template: "%s — magyarsportonline.hu",
  },
  description:
    "Story-alapú, AI-támogatott sporthírek: több forrásból összevetett, folyamatosan frissülő hírek verziótörténettel és forrásmegjelöléssel.",
  alternates: {
    types: { "application/rss+xml": [{ url: "/rss.xml", title: "magyarsportonline.hu RSS" }] },
  },
  openGraph: {
    type: "website",
    siteName: "magyarsportonline.hu",
    locale: "hu_HU",
  },
};

export default function RootLayout({ children }: { children: ReactNode }): ReactNode {
  return (
    <html lang="hu">
      <body>
        <header className="site-header">
          <div className="site-header__inner">
            <Link href="/" className="site-header__brand">
              magyarsportonline.hu
            </Link>
            <span className="site-header__tagline">Sporthírek, frissítve</span>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}

import { IBM_Plex_Mono, Oswald, Source_Sans_3 } from "next/font/google";

/**
 * Self-hosted via next/font (no runtime request to Google's CDN — fonts are
 * downloaded at build time and served from our own origin). Three roles:
 * Oswald for condensed display headlines, Source Sans 3 for body copy,
 * IBM Plex Mono for scores/stats/timestamps (tabular figures).
 */
export const displayFont = Oswald({
  subsets: ["latin", "latin-ext"],
  weight: ["500", "600", "700"],
  variable: "--font-display",
  display: "swap",
});

export const bodyFont = Source_Sans_3({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "600", "700"],
  variable: "--font-body",
  display: "swap",
});

export const monoFont = IBM_Plex_Mono({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "700"],
  variable: "--font-mono",
  display: "swap",
});

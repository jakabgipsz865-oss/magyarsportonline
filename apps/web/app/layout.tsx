import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "magyarsportonline.hu",
    template: "%s — magyarsportonline.hu",
  },
  description:
    "AI-first, Story-alapú sporthír-platform — fejlesztés alatt (Fázis 0).",
};

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}): ReactNode {
  return (
    <html lang="hu">
      <body>{children}</body>
    </html>
  );
}

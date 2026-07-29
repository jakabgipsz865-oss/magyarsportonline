import Link from "next/link";
import type { ReactNode } from "react";

const NAV_LINKS: Array<{ href: string; labelHu: string }> = [
  { href: "/admin", labelHu: "Áttekintés" },
  { href: "/admin/review", labelHu: "Review queue" },
  { href: "/admin/missed-merge-review", labelHu: "Story merge review" },
];

/**
 * Egységes admin fejléc minden `/admin/*` oldalon (2026-07-29, "kézzelfogható
 * admin dashboard" sprint): jól látható admin mód + környezet jelzés (hogy
 * sose lehessen összekeverni egy preview/dev deploy-t az éles oldallal),
 * kijelentkezés és navigáció — a `/admin/logout` route egy szándékosan
 * hibás Basic-auth kihívást ad vissza, hogy a böngésző eldobja a mentett
 * jelszót (HTTP Basic auth-nak nincs valódi szerveroldali "logout"-ja).
 */
export function AdminHeader({ activePath }: { activePath: string }): ReactNode {
  const vercelEnv = process.env["VERCEL_ENV"] ?? "development";
  const envLabelHu =
    vercelEnv === "production" ? "Production" : vercelEnv === "preview" ? "Preview" : "Development";
  const envColor =
    vercelEnv === "production" ? "#1a7f37" : vercelEnv === "preview" ? "#9a6700" : "#57606a";

  return (
    <header style={{ marginBottom: 20, borderBottom: "1px solid #ddd", paddingBottom: 12 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 10,
          marginBottom: 10,
        }}
      >
        <span
          style={{
            fontWeight: 700,
            padding: "3px 10px",
            borderRadius: 999,
            background: "#222",
            color: "white",
            fontSize: "0.85em",
          }}
        >
          🔒 Admin mód
        </span>
        <span
          style={{
            fontWeight: 600,
            padding: "3px 10px",
            borderRadius: 999,
            background: envColor,
            color: "white",
            fontSize: "0.85em",
          }}
          title="Melyik környezetben fut ez az admin felület"
        >
          {envLabelHu}
        </span>
        <span style={{ flex: 1 }} />
        <Link href="/admin/logout" prefetch={false} style={{ fontSize: "0.9em", color: "#555" }}>
          Kijelentkezés
        </Link>
      </div>
      <nav style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {NAV_LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            style={{
              padding: "6px 12px",
              borderRadius: 6,
              border: "1px solid #999",
              textDecoration: "none",
              background: link.href === activePath ? "#333" : "white",
              color: link.href === activePath ? "white" : "#333",
              fontSize: "0.95em",
            }}
          >
            {link.labelHu}
          </Link>
        ))}
      </nav>
    </header>
  );
}

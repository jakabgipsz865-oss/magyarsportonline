import Link from "next/link";
import type { ReactNode } from "react";
import { runtimeEnvironment } from "../../../lib/runtime-environment";

const NAV_LINKS: Array<{ href: string; labelHu: string }> = [
  { href: "/admin", labelHu: "Áttekintés" },
  { href: "/admin/quality", labelHu: "Minőség" },
  { href: "/admin/popularity", labelHu: "Népszerűség" },
  { href: "/admin/monetization", labelHu: "Monetizáció" },
  { href: "/admin/system", labelHu: "Rendszer" },
  { href: "/admin/knowledge", labelHu: "Szerkesztői tudás" },
];

/**
 * Egységes admin fejléc minden `/admin/*` oldalon (2026-07-29, "kézzelfogható
 * admin dashboard" sprint): jól látható admin mód + környezet jelzés (hogy
 * sose lehessen összekeverni egy preview/dev deploy-t az éles oldallal),
 * kijelentkezés és navigáció — a `/admin/logout` route törli az aláírt,
 * HttpOnly admin session cookie-t.
 */
export function AdminHeader({ activePath }: { activePath: string }): ReactNode {
  const runtimeEnv = runtimeEnvironment();
  const envLabelHu =
    runtimeEnv === "production"
      ? "Production"
      : runtimeEnv === "preview"
        ? "Preview"
        : "Development";

  return (
    <header className="admin-shell">
      <div className="admin-shell__meta">
        <div className="admin-shell__identity">
          <span className="admin-shell__mode">Admin</span>
          <span
            className="admin-shell__environment"
            data-environment={runtimeEnv}
            title="Melyik környezetben fut ez az admin felület"
          >
            {envLabelHu}
          </span>
        </div>
        <Link href="/admin/logout" prefetch={false} className="admin-shell__logout">
          Kijelentkezés
        </Link>
      </div>
      <nav className="admin-shell__nav" aria-label="Admin főnavigáció">
        {NAV_LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="admin-shell__nav-link"
            data-active={link.href === activePath}
            aria-current={link.href === activePath ? "page" : undefined}
          >
            {link.labelHu}
          </Link>
        ))}
      </nav>
    </header>
  );
}

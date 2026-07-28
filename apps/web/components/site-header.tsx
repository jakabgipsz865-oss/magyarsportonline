"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import type { ReactNode } from "react";

const NAV_LINKS = [
  { href: "/", label: "Kezdőlap" },
  { href: "/kategoria/labdarugas", label: "Labdarúgás" },
  { href: "/csapatok", label: "Csapatok" },
];

export function SiteHeader(): ReactNode {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="site-header">
      <div className="site-header__inner">
        <Link href="/" className="site-header__brand" onClick={() => setMobileOpen(false)}>
          <span className="site-header__mark" aria-hidden="true" />
          <span className="site-header__name">
            Magyar<b>Sport</b>Online
          </span>
        </Link>
        <nav className="site-nav">
          {NAV_LINKS.map((link) => (
            <Link key={link.href} href={link.href} data-active={pathname === link.href}>
              {link.label}
            </Link>
          ))}
        </nav>
        <button
          type="button"
          className="nav-toggle"
          aria-label={mobileOpen ? "Menü bezárása" : "Menü megnyitása"}
          aria-expanded={mobileOpen}
          onClick={() => setMobileOpen((open) => !open)}
        >
          {mobileOpen ? "✕" : "☰"}
        </button>
      </div>
      <nav className="mobile-nav" data-open={mobileOpen}>
        {NAV_LINKS.map((link) => (
          <Link key={link.href} href={link.href} onClick={() => setMobileOpen(false)}>
            {link.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}

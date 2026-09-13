import Link from "next/link";
import type { ReactNode } from "react";

export function SiteFooter({ className }: { className?: string }): ReactNode {
  return (
    <footer className={className ? `site-footer ${className}` : "site-footer"}>
      <span>© MagyarSportOnline</span>
      <span>
        <Link href="/impresszum">Impresszum</Link> · <Link href="/adatkezeles">Adatkezelés</Link> ·
        Források az egyes cikkeknél
      </span>
    </footer>
  );
}

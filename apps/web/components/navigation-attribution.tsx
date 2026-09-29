"use client";

import { useEffect } from "react";

export function NavigationAttribution(): null {
  useEffect(() => {
    function rememberClick(event: MouseEvent): void {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const link = target.closest<HTMLAnchorElement>("a[href]");
      if (!link) return;
      try {
        const url = new URL(link.href);
        if (url.origin !== window.location.origin) return;
        if (!url.pathname.startsWith("/hir/")) return;
        sessionStorage.setItem(
          "mso:next-read",
          JSON.stringify({
            path: url.pathname,
            source: link.dataset["readSource"] ?? "internal",
            at: Date.now(),
          }),
        );
      } catch {
        // Storage-disabled browsers still read articles normally.
      }
    }
    document.addEventListener("click", rememberClick);
    return () => document.removeEventListener("click", rememberClick);
  }, []);
  return null;
}

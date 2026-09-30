"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useAnalyticsConsent } from "./analytics-consent";
import {
  audienceSource,
  browserSession,
  publicPage,
  readConsent,
  type AudienceEvent,
} from "../lib/audience";
import {
  classifyReadSource,
  ensureQualifiedEvent,
  loadQualifiedEvent,
  QualifiedReadGate,
  qualifiedReadKey,
} from "../lib/qualified-read";
export function AudienceTracker(): null {
  const allowed = useAnalyticsConsent(),
    path = usePathname();
  const search = useSearchParams();
  const pageNumber =
    path === "/kategoria/labdarugas" && /^\d{1,4}$/.test(search.get("oldal") ?? "")
      ? Number(search.get("oldal"))
      : 1;
  const viewKey = `${path}#${pageNumber}`;
  const current = useRef<{ path: string; pv: AudienceEvent; sent: boolean } | null>(null);
  const previousPath = useRef<string | null>(null);
  const [visibleTick, rerender] = useState(0);
  useEffect(() => {
    if (!allowed || readConsent(document.cookie) !== "allow" || !publicPage(path)) {
      current.current = null;
      previousPath.current = viewKey;
      return;
    }
    if (document.visibilityState !== "visible") {
      // Prerender/prefetch/hidden tabs do not create a PV until actually shown.
      const onVisible = () => {
        if (document.visibilityState === "visible")
          window.dispatchEvent(new Event("mso:visible-page"));
      };
      document.addEventListener("visibilitychange", onVisible);
      return () => document.removeEventListener("visibilitychange", onVisible);
    }
    return start();
    function start(): (() => void) | undefined {
      let sessionId: string;
      try {
        sessionId = browserSession(sessionStorage, () => crypto.randomUUID());
      } catch {
        return;
      }
      const article = document.querySelector<HTMLElement>("article.story-article[data-story-id]");
      const storyId = article?.dataset["storyId"] ?? null;
      if (path.startsWith("/hir/") && !storyId) return;
      let placement: string | null = null;
      try {
        const raw = sessionStorage.getItem("mso:next-read");
        sessionStorage.removeItem("mso:next-read");
        if (raw) {
          const m = JSON.parse(raw) as { path: string; source: string; at: number };
          if (m.path === path && Date.now() - m.at >= 0 && Date.now() - m.at < 900000)
            placement = m.source;
        }
      } catch {
        /* Attribution remains optional. */
      }
      const internal = previousPath.current !== null && previousPath.current !== viewKey;
      const source = audienceSource(
        document.referrer,
        location.origin,
        internal || placement !== null,
      );
      const readSource = classifyReadSource(
        document.referrer,
        placement ?? (internal ? "internal" : null),
      );
      if (!current.current || current.current.path !== viewKey)
        current.current = {
          path: viewKey,
          sent: false,
          pv: {
            eventId: crypto.randomUUID(),
            sessionId,
            type: "page_view",
            path,
            storyId,
            source,
            placement: readSource,
            parentEventId: null,
          },
        };
      previousPath.current = viewKey;
      const state = current.current;
      const controller = new AbortController();
      let stopped = false,
        working = false,
        attempts = 0,
        qualified = false;
      const gate = new QualifiedReadGate(performance.now(), true);
      async function send(event: AudienceEvent): Promise<boolean> {
        if (stopped || readConsent(document.cookie) !== "allow") return false;
        try {
          const r = await fetch("/api/analytics/audience", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(event),
            credentials: "same-origin",
            keepalive: true,
            signal: controller.signal,
          });
          return r.ok;
        } catch {
          return false;
        }
      }
      async function flush(): Promise<void> {
        if (working || stopped || attempts >= 3 || readConsent(document.cookie) !== "allow") return;
        working = true;
        attempts++;
        try {
          if (!state.sent) state.sent = await send(state.pv);
          if (!state.sent || !qualified || !storyId) return;
          const existing = loadQualifiedEvent(sessionStorage, storyId);
          if (existing?.status === "sent") return;
          const qr = ensureQualifiedEvent(sessionStorage, storyId, readSource, () =>
            crypto.randomUUID(),
          );
          if (
            (await send({
              ...state.pv,
              eventId: qr.eventId,
              type: "qualified_read",
              parentEventId: state.pv.eventId,
              placement: qr.source,
            })) &&
            !stopped &&
            readConsent(document.cookie) === "allow"
          )
            sessionStorage.setItem(
              qualifiedReadKey(storyId),
              JSON.stringify({ ...qr, status: "sent" }),
            );
        } catch {
          /* Optional tracking must never affect reading. */
        } finally {
          working = false;
        }
      }
      void flush();
      const onVisible = () =>
        gate.setVisible(performance.now(), document.visibilityState === "visible");
      const onScroll = () => {
        if (
          article &&
          gate.checkScroll(
            (window.scrollY - (article.getBoundingClientRect().top + window.scrollY)) /
              Math.max(article.offsetHeight, 1),
          )
        ) {
          qualified = true;
          attempts = 0;
          void flush();
        }
      };
      let ticks = 0;
      const timer = window.setInterval(() => {
        ticks++;
        if (gate.checkTime(performance.now())) {
          qualified = true;
          attempts = 0;
          void flush();
        } else if (ticks % 10 === 0 && (!state.sent || qualified)) void flush();
      }, 500);
      document.addEventListener("visibilitychange", onVisible);
      window.addEventListener("scroll", onScroll, { passive: true });
      return () => {
        stopped = true;
        controller.abort();
        window.clearInterval(timer);
        document.removeEventListener("visibilitychange", onVisible);
        window.removeEventListener("scroll", onScroll);
      };
    }
  }, [allowed, path, viewKey, visibleTick]);
  // React state is only needed when a background-opened tab first becomes visible.
  useEffect(() => {
    const f = () => rerender((v) => v + 1);
    window.addEventListener("mso:visible-page", f);
    return () => window.removeEventListener("mso:visible-page", f);
  }, []);
  return null;
}

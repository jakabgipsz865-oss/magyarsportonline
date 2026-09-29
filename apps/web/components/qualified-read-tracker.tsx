"use client";

import { useEffect } from "react";
import {
  classifyReadSource, ensureQualifiedEvent, loadQualifiedEvent,
  QualifiedReadGate, qualifiedReadKey, type StoredQualifiedEvent,
} from "../lib/qualified-read";

function readClickSource(): string | null {
  try {
    const value = sessionStorage.getItem("mso:next-read");
    sessionStorage.removeItem("mso:next-read");
    if (!value) return null;
    const marker = JSON.parse(value) as { path?: string; source?: string; at?: number };
    return marker.path === window.location.pathname && typeof marker.at === "number" &&
      Date.now() - marker.at <= 15 * 60_000 ? marker.source ?? null : null;
  } catch {
    return null;
  }
}

export function QualifiedReadTracker({ storyId }: { storyId: string }): null {
  useEffect(() => {
    const key = qualifiedReadKey(storyId);
    let stored: StoredQualifiedEvent | null = null;
    try {
      stored = loadQualifiedEvent(sessionStorage, storyId);
    } catch {
      // Without session storage we cannot promise session-level deduplication.
      return;
    }
    if (stored?.status === "sent") return;
    const clickedSource = readClickSource();
    const source = classifyReadSource(document.referrer, clickedSource);
    const article = document.querySelector<HTMLElement>("article.story-article");
    if (!article) return;
    const trackedArticle = article;
    const gate = new QualifiedReadGate(performance.now(), document.visibilityState === "visible");
    let pending = stored;
    let sending = false;

    function persist(value: StoredQualifiedEvent): void {
      sessionStorage.setItem(key, JSON.stringify(value));
      pending = value;
    }

    async function send(): Promise<void> {
      if (sending || pending?.status === "sent") return;
      sending = true;
      try {
        if (!pending) persist(ensureQualifiedEvent(sessionStorage, storyId, source, () => crypto.randomUUID()));
        const response = await fetch("/api/analytics/qualified-read", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ eventId: pending?.eventId, storyId, source: pending?.source }),
          keepalive: true, credentials: "same-origin",
        });
        if (response.ok && pending) persist({ ...pending, status: "sent" });
      } catch {
        // A pending event can be retried with the same ID on the next visit.
      } finally {
        sending = false;
      }
    }

    function onVisibility(): void {
      gate.setVisible(performance.now(), document.visibilityState === "visible");
    }
    function onScroll(): void {
      const articleTop = trackedArticle.getBoundingClientRect().top + window.scrollY;
      const progress = (window.scrollY - articleTop) / Math.max(trackedArticle.offsetHeight, 1);
      if (gate.checkScroll(progress)) void send();
    }
    function onLeave(): void {
      gate.setVisible(performance.now(), false);
      if (pending?.status !== "pending") return;
      const payload = JSON.stringify({ eventId: pending.eventId, storyId, source: pending.source });
      navigator.sendBeacon?.("/api/analytics/qualified-read", new Blob([payload], { type: "application/json" }));
    }

    if (pending?.status === "pending") void send();
    const interval = window.setInterval(() => { if (gate.checkTime(performance.now())) void send(); }, 500);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pagehide", onLeave);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("pagehide", onLeave);
    };
  }, [storyId]);
  return null;
}

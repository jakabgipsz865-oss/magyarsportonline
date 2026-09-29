import type { ReadSource } from "./trending";

export interface StoredQualifiedEvent {
  eventId: string;
  source: ReadSource;
  status: "pending" | "sent";
}

interface SessionStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function qualifiedReadKey(storyId: string): string {
  return `mso:qr:${storyId}`;
}

export function loadQualifiedEvent(store: SessionStore, storyId: string): StoredQualifiedEvent | null {
  const raw = store.getItem(qualifiedReadKey(storyId));
  if (!raw) return null;
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null ||
    !("eventId" in parsed) || typeof parsed.eventId !== "string" ||
    !("status" in parsed) || (parsed.status !== "pending" && parsed.status !== "sent") ||
    !("source" in parsed) || typeof parsed.source !== "string") return null;
  return parsed as StoredQualifiedEvent;
}

export function ensureQualifiedEvent(
  store: SessionStore, storyId: string, source: ReadSource, newId: () => string,
): StoredQualifiedEvent {
  const existing = loadQualifiedEvent(store, storyId);
  if (existing) return existing;
  const event: StoredQualifiedEvent = { eventId: newId(), source, status: "pending" };
  store.setItem(qualifiedReadKey(storyId), JSON.stringify(event));
  return event;
}

/** Pure timing gate; hidden time and passive page opening do not qualify. */
export class QualifiedReadGate {
  private visibleSince: number | null = null;
  private accumulatedVisibleMs = 0;
  private qualified = false;

  constructor(now: number, visible: boolean) {
    if (visible) this.visibleSince = now;
  }

  setVisible(now: number, visible: boolean): void {
    if (this.qualified) return;
    if (visible) {
      if (this.visibleSince === null) this.visibleSince = now;
    } else if (this.visibleSince !== null) {
      this.accumulatedVisibleMs += Math.max(0, now - this.visibleSince);
      this.visibleSince = null;
    }
  }

  checkTime(now: number): boolean {
    if (this.qualified) return false;
    const elapsed = this.accumulatedVisibleMs +
      (this.visibleSince === null ? 0 : Math.max(0, now - this.visibleSince));
    if (this.visibleSince !== null && elapsed >= 10_000) {
      this.qualified = true;
      return true;
    }
    return false;
  }

  checkScroll(progress: number): boolean {
    if (this.qualified || this.visibleSince === null || progress < 0.25) return false;
    this.qualified = true;
    return true;
  }
}

export function classifyReadSource(referrer: string, clickedSource: string | null): ReadSource {
  const sources: ReadSource[] = ["latest", "trending_hero", "trending_side", "top5", "internal"];
  if (clickedSource && sources.includes(clickedSource as ReadSource)) return clickedSource as ReadSource;
  if (!referrer) return "direct";
  try {
    const host = new URL(referrer).hostname.toLowerCase();
    if (host === "mso24.hu" || host === "www.mso24.hu" ||
      host.endsWith(".mso24.hu")) return "internal";
    if (/(^|\.)(facebook|instagram|threads|tiktok|twitter|x|bsky)\./.test(host) ||
      host === "t.co" || host === "l.facebook.com") return "social";
    if (/(^|\.)(google|bing|duckduckgo|yahoo|yandex)\./.test(host)) return "search";
    if (/(^|\.)(feedly|inoreader|newsblur|feeder)\./.test(host)) return "rss";
  } catch {
    return "direct";
  }
  return "direct";
}

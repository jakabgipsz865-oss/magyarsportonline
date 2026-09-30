export const CONSENT_COOKIE = "mso_analytics_consent";
export const CONSENT_MAX_AGE = 90 * 86400;
export const RAW_AUDIENCE_DAYS = 32;
export const SOURCES = [
  "direct",
  "internal",
  "social",
  "search",
  "rss",
  "referral",
  "unknown",
] as const;
export type AudienceSource = (typeof SOURCES)[number];
export type Consent = "allow" | "deny" | null;
export function readConsent(cookie: string): Consent {
  const value = cookie
    .split(";")
    .map((v) => v["trim"]())
    .find((v) => v["startsWith"](`${CONSENT_COOKIE}=`))
    ?.split("=")[1];
  return value === "v1_allow" ? "allow" : value === "v1_deny" ? "deny" : null;
}
export function consentCookie(choice: Exclude<Consent, null>, secure: boolean): string {
  return `${CONSENT_COOKIE}=v1_${choice}; Path=/; Max-Age=${CONSENT_MAX_AGE}; SameSite=Lax${secure ? "; Secure" : ""}`;
}
export function publicPage(path: string): boolean {
  return (
    ["/", "/adatkezeles", "/impresszum", "/kategoria/labdarugas"].includes(path) ||
    /^\/hir\/[a-z0-9-]{1,180}$/.test(path)
  );
}
export function audienceSource(
  referrer: string,
  origin: string,
  internal: boolean,
): AudienceSource {
  if (internal) return "internal";
  if (!referrer) return "direct";
  try {
    const url = new URL(referrer);
    if (!["https:", "http:"].includes(url.protocol)) return "unknown";
    if (url.origin === origin || /(^|\.)mso24\.hu$/.test(url.hostname)) return "internal";
    const h = url.hostname.toLowerCase();
    if (/(^|\.)(facebook|instagram|threads|tiktok|twitter|x|bsky)\./.test(h) || h === "t.co")
      return "social";
    if (/(^|\.)(google|bing|duckduckgo|yahoo|yandex)\./.test(h)) return "search";
    if (/(^|\.)(feedly|inoreader|newsblur|feeder)\./.test(h)) return "rss";
    return "referral";
  } catch {
    return "unknown";
  }
}
interface Store {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export function browserSession(store: Store, newId: () => string): string {
  let id = store.getItem("mso:audience-session");
  if (!id) {
    id = newId();
    store.setItem("mso:audience-session", id);
  }
  return id;
}
export function clearAnalyticsStorage(store: Storage): void {
  for (let i = store.length - 1; i >= 0; i--) {
    const key = store.key(i);
    if (
      key &&
      (key.startsWith("mso:qr:") || key === "mso:audience-session" || key === "mso:next-read")
    )
      store.removeItem(key);
  }
}
export interface AudienceEvent {
  eventId: string;
  sessionId: string;
  type: "page_view" | "qualified_read";
  path: string;
  storyId: string | null;
  source: AudienceSource;
  placement: string;
  parentEventId: string | null;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function parseAudienceEvent(value: unknown): AudienceEvent | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (
    Object.keys(v).some(
      (k) =>
        ![
          "eventId",
          "sessionId",
          "type",
          "path",
          "storyId",
          "source",
          "placement",
          "parentEventId",
        ].includes(k),
    )
  )
    return null;
  if (
    typeof v["eventId"] !== "string" ||
    !uuid.test(v["eventId"]) ||
    typeof v["sessionId"] !== "string" ||
    !uuid.test(v["sessionId"]) ||
    !["page_view", "qualified_read"].includes(String(v["type"])) ||
    typeof v["path"] !== "string" ||
    !publicPage(v["path"]) ||
    !SOURCES.includes(v["source"] as AudienceSource) ||
    ![
      "latest",
      "trending_hero",
      "trending_side",
      "top5",
      "internal",
      "direct",
      "social",
      "search",
      "rss",
    ].includes(String(v["placement"])) ||
    !(
      v["storyId"] === null ||
      (typeof v["storyId"] === "string" && v["storyId"].length > 0 && v["storyId"].length <= 100)
    ) ||
    v["path"].startsWith("/hir/") !== (v["storyId"] !== null) ||
    (v["type"] === "page_view"
      ? v["parentEventId"] !== null
      : v["storyId"] === null ||
        typeof v["parentEventId"] !== "string" ||
        !uuid.test(v["parentEventId"]))
  )
    return null;
  return {
    eventId: v["eventId"],
    sessionId: v["sessionId"],
    type: v["type"] as AudienceEvent["type"],
    path: v["path"],
    storyId: v["storyId"] as string | null,
    source: v["source"] as AudienceSource,
    placement: v["placement"] as string,
    parentEventId: v["parentEventId"] as string | null,
  };
}

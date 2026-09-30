import { describe, it, expect } from "vitest";
import {
  readConsent,
  consentCookie,
  browserSession,
  audienceSource,
  parseAudienceEvent,
  publicPage,
} from "./audience";
describe("consent and minimized audience identity", () => {
  it("requires explicit, versioned permission and stores only a fixed preference for 90 days", () => {
    expect(readConsent("")).toBeNull();
    expect(readConsent("mso_analytics_consent=allow")).toBeNull();
    expect(readConsent("x=y; mso_analytics_consent=v1_deny")).toBe("deny");
    expect(readConsent("mso_analytics_consent=v1_allow")).toBe("allow");
    expect(consentCookie("allow", true)).toBe(
      "mso_analytics_consent=v1_allow; Path=/; Max-Age=7776000; SameSite=Lax; Secure",
    );
  });
  it("reuses an ephemeral session within a store, never across empty stores", () => {
    function store() {
      const m = new Map<string, string>();
      return {
        getItem: (k: string) => m.get(k) ?? null,
        setItem: (k: string, v: string) => {
          m.set(k, v);
        },
      };
    }
    const a = store(),
      b = store();
    expect(browserSession(a, () => "a")).toBe("a");
    expect(browserSession(a, () => "b")).toBe("a");
    expect(browserSession(b, () => "b")).toBe("b");
  });
  it.each([
    ["", "direct"],
    ["https://google.com/search?q=secret", "search"],
    ["https://l.facebook.com/?user=secret", "social"],
    ["https://feedly.com/x", "rss"],
    ["https://publisher.example/private?email=x", "referral"],
    ["invalid", "unknown"],
    ["https://preview.example/hir/abc?x=1", "internal"],
  ])("categorizes %s without retaining its URL", (url, result) =>
    expect(audienceSource(url, "https://preview.example", false)).toBe(result),
  );
  it("excludes queries, admin, API, and arbitrary paths", () => {
    for (const path of ["/admin", "/api/x", "/hir/abc?email=x", "/people/email@example.com"])
      expect(publicPage(path)).toBe(false);
    const e = {
      eventId: "123e4567-e89b-42d3-a456-426614174000",
      sessionId: "123e4567-e89b-42d3-a456-426614174001",
      type: "page_view",
      path: "/",
      storyId: null,
      source: "direct",
      placement: "direct",
      parentEventId: null,
    };
    expect(parseAudienceEvent(e)).toEqual(e);
    expect(parseAudienceEvent({ ...e, ip: "1.2.3.4" })).toBeNull();
    expect(parseAudienceEvent({ ...e, referrer: "https://secret.example" })).toBeNull();
    expect(parseAudienceEvent({ ...e, path: "/hir/a" })).toBeNull();
  });
});

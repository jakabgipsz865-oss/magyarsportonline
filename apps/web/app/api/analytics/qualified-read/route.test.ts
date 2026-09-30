import { beforeEach, describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ record: vi.fn(async () => true) }));
vi.mock("../../../../lib/db", () => ({ d1Binding: () => ({}) }));
vi.mock("../../../../lib/audience-store", () => ({ recordAudienceEvent: mocks.record }));
import { POST } from "./route";
const payload = {
  eventId: "123e4567-e89b-42d3-a456-426614174000",
  sessionId: "123e4567-e89b-42d3-a456-426614174001",
  type: "page_view",
  path: "/",
  storyId: null,
  source: "direct",
  placement: "direct",
  parentEventId: null,
};
function request(body: string, ip: string, headers: Record<string, string> = {}) {
  return new NextRequest("https://preview.example/api/analytics/audience", {
    method: "POST",
    body,
    headers: {
      "content-type": "application/json",
      origin: "https://preview.example",
      cookie: "mso_analytics_consent=v1_allow",
      "cf-connecting-ip": ip,
      ...headers,
    },
  });
}
describe("consent-only public analytics boundary, including legacy QR path", () => {
  beforeEach(() => mocks.record.mockClear());
  it("requires consent before any storage and rejects cross-origin or missing-origin events", async () => {
    for (const headers of [
      { cookie: "" },
      { cookie: "mso_analytics_consent=v1_deny" },
      { origin: "https://attacker.example" },
      { origin: "" },
      { "sec-fetch-site": "cross-site" },
    ])
      expect((await POST(request(JSON.stringify(payload), "no-consent", headers))).status).toBe(
        403,
      );
    expect(mocks.record).not.toHaveBeenCalled();
  });
  it("bounds streamed bodies without content-length and rejects raw identifiers/queries/invalid legacy payload", async () => {
    for (const value of [
      { ...payload, padding: "x".repeat(1000) },
      { ...payload, ip: "1.2.3.4" },
      { ...payload, path: "/?private=x" },
      { eventId: payload.eventId, storyId: "story", source: "direct" },
    ])
      expect((await POST(request(JSON.stringify(value), "invalid"))).status).toBe(400);
    expect(mocks.record).not.toHaveBeenCalled();
  });
  it("limits requests using transient per-isolate abuse keys", async () => {
    for (let i = 0; i < 120; i++)
      expect((await POST(request(JSON.stringify(payload), "audience-rate"))).status).toBe(200);
    expect((await POST(request(JSON.stringify(payload), "audience-rate"))).status).toBe(429);
    expect(mocks.record).toHaveBeenCalledTimes(120);
  });
});

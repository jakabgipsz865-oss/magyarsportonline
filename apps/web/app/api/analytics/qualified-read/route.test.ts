import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ record: vi.fn(async () => true) }));
vi.mock("../../../../lib/db", () => ({ d1Binding: () => ({}) }));
vi.mock("../../../../lib/trending-store", () => ({ recordQualifiedRead: mocks.record }));
import { POST } from "./route";

const payload = {
  eventId: "123e4567-e89b-42d3-a456-426614174000",
  storyId: "story",
  source: "direct",
};
function request(body: string, ip: string, headers: Record<string, string> = {}) {
  return new NextRequest("https://preview.example/api/analytics/qualified-read", {
    method: "POST",
    body,
    headers: { "content-type": "application/json", "cf-connecting-ip": ip, ...headers },
  });
}
describe("qualified read abuse boundary", () => {
  beforeEach(() => mocks.record.mockClear());
  it("rejects cross-origin events before storage", async () => {
    expect(
      (
        await POST(
          request(JSON.stringify(payload), "test-cross", { origin: "https://attacker.example" }),
        )
      ).status,
    ).toBe(403);
    expect(mocks.record).not.toHaveBeenCalled();
  });
  it("bounds streamed bodies even without content-length", async () => {
    expect(
      (await POST(request(JSON.stringify({ ...payload, padding: "x".repeat(1000) }), "test-size")))
        .status,
    ).toBe(400);
    expect(mocks.record).not.toHaveBeenCalled();
  });
  it("uses the existing short-lived per-isolate rate limit without persistent identifiers", async () => {
    for (let i = 0; i < 120; i++)
      expect((await POST(request(JSON.stringify(payload), "test-rate"))).status).toBe(200);
    expect((await POST(request(JSON.stringify(payload), "test-rate"))).status).toBe(429);
    expect(mocks.record).toHaveBeenCalledTimes(120);
  });
});

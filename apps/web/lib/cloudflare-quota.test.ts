import { describe, expect, it } from "vitest";
import { delayUntilNextCloudflareQuotaReset } from "./cloudflare-quota";

describe("delayUntilNextCloudflareQuotaReset", () => {
  it("defers until five minutes after the next 00:00 UTC reset", () => {
    const now = new Date("2026-07-30T22:15:00.000Z");
    const delayMs = delayUntilNextCloudflareQuotaReset(now);

    expect(new Date(now.getTime() + delayMs).toISOString()).toBe("2026-07-31T00:05:00.000Z");
  });
});

import { describe, expect, it } from "vitest";
import { FixedWindowRateLimiter, clientKeyFromHeaders } from "./rate-limit";

describe("FixedWindowRateLimiter", () => {
  it("allows requests up to the limit and rejects above it", () => {
    const now = 0;
    const limiter = new FixedWindowRateLimiter({ windowMs: 1000, maxRequests: 3, now: () => now });
    expect(limiter.allow("a")).toBe(true);
    expect(limiter.allow("a")).toBe(true);
    expect(limiter.allow("a")).toBe(true);
    expect(limiter.allow("a")).toBe(false);
  });

  it("resets the counter when the window rolls over", () => {
    let now = 0;
    const limiter = new FixedWindowRateLimiter({ windowMs: 1000, maxRequests: 1, now: () => now });
    expect(limiter.allow("a")).toBe(true);
    expect(limiter.allow("a")).toBe(false);
    now = 1001;
    expect(limiter.allow("a")).toBe(true);
  });

  it("tracks keys independently", () => {
    const limiter = new FixedWindowRateLimiter({ windowMs: 1000, maxRequests: 1, now: () => 0 });
    expect(limiter.allow("a")).toBe(true);
    expect(limiter.allow("b")).toBe(true);
    expect(limiter.allow("a")).toBe(false);
  });
});

describe("clientKeyFromHeaders", () => {
  it("prefers the first x-forwarded-for entry", () => {
    const headers = new Headers({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" });
    expect(clientKeyFromHeaders(headers)).toBe("1.2.3.4");
  });

  it("falls back to x-real-ip, then to a shared bucket", () => {
    expect(clientKeyFromHeaders(new Headers({ "x-real-ip": "5.6.7.8" }))).toBe("5.6.7.8");
    expect(clientKeyFromHeaders(new Headers())).toBe("unknown");
  });
});

import { describe, expect, it } from "vitest";
import { formatDateBucket } from "./date-bucket.js";

describe("formatDateBucket", () => {
  it("formats a Date as YYYY-MM-DD in UTC", () => {
    expect(formatDateBucket(new Date("2026-07-27T17:42:00Z"))).toBe("2026-07-27");
  });

  it("buckets two timestamps on the same UTC day identically", () => {
    const a = formatDateBucket(new Date("2026-07-27T00:05:00Z"));
    const b = formatDateBucket(new Date("2026-07-27T23:55:00Z"));
    expect(a).toBe(b);
  });

  it("buckets timestamps on different days differently", () => {
    const a = formatDateBucket(new Date("2026-07-27T23:00:00Z"));
    const b = formatDateBucket(new Date("2026-07-28T01:00:00Z"));
    expect(a).not.toBe(b);
  });
});

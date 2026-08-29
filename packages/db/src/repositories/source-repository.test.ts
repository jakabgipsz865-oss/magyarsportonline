import { describe, expect, it } from "vitest";
import { isSourceDue } from "./source-repository";

const now = new Date("2026-08-29T12:00:00.000Z");
const source = (
  overrides: Partial<Parameters<typeof isSourceDue>[0]> = {},
): Parameters<typeof isSourceDue>[0] => ({
  isActive: true,
  lastFetchedAt: null,
  pollingFrequencyMinutes: 2,
  ...overrides,
});

describe("isSourceDue", () => {
  it("excludes inactive sources", () => {
    expect(isSourceDue(source({ isActive: false }), now)).toBe(false);
  });

  it("includes sources never fetched", () => {
    expect(isSourceDue(source(), now)).toBe(true);
  });

  it("waits for a two-minute source's interval", () => {
    expect(isSourceDue(source({ lastFetchedAt: new Date("2026-08-29T11:59:00Z") }), now)).toBe(false);
    expect(isSourceDue(source({ lastFetchedAt: new Date("2026-08-29T11:57:59Z") }), now)).toBe(true);
  });

  it("respects a five-minute source's own interval", () => {
    expect(
      isSourceDue(
        source({ pollingFrequencyMinutes: 5, lastFetchedAt: new Date("2026-08-29T11:56:00Z") }),
        now,
      ),
    ).toBe(false);
    expect(
      isSourceDue(
        source({ pollingFrequencyMinutes: 5, lastFetchedAt: new Date("2026-08-29T11:55:00Z") }),
        now,
      ),
    ).toBe(true);
  });

  it("keeps null polling frequency backward-compatible", () => {
    expect(
      isSourceDue(
        source({ pollingFrequencyMinutes: null, lastFetchedAt: new Date("2026-08-29T11:59:59Z") }),
        now,
      ),
    ).toBe(true);
  });
});

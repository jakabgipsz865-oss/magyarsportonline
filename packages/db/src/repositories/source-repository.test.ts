import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import { SourceRepository, isSourceDue } from "./source-repository";

const now = new Date("2026-08-29T12:00:00.000Z");
const source = (
  overrides: Partial<Parameters<typeof isSourceDue>[0]> = {},
): Parameters<typeof isSourceDue>[0] => ({
  isActive: true,
  lastFetchedAt: null,
  pollingFrequencyMinutes: 2,
  ...overrides,
});

describe("SourceRepository watermarks", () => {
  it("advances ingest watermark monotonically in PostgreSQL", async () => {
    let values: Record<string, unknown> = {};
    const where = vi.fn(async () => undefined);
    const set = vi.fn((next: Record<string, unknown>) => {
      values = next;
      return { where };
    });
    const repository = new SourceRepository({ update: vi.fn(() => ({ set })) } as never);
    const watermark = new Date("2026-08-30T10:02:00.000Z");

    await repository.advanceIngestWatermark("source-id", watermark);

    const query = new PgDialect().sqlToQuery(values["ingestWatermarkAt"] as never);
    expect(query.sql).toContain("GREATEST(COALESCE(");
    expect(query.sql).toContain("::timestamptz");
    expect(query.params).toEqual([watermark.toISOString(), watermark.toISOString()]);
  });

  it("keeps lastSuccessAt equal to the successful fetch time", async () => {
    let values: Record<string, unknown> = {};
    const set = vi.fn((next: Record<string, unknown>) => {
      values = next;
      return { where: vi.fn(async () => undefined) };
    });
    const repository = new SourceRepository({ update: vi.fn(() => ({ set })) } as never);
    const fetchedAt = new Date("2026-08-30T10:03:00.000Z");

    await repository.recordFetchResult("source-id", { status: "ok", fetchedAt });

    expect(values).toMatchObject({ lastFetchedAt: fetchedAt, lastSuccessAt: fetchedAt });
  });
});

describe("isSourceDue", () => {
  it("excludes inactive sources", () => {
    expect(isSourceDue(source({ isActive: false }), now)).toBe(false);
  });

  it("includes sources never fetched", () => {
    expect(isSourceDue(source(), now)).toBe(true);
  });

  it("waits for a two-minute source's interval", () => {
    expect(isSourceDue(source({ lastFetchedAt: new Date("2026-08-29T11:59:00Z") }), now)).toBe(
      false,
    );
    expect(isSourceDue(source({ lastFetchedAt: new Date("2026-08-29T11:57:59Z") }), now)).toBe(
      true,
    );
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

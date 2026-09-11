import { describe, expect, it, vi } from "vitest";
import { preflightWindow, tabloidSourcePreflight } from "./tabloid-preflight";
import type { sourceIngest } from "@magyarsportonline/agents";
const fetchFeed = vi.hoisted(() => vi.fn());
vi.mock("@magyarsportonline/agents", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@magyarsportonline/agents")>();
  return {
    ...actual,
    sourceIngest: {
      ...actual.sourceIngest,
      RssSourceAdapter: class {
        fetch = fetchFeed;
      },
    },
  };
});
const article = (date: Date | null): sourceIngest.NormalizedArticle => ({
  sourceUrl: "https://publisher.test/a",
  titleOriginal: "Messi and his wife",
  bodyOriginal: "Personal life",
  publishedAtSource: date,
  imageUrl: null,
  subtitleOriginal: null,
  authorOriginal: null,
  contentOrigin: "rss_snippet",
});
describe("RSS validity is independent of 48-hour freshness", () => {
  it("keeps old and undated items available in a bounded quality sample", () => {
    const now = new Date("2026-09-11T00:00:00Z");
    const result = preflightWindow([article(new Date("2026-09-01")), article(null)], now);
    expect(result.current).toHaveLength(0);
    expect(result.quality).toHaveLength(2);
    expect(result.items30d).toBe(1);
  });
  it("sorts and caps the quality sample at 100 without mixing up fresh counts", () => {
    const now = new Date("2026-09-11T00:00:00Z");
    const result = preflightWindow(
      Array.from({ length: 150 }, (_, i) => article(new Date(now.getTime() - i * 3600_000))),
      now,
    );
    expect(result.quality).toHaveLength(100);
    expect(result.current).toHaveLength(49);
    expect(result.quality[0]?.publishedAtSource).toEqual(now);
  });
  it("reports a valid empty feed as RSS_VALID true and FRESH_48H false", async () => {
    fetchFeed.mockResolvedValue([]);
    const result = await tabloidSourcePreflight("it");
    expect(result.rows.every((row) => row.RSS_VALID && !row.FRESH_48H)).toBe(true);
    expect(result.llmCalls).toBe(0);
    expect(result.images).toEqual([]);
  });
  it("reports malformed/blocked feeds as RSS_VALID false", async () => {
    fetchFeed.mockRejectedValue(new Error("Status code 403"));
    const result = await tabloidSourcePreflight("it");
    expect(result.rows.every((row) => !row.RSS_VALID && !row.eligible)).toBe(true);
  });
});

it("marks a timed-out request UNVERIFIED, not invalid RSS", async () => {
  fetchFeed.mockRejectedValue(new Error("Request timed out after 8000ms"));
  const result = await tabloidSourcePreflight("es");
  expect(
    result.rows.every(
      (row) =>
        row.RSS_STATUS === "TIMEOUT/UNVERIFIED" && row.RSS_VALID === null && row.FRESH_48H === null,
    ),
  ).toBe(true);
});

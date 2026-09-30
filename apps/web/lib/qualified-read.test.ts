import { describe, expect, it } from "vitest";
import {
  classifyReadSource,
  ensureQualifiedEvent,
  loadQualifiedEvent,
  QualifiedReadGate,
} from "./qualified-read";

describe("qualified-read gate", () => {
  it("does not count a two-second opening or hidden time", () => {
    const gate = new QualifiedReadGate(0, true);
    expect(gate.checkTime(2_000)).toBe(false);
    gate.setVisible(2_000, false);
    expect(gate.checkTime(60_000)).toBe(false);
    gate.setVisible(60_000, true);
    expect(gate.checkTime(67_999)).toBe(false);
    expect(gate.checkTime(68_000)).toBe(true);
    expect(gate.checkTime(69_000)).toBe(false);
  });

  it("qualifies a visible 25% user scroll once", () => {
    const gate = new QualifiedReadGate(0, true);
    expect(gate.checkScroll(0.249)).toBe(false);
    expect(gate.checkScroll(0.25)).toBe(true);
    expect(gate.checkScroll(0.5)).toBe(false);
    expect(gate.checkTime(20_000)).toBe(false);
  });

  it("does not qualify scrolling while hidden", () => {
    const gate = new QualifiedReadGate(0, true);
    gate.setVisible(100, false);
    expect(gate.checkScroll(0.8)).toBe(false);
  });
});

describe("session deduplication and attribution", () => {
  it("reuses one event ID per article in one browser session", () => {
    const values = new Map<string, string>();
    const store = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    };
    const first = ensureQualifiedEvent(store, "story-1", "latest", () => "first-id");
    const retry = ensureQualifiedEvent(store, "story-1", "top5", () => "second-id");
    expect(retry).toEqual(first);
    expect(loadQualifiedEvent(store, "story-1")?.eventId).toBe("first-id");
    expect(ensureQualifiedEvent(store, "story-2", "latest", () => "other-id").eventId).toBe(
      "other-id",
    );
  });

  it("separates own promotion, social, search, RSS, internal and direct sources", () => {
    expect(classifyReadSource("https://mso24.hu/", "trending_hero")).toBe("trending_hero");
    expect(classifyReadSource("https://l.facebook.com/", null)).toBe("social");
    expect(classifyReadSource("https://www.google.com/", null)).toBe("search");
    expect(classifyReadSource("https://feedly.com/", null)).toBe("rss");
    expect(classifyReadSource("https://mso24.hu/hir/other", null)).toBe("internal");
    expect(classifyReadSource("", null)).toBe("direct");
  });
});

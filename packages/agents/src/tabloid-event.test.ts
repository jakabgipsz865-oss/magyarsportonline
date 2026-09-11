import { describe, expect, it } from "vitest";
import { memoryEvents } from "./tabloid-event-test-helper";
import {
  resolveTabloidEvent,
  describeTabloidEvent,
  EVENT_WINDOW_MS,
  type EventArticle,
} from "./tabloid-event";
import fixtures from "./tabloid-event-preview-fixtures.json";

let sequence = 0;
function article(title: string, hours = 0, content = ""): EventArticle {
  const id = String(++sequence);
  return {
    id,
    sourceId: `source-${id}`,
    title,
    content,
    sourceUrl: `https://publisher.test/${id}`,
    publishedAt: new Date(Date.parse("2026-09-11T00:00:00Z") + hours * 3600_000),
    ingestedAt: new Date("2026-09-11"),
  };
}
export const negativePairs = [
  ["Cristiano Ronaldo wedding with Georgina", "Cristiano Ronaldo diet interview"],
  ["Cristiano Ronaldo wedding with Georgina", "Cristiano Ronaldo luxury cars"],
  ["Cristiano Ronaldo diet interview", "Cristiano Ronaldo luxury cars"],
  ["Cristiano Ronaldo wedding with Georgina", "Cristiano Ronaldo wedding with Irina"],
  ["Cristiano Ronaldo holiday in Ibiza", "Cristiano Ronaldo holiday in Dubai"],
  ["Donnarumma and girlfriend robbery in Paris", "Donnarumma and girlfriend robbery in Madrid"],
  ["Donnarumma and girlfriend robbery 2026-09-01", "Donnarumma and girlfriend robbery 2026-09-10"],
  ["Sorba Thomas car crash", "Sorba Thomas nightclub party"],
  ["Edson Alvarez denies kidnapping allegations", "Edson Alvarez car crash"],
  ["David Beckham baby with Victoria", "David Beckham divorce with Victoria"],
  ["Arsenal party in London", "Arsenal car crash"],
  ["Donnarumma robbery", "Donnarumma and girlfriend robbery"],
];
describe("tabloid event identity", () => {
  it.each([...new Set(fixtures.map((f) => f.event))])(
    "actual Preview variants: %s => one canonical",
    async (event) => {
      const repo = memoryEvents();
      const rows = fixtures.filter((f) => f.event === event);
      const result = await Promise.all(
        rows.map((f) =>
          resolveTabloidEvent(
            { ...f, publishedAt: new Date(f.publishedAt), ingestedAt: new Date("2026-09-11") },
            repo,
          ),
        ),
      );
      expect(result.every((r) => r.event !== null)).toBe(true);
      expect(new Set(result.map((r) => r.fingerprint)).size).toBe(1);
      expect(result.filter((r) => r.merged).length).toBe(rows.length - 1);
    },
  );
  it.each(negativePairs)("different events: %s / %s", async (a, b) => {
    const repo = memoryEvents();
    const first = await resolveTabloidEvent(article(a), repo);
    const second = await resolveTabloidEvent(article(b), repo);
    expect(first.event).not.toBeNull();
    expect(second.event).not.toBeNull();
    expect(first.fingerprint).not.toBe(second.fingerprint);
  });
  it("cross-language robbery EN/ES/IT/DE uses the same canonical", async () => {
    const repo = memoryEvents();
    const titles = [
      "Donnarumma and girlfriend robbery",
      "Robo a Donnarumma y su novia",
      "Rapina a Donnarumma e moglie",
      "Überfall auf Donnarumma und seine Frau",
    ];
    const result = await Promise.all(titles.map((t) => resolveTabloidEvent(article(t), repo)));
    expect(new Set(result.map((r) => r.fingerprint)).size).toBe(1);
  });
  it("cross-language allegations and car accidents", async () => {
    for (const titles of [
      [
        "Edson Alvarez denies kidnapping allegations",
        "Edson Álvarez: acusaciones de secuestro",
        "Edson Alvarez: Entführung Vorwürfe",
      ],
      [
        "Sorba Thomas car crash",
        "Sorba Thomas: accidente de trafico en coche",
        "Sorba Thomas: incidente stradale in auto",
        "Sorba Thomas: Autounfall mit Auto",
      ],
    ]) {
      const repo = memoryEvents();
      const result = await Promise.all(titles.map((t) => resolveTabloidEvent(article(t), repo)));
      expect(new Set(result.map((r) => r.fingerprint)).size).toBe(1);
    }
  });
  it("separates a new event outside the 48-hour span and does not chain", async () => {
    const repo = memoryEvents();
    const title = "Sorba Thomas car crash";
    const result = [];
    for (const h of [0, 40, 70]) result.push(await resolveTabloidEvent(article(title, h), repo));
    expect(result[0]!.fingerprint).toBe(result[1]!.fingerprint);
    expect(result[2]!.fingerprint).not.toBe(result[0]!.fingerprint);
    expect(EVENT_WINDOW_MS).toBe(48 * 3600_000);
  });
  it("out-of-order timestamps match across midnight but outside span do not", async () => {
    const repo = memoryEvents();
    const a = await resolveTabloidEvent(article("Sorba Thomas car crash", 24), repo);
    const b = await resolveTabloidEvent(article("Sorba Thomas car crash", -24), repo);
    const c = await resolveTabloidEvent(article("Sorba Thomas car crash", -24.001), repo);
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.fingerprint).not.toBe(c.fingerprint);
  });
  it("missing evidence cannot bridge two known locations; retries stay stable", async () => {
    const repo = memoryEvents();
    await resolveTabloidEvent(article("Donnarumma robbery in Paris"), repo);
    await resolveTabloidEvent(article("Donnarumma robbery in Madrid"), repo);
    const ambiguous = article("Donnarumma robbery");
    const a = await resolveTabloidEvent(ambiguous, repo);
    const b = await resolveTabloidEvent(ambiguous, repo);
    expect(a.merged).toBe(false);
    expect(b.fingerprint).toBe(a.fingerprint);
    expect(new Set([...repo.events.values()].map((e) => e.fingerprint)).size).toBe(3);
  });
  it("unknown entities, ambiguous event types and repeated incidents stay separate", async () => {
    for (const title of [
      "A footballer robbery",
      "Donnarumma wedding and divorce",
      "Donnarumma suffers another robbery",
    ]) {
      const repo = memoryEvents();
      expect(describeTabloidEvent(article(title))).toBeNull();
      const a = await resolveTabloidEvent(article(title), repo);
      const b = await resolveTabloidEvent(article(title), repo);
      expect(a.fingerprint).not.toBe(b.fingerprint);
    }
  });
});

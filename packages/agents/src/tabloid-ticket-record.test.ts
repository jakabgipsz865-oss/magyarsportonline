import { expect, it, describe } from "vitest";
import { memoryEvents } from "./tabloid-event-test-helper";
import { resolveTabloidEvent } from "./tabloid-event";
import { isFootballTabloid } from "./tabloid";
import tickets from "./tabloid-ticket-preview-fixtures.json";

describe("ticket enforcement and competition records", () => {
  it("actual Preview Sun/Star ticket case => 1 event", async () => {
    const repo = memoryEvents();
    const out = [];
    for (const row of tickets)
      out.push(
        await resolveTabloidEvent(
          { ...row, publishedAt: new Date(row.publishedAt!), ingestedAt: new Date(row.ingestedAt) },
          repo,
        ),
      );
    expect(out.every((x) => x.event?.eventType === "ticket-enforcement")).toBe(true);
    expect(new Set(out.map((x) => x.fingerprint)).size).toBe(1);
  });
  it("general rule works for another club, separates sanction counts and rejects ticket sales", async () => {
    const repo = memoryEvents();
    const base = {
      sourceId: "source",
      content: "",
      sourceUrl: "https://example.test/a",
      publishedAt: new Date("2026-09-11"),
      ingestedAt: new Date("2026-09-11"),
    };
    const titles = [
      "Arsenal revoke 200 season tickets in touting crackdown",
      "Arsenal remove 200 season tickets after investigation",
      "Arsenal revoke 300 season tickets in touting crackdown",
      "Arsenal 200 season tickets available for sale",
    ];
    const out = [];
    for (const [i, title] of titles.entries())
      out.push(await resolveTabloidEvent({ ...base, id: String(i), title }, repo));
    expect(out[0]!.fingerprint).toBe(out[1]!.fingerprint);
    expect(out[0]!.fingerprint).not.toBe(out[2]!.fingerprint);
    expect(out[3]!.event).toBeNull();
  });
  it.each(["DIRECT_GOSSIP", "BROAD_TABLOID_FOOTBALL"] as const)(
    "actual Preview Arsenal record is REJECT: %s",
    (mode) => {
      expect(
        isFootballTabloid(
          "Best starts to the season EVER as Arsenal look to smash Chelsea’s 21-year-old record and continue incredible winning run",
          "ARSENAL have enjoyed a flying start in their bid to win their first ever back-to-back Premier league titles. The Gunners finally broke their duck last season by winning their first Prem trophy since the Invincibles' 2004 triumph. And the North Londoners have won all three of their opening matches this term in the English top...",
          true,
          mode,
        ),
      ).toBe(false);
    },
  );
  it.each([
    "Arsenal shock fans with record-breaking season",
    "Ronaldo celebrates his 900th goal milestone",
    "Real Madrid bate record de goles esta temporada",
    "Juventus: record di gol in stagione",
    "Bayern: Torrekord und Siegesserie",
  ])("general sports milestone remains REJECT: %s", (title) =>
    expect(isFootballTabloid(title, "", true, "DIRECT_GOSSIP")).toBe(false),
  );
  it("off-field story about a record-holder stays eligible", () => {
    expect(
      isFootballTabloid(
        "Ronaldo's wedding photos: record goalscorer celebrates with family",
        "The footballer is enjoying his private life.",
        true,
        "BROAD_TABLOID_FOOTBALL",
      ),
    ).toBe(true);
    expect(
      isFootballTabloid(
        "Calciatore svela il nuovo look per la sfilata",
        "Moda e vita privata",
        true,
        "DIRECT_GOSSIP",
      ),
    ).toBe(true);
  });
});

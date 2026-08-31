import { describe, expect, it } from "vitest";
import { selectPremierLeagueMatches } from "./premier-league-fixtures";

function fixture(overrides: Record<string, unknown> = {}) {
  return {
    fixture: {
      id: 1,
      date: "2026-08-30T17:30:00+02:00",
      status: { long: "Not Started", short: "NS", elapsed: null },
      ...overrides,
    },
    teams: { home: { name: "Arsenal" }, away: { name: "Liverpool" } },
    goals: { home: null, away: null },
  };
}

describe("selectPremierLeagueMatches", () => {
  it("shows today's matches and sorts live matches first", () => {
    const panel = selectPremierLeagueMatches(
      {
        response: [
          fixture(),
          fixture({
            id: 2,
            date: "2026-08-30T15:00:00+02:00",
            status: { long: "Second Half", short: "2H", elapsed: 67 },
          }),
        ],
      },
      new Date("2026-08-30T12:00:00.000Z"),
    );
    expect(panel.title).toBe("Mai Premier League-meccsek");
    expect(panel.matches.map((match) => match.id)).toEqual([2, 1]);
    expect(panel.matches[0]?.isLive).toBe(true);
  });

  it("falls back to the next fixtures when there is no match today", () => {
    const panel = selectPremierLeagueMatches(
      { response: [fixture({ date: "2026-09-01T17:30:00+02:00" })] },
      new Date("2026-08-30T12:00:00.000Z"),
    );
    expect(panel.title).toBe("Következő Premier League-meccsek");
    expect(panel.matches).toHaveLength(1);
  });

  it("fails closed instead of treating an API error as an empty fixture list", () => {
    expect(() =>
      selectPremierLeagueMatches({ errors: { plan: "Current season unavailable" }, response: [] }),
    ).toThrow("Current season unavailable");
  });
});

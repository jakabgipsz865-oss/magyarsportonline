import { describe, expect, it } from "vitest";
import { inferSportFromUrl } from "./sport";

describe("inferSportFromUrl", () => {
  it("infers the sport vertical from a Sky Sports URL's first path segment", () => {
    expect(
      inferSportFromUrl(
        "https://www.skysports.com/darts/news/12040/13567883/darts-players-championship-25",
      ),
    ).toBe("darts");
    expect(inferSportFromUrl("https://www.skysports.com/golf/news/1/2/solheim-cup")).toBe("golf");
    expect(inferSportFromUrl("https://www.skysports.com/football/news/1/2/x")).toBe("football");
  });

  it("infers the sport vertical from a BBC Sport URL's segment after /sport/", () => {
    expect(inferSportFromUrl("https://www.bbc.co.uk/sport/football/articles/c5ydrlg3rjpo")).toBe(
      "football",
    );
    expect(inferSportFromUrl("https://www.bbc.co.uk/sport/darts/articles/abc123")).toBe("darts");
  });

  it("returns null for a generic BBC page with no distinct sport segment", () => {
    expect(inferSportFromUrl("https://www.bbc.co.uk/sport/articles/c5ydrlg3rjpo")).toBeNull();
    expect(inferSportFromUrl("https://www.bbc.co.uk/sport/live/abc")).toBeNull();
  });

  it("returns null for an unrecognized domain rather than guessing", () => {
    expect(inferSportFromUrl("https://example.com/football/news/1")).toBeNull();
  });

  it("returns null for a malformed URL instead of throwing", () => {
    expect(inferSportFromUrl("not a url")).toBeNull();
  });
});

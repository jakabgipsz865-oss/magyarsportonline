import { describe, expect, it } from "vitest";
import { cleanStartSources } from "./seed";

const structuredDomains = [
  "talksport.com",
  "dailymail.co.uk",
  "mirror.co.uk",
  "thesun.co.uk",
  "dailystar.co.uk",
  "express.co.uk",
  "caughtoffside.com",
  "football365.com",
  "goal.com",
];

describe("clean-start source seed", () => {
  it("contains exactly the 12 canonical, inactive sources", () => {
    expect(cleanStartSources).toHaveLength(12);
    expect(cleanStartSources.every((source) => source.isActive === false)).toBe(true);
    expect(new Set(cleanStartSources.map((source) => source.name)).size).toBe(12);
  });

  it("contains exactly one BBC and one Sky source with their dedicated extractors", () => {
    const bbc = cleanStartSources.filter((source) => source.extractorName === "bbc-sport");
    const sky = cleanStartSources.filter((source) => source.extractorName === "sky-sports");
    expect(bbc).toHaveLength(1);
    expect(bbc[0]?.name).toBe("BBC Sport - Premier League");
    expect(sky).toHaveLength(1);
    expect(sky[0]?.name).toBe("Sky Sports - Football");
  });

  it("maps allowlisted domains to the structured extractor and leaves Guardian on hold", () => {
    for (const domain of structuredDomains) {
      const source = cleanStartSources.find(({ baseUrl }) =>
        new URL(baseUrl).hostname.endsWith(domain),
      );
      expect(source?.extractorName, domain).toBe("structured-news-article");
    }
    expect(
      cleanStartSources.find((source) => source.name === "The Guardian - Football")?.extractorName,
    ).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import {
  type EditorialCorrection,
  correctionsToForbiddenLiteralTranslations,
  correctionsToLexiconEntries,
  correctionsToRecommendedPhrasings,
  findMatchingForbiddenTranslations,
  formatForbiddenTranslationsBlock,
  formatPromptExamplesBlock,
  formatRecommendedPhrasingsBlock,
} from "./editorial-corrections";

function correction(overrides: Partial<EditorialCorrection> = {}): EditorialCorrection {
  return {
    id: "correction-1",
    category: "terminology",
    termEn: "super-sub",
    originalSentenceEn: "He is a real super-sub for this team.",
    currentSentenceHu: "szuper csere",
    correctedSentenceHu: "ütőkártya a cserepadról",
    note: "bevált csereember",
    ...overrides,
  };
}

describe("correctionsToLexiconEntries", () => {
  it("converts a slang/terminology correction into a learned lexicon entry", () => {
    const entries = correctionsToLexiconEntries([correction()]);
    expect(entries).toEqual([
      {
        category: "learned",
        en: "super-sub",
        meaningHu: "bevált csereember",
        naturalHu: "ütőkártya a cserepadról",
        avoidLiteralHu: "szuper csere",
        exampleEn: "He is a real super-sub for this team.",
        exampleHu: "ütőkártya a cserepadról",
      },
    ]);
  });

  it("falls back to the original sentence when termEn is missing", () => {
    const entries = correctionsToLexiconEntries([correction({ termEn: null })]);
    expect(entries[0]?.en).toBe("He is a real super-sub for this team.");
  });

  it("ignores corrections outside the slang/terminology categories", () => {
    const entries = correctionsToLexiconEntries([correction({ category: "style" })]);
    expect(entries).toEqual([]);
  });
});

describe("correctionsToForbiddenLiteralTranslations", () => {
  it("keeps only literal_translation corrections", () => {
    const items = correctionsToForbiddenLiteralTranslations([
      correction({ category: "literal_translation" }),
      correction({ category: "grammar" }),
    ]);
    expect(items).toEqual([
      {
        avoidHu: "szuper csere",
        useInsteadHu: "ütőkártya a cserepadról",
        contextEn: "He is a real super-sub for this team.",
      },
    ]);
  });
});

describe("findMatchingForbiddenTranslations", () => {
  it("returns only entries whose avoidHu text actually appears in the given Hungarian text", () => {
    const forbidden = [
      { avoidHu: "gólos drámában", useInsteadHu: "izgalmas meccsen", contextEn: "" },
      { avoidHu: "sosem használt kifejezés", useInsteadHu: "más", contextEn: "" },
    ];
    const matches = findMatchingForbiddenTranslations(
      "A csapat gólos drámában nyert idegenben.",
      forbidden,
    );
    expect(matches).toEqual([forbidden[0]]);
  });

  it("is case-insensitive", () => {
    const forbidden = [
      { avoidHu: "Gólos Drámában", useInsteadHu: "izgalmas meccsen", contextEn: "" },
    ];
    const matches = findMatchingForbiddenTranslations("gólos drámában nyert", forbidden);
    expect(matches).toHaveLength(1);
  });

  it("respects the limit parameter", () => {
    const forbidden = [
      { avoidHu: "a", useInsteadHu: "1", contextEn: "" },
      { avoidHu: "b", useInsteadHu: "2", contextEn: "" },
      { avoidHu: "c", useInsteadHu: "3", contextEn: "" },
    ];
    const matches = findMatchingForbiddenTranslations("a b c", forbidden, 2);
    expect(matches).toHaveLength(2);
  });
});

describe("formatForbiddenTranslationsBlock", () => {
  it("returns an empty string for no items", () => {
    expect(formatForbiddenTranslationsBlock([])).toBe("");
  });

  it("formats items with a NE/HELYETTE pattern", () => {
    const block = formatForbiddenTranslationsBlock([
      { avoidHu: "gólos drámában", useInsteadHu: "izgalmas meccsen", contextEn: "" },
    ]);
    expect(block).toContain("TILTOTT TÜKÖRFORDÍTÁSOK");
    expect(block).toContain("gólos drámában");
    expect(block).toContain("izgalmas meccsen");
  });
});

describe("correctionsToRecommendedPhrasings", () => {
  it("keeps only style/grammar corrections", () => {
    const items = correctionsToRecommendedPhrasings([
      correction({ category: "style" }),
      correction({ category: "grammar" }),
      correction({ category: "fact" }),
    ]);
    expect(items).toEqual([
      { beforeHu: "szuper csere", afterHu: "ütőkártya a cserepadról" },
      { beforeHu: "szuper csere", afterHu: "ütőkártya a cserepadról" },
    ]);
  });
});

describe("formatRecommendedPhrasingsBlock", () => {
  it("returns an empty string for no items", () => {
    expect(formatRecommendedPhrasingsBlock([])).toBe("");
  });

  it("formats a before/after phrasing pair", () => {
    const block = formatRecommendedPhrasingsBlock([
      { beforeHu: "A menedzser", afterHu: "A vezetőedző" },
    ]);
    expect(block).toContain("AJÁNLOTT MAGYAR SPORTÚJSÁGÍRÓI MEGFOGALMAZÁSOK");
    expect(block).toContain("A menedzser");
    expect(block).toContain("A vezetőedző");
  });

  it("respects the limit parameter", () => {
    const items = Array.from({ length: 15 }, (_, i) => ({
      beforeHu: `before-${i}`,
      afterHu: `after-${i}`,
    }));
    const block = formatRecommendedPhrasingsBlock(items, 3);
    expect(block).toContain("before-0");
    expect(block).not.toContain("before-3");
  });
});

describe("formatPromptExamplesBlock", () => {
  it("returns an empty string for no corrections", () => {
    expect(formatPromptExamplesBlock([])).toBe("");
  });

  it("includes every category, labelled in Hungarian", () => {
    const block = formatPromptExamplesBlock([correction({ category: "slang" })]);
    expect(block).toContain("PROMPT PÉLDATÁR");
    expect(block).toContain("[szleng]");
    expect(block).toContain("szuper csere");
    expect(block).toContain("ütőkártya a cserepadról");
  });

  it("respects the limit parameter, keeping the most recent (first) entries", () => {
    const corrections = Array.from({ length: 15 }, (_, i) =>
      correction({ currentSentenceHu: `current-${i}`, correctedSentenceHu: `fixed-${i}` }),
    );
    const block = formatPromptExamplesBlock(corrections, 3);
    expect(block).toContain("current-0");
    expect(block).not.toContain("current-3");
  });
});

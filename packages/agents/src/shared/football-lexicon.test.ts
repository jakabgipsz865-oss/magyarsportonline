import { describe, expect, it } from "vitest";
import {
  FOOTBALL_LEXICON,
  applyLexiconSuggestion,
  findLexiconMatchesInHungarianText,
  findRelevantLexiconEntries,
  formatLexiconBlock,
} from "./football-lexicon";

describe("FOOTBALL_LEXICON", () => {
  it("has at least 300 entries", () => {
    expect(FOOTBALL_LEXICON.length).toBeGreaterThanOrEqual(300);
  });

  it("has no duplicate English terms", () => {
    const terms = FOOTBALL_LEXICON.map((e) => e.en.toLowerCase());
    expect(new Set(terms).size).toBe(terms.length);
  });

  it("every entry has all six required fields populated", () => {
    for (const entry of FOOTBALL_LEXICON) {
      expect(entry.en.length).toBeGreaterThan(0);
      expect(entry.meaningHu.length).toBeGreaterThan(0);
      expect(entry.naturalHu.length).toBeGreaterThan(0);
      expect(entry.avoidLiteralHu.length).toBeGreaterThan(0);
      expect(entry.exampleEn.length).toBeGreaterThan(0);
      expect(entry.exampleHu.length).toBeGreaterThan(0);
    }
  });

  it("covers all six required categories with a meaningful count each", () => {
    const counts = new Map<string, number>();
    for (const entry of FOOTBALL_LEXICON) {
      counts.set(entry.category, (counts.get(entry.category) ?? 0) + 1);
    }
    for (const category of [
      "transfer",
      "match_report",
      "tactics",
      "injury_squad",
      "quotes",
      "slang_idiom",
    ]) {
      expect(counts.get(category) ?? 0).toBeGreaterThanOrEqual(20);
    }
  });

  it("contains the reviewed Hungarian terminology corrections and missing core terms", () => {
    const byEnglishTerm = new Map(FOOTBALL_LEXICON.map((entry) => [entry.en, entry]));

    expect(byEnglishTerm.get("through ball")).toMatchObject({
      naturalHu: "kiugrató passz / mélységi passz",
      avoidLiteralHu: "bedobó labda",
    });
    expect(byEnglishTerm.get("Golden Boot")).toMatchObject({
      naturalHu: "Aranycipő",
      avoidLiteralHu: "Aranycsizma",
    });
    expect(byEnglishTerm.get("snatch a point")?.naturalHu).not.toBe(
      byEnglishTerm.get("rescue a point")?.naturalHu,
    );

    for (const term of [
      "red card",
      "yellow card",
      "second yellow card",
      "penalty",
      "free kick",
      "handball",
      "offside",
      "assist",
      "captain",
      "substitution",
      "promotion",
      "control the game",
    ]) {
      expect(byEnglishTerm.has(term), `missing reviewed lexicon term: ${term}`).toBe(true);
    }
  });
});

describe("findRelevantLexiconEntries", () => {
  it("finds an entry whose English term appears as a whole word in the text", () => {
    const matches = findRelevantLexiconEntries("He signed on a free transfer this summer.");
    expect(matches.some((e) => e.en === "free transfer")).toBe(true);
  });

  it("does not match a term that only appears as a substring of another word", () => {
    const matches = findRelevantLexiconEntries("The transferral of documents was delayed.");
    expect(matches.some((e) => e.en === "transfer window")).toBe(false);
  });

  it("respects the limit parameter", () => {
    const matches = findRelevantLexiconEntries(
      "loan move medical undisclosed fee record fee release clause",
      2,
    );
    expect(matches.length).toBeLessThanOrEqual(2);
  });

  it("returns an empty array when nothing matches", () => {
    const matches = findRelevantLexiconEntries("A csendes délután semmi különöset nem hozott.");
    expect(matches).toEqual([]);
  });
});

describe("findLexiconMatchesInHungarianText", () => {
  it("finds a lexicon entry whose avoidLiteralHu phrase appears in the given Hungarian text", () => {
    const matches = findLexiconMatchesInHungarianText("A kapus tiszta lapot tartott a mérkőzésen.");
    expect(matches.some((entry) => entry.en === "clean sheet")).toBe(true);
  });

  it("is case-insensitive", () => {
    const matches = findLexiconMatchesInHungarianText("TISZTA LAPOT tartott a kapus.");
    expect(matches.some((entry) => entry.en === "clean sheet")).toBe(true);
  });

  it("returns an empty array when no known literal-translation phrase is present", () => {
    const matches = findLexiconMatchesInHungarianText("A csapat magabiztosan nyert idegenben.");
    expect(matches).toEqual([]);
  });

  it("sorts the longest (most specific) avoidLiteralHu match first", () => {
    const entries = [
      { ...FOOTBALL_LEXICON[0]!, avoidLiteralHu: "lap" },
      { ...FOOTBALL_LEXICON[0]!, avoidLiteralHu: "tiszta lap" },
    ];
    const matches = findLexiconMatchesInHungarianText("A kapus tiszta lapot tartott.", entries);
    expect(matches[0]?.avoidLiteralHu).toBe("tiszta lap");
  });
});

describe("applyLexiconSuggestion", () => {
  it("replaces a whole-word (non-inflected) occurrence with the natural Hungarian phrasing", () => {
    const entry = FOOTBALL_LEXICON.find((e) => e.en === "clean sheet");
    if (!entry) throw new Error("expected a 'clean sheet' lexicon entry");
    const result = applyLexiconSuggestion("Ismét tiszta lap volt a mérkőzés végén.", entry);
    expect(result).toContain(entry.naturalHu);
    expect(result).not.toContain("tiszta lap");
  });

  it("replaces every whole-word occurrence, case-insensitively", () => {
    const entry = FOOTBALL_LEXICON.find((e) => e.en === "clean sheet");
    if (!entry) throw new Error("expected a 'clean sheet' lexicon entry");
    const result = applyLexiconSuggestion("Tiszta lap. Megint TISZTA LAP.", entry);
    expect(result.toLowerCase()).not.toContain("tiszta lap");
  });

  it("returns the text unchanged when the avoid phrase does not appear", () => {
    const entry = FOOTBALL_LEXICON.find((e) => e.en === "clean sheet");
    if (!entry) throw new Error("expected a 'clean sheet' lexicon entry");
    const result = applyLexiconSuggestion("A csapat magabiztosan nyert.", entry);
    expect(result).toBe("A csapat magabiztosan nyert.");
  });

  it("does NOT splice into an inflected (suffixed) occurrence of the avoid phrase", () => {
    // Magyar toldalékolás: "tiszta lapOT" a "tiszta lap" ragozott alakja — egy
    // vak szövegcsere itt "...meccsetOT"-féle, összefércelt szót eredményezne
    // (ez volt a valódi hiba, amit egy Playwright e2e teszt buktatott le).
    const entry = FOOTBALL_LEXICON.find((e) => e.en === "clean sheet");
    if (!entry) throw new Error("expected a 'clean sheet' lexicon entry");
    const result = applyLexiconSuggestion("A kapus tiszta lapot tartott a mérkőzésen.", entry);
    expect(result).toBe("A kapus tiszta lapot tartott a mérkőzésen.");
  });
});

describe("formatLexiconBlock", () => {
  it("returns an empty string for no entries", () => {
    expect(formatLexiconBlock([])).toBe("");
  });

  it("formats entries into a compact, labelled block", () => {
    const [first] = FOOTBALL_LEXICON;
    if (!first) throw new Error("lexicon is empty");
    const block = formatLexiconBlock([first]);
    expect(block).toContain(first.en);
    expect(block).toContain(first.naturalHu);
    expect(block).toContain("FUTBALLNYELVI SZÓTÁR");
  });
});

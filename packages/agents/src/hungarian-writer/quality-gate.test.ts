import { describe, expect, it } from "vitest";
import { assessContentQuality } from "./quality-gate";

const FACTS = [
  {
    factType: "score",
    detailHu: "Anglia 6-4-re győzött Franciaország ellen a világbajnokság harmadik helyéért.",
    quoteOriginal: null,
    quoteSpeaker: null,
  },
];

describe("assessContentQuality", () => {
  it("passes natural, non-empty Hungarian content", () => {
    const result = assessContentQuality({
      titleHu: "Anglia nyerte a harmadik helyet a világbajnokságon",
      leadHu: "Az Anglia 6-4-re győzött Franciaország ellen egy izgalmas mérkőzésen.",
      bodyHu: "Az Anglia csapata megnyerte a harmadik helyért zajló mérkőzést Franciaország ellen.",
      facts: FACTS,
    });

    expect(result).toEqual({ passed: true, issues: [] });
  });

  it("flags an empty field", () => {
    const result = assessContentQuality({
      titleHu: "",
      leadHu: "Az Anglia 6-4-re győzött Franciaország ellen.",
      bodyHu: "Az Anglia csapata megnyerte a mérkőzést.",
      facts: FACTS,
    });

    expect(result.passed).toBe(false);
    expect(result.issues).toContainEqual({ field: "title", kind: "empty" });
  });

  it("flags a title that was never translated into Hungarian", () => {
    const result = assessContentQuality({
      titleHu: "England beat France in ten goal thriller for third place",
      leadHu: "Az Anglia 6-4-re győzött Franciaország ellen egy izgalmas mérkőzésen.",
      bodyHu: "Az Anglia csapata megnyerte a harmadik helyért zajló mérkőzést.",
      facts: FACTS,
    });

    expect(result.passed).toBe(false);
    expect(result.issues).toContainEqual({ field: "title", kind: "looks_english" });
  });

  it("does not flag short titles even without diacritics (proper-noun-heavy, ambiguous either way)", () => {
    const result = assessContentQuality({
      titleHu: "Mbappe gol",
      leadHu: "Az Anglia 6-4-re győzött Franciaország ellen egy izgalmas mérkőzésen.",
      bodyHu: "Az Anglia csapata megnyerte a harmadik helyért zajló mérkőzést.",
      facts: FACTS,
    });

    expect(result.passed).toBe(true);
  });

  it("flags content that is just a Fact's detail_hu copied verbatim", () => {
    const result = assessContentQuality({
      titleHu: "Anglia győzelme",
      leadHu: "Anglia 6-4-re győzött Franciaország ellen a világbajnokság harmadik helyéért.",
      bodyHu: "Az Anglia csapata megnyerte a harmadik helyért zajló mérkőzést Franciaország ellen.",
      facts: FACTS,
    });

    expect(result.passed).toBe(false);
    expect(result.issues).toContainEqual({ field: "lead", kind: "matches_source_verbatim" });
  });

  it("flags a body that repeats the same paragraph twice with a trailing sentence dropped", () => {
    const result = assessContentQuality({
      titleHu: "Anglia nyerte a harmadik helyet a világbajnokságon",
      leadHu:
        "Az Anglia 6-4-es győzelmet aratott Franciaország ellen Bukayo Saka mesterhármasával.",
      bodyHu:
        "Bukayo Saka szintén mesterhármast szerzett, 6-4-es meccsen győzött az Anglia Franciaország ellen. Az angol szövetségi kapitány dicsérte játékosait a győzelem után.\n\nBukayo Saka szintén mesterhármast szerzett, 6-4-es meccsen győzött az Anglia Franciaország ellen.",
      facts: FACTS,
    });

    expect(result.passed).toBe(false);
    expect(result.issues).toContainEqual({ field: "body", kind: "repeated_paragraph" });
  });

  it("does not flag two distinct body paragraphs covering different facts", () => {
    const result = assessContentQuality({
      titleHu: "Anglia nyerte a harmadik helyet a világbajnokságon",
      leadHu: "Az Anglia 6-4-re győzött Franciaország ellen egy izgalmas mérkőzésen.",
      bodyHu:
        "Az Anglia csapata megnyerte a harmadik helyért zajló mérkőzést Franciaország ellen.\n\nA szövetségi kapitány elmondta, hogy a csapat a jövő évi tornára készül a folytatásban.",
      facts: FACTS,
    });

    expect(result.passed).toBe(true);
  });

  it("flags a lead that is just restated verbatim as a body paragraph", () => {
    const result = assessContentQuality({
      titleHu: "Anglia nyerte a harmadik helyet a világbajnokságon",
      leadHu:
        "Az Anglia 6-4-es győzelmet aratott Franciaország ellen Bukayo Saka mesterhármasával.",
      bodyHu:
        "Az Anglia 6-4-es győzelmet aratott Franciaország ellen Bukayo Saka mesterhármasával.\n\nA szövetségi kapitány elmondta, hogy a csapat a jövő évi tornára készül.",
      facts: FACTS,
    });

    expect(result.passed).toBe(false);
    expect(result.issues).toContainEqual({ field: "lead", kind: "duplicates_body" });
  });

  it("catches an English fact-extraction fallback passthrough copied into the body", () => {
    const englishPassthroughFacts = [
      {
        factType: "other",
        detailHu: "England beat France in 10-goal thriller\n\nEngland won the match 6-4.",
        quoteOriginal: null,
        quoteSpeaker: null,
      },
    ];
    const result = assessContentQuality({
      titleHu: "Anglia nyert",
      leadHu: "Az Anglia győzött a mérkőzésen.",
      bodyHu: "England beat France in 10-goal thriller\n\nEngland won the match 6-4.",
      facts: englishPassthroughFacts,
    });

    expect(result.passed).toBe(false);
    expect(result.issues).toContainEqual({ field: "body", kind: "matches_source_verbatim" });
  });

  it("flags mostly-English content even when it contains one Hungarian word and an accent", () => {
    const result = assessContentQuality({
      titleHu: "Meditate, pray és watch football instead of spreading hate",
      leadHu: "Az angol szövetség közleményt adott ki a mérkőzés előtt.",
      bodyHu:
        "Az angol szövetség a mérkőzés előtt közzétett közleményében a sportszerű viselkedés fontosságát hangsúlyozta.",
      facts: FACTS,
    });

    expect(result.issues).toContainEqual({ field: "title", kind: "looks_english" });
  });

  it("flags an unmistakably English short title", () => {
    const result = assessContentQuality({
      titleHu: "Mbappe goal",
      leadHu: "A francia támadó gólt szerzett a bajnoki mérkőzésen.",
      bodyHu:
        "Kylian Mbappé a második félidőben talált a kapuba, csapata pedig megnyerte a bajnoki találkozót.",
      facts: FACTS,
    });

    expect(result.issues).toContainEqual({ field: "title", kind: "looks_english" });
  });

  it("flags a No-LLM fallback notice even when the rest is Hungarian", () => {
    const result = assessContentQuality({
      titleHu: "A világbajnokság díjazása",
      leadHu:
        "Ez a tartalom még nem AI által lefordított vagy ellenőrzött szöveg — az eredeti, angol nyelvű forrásanyag jelenik meg.",
      bodyHu:
        "A torna szervezői részletesen ismertették a világbajnokság pénzdíjait és a résztvevő csapatoknak járó összegeket.",
      facts: FACTS,
    });

    expect(result.issues).toContainEqual({ field: "lead", kind: "fallback_notice" });
  });

  it("flags a repeated sentence inside one body paragraph", () => {
    const repeated =
      "Bukayo Saka mesterhármast szerzett, Anglia pedig 6-4-re legyőzte Franciaországot.";
    const result = assessContentQuality({
      titleHu: "Anglia bronzérmes lett a világbajnokságon",
      leadHu: "Anglia tízgólos mérkőzésen győzte le Franciaországot.",
      bodyHu: `${repeated} Az angol válogatott ezzel megszerezte a bronzérmet. ${repeated}`,
      facts: FACTS,
    });

    expect(result.issues).toContainEqual({ field: "body", kind: "repeated_sentence" });
  });

  it.each([
    "időtlen-e Rodri eladása",
    "meghatározatlan átvételi díj",
    "szabad átvételben csatlakozott",
    "a büntetőkirekesztés előtt",
    "stopperidőben szerzett gólt",
  ])("flags known bad football terminology: %s", (badPhrase) => {
    const result = assessContentQuality({
      titleHu: "A klub fontos döntés előtt áll",
      leadHu: `A sportigazgató azt vizsgálja, hogy ${badPhrase} a megfelelő megoldás.`,
      bodyHu:
        "A klub vezetői a következő napokban hozzák meg a végső döntést, miután minden szakmai és pénzügyi szempontot megvizsgáltak.",
      facts: FACTS,
    });

    expect(result.issues).toContainEqual({ field: "lead", kind: "forbidden_terminology" });
  });
});

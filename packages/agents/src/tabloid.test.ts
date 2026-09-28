import { describe, expect, it, vi } from "vitest";
import {
  assessTabloidQuality,
  isFootballTabloid,
  paragraphizeBody,
  repairTabloid,
  writeTabloid,
} from "./tabloid";
import type { LlmClient } from "@magyarsportonline/llm";

describe("all-football feed filter", () => {
  it.each([
    ["Ronaldo furious after dressing room clash", true],
    ["El vestuario estalla: polémica por las palabras del técnico", true],
    ["La moglie del calciatore racconta tutto", true],
    ["Kabinen-Zoff beim FC Bayern", true],
    ["A surprising evening for Arsenal's captain", true],
    ["Manchester United transfer news: fans furious at new signing", true],
    ["Fichajes: polémica por el delantero del Real Madrid", true],
    ["Calciomercato: scandalo alla Juventus", true],
    ["Bayern: Wechsel sorgt für Fan-Wut", true],
    ["Bundesliga Tabelle und Ergebnisse", true],
    ["Arsenal scores in a bizarre 2-1 victory", true],
    ["Barcelona: victoria polémica", true],
    ["Juventus: vittoria con polemica", true],
    ["Bayern: Fans feiern kuriosen Sieg", true],
    ["Manchester United match report: furious fans", true],
    ["Arsenal lineup sparks outrage", true],
    ["Liverpool fixtures shock fans", true],
    ["Premier League live score: fans react", true],
    ["Liverpool preview: furious manager", true],
    ["Arsenal ready to face Napoli in Champions League clash", true],
    ["Arsenal's next Champions League clash", true],
    ["Arsenal official statement: apology", true],
    ["Real Madrid comunicado oficial: polémica", true],
    ["Juventus comunicato ufficiale: scandalo", true],
    ["Bayern offizielle Mitteilung: Entschuldigung", true],
    ["Matheus Cunha scores first goal in Manchester United clash", true],
    ["Gasperini cambia Koné: problema muscolare per il calciatore", true],
    ["Chelsea wage bill for 2026/27 season", true],
    ["Manchester United wonderkid makes history with debut hat-trick", true],
    ["Arsenal fans celebrate a new sponsorship", true],
    ["Police arrest a politician", true],
    ["Hollywood star reveals divorce", true],
    ["Tennis star cries after nightclub arrest", true],
    ["Bayern-Star nach Streit festgenommen", true],
    ["Filmreife Verfolgungsjagd in Bayern: Polizei schiesst auf Autodieb", true],
    ["La esposa del futbolista denuncia amenazas", true],
    ["Il calciatore in lacrime dopo il divorzio", true],
    ["Arsenal footballer apologises for viral Instagram video", true],
  ])("%s => %s", (title, expected) => expect(isFootballTabloid(title, "")).toBe(expected));
  it.each([
    ["Arsenal captain speaks", "He apologises for a nightclub incident.", true],
    ["Barcelona al día", "El futbolista habla de su divorcio.", true],
    ["Juventus, la storia", "La moglie del calciatore racconta la sua vita privata.", true],
    ["Bayern-Star spricht", "Die Polizei untersucht den Streit.", true],
    ["Arsenal footballer is furious", "His transfer to Liverpool is confirmed.", true],
    ["Barcelona: esposa y polémica", "Se confirma el fichaje.", true],
    ["Juventus: la moglie in lacrime", "Il prestito è ufficiale.", true],
    ["Bayern-Star im Streit", "Die Verpflichtung ist offiziell.", true],
    ["Arsenal announces news", "Training continued on Thursday.", true],
    ["El motor idóneo", "En el fútbol los dos forman la pareja ideal en la medular.", true],
    [
      "Napoli, il centrocampista",
      "Visualizza questo post su Instagram Un post condiviso da Spazio Napoli (@spazionapoli.it)",
      true,
    ],
    ["Sydney Sweeney geht viral", "Ein Football und Schulterpolster in ihrer Werbung.", false],
    [
      "Liverpool star responds",
      "The footballer scored a hat-trick. Fans react on social media.",
      true,
    ],
  ])("checks title and RSS body together: %s", (title, content, accepted) => {
    expect(isFootballTabloid(title, content)).toBe(accepted);
  });
  it("trusts a declared football feed and requires evidence in a mixed feed", () => {
    expect(isFootballTabloid("Club statement", "", true)).toBe(true);
    expect(isFootballTabloid("Arsenal transfer", "", false)).toBe(true);
    expect(isFootballTabloid("Police arrest a politician", "", false)).toBe(false);
  });
  it("uses the source URL to keep only BILD football and recognize direct football sections", () => {
    expect(
      isFootballTabloid(
        "Bayern reist nach Luxemburg",
        "",
        false,
        "BROAD_TABLOID_FOOTBALL",
        "https://www.bild.de/sport/fussball/fc-bayern-reise-123",
      ),
    ).toBe(true);
    expect(
      isFootballTabloid(
        "Bundesliga Tabelle",
        "",
        true,
        "BROAD_TABLOID_FOOTBALL",
        "https://sportbild.bild.de/fussball/bundesliga/tabelle-123.html",
      ),
    ).toBe(true);
    expect(
      isFootballTabloid(
        "THW Kiel gewinnt",
        "",
        false,
        "BROAD_TABLOID_FOOTBALL",
        "https://www.bild.de/sport/mehr-sport/handball-kiel-123",
      ),
    ).toBe(false);
    expect(
      isFootballTabloid(
        "Polizei schiesst auf Autodieb",
        "Bayern",
        false,
        "BROAD_TABLOID_FOOTBALL",
        "https://www.bild.de/regional/bayern/verfolgungsjagd-123",
      ),
    ).toBe(false);
    expect(
      isFootballTabloid(
        "Daniel Maldini coinvolto in un incidente",
        "",
        false,
        "DIRECT_GOSSIP",
        "https://www.golssip.it/gossip/calcio/daniel-maldini-incidente/",
      ),
    ).toBe(true);
  });
});

describe("one-call Hungarian writer", () => {
  const input = {
    language: "en",
    title: "Arsenal captain speaks about family",
    content: "The Arsenal captain spoke about his family.",
    sourceName: "Example",
    sourceUrl: "https://example.com/story",
    publishedAt: null,
  };
  function client(data: unknown, isFallback = false) {
    return {
      completeJson: vi
        .fn()
        .mockResolvedValue({ data, isFallback, inputTokens: 10, outputTokens: 20 }),
      completeText: vi.fn(),
    } satisfies LlmClient;
  }
  it("publishes short RSS without minimum word counts or extra checks", async () => {
    const llm = client({
      title_hu: "A családjáról mesélt az Arsenal kapitánya",
      lead_hu: "Személyes témát érintett.",
      body_hu: "Az Arsenal kapitánya a családjáról beszélt.",
    });
    expect((await writeTabloid(llm, input)).body_hu).toContain("családjáról");
    expect(llm.completeJson).toHaveBeenCalledTimes(1);
    expect(llm.completeJson).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gemini-3.5-flash-lite", thinkingLevel: "minimal" }),
    );
    expect(llm.completeText).not.toHaveBeenCalled();
  });
  it("requires natural Hungarian while forbidding unsupported editorial additions", async () => {
    const llm = client({
      title_hu: "A családjáról mesélt az Arsenal kapitánya",
      lead_hu: "Személyes témát érintett.",
      body_hu: "Az Arsenal kapitánya a családjáról beszélt.",
    });
    await writeTabloid(llm, input);
    const request = llm.completeJson.mock.calls[0]?.[0];
    expect(request?.system).toContain("Ne tükörfordíts");
    expect(request?.system).toContain("minden tényállítása legyen közvetlenül visszavezethető");
    expect(request?.system).toContain("Ne tegyél a végére hangulati összegzést");
  });
  it("rejects invalid schema without repair", async () => {
    const llm = client({ title_hu: "Cím", lead_hu: "", body_hu: "" });
    await expect(writeTabloid(llm, input)).rejects.toThrow();
    expect(llm.completeJson).toHaveBeenCalledTimes(1);
  });
  it("rejects a fallback without publishing or retrying", async () => {
    const llm = client({}, true);
    await expect(writeTabloid(llm, input)).rejects.toThrow("fallback");
    expect(llm.completeJson).toHaveBeenCalledTimes(1);
  });
  it("rejects an unchanged source copy", async () => {
    const llm = client({
      title_hu: input.title,
      lead_hu: "The captain spoke.",
      body_hu: input.content,
    });
    await expect(writeTabloid(llm, input)).rejects.toThrow("untranslated");
  });
  it("does not reject a concise summary solely for its length", async () => {
    const llm = client({
      title_hu: "Részletes történet",
      lead_hu: "A történet röviden.",
      body_hu: "Ez csak egy rövid bekezdés.",
    });
    const sourceContent = "Detailed source sentence. ".repeat(60);
    const output = await writeTabloid(llm, {
      ...input,
      content: sourceContent,
    });
    expect(
      assessTabloidQuality({ sourceContent, output }).some(
        (flag) => flag.code === "incomplete_coverage",
      ),
    ).toBe(false);
  });

  it.each([
    ["Bayern won 3-0.", "A Bayern 3–0-ra nyert.", false],
    ["Bayern won 3-0.", "A Bayern 0–3-ra nyert.", true],
    ["Bayern played 3 matches and conceded 0 goals.", "A Bayern 3–0-ra nyert.", true],
    ["Arsenal beat Chelsea 3-0.", "A Chelsea 3–0-ra verte az Arsenalt.", true],
    ["Arsenal beat Chelsea 3-0.", "Az Arsenal 3–0-ra verte a Chelsea-t.", false],
    ["The fee was 1.5 million euros.", "A díj 1,5 millió euró volt.", false],
    ["The fee was 1.5 million euros.", "A díj 1,5 millió dollár volt.", true],
    ["The fee was 1,500,000 euros.", "A díj 1,5 millió euró volt.", false],
    ["The match was on 2026-09-27.", "A meccs 2026.09.27-én volt.", false],
    ["The match was on 2026-09-27.", "A meccs 2026.09.28-án volt.", true],
    ["Kickoff is at 18:30.", "A kezdés 18.30-kor lesz.", false],
    ["Kickoff is at 18:30.", "A kezdés 19.30-kor lesz.", true],
    ["Ronaldo scored 2 and Messi scored 3.", "Ronaldo 3, Messi 2 gólt szerzett.", true],
    [
      "Luca Bolay (24) is worth 500.000 Euro.",
      "A 24 éves Luca Bolay értékét 500.000 eurónak tartják.",
      false,
    ],
    [
      "Haaland faced 114 charges. Roberto Mancini denied wrongdoing.",
      "A 114 vád után Roberto Mancini tagadta a szabálytalanságot.",
      false,
    ],
    ["The match is on October 11.", "Október 11-én lesz a mérkőzés a Premier League-ben.", false],
    ["Haaland equalised in the 51st minute.", "Haaland az 51. percben egyenlített.", false],
  ])("checks numeric meaning: %s => %s", (sourceContent, body_hu, rejected) => {
    const flags = assessTabloidQuality({
      sourceContent,
      output: { title_hu: "Sporthír", lead_hu: "Részletek.", body_hu },
    });
    expect(flags.some((flag) => flag.code === "number_integrity")).toBe(rejected);
  });

  it("matches forbidden expressions at word boundaries", () => {
    const output = {
      title_hu: "Keresztüljutott",
      lead_hu: "A keresztül vezető úton ment.",
      body_hu: "A játékos keresztülhaladt a pályán.",
    };
    const flags = assessTabloidQuality({
      sourceContent: "The player went through the field.",
      output,
      forbiddenTerms: ["kereszt"],
    });
    expect(flags.some((flag) => flag.code === "forbidden_terminology")).toBe(false);
  });

  it("separates hard and language flags without another AI call", () => {
    const flags = assessTabloidQuality({
      sourceContent: "Harry Kane scored 2 goals.",
      output: {
        title_hu: "Harry Kane nagy nagy napja",
        lead_hu: "A csatár 3 gólt szerzett.",
        body_hu:
          "Ugyanaz a hosszabb mondat szerepel itt.\n\nUgyanaz a hosszabb mondat szerepel itt.",
        language_warnings: ["A cím bizonytalan."],
      },
      forbiddenTerms: ["nagy nagy"],
    });
    expect(flags.some((flag) => flag.kind === "hard" && flag.code === "number_integrity")).toBe(
      true,
    );
    expect(flags.some((flag) => flag.kind === "hard" && flag.code === "repetition")).toBe(true);
    expect(
      flags.some((flag) => flag.kind === "language" && flag.code === "writer_language_warning"),
    ).toBe(true);
  });

  it("does not treat normal mixed-case brand names as malformed Hungarian", () => {
    const flags = assessTabloidQuality({
      sourceContent: "The player shared an iPhone video with LaLiga officials.",
      output: {
        title_hu: "iPhone-videót mutatott a LaLiga játékosa",
        lead_hu: "A futballista megmutatta a felvételt.",
        body_hu:
          "A játékos az iPhone készülékével készült videót a LaLiga illetékeseinek is megmutatta.",
        language_warnings: [],
      },
    });
    expect(flags.some((flag) => flag.code === "malformed_hungarian")).toBe(false);
  });

  it("accepts a source-attributed mixed-case broadcaster name", () => {
    const flags = assessTabloidQuality({
      sourceContent: "He told TalkTV that the appeal was likely.",
      output: {
        title_hu: "Fellebbezést terveznek",
        lead_hu: "Sajtóhír érkezett.",
        body_hu: "A szakértő a TalkTV-nek nyilatkozott a várható fellebbezésről.",
      },
    });
    expect(flags.some((flag) => flag.code === "malformed_hungarian")).toBe(false);
  });

  it("uses Unicode word boundaries for repeated-word detection", () => {
    const flags = assessTabloidQuality({
      sourceContent: "A team suffered elimination and then won four matches.",
      output: {
        title_hu: "Fordulat a csapatnál",
        lead_hu: "A kiesés és a négy győzelem is szóba került.",
        body_hu:
          "A kupakiesés és a bajnokságban aratott négy győzelem egyaránt fontos része volt az értékelésnek.",
        language_warnings: [],
      },
    });
    expect(flags.some((flag) => flag.code === "malformed_hungarian")).toBe(false);
  });

  it("repairs only flagged fields once and rejects number changes", async () => {
    const llm = client({ title_hu: "Kane 3 gólt szerzett" });
    const output = {
      title_hu: "Kane 2 gólt szerzett",
      lead_hu: "A csatár remekelt.",
      body_hu: "A Bayern játékosa kétszer talált be.",
      language_warnings: [],
      generatedByModel: "gemini-3.5-flash-lite",
    };
    await expect(
      repairTabloid(
        llm,
        output,
        [{ kind: "language", code: "malformed_hungarian", field: "title" }],
        {
          role: "targeted_repair",
        },
      ),
    ).rejects.toThrow("changed numbers");
    expect(llm.completeJson).toHaveBeenCalledOnce();
    expect(llm.completeJson).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gemini-3.5-flash",
        usageContext: { role: "targeted_repair" },
      }),
    );
  });
  it("sends only an identified paragraph to Flash and avoids an unscoped body rewrite", async () => {
    const llm = client({ body_hu: "A csapat pontosan passzolt." });
    const output = {
      title_hu: "A csapat győzött",
      lead_hu: "A mérkőzésen sok helyzet volt.",
      body_hu: "Az első félidőben kevés helyzet volt.\n\nA csapat rosszul passzolt.",
      language_warnings: [],
      generatedByModel: "gemini-3.5-flash-lite",
    };
    await repairTabloid(
      llm,
      output,
      [{ kind: "hard", code: "forbidden_terminology", field: "body", detail: "rosszul" }],
      { role: "targeted_repair" },
    );
    expect(llm.completeJson.mock.calls[0]?.[0]?.messages[0]?.content).toContain(
      "A csapat rosszul passzolt.",
    );
    expect(llm.completeJson.mock.calls[0]?.[0]?.messages[0]?.content).not.toContain(
      "Az első félidőben",
    );
    await expect(
      repairTabloid(llm, output, [{ kind: "language", code: "foreign_language", field: "body" }], {
        role: "targeted_repair",
      }),
    ).rejects.toThrow("one identifiable body paragraph");
    expect(llm.completeJson).toHaveBeenCalledOnce();
  });
  it("deterministically splits a long one-block draft into readable paragraphs", () => {
    expect(
      paragraphizeBody(
        "Első mondat. Második mondat. Harmadik mondat. Negyedik mondat. Ötödik mondat. Hatodik mondat.",
      ).split("\n\n"),
    ).toHaveLength(3);
  });
});

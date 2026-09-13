import { describe, expect, it, vi } from "vitest";
import { isFootballTabloid, paragraphizeBody, writeTabloid } from "./tabloid";
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
      expect.objectContaining({ model: "gemini-3.5-flash", thinkingLevel: "minimal" }),
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
  it("rejects a short draft for a detailed source article", async () => {
    const llm = client({
      title_hu: "Részletes történet",
      lead_hu: "A történet röviden.",
      body_hu: "Ez csak egy rövid bekezdés.",
    });
    await expect(
      writeTabloid(llm, {
        ...input,
        content: "Detailed source sentence. ".repeat(60),
      }),
    ).rejects.toThrow("incomplete coverage");
  });
  it("deterministically splits a long one-block draft into readable paragraphs", () => {
    expect(
      paragraphizeBody(
        "Első mondat. Második mondat. Harmadik mondat. Negyedik mondat. Ötödik mondat. Hatodik mondat.",
      ).split("\n\n"),
    ).toHaveLength(3);
  });
});

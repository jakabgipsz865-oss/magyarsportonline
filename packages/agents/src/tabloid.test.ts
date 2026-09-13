import { describe, expect, it, vi } from "vitest";
import { isFootballTabloid, paragraphizeBody, writeTabloid } from "./tabloid";
import type { LlmClient } from "@magyarsportonline/llm";

describe("precision-first football tabloid filter", () => {
  it.each([
    ["Ronaldo furious after dressing room clash", true],
    ["El vestuario estalla: polémica por las palabras del técnico", true],
    ["La moglie del calciatore racconta tutto", true],
    ["Kabinen-Zoff beim FC Bayern", true],
    ["A surprising evening for Arsenal's captain", false],
    ["Manchester United transfer news: fans furious at new signing", false],
    ["Fichajes: polémica por el delantero del Real Madrid", false],
    ["Calciomercato: scandalo alla Juventus", false],
    ["Bayern: Wechsel sorgt für Fan-Wut", false],
    ["Bundesliga Tabelle und Ergebnisse", false],
    ["Arsenal scores in a bizarre 2-1 victory", false],
    ["Barcelona: victoria polémica", false],
    ["Juventus: vittoria con polemica", false],
    ["Bayern: Fans feiern kuriosen Sieg", false],
    ["Manchester United match report: furious fans", false],
    ["Arsenal lineup sparks outrage", false],
    ["Liverpool fixtures shock fans", false],
    ["Premier League live score: fans react", false],
    ["Liverpool preview: furious manager", false],
    ["Arsenal ready to face Napoli in Champions League clash", false],
    ["Arsenal's next Champions League clash", false],
    ["Arsenal official statement: apology", false],
    ["Real Madrid comunicado oficial: polémica", false],
    ["Juventus comunicato ufficiale: scandalo", false],
    ["Bayern offizielle Mitteilung: Entschuldigung", false],
    ["Matheus Cunha scores first goal in Manchester United clash", false],
    ["Gasperini cambia Koné: problema muscolare per il calciatore", false],
    ["Chelsea wage bill for 2026/27 season", false],
    ["Manchester United wonderkid makes history with debut hat-trick", false],
    ["Arsenal fans celebrate a new sponsorship", false],
    ["Police arrest a politician", false],
    ["Hollywood star reveals divorce", false],
    ["Tennis star cries after nightclub arrest", false],
    ["Bayern-Star nach Streit festgenommen", true],
    ["La esposa del futbolista denuncia amenazas", true],
    ["Il calciatore in lacrime dopo il divorzio", true],
    ["Arsenal footballer apologises for viral Instagram video", true],
  ])("%s => %s", (title, expected) => expect(isFootballTabloid(title, "")).toBe(expected));
  it.each([
    ["Arsenal captain speaks", "He apologises for a nightclub incident.", true],
    ["Barcelona al día", "El futbolista habla de su divorcio.", true],
    ["Juventus, la storia", "La moglie del calciatore racconta la sua vita privata.", true],
    ["Bayern-Star spricht", "Die Polizei untersucht den Streit.", true],
    ["Arsenal footballer is furious", "His transfer to Liverpool is confirmed.", false],
    ["Barcelona: esposa y polémica", "Se confirma el fichaje.", false],
    ["Juventus: la moglie in lacrime", "Il prestito è ufficiale.", false],
    ["Bayern-Star im Streit", "Die Verpflichtung ist offiziell.", false],
    ["Arsenal announces news", "Training continued on Thursday.", false],
    ["El motor idóneo", "En el fútbol los dos forman la pareja ideal en la medular.", false],
    [
      "Napoli, il centrocampista",
      "Visualizza questo post su Instagram Un post condiviso da Spazio Napoli (@spazionapoli.it)",
      false,
    ],
    ["Sydney Sweeney geht viral", "Ein Football und Schulterpolster in ihrer Werbung.", false],
    [
      "Liverpool star responds",
      "The footballer scored a hat-trick. Fans react on social media.",
      false,
    ],
  ])("checks title and RSS body together: %s", (title, content, accepted) => {
    expect(isFootballTabloid(title, content)).toBe(accepted);
  });
  it("uses a direct gossip vertical as a positive signal, after football and hard exclusions", () => {
    expect(
      isFootballTabloid("Arsenal captain speaks", "A personal account.", true, "DIRECT_GOSSIP"),
    ).toBe(true);
    expect(
      isFootballTabloid(
        "Arsenal captain speaks",
        "A personal account.",
        true,
        "BROAD_TABLOID_FOOTBALL",
      ),
    ).toBe(false);
    expect(isFootballTabloid("Arsenal transfer scandal", "", true, "DIRECT_GOSSIP")).toBe(false);
    expect(isFootballTabloid("Liverpool wins 2-0", "", true, "DIRECT_GOSSIP")).toBe(false);
    expect(isFootballTabloid("Hollywood wedding", "", false, "DIRECT_GOSSIP")).toBe(false);
  });
  it("requires football evidence even in a declared football feed", () => {
    expect(isFootballTabloid("Police arrest a politician", "", true)).toBe(false);
    expect(isFootballTabloid("Striker arrested at nightclub", "", true)).toBe(true);
    expect(isFootballTabloid("Striker arrested at nightclub", "", false)).toBe(false);
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
    expect(llm.completeText).not.toHaveBeenCalled();
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
  it("deterministically splits a long one-block draft into readable paragraphs", () => {
    expect(
      paragraphizeBody(
        "Első mondat. Második mondat. Harmadik mondat. Negyedik mondat. Ötödik mondat. Hatodik mondat.",
      ).split("\n\n"),
    ).toHaveLength(3);
  });
});

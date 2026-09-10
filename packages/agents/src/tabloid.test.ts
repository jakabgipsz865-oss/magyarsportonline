import { describe, expect, it, vi } from "vitest";
import { isFootballTabloid, writeTabloid } from "./tabloid";
import type { LlmClient } from "@magyarsportonline/llm";

describe("permissive football tabloid filter", () => {
  it.each([
    ["Ronaldo furious after dressing room clash", true],
    ["El vestuario estalla: polémica por las palabras del técnico", true],
    ["La moglie del calciatore racconta tutto", true],
    ["Kabinen-Zoff beim FC Bayern", true],
    ["A surprising evening for Arsenal's captain", true],
    ["Manchester United transfer news: new signing", false],
    ["Fichajes: el delantero firma por el Madrid", false],
    ["Calciomercato: le ultime notizie", false],
    ["Bundesliga Tabelle und Ergebnisse", false],
    ["Transfer row: fans react to controversial decision", true],
  ])("%s => %s", (title, expected) => expect(isFootballTabloid(title, "")).toBe(expected));
  it("rejects unrelated stories in general feeds", () => {
    expect(isFootballTabloid("Police arrest a politician", "", false)).toBe(false);
    expect(isFootballTabloid("Bayern-Star nach Streit festgenommen", "Fußball", false)).toBe(true);
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
});

import type { Entity } from "@magyarsportonline/db";
import { describe, expect, it } from "vitest";
import { isPremierLeagueRelevant } from "./relevance";

const entities: Entity[] = [
  {
    id: "entity-liverpool",
    type: "team",
    nameCanonical: "Liverpool FC",
    nameHu: "Liverpool",
    aliases: ["Liverpool", "Reds"],
    externalRef: null,
  },
  {
    id: "entity-bournemouth",
    type: "team",
    nameCanonical: "AFC Bournemouth",
    nameHu: "Bournemouth",
    aliases: ["Bournemouth", "AFC Bournemouth", "Cherries"],
    externalRef: null,
  },
];

function article(titleOriginal: string, subtitleOriginal = "") {
  return { titleOriginal, subtitleOriginal, bodyOriginal: "" };
}

describe("Premier League relevance gate", () => {
  it.each([
    ["Liverpool beat their rivals 3-1", ""],
    ["Transfer update", "Liverpool submit a new bid for the midfielder"],
    ["League statement", "The Premier League confirms a disciplinary decision"],
    ["Medical scheduled", "The Cherries have agreed a transfer fee"],
  ])("accepts relevant news: %s", (title, lead) => {
    expect(isPremierLeagueRelevant(article(title, lead), entities)).toBe(true);
  });

  it.each([
    "Liverpool betting tips and odds",
    "Best FPL picks for Liverpool",
    "Liverpool quiz of the week",
    "Liverpool tickets and hospitality packages",
    "How to watch Liverpool this weekend",
    "Listen to the new Liverpool podcast",
    "Liverpool casino free bet offer",
    "Liverpool sponsored content",
    "Real Madrid agree a transfer fee",
  ])("drops irrelevant or promotional content: %s", (title) => {
    expect(isPremierLeagueRelevant(article(title), entities)).toBe(false);
  });
});

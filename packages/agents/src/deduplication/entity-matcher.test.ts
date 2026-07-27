import { describe, expect, it } from "vitest";
import { matchEntities } from "./entity-matcher.js";

const DUNA_FC = { id: "e1", nameCanonical: "Duna FC", aliases: ["Duna"] };
const TISZA_SE = { id: "e2", nameCanonical: "Tisza SE", aliases: [] };

describe("matchEntities", () => {
  it("matches by canonical name, case-insensitively", () => {
    const matches = matchEntities("A DUNA FC nyert.", [DUNA_FC, TISZA_SE]);
    expect(matches.map((e) => e.id)).toEqual(["e1"]);
  });

  it("matches by alias", () => {
    const matches = matchEntities("A Duna ma gyozott.", [DUNA_FC, TISZA_SE]);
    expect(matches.map((e) => e.id)).toEqual(["e1"]);
  });

  it("returns entities ordered by first appearance in the text", () => {
    const matches = matchEntities("A Tisza SE 1-2-re kikapott a Duna FC otthonaban.", [
      DUNA_FC,
      TISZA_SE,
    ]);
    expect(matches.map((e) => e.id)).toEqual(["e2", "e1"]);
  });

  it("returns an empty array when nothing matches", () => {
    const matches = matchEntities("Teljesen ismeretlen szoveg.", [DUNA_FC, TISZA_SE]);
    expect(matches).toEqual([]);
  });

  it("does not duplicate an entity matched via both name and alias", () => {
    const matches = matchEntities("A Duna FC es a Duna is ugyanaz a csapat.", [DUNA_FC]);
    expect(matches).toHaveLength(1);
  });
});

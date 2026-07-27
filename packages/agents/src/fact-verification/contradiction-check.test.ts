import { describe, expect, it } from "vitest";
import { findContradictedFactIds } from "./contradiction-check";

describe("findContradictedFactIds", () => {
  it("returns no contradictions when all score facts agree", () => {
    const facts = [
      { id: "1", factType: "score", payload: { detail_hu: "3-1 Liverpool javára" } },
      { id: "2", factType: "score", payload: { detail_hu: "3-1 Liverpool javára" } },
    ];
    expect(findContradictedFactIds(facts)).toEqual([]);
  });

  it("flags all score facts as contradicted when values disagree", () => {
    const facts = [
      { id: "1", factType: "score", payload: { detail_hu: "3-1 Liverpool javára" } },
      { id: "2", factType: "score", payload: { detail_hu: "2-1 Liverpool javára" } },
    ];
    expect(findContradictedFactIds(facts).sort()).toEqual(["1", "2"]);
  });

  it("ignores non-score fact types", () => {
    const facts = [
      { id: "1", factType: "quote", payload: { detail_hu: "valamit mondott" } },
      { id: "2", factType: "other", payload: { detail_hu: "más infó" } },
    ];
    expect(findContradictedFactIds(facts)).toEqual([]);
  });

  it("treats a single score fact as consistent", () => {
    const facts = [{ id: "1", factType: "score", payload: { detail_hu: "3-1" } }];
    expect(findContradictedFactIds(facts)).toEqual([]);
  });
});

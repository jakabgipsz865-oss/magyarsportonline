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

  it("ignores free-text fact types (quote, other) — never flags them as contradicted", () => {
    const facts = [
      { id: "1", factType: "quote", payload: { detail_hu: "valamit mondott" } },
      { id: "2", factType: "other", payload: { detail_hu: "más infó" } },
      { id: "3", factType: "quote", payload: { detail_hu: "mást mondott" } },
    ];
    expect(findContradictedFactIds(facts)).toEqual([]);
  });

  it("treats a single score fact as consistent", () => {
    const facts = [{ id: "1", factType: "score", payload: { detail_hu: "3-1" } }];
    expect(findContradictedFactIds(facts)).toEqual([]);
  });

  it("flags disagreeing transfer_status facts (2026-07-28 generalization beyond score)", () => {
    const facts = [
      { id: "1", factType: "transfer_status", payload: { detail_hu: "35 millió euróért igazolt" } },
      { id: "2", factType: "transfer_status", payload: { detail_hu: "40 millió euróért igazolt" } },
    ];
    expect(findContradictedFactIds(facts).sort()).toEqual(["1", "2"]);
  });

  it("flags disagreeing injury_status and event_time facts too", () => {
    const facts = [
      { id: "1", factType: "injury_status", payload: { detail_hu: "térdsérülés miatt kimarad" } },
      {
        id: "2",
        factType: "injury_status",
        payload: { detail_hu: "csak apró horzsolás, játszhat" },
      },
      { id: "3", factType: "event_time", payload: { detail_hu: "szombat este 8-kor" } },
      { id: "4", factType: "event_time", payload: { detail_hu: "vasárnap délután" } },
    ];
    expect(findContradictedFactIds(facts).sort()).toEqual(["1", "2", "3", "4"]);
  });

  it("keeps each fact_type's contradiction check isolated from the others", () => {
    const facts = [
      { id: "1", factType: "score", payload: { detail_hu: "3-1" } },
      { id: "2", factType: "score", payload: { detail_hu: "3-1" } },
      { id: "3", factType: "transfer_status", payload: { detail_hu: "35 millió euró" } },
      { id: "4", factType: "transfer_status", payload: { detail_hu: "40 millió euró" } },
    ];
    // score facts agree (not contradicted); only the disagreeing transfer_status pair is flagged.
    expect(findContradictedFactIds(facts).sort()).toEqual(["3", "4"]);
  });
});

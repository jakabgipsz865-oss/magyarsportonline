import { describe, expect, it } from "vitest";
import { decideFactMergeAction, factPayloadsAgree } from "./fact-merge.js";

describe("decideFactMergeAction", () => {
  it("inserts when there is no existing fact of the same type", () => {
    const action = decideFactMergeAction({ factType: "score", payload: { home: 2, away: 1 } }, []);
    expect(action).toEqual({ kind: "insert" });
  });

  it("corroborates when the new score matches the existing one", () => {
    const action = decideFactMergeAction({ factType: "score", payload: { home: 2, away: 1 } }, [
      { id: "f1", factType: "score", payload: { home: 2, away: 1 } },
    ]);
    expect(action).toEqual({ kind: "corroborate", existingFactId: "f1" });
  });

  it("contradicts when the new score differs from the existing one", () => {
    const action = decideFactMergeAction({ factType: "score", payload: { home: 2, away: 1 } }, [
      { id: "f1", factType: "score", payload: { home: 1, away: 1 } },
    ]);
    expect(action).toEqual({ kind: "contradict", existingFactId: "f1" });
  });

  it("always inserts multiple distinct quotes rather than merging them", () => {
    const action = decideFactMergeAction(
      { factType: "quote", payload: { text: "masodik nyilatkozat" } },
      [{ id: "f1", factType: "quote", payload: { text: "elso nyilatkozat" } }],
    );
    expect(action).toEqual({ kind: "insert" });
  });
});

describe("factPayloadsAgree", () => {
  it("compares score facts by home/away fields", () => {
    expect(factPayloadsAgree("score", { home: 2, away: 1 }, { home: 2, away: 1 })).toBe(true);
    expect(factPayloadsAgree("score", { home: 2, away: 1 }, { home: 2, away: 0 })).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { findContradictedFactIds } from "./contradiction-check";

const fact = (id: string, factType: string, subject: string, predicate: string, value: string) => ({
  id,
  factType,
  payload: {
    subject,
    predicate,
    normalized_value: value,
    claim_en: `${subject} ${predicate} ${value}`,
  },
});

describe("findContradictedFactIds", () => {
  it("flags different values only in the same subject + predicate slot", () => {
    expect(
      findContradictedFactIds([
        fact("1", "score", "Leeds v Brentford", "final_score", "1-1"),
        fact("2", "score", "Leeds v Brentford", "final_score", "2-1"),
      ]).sort(),
    ).toEqual(["1", "2"]);
  });

  it("does not treat unrelated claims with the same fact type as contradictions", () => {
    expect(
      findContradictedFactIds([
        fact("1", "transfer_status", "Player A", "transfer_fee", "£35m"),
        fact("2", "transfer_status", "Player B", "transfer_fee", "£40m"),
      ]),
    ).toEqual([]);
  });

  it("ignores free-text types and incomplete legacy slots", () => {
    expect(
      findContradictedFactIds([
        fact("1", "quote", "Coach", "quote", "A"),
        { id: "2", factType: "score", payload: { detail_hu: "3-1" } },
      ]),
    ).toEqual([]);
  });
});

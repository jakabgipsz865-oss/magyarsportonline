import { describe, expect, it } from "vitest";
import { mergeClaims } from "./claim-merge";

describe("mergeClaims", () => {
  it("counts a fact as corroborated by 1 source when it's the only one", () => {
    const result = mergeClaims([
      { id: "f1", factType: "score", payload: { detail_hu: "3-1" }, sourceId: "source-a" },
    ]);
    expect(result.corroboratingSourceCountByFactId.get("f1")).toBe(1);
    expect(result.maxCorroboratingSourceCount).toBe(1);
  });

  it("counts corroboration across distinct sources with the same fact_type and normalized text", () => {
    const result = mergeClaims([
      { id: "f1", factType: "score", payload: { detail_hu: "3-1" }, sourceId: "source-a" },
      { id: "f2", factType: "score", payload: { detail_hu: "3-1" }, sourceId: "source-b" },
      { id: "f3", factType: "score", payload: { detail_hu: "3-1" }, sourceId: "source-c" },
    ]);
    expect(result.corroboratingSourceCountByFactId.get("f1")).toBe(3);
    expect(result.corroboratingSourceCountByFactId.get("f2")).toBe(3);
    expect(result.corroboratingSourceCountByFactId.get("f3")).toBe(3);
    expect(result.maxCorroboratingSourceCount).toBe(3);
  });

  it("does not double-count the same source appearing twice for the same claim", () => {
    const result = mergeClaims([
      { id: "f1", factType: "score", payload: { detail_hu: "3-1" }, sourceId: "source-a" },
      { id: "f2", factType: "score", payload: { detail_hu: "3-1" }, sourceId: "source-a" },
    ]);
    expect(result.corroboratingSourceCountByFactId.get("f1")).toBe(1);
    expect(result.corroboratingSourceCountByFactId.get("f2")).toBe(1);
  });

  it("is case/whitespace-insensitive (normalized via detailOf) but keeps distinct fact_types separate", () => {
    const result = mergeClaims([
      { id: "f1", factType: "score", payload: { detail_hu: "  3-1  " }, sourceId: "source-a" },
      { id: "f2", factType: "score", payload: { detail_hu: "3-1" }, sourceId: "source-b" },
      { id: "f3", factType: "injury_status", payload: { detail_hu: "3-1" }, sourceId: "source-c" },
    ]);
    expect(result.corroboratingSourceCountByFactId.get("f1")).toBe(2);
    expect(result.corroboratingSourceCountByFactId.get("f2")).toBe(2);
    expect(result.corroboratingSourceCountByFactId.get("f3")).toBe(1);
  });

  it("does not corroborate facts with disagreeing text — each stays at its own source count", () => {
    const result = mergeClaims([
      { id: "f1", factType: "score", payload: { detail_hu: "3-1" }, sourceId: "source-a" },
      { id: "f2", factType: "score", payload: { detail_hu: "2-1" }, sourceId: "source-b" },
    ]);
    expect(result.corroboratingSourceCountByFactId.get("f1")).toBe(1);
    expect(result.corroboratingSourceCountByFactId.get("f2")).toBe(1);
    expect(result.maxCorroboratingSourceCount).toBe(1);
  });

  it("treats a fact with no detail_hu field as uncorroborated (count 1), never throwing", () => {
    const result = mergeClaims([
      { id: "f1", factType: "quote", payload: { quote_original: "hi" }, sourceId: "source-a" },
    ]);
    expect(result.corroboratingSourceCountByFactId.get("f1")).toBe(1);
  });
});

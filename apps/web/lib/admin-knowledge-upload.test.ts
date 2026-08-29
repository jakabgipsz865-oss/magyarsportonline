import { describe, expect, it } from "vitest";
import {
  MAX_KNOWLEDGE_IMPORT_BYTES,
  parseAdminKnowledgePackage,
} from "./admin-knowledge-upload";

describe("admin V2 knowledge upload boundary", () => {
  it("parses JSON for repository-level contract validation", () => {
    const value = { format: "magyarsportonline.editorial-knowledge", records: [] };
    expect(parseAdminKnowledgePackage(JSON.stringify(value))).toEqual(value);
  });

  it("rejects malformed JSON", () => {
    expect(() => parseAdminKnowledgePackage("{not-json")).toThrow("A fájl nem érvényes JSON.");
  });

  it("rejects an oversized package before database work", () => {
    expect(() => parseAdminKnowledgePackage("x".repeat(MAX_KNOWLEDGE_IMPORT_BYTES + 1))).toThrow(
      "megengedett 10 MB-nál",
    );
  });
});

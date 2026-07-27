import { describe, expect, it } from "vitest";
import { slugify } from "./slugify.js";

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("Duna FC nyert")).toBe("duna-fc-nyert");
  });

  it("strips Hungarian diacritics", () => {
    expect(slugify("Győzelmet aratott a Tisza SE")).toBe("gyozelmet-aratott-a-tisza-se");
  });

  it("collapses punctuation into single hyphens", () => {
    expect(slugify("Duna FC 2-1: nyert!!  a Tisza SE ellen")).toBe(
      "duna-fc-2-1-nyert-a-tisza-se-ellen",
    );
  });

  it("trims leading/trailing hyphens", () => {
    expect(slugify("  -Cim-  ")).toBe("cim");
  });

  it("is deterministic for the same input", () => {
    expect(slugify("Ugyanaz a cim")).toBe(slugify("Ugyanaz a cim"));
  });
});

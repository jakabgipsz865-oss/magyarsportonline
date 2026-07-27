import { describe, expect, it } from "vitest";
import { slugify } from "./slug";

describe("slugify", () => {
  it("removes Hungarian diacritics and lowercases", () => {
    expect(slugify("Szoboszlai Dominik góljával nyert a válogatott")).toBe(
      "szoboszlai-dominik-goljaval-nyert-a-valogatott",
    );
  });

  it("collapses non-alphanumeric runs into a single hyphen and trims edges", () => {
    expect(slugify("  Liverpool -- Arsenal: 3-1!! ")).toBe("liverpool-arsenal-3-1");
  });

  it("falls back to a default slug when nothing alphanumeric remains", () => {
    expect(slugify("???")).toBe("hir");
  });

  it("caps length at 100 characters", () => {
    const long = "a".repeat(200);
    expect(slugify(long).length).toBeLessThanOrEqual(100);
  });
});

import { describe, expect, it } from "vitest";
import { classifyRisk } from "./risk-classifier.js";

describe("classifyRisk", () => {
  it("returns low for ordinary match coverage", () => {
    expect(classifyRisk("A Duna FC 2-1-re gyozott.", false)).toBe("low");
  });

  it("returns medium for injury-related keywords", () => {
    expect(classifyRisk("A jatekos megserult a merkozesen.", false)).toBe("medium");
  });

  it("returns high for death/doping-related keywords", () => {
    expect(classifyRisk("A csapat dopping vetseg miatt vizsgalat alatt all.", false)).toBe("high");
  });

  it("returns high whenever prompt injection is suspected, regardless of content", () => {
    expect(classifyRisk("Teljesen artalmatlan szoveg.", true)).toBe("high");
  });

  it("high-risk keywords take precedence over medium-risk ones", () => {
    expect(classifyRisk("A jatekos megserult, majd kesobb elhunyt.", false)).toBe("high");
  });
});

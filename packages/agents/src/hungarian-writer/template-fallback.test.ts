import { describe, expect, it } from "vitest";
import { renderTemplateFallback } from "./template-fallback.js";

describe("renderTemplateFallback", () => {
  it("renders the score into the lead", () => {
    const output = renderTemplateFallback(
      {
        canonicalTitle: "Duna FC nyert",
        facts: [{ factType: "score", payload: { home: 2, away: 1 } }],
      },
      false,
    );
    expect(output.leadHu).toContain("2-1");
    expect(output.titleHu).toBe("Duna FC nyert");
  });

  it("appends quote sentences to the body", () => {
    const output = renderTemplateFallback(
      {
        canonicalTitle: "Duna FC nyert",
        facts: [
          { factType: "score", payload: { home: 2, away: 1 } },
          { factType: "quote", payload: { text: "Elegedett vagyok.", speaker: "Kovacs Andras" } },
        ],
      },
      false,
    );
    expect(output.bodyHu).toContain("Kovacs Andras");
    expect(output.bodyHu).toContain("Elegedett vagyok.");
  });

  it("marks the change summary as an update when isUpdate is true", () => {
    const output = renderTemplateFallback({ canonicalTitle: "Cim", facts: [] }, true);
    expect(output.changeSummaryHu).toMatch(/frissült/);
  });

  it("never claims to be AI-generated", () => {
    const output = renderTemplateFallback({ canonicalTitle: "Cim", facts: [] }, false);
    expect(output.changeSummaryHu).toMatch(/nem AI-generált/);
  });
});

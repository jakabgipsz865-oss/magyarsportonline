import { describe, expect, it } from "vitest";
import { toBodyHtml } from "./body-html";

describe("toBodyHtml", () => {
  it("wraps each non-empty paragraph in <p>", () => {
    expect(toBodyHtml("First paragraph.\n\nSecond paragraph.")).toBe(
      "<p>First paragraph.</p>\n<p>Second paragraph.</p>",
    );
  });

  it("escapes HTML special characters", () => {
    expect(toBodyHtml("<script>alert(1)</script> & more")).toBe(
      "<p>&lt;script&gt;alert(1)&lt;/script&gt; &amp; more</p>",
    );
  });

  it("drops empty paragraphs", () => {
    expect(toBodyHtml("A\n\n\n\nB")).toBe("<p>A</p>\n<p>B</p>");
  });
});

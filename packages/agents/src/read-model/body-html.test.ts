import { describe, expect, it } from "vitest";
import { toBodyHtml } from "./index.js";

describe("toBodyHtml", () => {
  it("wraps each blank-line-separated paragraph in <p>", () => {
    const html = toBodyHtml("Elso bekezdes.\n\nMasodik bekezdes.");
    expect(html).toBe("<p>Elso bekezdes.</p>\n<p>Masodik bekezdes.</p>");
  });

  it("drops empty paragraphs from excess blank lines", () => {
    const html = toBodyHtml("Egy.\n\n\n\nKetto.");
    expect(html.match(/<p>/g)).toHaveLength(2);
  });

  it("escapes HTML special characters so a quoted <script> can't execute", () => {
    const html = toBodyHtml('Az edzo szerint: "<script>alert(1)</script>"');
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("escapes ampersands and quotes", () => {
    const html = toBodyHtml('A & B "csapat" gyozott.');
    expect(html).toContain("&amp;");
    expect(html).toContain("&quot;csapat&quot;");
  });
});

import { describe, expect, it } from "vitest";
import { escapeXml } from "./xml";

describe("escapeXml", () => {
  it("escapes all five XML special characters", () => {
    expect(escapeXml(`<a href="x">Q&A 'quote'</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;Q&amp;A &apos;quote&apos;&lt;/a&gt;",
    );
  });

  it("leaves plain text untouched", () => {
    expect(escapeXml("Liverpool 3-1 Arsenal")).toBe("Liverpool 3-1 Arsenal");
  });
});

import { describe, expect, it } from "vitest";
import { archivePageUrl, parseArchivePage, visibleArchivePages } from "./archive-pagination";

describe("public news archive pagination", () => {
  it("accepts only safe positive page numbers", () => {
    expect(parseArchivePage(undefined)).toBe(1);
    expect(parseArchivePage("1")).toBe(1);
    expect(parseArchivePage("27")).toBe(27);
    for (const value of ["0", "-1", "1.5", "abc", "01", "9007199254740992", ["1", "2"]]) {
      expect(parseArchivePage(value)).toBeNull();
    }
  });

  it("links every archive page with a distinct crawlable URL", () => {
    expect(archivePageUrl("labdarugas", 1)).toBe("/kategoria/labdarugas");
    expect(archivePageUrl("labdarugas", 2)).toBe("/kategoria/labdarugas?oldal=2");
    expect(visibleArchivePages(1, 27)).toEqual([1, 2, 3, 27]);
    expect(visibleArchivePages(14, 27)).toEqual([1, 12, 13, 14, 15, 16, 27]);
    expect(visibleArchivePages(27, 27)).toEqual([1, 25, 26, 27]);
    expect(visibleArchivePages(1, 1)).toEqual([1]);
  });
});

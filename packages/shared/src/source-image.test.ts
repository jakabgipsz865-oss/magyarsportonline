import { describe, expect, it } from "vitest";
import { deduplicateSourceImages, sourceImageIdentityKey } from "./source-image";

describe("source image identity", () => {
  it.each([
    [
      "https://i2-prod.mirror.co.uk/article37649174.ece/ALTERNATES/s1200d/1_photo.jpg",
      "https://i2-prod.mirror.co.uk/article37649174.ece/ALTERNATES/s1200f/1_photo.jpg",
    ],
    [
      "https://www.thesun.co.uk/wp-content/uploads/2026/09/photo-1107818138.jpg?quality=90&w=1920&crop=1",
      "https://www.thesun.co.uk/wp-content/uploads/2026/09/photo-1107818138_88c4a1.jpg?strip=all",
    ],
    ["https://images.bild.de/story/photo?w=1280", "https://images.bild.de/story/photo?w=992"],
    ["https://cdn.example.test/photo.jpg", "https://cdn.example.test/photo-1200x771.jpg"],
  ])("matches CDN variants of one image", (first, second) => {
    expect(sourceImageIdentityKey(first)).toBe(sourceImageIdentityKey(second));
    expect(deduplicateSourceImages([{ url: first }, { url: second }])).toEqual([{ url: first }]);
  });

  it("keeps identity query parameters and distinct asset paths", () => {
    expect(sourceImageIdentityKey("https://cdn.test/image?id=one&w=1200")).not.toBe(
      sourceImageIdentityKey("https://cdn.test/image?id=two&w=1200"),
    );
    expect(
      deduplicateSourceImages([
        { url: "https://cdn.test/first.jpg?w=1200" },
        { url: "https://cdn.test/second.jpg?w=1200" },
      ]),
    ).toHaveLength(2);
  });
});

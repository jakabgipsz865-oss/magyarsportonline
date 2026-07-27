import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseFeedXml } from "./rss-fetcher.js";

const FIXTURES_DIR = path.join(import.meta.dirname, "..", "..", "..", "..", "scripts", "fixtures");

describe("parseFeedXml", () => {
  it("parses the demo source-a fixture into a normalized item", async () => {
    const xml = await readFile(path.join(FIXTURES_DIR, "source-a.xml"), "utf-8");
    const items = await parseFeedXml(xml);

    expect(items).toHaveLength(1);
    expect(items[0]?.title).toContain("Duna FC");
    expect(items[0]?.link).toBe(
      "https://demo-sporthir-ugynokseg.example/hirek/duna-fc-tisza-se-2-1",
    );
    expect(items[0]?.contentText).not.toMatch(/\s{2,}/);
    expect(items[0]?.publishedAt).toBeInstanceOf(Date);
  });

  it("drops items without a usable link", async () => {
    const xml = `<?xml version="1.0"?>
      <rss version="2.0"><channel>
        <item><title>No link here</title></item>
      </channel></rss>`;
    const items = await parseFeedXml(xml);
    expect(items).toHaveLength(0);
  });

  it("normalizes whitespace in the extracted body text", async () => {
    const xml = `<?xml version="1.0"?>
      <rss version="2.0"><channel>
        <item>
          <title>Cim</title>
          <link>https://example.test/1</link>
          <description>Sok    szokoz   \n\n itt.</description>
        </item>
      </channel></rss>`;
    const items = await parseFeedXml(xml);
    expect(items[0]?.contentText).toBe("Sok szokoz itt.");
  });
});

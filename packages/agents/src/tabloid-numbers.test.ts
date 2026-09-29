import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import manifest from "./fixtures/number-audit-124-manifest.json";
import { normalizeNumericAmount, unverifiedNumericClaims } from "./tabloid-numbers";
import { assessTabloidQuality } from "./tabloid";

describe("multilingual numbers remain fail closed", () => {
  it.each([
    ["en", "4.6 million euros"],
    ["de", "4,6 Millionen Euro"],
    ["es", "4,6 millones de euros"],
    ["it", "4,6 milioni di euro"],
  ])("normalizes %s money", (language, source) => {
    expect(
      unverifiedNumericClaims(source, "4,6 millió euró", { sourceLanguage: language }),
    ).toEqual([]);
    expect(
      unverifiedNumericClaims(source, "4,6 millió dollár", { sourceLanguage: language }),
    ).not.toEqual([]);
  });
  it("does not guess an unwritten currency or score", () => {
    expect(unverifiedNumericClaims("The transfer cost 40m.", "40 millió euró")).not.toEqual([]);
    expect(unverifiedNumericClaims("We expect 3-1 new signings.", "3-1 új igazolás")).not.toEqual(
      [],
    );
    expect(unverifiedNumericClaims("Bayern won 3-1.", "A Bayern 1-3-ra nyert.")).not.toEqual([]);
  });
  it("respects decimal locale, exact units and ambiguous formatting", () => {
    expect(normalizeNumericAmount("2,302", "it")).toBe("2.302");
    expect(normalizeNumericAmount("2,302", "en")).toBe("2302");
    expect(normalizeNumericAmount("1.23.456", "de")).toBeNull();
    expect(
      unverifiedNumericClaims("He is 1.63 Meter tall.", "163 centiméter magas", {
        sourceLanguage: "de",
      }),
    ).toEqual([]);
    expect(unverifiedNumericClaims("He is 6ft 5in tall.", "196 centiméter magas")).not.toEqual([]);
    expect(
      unverifiedNumericClaims("500.000 euros", "500 000 euró", { sourceLanguage: "en" }),
    ).not.toEqual([]);
  });
});

// Full stored texts are kept outside git. See docs/runbooks/control-tower-release.md.
const corpusPath = process.env["MSO_NUMBER_CORPUS"];
describe.skipIf(!corpusPath)("124 authenticated real source/draft pairs", () => {
  it("passes A/B only when proven, and keeps every C/D blocked", () => {
    const rows = JSON.parse(readFileSync(corpusPath!, "utf8")) as Array<Record<string, string>>;
    expect(rows).toHaveLength(124);
    const report = rows.map((row, index) => {
      const entry = manifest[index]!;
      expect(row["story_id"]).toBe(entry.id);
      const hash = createHash("sha256")
        .update(
          JSON.stringify(
            ["title_original", "body_original", "title_hu", "lead_hu", "body_hu"].map(
              (k) => row[k],
            ),
          ),
        )
        .digest("hex");
      expect(hash).toBe(entry.sha256);
      const issues = unverifiedNumericClaims(
        `${row["title_original"]}\n${row["body_original"]}`,
        `${row["title_hu"]} ${row["lead_hu"]} ${row["body_hu"]}`,
        { sourceLanguage: row["language"]! },
      );
      expect(issues.length === 0, `${index + 1}/${entry.category}: ${issues.join(",")}`).toBe(
        ["A", "B"].includes(entry.category),
      );
      const stored = JSON.parse(row["quality_issues"] || "[]") as Array<{
        code: string;
        repaired?: boolean;
      }>;
      const warnings = stored
        .filter((f) => f.code === "writer_language_warning" && !f.repaired)
        .map((f) => "Persisted Writer warning");
      const flags = assessTabloidQuality({
        sourceLanguage: row["language"]!,
        sourceContent: `${row["title_original"]}\n${row["body_original"]}`,
        output: {
          title_hu: row["title_hu"]!,
          lead_hu: row["lead_hu"]!,
          body_hu: row["body_hu"]!,
          language_warnings: warnings,
        },
      });
      const unresolved = stored.filter((f) => f.code !== "number_integrity" && !f.repaired);
      return {
        id: entry.id,
        category: entry.category,
        numericPass: issues.length === 0,
        flags: flags.map((f) => f.code),
        publishable: !flags.length && !unresolved.length,
      };
    });
    if (process.env["MSO_NUMBER_REPORT"])
      writeFileSync(process.env["MSO_NUMBER_REPORT"]!, JSON.stringify(report, null, 2));
    expect(report.filter((r) => r.numericPass)).toHaveLength(97);
  });
});

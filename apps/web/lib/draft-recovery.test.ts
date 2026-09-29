import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { tabloid } from "@magyarsportonline/agents";
import { sqliteD1 } from "./testing/sqlite-d1";
import { recoverSavedDrafts } from "./draft-recovery";
const corpus = process.env["MSO_NUMBER_CORPUS"],
  metadata = process.env["MSO_RECOVERY_METADATA"];
describe.skipIf(!corpus || !metadata)("real 124 saved-draft recovery, isolated SQLite", () => {
  it("dry run makes no writes; publishes only 96 proven drafts with original chronology, no AI/social, and is idempotent", async () => {
    const { db, d1 } = sqliteD1();
    try {
      const rows = JSON.parse(readFileSync(corpus!, "utf8")) as Array<Record<string, string>>;
      const meta = JSON.parse(readFileSync(metadata!, "utf8")) as Array<Record<string, string>>;
      for (const [i, row] of rows.entries()) {
        const m = meta[i]!;
        expect(m["story_id"]).toBe(row["story_id"]);
        db.prepare(
          `INSERT OR IGNORE INTO sources(id,name,base_url,type,language,license_type,reliability_tier,fetch_config,is_active) VALUES(?,?,?,?,?,?,?,?,1)`,
        ).run(
          ...[
            "source_id",
            "name",
            "base_url",
            "type",
            "source_language",
            "license_type",
            "reliability_tier",
            "fetch_config",
          ].map((k) => m[k]!),
        );
        db.prepare(
          `INSERT INTO stories(id,canonical_title,first_seen_at,status,version_count,image_url) VALUES(?,?,?,'draft',1,?)`,
        ).run(
          row["story_id"]!,
          row["title_hu"]!,
          m["story_first_seen_at"]!,
          m["story_image_url"] ?? null,
        );
        db.prepare(
          `INSERT INTO story_versions(id,story_id,version_number,title_hu,lead_hu,body_hu,generated_by_model,prompt_version,quality_issues) VALUES(?,?,1,?,?,?,'gemini-3.5-flash-lite',?,?)`,
        ).run(
          row["version_id"]!,
          row["story_id"]!,
          row["title_hu"]!,
          row["lead_hu"]!,
          row["body_hu"]!,
          tabloid.TABLOID_PROMPT,
          row["quality_issues"]!,
        );
        db.prepare(
          `INSERT INTO raw_articles(id,source_id,source_url,title_original,body_original,language,story_id,published_at_source,first_seen_at,ingested_at,content_origin,image_url,inline_images) VALUES(?,?,?,?,?,?,?,?,?,?,'full_article',?,?)`,
        ).run(
          row["raw_article_id"]!,
          m["source_id"]!,
          row["source_url"]!,
          row["title_original"]!,
          row["body_original"]!,
          row["language"]!,
          row["story_id"]!,
          m["published_at_source"] ?? null,
          m["first_seen_at"] ?? null,
          m["ingested_at"]!,
          m["image_url"] ?? null,
          m["inline_images"]!,
        );
        db.prepare(
          `INSERT INTO story_sources(id,story_id,raw_article_id,contribution_type) VALUES(?,?,?,'initial')`,
        ).run(crypto.randomUUID(), row["story_id"]!, row["raw_article_id"]!);
      }
      const ids = rows.map((r) => r["story_id"]!);
      const options = {
        activationAt: new Date("2026-09-28T17:30:00Z"),
        forceReviewMode: false,
        now: new Date("2026-09-30T00:00:00Z"),
      };
      const before = db.prepare("SELECT total_changes() n").get();
      const dry = await recoverSavedDrafts(d1, ids, options);
      expect(db.prepare("SELECT total_changes() n").get()).toEqual(before);
      expect(dry.filter((r) => r.publishable)).toHaveLength(96);
      expect(dry.filter((r) => !r.publishable)).toHaveLength(28);
      await expect(recoverSavedDrafts(d1, ids, { ...options, execute: true })).rejects.toThrow(
        "disabled",
      );
      const result = await recoverSavedDrafts(d1, ids, {
        ...options,
        execute: true,
        executionEnabled: true,
      });
      expect(result.filter((r) => r.status === "published")).toHaveLength(96);
      expect(db.prepare("SELECT count(*) n FROM social_posts").get()).toEqual({ n: 0 });
      expect(db.prepare("SELECT count(*) n FROM llm_usage").get()).toEqual({ n: 0 });
      expect(db.prepare("SELECT count(*) n FROM story_read_model").get()).toEqual({ n: 96 });
      expect(
        db
          .prepare(
            "SELECT count(*) n FROM stories s JOIN draft_recovery_publications r ON r.story_id=s.id WHERE s.published_at!=r.published_at",
          )
          .get(),
      ).toEqual({ n: 0 });
      expect(
        (
          await recoverSavedDrafts(d1, ids, { ...options, execute: true, executionEnabled: true })
        ).filter((r) => r.status === "published"),
      ).toHaveLength(0);
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      db.close();
    }
  });
});

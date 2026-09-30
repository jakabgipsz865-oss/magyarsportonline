import { describe, expect, it } from "vitest";
import { sqliteD1 } from "./testing/sqlite-d1";
import {
  loadControlTower,
  qualifiedReadSummary,
  schedulerHealth,
  qaIssueCounts,
} from "./control-tower";
import { monetizationEstimates } from "./monetization";
describe("honest control-tower metrics", () => {
  it("counts Writer Stories once across QA versions, excludes unmeasured audience metrics and bounds qualified reads", async () => {
    const { db, d1 } = sqliteD1([
      "0001_initial",
      "0002_qualified_read_trending",
      "0003_draft_recovery",
      "0004_language_qa",
    ]);
    try {
      db.exec(`INSERT INTO stories(id,canonical_title,status,version_count,published_at) VALUES('published','Live','published',2,'2026-09-30T00:00:00Z'),('draft','Held','draft',1,NULL);
    INSERT INTO story_versions(id,story_id,version_number,title_hu,lead_hu,body_hu,generated_by_model,prompt_version,created_at,quality_issues,is_published)
    VALUES('v1','published',1,'Live','Lead','Body','gemini-3.5-flash-lite','tabloid-hu@2','2026-09-29T23:00:00Z',NULL,1),
    ('v2','published',2,'Live','Lead','New body','@cf/openai/gpt-oss-120b','tabloid-hu@2','2026-09-29T23:30:00Z',NULL,1),
    ('v3','draft',1,'Held','Lead','Body','gemini-3.5-flash-lite','tabloid-hu@2','2026-09-29T23:00:00Z','[{"code":"number_integrity","repaired":false}]',0);
    UPDATE stories SET current_version_id='v2' WHERE id='published';
    INSERT INTO qualified_read_events VALUES('recent','published','direct','2026-09-29T23:00:00Z','2026-09-29T23:00:00Z'),('old','published','direct','2026-09-28T23:00:00Z','2026-09-28T23:00:00Z');`);
      for (const [id, story, version, type] of [
        ["q1", "published", "v2", "FOREIGN_LANGUAGE"],
        ["q2", "draft", "v3", "UNNATURAL_HUNGARIAN"],
      ]) {
        db.prepare(
          "INSERT INTO language_qa_audits(id,story_id,version_id,content_hash,original_fields,status,model,issues,queued_at,audited_at,next_attempt_at) VALUES(?,?,?,'hash','{}','repair_rejected','fixture',?,'2026-09-29T23:00:00Z','2026-09-29T23:00:00Z','2026-09-29T23:00:00Z')",
        ).run(id!, story!, version!, JSON.stringify([{ type }]));
      }
      expect(await qaIssueCounts(d1, new Date("2026-09-29T00:00:00Z"))).toEqual([
        { issue_type: "FOREIGN_LANGUAGE", count: 1 },
        { issue_type: "UNNATURAL_HUNGARIAN", count: 1 },
      ]);
      const data = await loadControlTower(d1, new Date("2026-09-30T00:00:00Z"));
      expect(data.stats).toMatchObject({
        writerStories: 2,
        checked: 2,
        qualityPass: 1,
        draft: 1,
        qualityBlocked: 1,
        published24h: 1,
        publishedToday: 1,
      });
      expect(data.flags).toEqual([{ code: "number_integrity", stories: 1, occurrences: 1 }]);
      expect((await qualifiedReadSummary(d1, new Date("2026-09-30T00:00:00Z"))).count).toBe(1);
      expect(monetizationEstimates(null)).toEqual({
        inventory: null,
        averageDailyUv: null,
        threshold: null,
      });
      expect(schedulerHealth(null)).toContain("Nincs");
      expect(
        schedulerHealth(
          { status: "ok", updated_at: "2026-09-29T23:55:00Z", last_error_at: null, detail: "{}" },
          new Date("2026-09-30T00:00:00Z"),
        ),
      ).toContain("STALE");
    } finally {
      db.close();
    }
  });
  it("estimates inventory and internal thresholds only with actual PV and complete 30-day UV input", () => {
    expect(
      monetizationEstimates({
        source: "verified_existing",
        monthlyPageviews: 10000,
        uniqueVisitorsByDay: Array(30).fill(5000),
      }),
    ).toMatchObject({
      inventory: [
        { slots: 1, theoretical: 10000, sellable: 7000 },
        { slots: 2, theoretical: 20000, sellable: 14000 },
        { slots: 3, theoretical: 30000, sellable: 21000 },
      ],
      averageDailyUv: 5000,
      threshold: "Direkt hirdetés",
    });
    expect(
      monetizationEstimates({
        source: "verified_existing",
        monthlyPageviews: null,
        uniqueVisitorsByDay: Array(29).fill(5000),
      }).averageDailyUv,
    ).toBeNull();
  });
});

import { describe, it, expect } from "vitest";
import { TABLOID_PUBLIC_PROMPT } from "@magyarsportonline/shared";
import { sqliteD1 } from "./testing/sqlite-d1";
import {
  recordAudienceEvent,
  audienceReport,
  cleanupAudience,
  audienceCsv,
} from "./audience-store";
import type { AudienceEvent } from "./audience";
function fixture() {
  const f = sqliteD1([
    "0001_initial",
    "0002_qualified_read_trending",
    "0003_draft_recovery",
    "0004_language_qa",
    "0005_first_party_audience_analytics",
  ]);
  f.db.exec(
    "INSERT INTO stories(id,canonical_title,first_seen_at,status) VALUES('story','Title','2026-09-29T00:00:00Z','published')",
  );
  // Use the real read-model schema with all required columns.
  f.db
    .prepare(
      `INSERT INTO story_read_model(story_id,slug,title_hu,lead_hu,body_html,sources_summary,version_history_summary,tags,published_at,last_updated_at)
    VALUES('story','story','Test title','Lead','<p>Text</p>','[]',?,'[]','2026-09-29T00:00:00.000000+00:00','2026-09-29T00:00:00Z')`,
    )
    .run(JSON.stringify([{ prompt_version: TABLOID_PUBLIC_PROMPT, is_current: true }]));
  return f;
}
function event(id: string, session = "session", story: string | null = null): AudienceEvent {
  return {
    eventId: id,
    sessionId: session,
    type: "page_view",
    path: story ? "/hir/story" : "/",
    storyId: story,
    source: "direct",
    placement: "direct",
    parentEventId: null,
  };
}
describe("atomic audience rollups, time windows and privacy retention", () => {
  it("deduplicates event IDs and sessions across UTC days; QR requires a matching PV and is once/session/story", async () => {
    const { db, d1 } = fixture();
    const now = new Date("2026-09-30T12:00:00Z");
    const pv = event("pv", "same", "story");
    expect(await recordAudienceEvent(d1, pv, new Date("2026-09-29T23:59:00Z"))).toBe(true);
    expect(await recordAudienceEvent(d1, pv, now)).toBe(false);
    expect(
      await recordAudienceEvent(d1, event("pv2", "same"), new Date("2026-09-30T00:01:00Z")),
    ).toBe(true);
    await recordAudienceEvent(d1, event("pv3", "other"), new Date("2026-09-30T00:02:00Z"));
    const qr = { ...pv, eventId: "qr", type: "qualified_read" as const, parentEventId: "pv" };
    expect(await recordAudienceEvent(d1, { ...qr, sessionId: "wrong" }, now)).toBe(false);
    expect(await recordAudienceEvent(d1, { ...qr, parentEventId: "nonexistent" }, now)).toBe(false);
    expect(await recordAudienceEvent(d1, qr, new Date("2026-09-30T00:00:00Z"))).toBe(true);
    expect(await recordAudienceEvent(d1, { ...qr, eventId: "qr-duplicate" }, now)).toBe(false);
    const report = await audienceReport(d1, now);
    expect(report.periods[0]).toMatchObject({
      pv: 3,
      sessions: 2,
      qualified: 1,
      articlePv: 1,
      qualifiedViews: 1,
    });
    expect(report.history).toMatchObject({ pv: 3, qualified: 1, days: 2 });
    expect(db.prepare("SELECT SUM(daily_sessions) n FROM audience_daily").get()).toMatchObject({
      n: 3,
    });
    expect(db.prepare("SELECT COUNT(*) n FROM qualified_read_events").get()).toMatchObject({
      n: 1,
    });
    expect(
      db.prepare("SELECT SUM(normal_reads) n FROM qualified_read_buckets").get(),
    ).toMatchObject({ n: 1 });
    const csv = audienceCsv(report);
    expect(csv).not.toContain("session_id");
    expect(csv).not.toContain("event_id");
    expect(csv).not.toContain("qr-duplicate");
    db.close();
  });
  it("calculates exact bounded rolling windows and retains lifetime daily/story/source rollups after raw cleanup", async () => {
    const { db, d1 } = fixture(),
      now = new Date("2026-11-01T12:00:00Z");
    for (const [id, days] of [
      ["old", 40],
      ["month", 20],
      ["week", 5],
      ["day", 0.5],
    ] as const)
      await recordAudienceEvent(
        d1,
        event(id, id, "story"),
        new Date(now.getTime() - days * 86400000),
      );
    const before = await audienceReport(d1, now);
    expect(before.periods.map((p) => p.pv)).toEqual([1, 2, 3]);
    expect(before.periods.every((p) => p.complete)).toBe(true);
    expect(await cleanupAudience(d1, now)).toBe(1);
    const after = await audienceReport(d1, now);
    expect(after.history.pv).toBe(4);
    expect(after.periods.map((p) => p.pv)).toEqual([1, 2, 3]);
    expect(db.prepare("SELECT SUM(page_views) n FROM audience_story_daily").get()).toMatchObject({
      n: 4,
    });
    expect(db.prepare("SELECT SUM(page_views) n FROM audience_source_daily").get()).toMatchObject({
      n: 4,
    });
    expect(
      db
        .prepare("PRAGMA table_info(audience_daily)")
        .all()
        .map((x) => (x as { name: string }).name),
    ).not.toContain("session_id");
    db.close();
  });
  it("does not fabricate pre-instrumentation completeness or include withdrawn/unpublished content", async () => {
    const { db, d1 } = fixture(),
      now = new Date("2026-09-30T12:00:00Z");
    await recordAudienceEvent(d1, event("pv", "s", "story"), now);
    db.exec("UPDATE stories SET status='draft' WHERE id='story'");
    expect(await recordAudienceEvent(d1, event("private", "s", "story"), now)).toBe(false);
    expect(
      (await audienceReport(d1, new Date(now.getTime() + 1000))).periods.every((p) => !p.complete),
    ).toBe(true);
    db.close();
  });
  it("expires each raw event by its own age without cascading a recent QR; anonymous history survives", async () => {
    const { db, d1 } = fixture(),
      now = new Date("2026-11-01T12:00:00Z");
    const pv = {
      eventId: "old-pv",
      sessionId: "s",
      type: "page_view" as const,
      path: "/hir/story",
      storyId: "story",
      source: "direct" as const,
      placement: "direct",
      parentEventId: null,
    };
    await recordAudienceEvent(d1, pv, new Date(now.getTime() - 32 * 86400000 + 60000));
    await recordAudienceEvent(
      d1,
      { ...pv, eventId: "recent-qr", type: "qualified_read", parentEventId: "old-pv" },
      now,
    );
    await cleanupAudience(d1, new Date(now.getTime() + 120000));
    expect(
      db.prepare("SELECT COUNT(*) n FROM audience_events WHERE event_id='recent-qr'").get(),
    ).toMatchObject({ n: 1 });
    expect((await audienceReport(d1, new Date(now.getTime() + 120000))).history).toMatchObject({
      pv: 1,
      qualified: 1,
    });
    db.close();
  });
});

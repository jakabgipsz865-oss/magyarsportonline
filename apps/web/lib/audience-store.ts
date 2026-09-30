import type { D1Client } from "@magyarsportonline/db/d1";
import { TABLOID_PUBLIC_PROMPT, TABLOID_PUBLIC_START } from "@magyarsportonline/shared";
import { d1Timestamp } from "@magyarsportonline/db/d1";
import { RAW_AUDIENCE_DAYS, type AudienceEvent } from "./audience";
export async function recordAudienceEvent(
  db: D1Client,
  e: AudienceEvent,
  now = new Date(),
): Promise<boolean> {
  const publicStory = `EXISTS (SELECT 1 FROM story_read_model r JOIN stories s ON s.id=r.story_id AND s.status='published'
    WHERE r.story_id=? AND '/hir/'||r.slug=? AND r.published_at>=? AND length(trim(r.title_hu))>0 AND length(trim(r.body_html))>0
    AND EXISTS (SELECT 1 FROM json_each(r.version_history_summary) v WHERE json_extract(v.value,'$.prompt_version')=? AND json_extract(v.value,'$.is_current')=1))`;
  const publicArgs = e.storyId
    ? [e.storyId, e.path, d1Timestamp(new Date(TABLOID_PUBLIC_START)), TABLOID_PUBLIC_PROMPT]
    : [];
  const result =
    e.type === "page_view"
      ? await db
          .prepare(
            `INSERT OR IGNORE INTO audience_events(event_id,session_id,event_type,page,story_id,source,placement,parent_event_id,occurred_at)
      SELECT ?,?,'page_view',?,?,?,?,NULL,? WHERE ${e.storyId ? publicStory : "1=1"}`,
          )
          .bind(
            e.eventId,
            e.sessionId,
            e.path,
            e.storyId,
            e.source,
            e.placement,
            now.toISOString(),
            ...publicArgs,
          )
          .run()
      : await db
          .prepare(
            `INSERT OR IGNORE INTO audience_events(event_id,session_id,event_type,page,story_id,source,placement,parent_event_id,occurred_at)
      SELECT ?,p.session_id,'qualified_read',p.page,p.story_id,p.source,p.placement,p.event_id,? FROM audience_events p
      WHERE p.event_id=? AND p.session_id=? AND p.story_id=? AND p.page=? AND p.event_type='page_view'
        AND p.occurred_at>=? AND p.occurred_at<=? AND ${publicStory}`,
          )
          .bind(
            e.eventId,
            now.toISOString(),
            e.parentEventId,
            e.sessionId,
            e.storyId,
            e.path,
            new Date(now.getTime() - RAW_AUDIENCE_DAYS * 86400000).toISOString(),
            now.toISOString(),
            ...publicArgs,
          )
          .run();
  return result.meta.changes > 0;
}
export async function cleanupAudience(db: D1Client, now = new Date()): Promise<number> {
  // Bounded indexed sweep; repeated every five minutes. Rollups are never deleted.
  const result = await db
    .prepare(
      `DELETE FROM audience_events WHERE event_id IN
    (SELECT event_id FROM audience_events INDEXED BY audience_events_time WHERE occurred_at<? ORDER BY occurred_at LIMIT 5000)`,
    )
    .bind(new Date(now.getTime() - RAW_AUDIENCE_DAYS * 86400000).toISOString())
    .run();
  return result.meta.changes;
}
export interface AudienceCounts {
  pv: number;
  articlePv: number;
  sessions: number;
  qualified: number;
  qualifiedViews: number;
}
export interface TopContent {
  story_id: string;
  title_hu: string;
  slug: string;
  pv: number;
  qualified: number;
  qualifiedViews: number;
}
export interface AudiencePeriod extends AudienceCounts {
  days: number;
  complete: boolean;
  topPv: TopContent[];
  topReads: TopContent[];
  sources: { source: string; pv: number; qualified: number }[];
}
export interface AudienceReport {
  startedAt: string | null;
  periods: AudiencePeriod[];
  history: { days: number; pv: number; articlePv: number; qualified: number };
}
export async function audienceReport(db: D1Client, now = new Date()): Promise<AudienceReport> {
  const start = await db
    .prepare("SELECT started_at FROM audience_measurement WHERE id=1")
    .first<{ started_at: string }>();
  const periods: AudiencePeriod[] = [];
  for (const days of [1, 7, 30]) {
    const cutoff = new Date(now.getTime() - days * 86400000).toISOString(),
      end = now.toISOString();
    const counts = await db
      .prepare(
        `SELECT
      COALESCE(SUM(e.event_type='page_view'),0) pv,
      COALESCE(SUM(e.event_type='page_view' AND e.story_id IS NOT NULL),0) articlePv,
      COUNT(DISTINCT CASE WHEN e.event_type='page_view' THEN e.session_id END) sessions,
      COALESCE(SUM(e.event_type='qualified_read'),0) qualified,
      COALESCE(SUM(e.event_type='page_view' AND EXISTS(SELECT 1 FROM audience_events q WHERE q.parent_event_id=e.event_id)),0) qualifiedViews
      FROM audience_events e INDEXED BY audience_events_time WHERE e.occurred_at>=? AND e.occurred_at<?`,
      )
      .bind(cutoff, end)
      .first<AudienceCounts>();
    const topSql = `SELECT e.story_id,r.title_hu,r.slug,
      SUM(e.event_type='page_view') pv,SUM(e.event_type='qualified_read') qualified,
      SUM(e.event_type='page_view' AND EXISTS(SELECT 1 FROM audience_events q WHERE q.parent_event_id=e.event_id)) qualifiedViews
      FROM audience_events e INDEXED BY audience_events_time JOIN story_read_model r ON r.story_id=e.story_id
      JOIN stories s ON s.id=r.story_id AND s.status='published'
      WHERE e.occurred_at>=? AND e.occurred_at<? AND e.story_id IS NOT NULL
      GROUP BY e.story_id,r.title_hu,r.slug`;
    const [pv, qr, sources] = await Promise.all([
      db
        .prepare(topSql + " ORDER BY pv DESC,qualified DESC,e.story_id LIMIT 10")
        .bind(cutoff, end)
        .all<TopContent>(),
      db
        .prepare(topSql + " ORDER BY qualified DESC,pv DESC,e.story_id LIMIT 10")
        .bind(cutoff, end)
        .all<TopContent>(),
      db
        .prepare(
          `SELECT source,SUM(event_type='page_view') pv,SUM(event_type='qualified_read') qualified
        FROM audience_events INDEXED BY audience_events_time WHERE occurred_at>=? AND occurred_at<? GROUP BY source LIMIT 7`,
        )
        .bind(cutoff, end)
        .all<{ source: string; pv: number; qualified: number }>(),
    ]);
    periods.push({
      ...counts!,
      days,
      complete: !!start && start.started_at <= cutoff,
      topPv: pv.results,
      topReads: qr.results,
      sources: sources.results,
    });
  }
  const history = await db
    .prepare(
      `SELECT COUNT(*) days,COALESCE(SUM(page_views),0) pv,
    COALESCE(SUM(article_views),0) articlePv,COALESCE(SUM(qualified_reads),0) qualified FROM audience_daily`,
    )
    .first<AudienceReport["history"]>();
  return { startedAt: start?.started_at ?? null, periods, history: history! };
}
export function audienceCsv(report: AudienceReport): string {
  const quote = (v: unknown) =>
    `"${String(v ?? "")
      .replaceAll('"', '""')
      .replace(/^[=+@-]/, "'$&")}"`;
  const rows: unknown[][] = [["period", "metric", "value", "title", "path"]];
  for (const p of report.periods) {
    const label = `rolling_${p.days}d${p.complete ? "" : "_partial"}`;
    for (const k of ["pv", "articlePv", "sessions", "qualified"] as const)
      rows.push([label, k, p[k], "", ""]);
    rows.push([
      label,
      "pv_per_browser_session",
      p.sessions ? p.pv / p.sessions : "unavailable",
      "",
      "",
    ]);
    rows.push([
      label,
      "qualified_article_views_ratio",
      p.articlePv ? p.qualifiedViews / p.articlePv : "unavailable",
      "",
      "",
    ]);
    for (const kind of ["topPv", "topReads"] as const)
      for (const t of p[kind])
        rows.push([label, kind, `${t.pv} PV / ${t.qualified} QR`, t.title_hu, `/hir/${t.slug}`]);
  }
  rows.push(
    ["all_time", "pv", report.history.pv, "", ""],
    ["all_time", "qualified", report.history.qualified, "", ""],
  );
  return "\uFEFF" + rows.map((row) => row.map(quote).join(",")).join("\r\n");
}

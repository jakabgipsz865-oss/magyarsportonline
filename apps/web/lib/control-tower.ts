import { tabloid } from "@magyarsportonline/agents";
import { d1Timestamp, type D1Client } from "@magyarsportonline/db/d1";
export interface TowerStats {
  writerStories: number;
  checked: number;
  qualityPass: number;
  draft: number;
  qualityBlocked: number;
  published24h: number;
  publishedToday: number;
  lastPublication: string | null;
}
export interface TowerUsage {
  role: string;
  status: string;
  calls: number;
  cost: number;
}
export interface QaCount {
  status: string;
  count: number;
  todayCount: number;
}
export interface SchedulerState {
  status: string;
  updated_at: string;
  last_error_at: string | null;
  detail: string;
}
export interface SourceState {
  name: string;
  last_fetched_at: string | null;
  last_fetch_status: string | null;
  is_active: number;
}
const sourceDay = (date: Date) => date.toISOString().slice(0, 10);
export async function loadControlTower(db: D1Client, now = new Date()) {
  const since = new Date(now.getTime() - 24 * 3600_000),
    day = sourceDay(now),
    month = day.slice(0, 7) + "-01";
  // Range indexes bound both the Writer cohort and usage; no historic article/analytics scan.
  const [stats, usage24h, usageMonth, qa, scheduler, sources, social, flags] = await Promise.all([
    db
      .prepare(
        `WITH cohort AS (SELECT DISTINCT story_id FROM story_versions WHERE created_at>=? AND julianday(created_at)>=julianday(?) AND generated_by_model=?), latest AS
   (SELECT s.*,v.quality_issues FROM cohort c JOIN stories s ON s.id=c.story_id JOIN story_versions v ON v.id=coalesce(s.current_version_id,(SELECT id FROM story_versions WHERE story_id=s.id ORDER BY version_number DESC LIMIT 1)))
   SELECT (SELECT count(*) FROM cohort) writerStories,coalesce(sum(NOT EXISTS(SELECT 1 FROM json_each(coalesce(quality_issues,'[]')) j WHERE json_extract(j.value,'$.code')='writer_validation_pending')),0) checked,
    coalesce(sum(CASE WHEN NOT EXISTS(SELECT 1 FROM json_each(coalesce(quality_issues,'[]')) j WHERE coalesce(json_extract(j.value,'$.repaired'),0)=0) THEN 1 ELSE 0 END),0) qualityPass,
    coalesce(sum(status IN ('draft','pending_review','written','seo_ready')),0) draft,
    coalesce(sum(status IN ('draft','pending_review','written','seo_ready') AND EXISTS(SELECT 1 FROM json_each(coalesce(quality_issues,'[]')) j WHERE coalesce(json_extract(j.value,'$.repaired'),0)=0)),0) qualityBlocked,
    (SELECT count(*) FROM stories WHERE status='published' AND published_at>=? AND julianday(published_at)>=julianday(?)) published24h,
    (SELECT count(*) FROM stories WHERE status='published' AND published_at>=?) publishedToday,
    (SELECT max(published_at) FROM stories WHERE status='published') lastPublication FROM latest`,
      )
      .bind(
        sourceDay(since),
        d1Timestamp(since),
        tabloid.TABLOID_MODEL,
        sourceDay(since),
        d1Timestamp(since),
        day,
      )
      .first<TowerStats>(),
    db
      .prepare(
        `SELECT role,status,count(*) calls,coalesce(sum(CAST(cost_usd AS REAL)),0) cost FROM llm_usage WHERE occurred_at>=? AND julianday(occurred_at)>=julianday(?) GROUP BY role,status`,
      )
      .bind(sourceDay(since), d1Timestamp(since))
      .all<TowerUsage>(),
    db
      .prepare(
        `SELECT role,status,count(*) calls,coalesce(sum(CAST(cost_usd AS REAL)),0) cost FROM llm_usage WHERE occurred_at>=? GROUP BY role,status`,
      )
      .bind(month)
      .all<TowerUsage>(),
    db
      .prepare(
        `SELECT status,count(*) count,sum(audited_at>=?) todayCount FROM language_qa_audits WHERE audited_at>=? AND julianday(audited_at)>=julianday(?) GROUP BY status`,
      )
      .bind(day, sourceDay(since), d1Timestamp(since))
      .all<QaCount>(),
    db
      .prepare("SELECT * FROM operational_state WHERE component='scheduler'")
      .first<SchedulerState>(),
    db
      .prepare(
        "SELECT name,last_fetched_at,last_fetch_status,is_active FROM sources ORDER BY name LIMIT 100",
      )
      .all<SourceState>(),
    db
      .prepare(
        `SELECT status,count(*) count FROM social_posts WHERE platform='facebook' AND created_at>=? AND julianday(created_at)>=julianday(?) GROUP BY status`,
      )
      .bind(sourceDay(since), d1Timestamp(since))
      .all<{ status: string; count: number }>(),
    db
      .prepare(
        `SELECT json_extract(j.value,'$.code') code,count(DISTINCT v.story_id) stories,count(*) occurrences FROM story_versions v JOIN json_each(coalesce(v.quality_issues,'[]')) j
   WHERE v.created_at>=? AND julianday(v.created_at)>=julianday(?) AND coalesce(json_extract(j.value,'$.repaired'),0)=0
   AND v.id=coalesce((SELECT current_version_id FROM stories WHERE id=v.story_id),(SELECT id FROM story_versions WHERE story_id=v.story_id ORDER BY version_number DESC LIMIT 1)) GROUP BY code ORDER BY stories DESC`,
      )
      .bind(sourceDay(since), d1Timestamp(since))
      .all<{ code: string; stories: number; occurrences: number }>(),
  ]);
  const lastIngest =
    sources.results
      .filter((s) => s.last_fetch_status === "ok" && s.last_fetched_at)
      .map((s) => s.last_fetched_at!)
      .sort()
      .at(-1) ?? null;
  return {
    stats,
    usage24h: usage24h.results,
    usageMonth: usageMonth.results,
    qa: qa.results,
    scheduler,
    sources: sources.results,
    social: social.results,
    flags: flags.results,
    lastIngest,
  };
}
export function schedulerHealth(state: SchedulerState | null, now = new Date()): string {
  if (!state) return "Nincs beérkezett scheduler-mérés";
  const age = now.getTime() - new Date(state.updated_at).getTime();
  if (!Number.isFinite(age) || age < 0 || age > 3 * 60_000) return "STALE · nincs friss heartbeat";
  return state.status === "ok" ? "OK · sikeres scheduler-kör" : "HIBA · sikertelen scheduler-ág";
}
export async function qualifiedReadSummary(db: D1Client, now = new Date()) {
  const since = new Date(now.getTime() - 24 * 3600_000).toISOString();
  const [count, top, sources] = await Promise.all([
    db
      .prepare("SELECT count(*) count FROM qualified_read_events WHERE occurred_at>=?")
      .bind(since)
      .first<{ count: number }>(),
    db
      .prepare(
        `SELECT e.story_id,r.title_hu,r.slug,count(*) count FROM qualified_read_events e JOIN story_read_model r ON r.story_id=e.story_id JOIN stories s ON s.id=e.story_id AND s.status='published' WHERE e.occurred_at>=? GROUP BY e.story_id ORDER BY count DESC LIMIT 5`,
      )
      .bind(since)
      .all<{ story_id: string; title_hu: string; slug: string; count: number }>(),
    db
      .prepare(
        "SELECT source,count(*) count FROM qualified_read_events WHERE occurred_at>=? GROUP BY source",
      )
      .bind(since)
      .all<{ source: string; count: number }>(),
  ]);
  return { count: count?.count ?? 0, top: top.results, sources: sources.results };
}

/** Group by the issue expression: json_each.type is a different JSON metadata column. */
export async function qaIssueCounts(db: D1Client, since: Date) {
  return (
    await db
      .prepare(
        `SELECT json_extract(j.value,'$.type') issue_type,count(DISTINCT q.story_id) count FROM language_qa_audits q JOIN json_each(q.issues) j WHERE q.audited_at>=? AND julianday(q.audited_at)>=julianday(?) GROUP BY json_extract(j.value,'$.type')`,
      )
      .bind(sourceDay(since), d1Timestamp(since))
      .all<{ issue_type: string; count: number }>()
  ).results;
}

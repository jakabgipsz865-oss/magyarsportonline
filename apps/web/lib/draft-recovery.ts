import { tabloid, seo } from "@magyarsportonline/agents";
import { d1Timestamp, type D1Client } from "@magyarsportonline/db/d1";
import { TABLOID_PUBLIC_START, type TabloidSourceMode } from "@magyarsportonline/shared";
import { NUMBER_PARSER_VERSION } from "../../../packages/agents/src/tabloid-numbers";
import { projectD1Story, relevantD1Knowledge } from "./d1-tabloid";
import registry from "./tabloid-sources.json";

interface DraftRow {
  story_id: string;
  status: string;
  current_version_id: string | null;
  version_id: string;
  slug: string | null;
  title_hu: string;
  lead_hu: string;
  body_hu: string;
  quality_issues: string | null;
  prompt_version: string;
  is_published: number;
  raw_id: string;
  source_id: string;
  source_url: string;
  title_original: string;
  body_original: string;
  language: string;
  content_origin: string;
  published_at_source: string | null;
  first_seen_at: string | null;
  ingested_at: string;
  fetch_config: string;
}
export interface RecoveryDecision {
  storyId: string;
  versionId: string;
  publishable: boolean;
  reasons: string[];
  publishedAt: string | null;
  status?: string;
}
export interface RecoveryOptions {
  activationAt: Date;
  forceReviewMode: boolean;
  now?: Date;
  execute?: boolean;
  executionEnabled?: boolean;
}

/** Explicit saved-draft cohort only. No LLM client, queue or social producer is reachable. */
export async function recoverSavedDrafts(
  db: D1Client,
  ids: string[],
  options: RecoveryOptions,
): Promise<RecoveryDecision[]> {
  if (
    !ids.length ||
    ids.length > 124 ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => !/^[-a-f0-9]{36}$/u.test(id))
  )
    throw new Error("Invalid bounded Story cohort");
  if (options.execute && (!options.executionEnabled || !db.batch))
    throw new Error("Recovery execution disabled");
  const now = options.now ?? new Date();
  const decisions: RecoveryDecision[] = [];
  for (const id of ids) {
    const rows = await db
      .prepare(
        `SELECT s.id story_id,s.status,s.current_version_id,s.slug,
      v.id version_id,v.title_hu,v.lead_hu,v.body_hu,v.quality_issues,v.prompt_version,v.is_published,
      r.id raw_id,r.source_id,r.source_url,r.title_original,r.body_original,r.language,r.content_origin,
      r.published_at_source,r.first_seen_at,r.ingested_at,src.fetch_config
      FROM stories s JOIN story_versions v ON v.story_id=s.id
      JOIN story_sources ss ON ss.story_id=s.id AND ss.excluded=0
      JOIN raw_articles r ON r.id=ss.raw_article_id JOIN sources src ON src.id=r.source_id
      WHERE s.id=? AND v.version_number=(SELECT max(version_number) FROM story_versions WHERE story_id=s.id)
      LIMIT 2`,
      )
      .bind(id)
      .all<DraftRow>();
    const row = rows.results[0];
    if (!row) {
      decisions.push({
        storyId: id,
        versionId: "",
        publishable: false,
        reasons: ["missing_saved_draft"],
        publishedAt: null,
      });
      continue;
    }
    const reasons: string[] = [];
    if (rows.results.length !== 1) reasons.push("ambiguous_source");
    if (
      !["draft", "pending_review", "written", "seo_ready"].includes(row.status) ||
      row.is_published ||
      row.current_version_id
    )
      reasons.push("not_unpublished_draft");
    if (row.prompt_version !== tabloid.TABLOID_PROMPT || row.content_origin !== "full_article")
      reasons.push("wrong_prompt_or_incomplete_source");
    const chronology = row.published_at_source ?? row.first_seen_at;
    const validDate = (value: string | null): value is string =>
      Boolean(value && Number.isFinite(new Date(value).getTime()) && new Date(value) <= now);
    if (
      !validDate(chronology) ||
      !validDate(row.first_seen_at) ||
      new Date(row.first_seen_at) < options.activationAt ||
      new Date(row.ingested_at) < new Date(TABLOID_PUBLIC_START) ||
      new Date(chronology) < options.activationAt
    )
      reasons.push("invalid_original_chronology");
    if (options.forceReviewMode) reasons.push("force_review_mode");
    const config = JSON.parse(row.fetch_config) as {
      tabloid?: boolean;
      footballFeed?: boolean;
      mode?: TabloidSourceMode;
    };
    if (
      !config.tabloid ||
      !registry.some((s) => s.id === row.source_id) ||
      !tabloid.isFootballTabloid(
        row.title_original,
        row.body_original,
        config.footballFeed !== false,
        config.mode,
        row.source_url,
      )
    )
      reasons.push("source_not_eligible");
    if (!row.title_hu.trim() || !row.lead_hu.trim() || !row.body_hu.trim())
      reasons.push("unrenderable");
    const stored = JSON.parse(row.quality_issues ?? "[]") as Array<{
      code?: string;
      repaired?: boolean;
      detail?: string;
    }>;
    if (!Array.isArray(stored) || !stored.some((f) => f.code === "number_integrity" && !f.repaired))
      reasons.push("not_number_recovery_cohort");
    const unresolved = stored.filter((f) => f.code !== "number_integrity" && f.repaired !== true);
    reasons.push(...unresolved.map((f) => f.code ?? "unknown_stored_quality_issue"));
    const knowledge = await relevantD1Knowledge(db, row);
    const flags = tabloid.assessTabloidQuality({
      sourceLanguage: row.language,
      sourceContent: `${row.title_original}\n${row.body_original}`,
      output: {
        title_hu: row.title_hu,
        lead_hu: row.lead_hu,
        body_hu: row.body_hu,
        language_warnings: unresolved
          .filter((f) => f.code === "writer_language_warning")
          .map((f) => f.detail ?? "Persisted language warning"),
      },
      forbiddenRules: knowledge,
    });
    reasons.push(...flags.map((f) => f.code));
    const active = await db
      .prepare(
        `SELECT 1 FROM pipeline_jobs WHERE (coalesce(json_extract(event,'$.payload.story_id'),json_extract(event,'$.payload.storyId'))=? OR coalesce(json_extract(event,'$.payload.raw_article_id'),json_extract(event,'$.payload.rawArticleId'))=?) AND status IN ('pending','in_progress') LIMIT 1`,
      )
      .bind(id, row.raw_id)
      .first();
    if (active) reasons.push("active_pipeline_job");
    const unrelatedReview = await db
      .prepare(
        `SELECT 1 FROM review_queue_items WHERE story_version_id=? AND status='pending' AND reason!='content_quality_failed' LIMIT 1`,
      )
      .bind(row.version_id)
      .first();
    if (unrelatedReview) reasons.push("other_review_reason");
    const decision: RecoveryDecision = {
      storyId: id,
      versionId: row.version_id,
      publishable: !reasons.length,
      reasons: [...new Set(reasons)],
      publishedAt: validDate(chronology) ? new Date(chronology).toISOString() : null,
    };
    if (decision.publishable && options.execute) {
      const token = crypto.randomUUID(),
        time = d1Timestamp(now),
        published = d1Timestamp(new Date(chronology!));
      const slug = row.slug ?? `${seo.slugify(row.title_hu)}-${id.slice(0, 8)}`;
      const results = await db.batch!([
        db
          .prepare(
            `INSERT INTO draft_recovery_publications(version_id,story_id,request_token,parser_version,published_at,recovered_at,reason)
          SELECT ?,?,?,?,?,?,'saved draft passed deterministic gate; no Facebook enqueue'
          WHERE EXISTS(SELECT 1 FROM stories s JOIN story_versions v ON v.story_id=s.id
            WHERE s.id=? AND s.status=? AND s.current_version_id IS NULL AND v.id=? AND v.is_published=0
            AND v.quality_issues IS ? AND v.title_hu=? AND v.lead_hu=? AND v.body_hu=?
            AND v.version_number=(SELECT max(version_number) FROM story_versions WHERE story_id=s.id))
          AND EXISTS(SELECT 1 FROM raw_articles WHERE id=? AND title_original=? AND body_original=? AND published_at_source IS ? AND first_seen_at IS ?)
          AND NOT EXISTS(SELECT 1 FROM pipeline_jobs WHERE (coalesce(json_extract(event,'$.payload.story_id'),json_extract(event,'$.payload.storyId'))=? OR coalesce(json_extract(event,'$.payload.raw_article_id'),json_extract(event,'$.payload.rawArticleId'))=?) AND status IN ('pending','in_progress'))
          AND NOT EXISTS(SELECT 1 FROM review_queue_items WHERE story_version_id=? AND status='pending' AND reason!='content_quality_failed')
          ON CONFLICT(version_id) DO NOTHING`,
          )
          .bind(
            row.version_id,
            id,
            token,
            NUMBER_PARSER_VERSION,
            published,
            time,
            id,
            row.status,
            row.version_id,
            row.quality_issues,
            row.title_hu,
            row.lead_hu,
            row.body_hu,
            row.raw_id,
            row.title_original,
            row.body_original,
            row.published_at_source,
            row.first_seen_at,
            id,
            row.raw_id,
            row.version_id,
          ),
        db
          .prepare(
            `UPDATE stories SET status='published',current_version_id=?,slug=?,published_at=?,last_updated_at=? WHERE id=? AND EXISTS(SELECT 1 FROM draft_recovery_publications WHERE request_token=?)`,
          )
          .bind(row.version_id, slug, published, time, id, token),
        db
          .prepare(
            `UPDATE story_versions SET is_published=1,quality_issues=NULL WHERE id=? AND EXISTS(SELECT 1 FROM draft_recovery_publications WHERE request_token=?)`,
          )
          .bind(row.version_id, token),
        db
          .prepare(
            `UPDATE review_queue_items SET status='approved',reviewed_by='deterministic_recovery',review_note='All stored hard issues cleared; no AI or social call',resolved_at=? WHERE story_version_id=? AND status='pending' AND reason='content_quality_failed' AND EXISTS(SELECT 1 FROM draft_recovery_publications WHERE request_token=?)`,
          )
          .bind(time, row.version_id, token),
      ]);
      if (results[0]?.meta.changes === 1) {
        await projectD1Story(db, id, row.version_id);
        decision.status = "published";
      } else {
        decision.publishable = false;
        decision.reasons.push("concurrent_change");
        decision.status = "skipped";
      }
    }
    decisions.push(decision);
  }
  return decisions;
}

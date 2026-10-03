import { languageQa, tabloid } from "@magyarsportonline/agents";
import { d1Timestamp, type D1Client } from "@magyarsportonline/db/d1";
import { CloudflareApiError, estimateCloudflareCostUsd, type LlmClient } from "@magyarsportonline/llm";
import { projectD1Story, relevantD1Knowledge } from "./d1-tabloid";
import { qaContentHash, sweepLanguageQa } from "./language-qa-store";
interface Audit {
  id: string;
  story_id: string;
  version_id: string;
  content_hash: string;
  original_fields: string;
  attempts: number;
  lease_owner: string;
}
interface Live extends languageQa.ArticleFields {
  raw_id: string;
  language: string;
  title_original: string;
  body_original: string;
  quality_issues: string | null;
  prompt_version: string;
}
export interface QaPolicy {
  enabled: boolean;
  dailyCalls: number;
  dailyBudgetUsd: number;
  mock?: boolean;
  now?: Date;
  sweep?: boolean;
  priorityAfter?: Date;
}
const retryAt = (now: Date) => d1Timestamp(new Date(now.getTime() + 30 * 60_000));
/** Separate durable audit queue in the existing scheduler. No publication waits for it. */
export async function processLanguageQa(db: D1Client, policy: QaPolicy, client: () => LlmClient) {
  if (!policy.enabled) return { processed: 0, disabled: true };
  if (
    !db.batch ||
    policy.dailyCalls < 1 ||
    policy.dailyCalls > 300 ||
    policy.dailyBudgetUsd <= 0 ||
    policy.dailyBudgetUsd > 1
  )
    throw new Error("Invalid QA hard limits");
  const now = policy.now ?? new Date(),
    time = d1Timestamp(now);
  const priorityAfter = policy.priorityAfter
    ? d1Timestamp(policy.priorityAfter)
    : "9999-12-31 23:59:59";
  const swept = policy.sweep ? await sweepLanguageQa(db, now) : 0;
  const projection = await db
    .prepare(
      `SELECT id,story_id,new_version_id FROM language_qa_audits WHERE projection_pending=1 AND status='repaired' LIMIT 1`,
    )
    .first<{ id: string; story_id: string; new_version_id: string }>();
  if (projection) {
    await projectD1Story(db, projection.story_id, projection.new_version_id);
    await db
      .prepare("UPDATE language_qa_audits SET projection_pending=0 WHERE id=?")
      .bind(projection.id)
      .run();
  }
  const owner = crypto.randomUUID();
  const audit = await db
    .prepare(
      `UPDATE language_qa_audits SET status='processing',lease_owner=?,lease_expires_at=?,attempts=attempts+1
  WHERE id=(SELECT q.id FROM language_qa_audits q JOIN stories s ON s.id=q.story_id WHERE q.attempts<3 AND
   ((q.status IN ('queued','technical_error') AND q.next_attempt_at<=?) OR (q.status='processing' AND q.lease_expires_at<=?))
   ORDER BY CASE WHEN s.published_at>=? THEN 0 ELSE 1 END, q.queued_at LIMIT 1) RETURNING *`,
    )
    .bind(owner, d1Timestamp(new Date(now.getTime() + 120_000)), time, time, priorityAfter)
    .first<Audit>();
  if (!audit) return { processed: 0, swept };
  const finish = async (status: string, reason: string, issues: unknown[] = []) =>
    db
      .prepare(
        `UPDATE language_qa_audits SET status=?,reason=?,issues=?,issue_count=?,audited_at=?,next_attempt_at=?,lease_owner=NULL,lease_expires_at=NULL WHERE id=? AND lease_owner=?`,
      )
      .bind(
        status,
        reason,
        JSON.stringify(issues),
        issues.length,
        time,
        retryAt(now),
        audit.id,
        owner,
      )
      .run();
  let usageId: string | null = null,
    reservedCost = 0;
  try {
    const live = await db
      .prepare(
        `SELECT v.title_hu,v.lead_hu,v.body_hu,v.quality_issues,v.prompt_version,r.id raw_id,r.language,r.title_original,r.body_original
   FROM stories s JOIN story_versions v ON s.current_version_id=v.id
   JOIN story_sources ss ON ss.story_id=s.id AND ss.excluded=0 JOIN raw_articles r ON r.id=ss.raw_article_id
   WHERE s.id=? AND v.id=? AND s.status='published' AND v.is_published=1 AND r.content_origin='full_article'
   ORDER BY CASE WHEN ss.contribution_type='initial' THEN 0 ELSE 1 END,ss.id LIMIT 1`,
      )
      .bind(audit.story_id, audit.version_id)
      .all<Live>();
    const row = live.results[0];
    if (!row || row.prompt_version !== tabloid.TABLOID_PROMPT) {
      await finish("repair_rejected", "stale_version_or_ambiguous_source");
      return { processed: 1, status: "repair_rejected" };
    }
    const fields = { title_hu: row.title_hu, lead_hu: row.lead_hu, body_hu: row.body_hu };
    if (qaContentHash(fields) !== audit.content_hash) {
      await finish("repair_rejected", "stale_version_content");
      return { processed: 1, status: "repair_rejected" };
    }
    const stored = JSON.parse(row.quality_issues ?? "[]") as Array<{
      code: string;
      repaired?: boolean;
    }>;
    if (stored.some((f) => !f.repaired && !tabloid.REPAIRABLE_TABLOID_FLAGS.has(f.code))) {
      await finish("repair_rejected", "stored_non_repairable_quality_issue");
      return { processed: 1, status: "repair_rejected" };
    }
    const request = languageQa.qaRequest(fields, audit.story_id, {
      language: row.language,
      title_original: row.title_original,
      body_original: row.body_original,
    });
    const maxInput =
      new TextEncoder().encode(request.system + request.messages[0]!.content).length + 512;
    reservedCost = policy.mock
      ? 0
      : estimateCloudflareCostUsd(languageQa.LANGUAGE_QA_MODEL, maxInput, request.maxTokens);
    const day = now.toISOString().slice(0, 10);
    usageId = crypto.randomUUID();
    const reservation = await db
      .prepare(
        `INSERT INTO llm_usage(id,model,input_tokens,output_tokens,cost_usd,occurred_at,provider,role,status,story_id)
   SELECT ?,?,0,0,?,?,?,'language_qa','reserved',? WHERE
    (SELECT count(*) FROM llm_usage WHERE role='language_qa' AND occurred_at>=? AND status IN ('reserved','success','error'))<?
    AND (SELECT coalesce(sum(CAST(cost_usd AS REAL)),0) FROM llm_usage WHERE role='language_qa' AND occurred_at>=? AND status IN ('reserved','success','error'))+?<=?
    AND EXISTS(SELECT 1 FROM language_qa_audits WHERE id=? AND lease_owner=?)`,
      )
      .bind(
        usageId,
        languageQa.LANGUAGE_QA_MODEL,
        reservedCost.toFixed(8),
        time,
        policy.mock ? "cloudflare_mock" : "cloudflare",
        audit.story_id,
        day,
        policy.dailyCalls,
        day,
        reservedCost,
        policy.dailyBudgetUsd,
        audit.id,
        owner,
      )
      .run();
    if (reservation.meta.changes !== 1) {
      usageId = null;
      await db
        .prepare(
          `UPDATE language_qa_audits SET status='queued',reason='daily_cap_deferred',attempts=attempts-1,next_attempt_at=?,lease_owner=NULL,lease_expires_at=NULL WHERE id=? AND lease_owner=?`,
        )
        .bind(
          d1Timestamp(
            new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)),
          ),
          audit.id,
          owner,
        )
        .run();
      return { processed: 0, deferred: true };
    }
    const result = await client().completeJson(request);
    const cost = policy.mock
      ? 0
      : result.inputTokens > 0
        ? estimateCloudflareCostUsd(
            languageQa.LANGUAGE_QA_MODEL,
            result.inputTokens,
            result.outputTokens,
          )
        : reservedCost;
    await db
      .prepare(
        `UPDATE llm_usage SET status='success',input_tokens=?,output_tokens=?,cost_usd=? WHERE id=? AND status='reserved'`,
      )
      .bind(result.inputTokens, result.outputTokens, cost.toFixed(8), usageId)
      .run();
    usageId = null;
    const knowledge = await relevantD1Knowledge(db, row);
    const guarded = languageQa.applyLanguageQa(fields, result.data, {
      text: `${row.title_original}\n${row.body_original}`,
      language: row.language,
      forbiddenRules: knowledge,
    });
    if (guarded.status !== "repaired") {
      await finish(guarded.status, guarded.reason, guarded.issues);
      return { processed: 1, status: guarded.status };
    }
    const newId = crypto.randomUUID(),
      next = guarded.article;
    const condition = `EXISTS(SELECT 1 FROM stories s JOIN story_versions v ON s.current_version_id=v.id WHERE s.id=? AND s.status='published' AND v.id=? AND v.title_hu=? AND v.lead_hu=? AND v.body_hu=? AND v.quality_issues IS ?)
    AND EXISTS(SELECT 1 FROM raw_articles WHERE id=? AND title_original=? AND body_original=?)
    AND EXISTS(SELECT 1 FROM language_qa_audits WHERE id=? AND lease_owner=? AND status='processing')`;
    const values = [
      audit.story_id,
      audit.version_id,
      row.title_hu,
      row.lead_hu,
      row.body_hu,
      row.quality_issues,
      row.raw_id,
      row.title_original,
      row.body_original,
      audit.id,
      owner,
    ];
    const changed = await db.batch([
      db
        .prepare(
          `INSERT INTO story_versions(id,story_id,version_number,title_hu,lead_hu,body_hu,generated_by_model,prompt_version,is_published,is_ai_generated,quality_issues,created_at,change_summary_hu,meta_description,structured_data)
    SELECT ?,s.id,s.version_count+1,?,?,?,?,?,1,1,NULL,?,'Autonóm nyelvi mondatjavítás',v.meta_description,v.structured_data FROM stories s JOIN story_versions v ON s.current_version_id=v.id WHERE s.id=? AND ${condition}`,
        )
        .bind(
          newId,
          next.title_hu,
          next.lead_hu,
          next.body_hu,
          languageQa.LANGUAGE_QA_MODEL,
          tabloid.TABLOID_PROMPT,
          time,
          audit.story_id,
          ...values,
        ),
      db
        .prepare(
          `UPDATE stories SET current_version_id=?,version_count=version_count+1,last_updated_at=? WHERE id=? AND current_version_id=? AND status='published' AND EXISTS(SELECT 1 FROM story_versions WHERE id=?)`,
        )
        .bind(newId, time, audit.story_id, audit.version_id, newId),
      db
        .prepare(
          `UPDATE language_qa_audits SET status='repaired',repaired=1,new_version_id=?,issues=?,issue_count=?,reason=?,audited_at=?,projection_pending=1,lease_owner=NULL,lease_expires_at=NULL WHERE id=? AND lease_owner=? AND EXISTS(SELECT 1 FROM stories WHERE id=? AND current_version_id=?)`,
        )
        .bind(
          newId,
          JSON.stringify(guarded.issues),
          guarded.issues.length,
          guarded.reason,
          time,
          audit.id,
          owner,
          audit.story_id,
          newId,
        ),
      db
        .prepare(
          `INSERT INTO language_qa_audits(id,story_id,version_id,content_hash,original_fields,status,model,reason,queued_at,next_attempt_at,audited_at)
    SELECT ?,?,?,?,?, 'pass',?,'Validated resulting version; no repeat model call',?,?,? WHERE EXISTS(SELECT 1 FROM stories WHERE id=? AND current_version_id=?) ON CONFLICT(version_id,content_hash) DO NOTHING`,
        )
        .bind(
          crypto.randomUUID(),
          audit.story_id,
          newId,
          qaContentHash(next),
          JSON.stringify(next),
          languageQa.LANGUAGE_QA_MODEL,
          time,
          time,
          time,
          audit.story_id,
          newId,
        ),
    ]);
    if (changed[1]?.meta.changes !== 1) {
      await finish("repair_rejected", "concurrent_version_or_source_change", guarded.issues);
      return { processed: 1, status: "repair_rejected" };
    }
    try {
      await projectD1Story(db, audit.story_id, newId);
      await db
        .prepare("UPDATE language_qa_audits SET projection_pending=0 WHERE id=?")
        .bind(audit.id)
        .run();
    } catch {
      console.error("language_qa projection deferred", { auditId: audit.id });
    }
    return { processed: 1, status: "repaired", newVersionId: newId };
  } catch (error) {
    const providerCode = error instanceof CloudflareApiError
      ? `cloudflare_${error.kind}_${error.status}`
      : null;
    if (usageId)
      await db
        .prepare(
          "UPDATE llm_usage SET status='error',error_code=? WHERE id=? AND status='reserved'",
        )
        .bind(providerCode ?? "language_qa_technical_error", usageId)
        .run();
    const reason =
      error instanceof Error && ["qa_input_too_large", "qa_source_unavailable"].includes(error.message)
        ? error.message
        : (providerCode ?? "language_qa_technical_error");
    await finish("technical_error", reason);
    console.error("language_qa technical_error", { auditId: audit.id, reason });
    return { processed: 1, status: "technical_error" };
  }
}

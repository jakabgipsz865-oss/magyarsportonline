import { createHash } from "node:crypto";
import { languageQa, tabloid } from "@magyarsportonline/agents";
import { d1Timestamp, type D1Client } from "@magyarsportonline/db/d1";
export function qaContentHash(fields: languageQa.ArticleFields) {
  return createHash("sha256").update(JSON.stringify(fields)).digest("hex");
}
export async function enqueueLanguageQa(
  db: D1Client,
  storyId: string,
  versionId: string,
  now = new Date(),
): Promise<void> {
  const fields = await db
    .prepare(
      `SELECT v.title_hu,v.lead_hu,v.body_hu FROM story_versions v JOIN stories s ON s.current_version_id=v.id WHERE s.id=? AND v.id=? AND s.status='published' AND v.is_published=1`,
    )
    .bind(storyId, versionId)
    .first<languageQa.ArticleFields>();
  if (!fields) return;
  await db
    .prepare(
      `INSERT INTO language_qa_audits(id,story_id,version_id,content_hash,original_fields,status,model,queued_at,next_attempt_at)
  SELECT ?,?,?,?,?,'queued',?,?,? WHERE EXISTS(SELECT 1 FROM stories s JOIN story_versions v ON s.current_version_id=v.id WHERE s.id=? AND s.status='published' AND v.id=? AND v.title_hu=? AND v.lead_hu=? AND v.body_hu=?)
  ON CONFLICT(version_id,content_hash) DO NOTHING`,
    )
    .bind(
      crypto.randomUUID(),
      storyId,
      versionId,
      qaContentHash(fields),
      JSON.stringify(fields),
      languageQa.LANGUAGE_QA_MODEL,
      d1Timestamp(now),
      d1Timestamp(now),
      storyId,
      versionId,
      fields.title_hu,
      fields.lead_hu,
      fields.body_hu,
    )
    .run();
}
/** Bounded incremental sweep. Modified text under the same ID also gets a new content hash. */
export async function sweepLanguageQa(db: D1Client, now = new Date()): Promise<number> {
  const rows = await db
    .prepare(
      `SELECT s.id story_id,s.current_version_id version_id FROM stories s JOIN story_versions v ON v.id=s.current_version_id
  WHERE s.status='published' AND v.is_published=1 AND v.prompt_version=? AND NOT EXISTS
   (SELECT 1 FROM language_qa_audits q WHERE q.version_id=v.id
    AND json_extract(q.original_fields,'$.title_hu')=v.title_hu
    AND json_extract(q.original_fields,'$.lead_hu')=v.lead_hu
    AND json_extract(q.original_fields,'$.body_hu')=v.body_hu)
  ORDER BY s.last_updated_at DESC LIMIT 50`,
    )
    .bind(tabloid.TABLOID_PROMPT)
    .all<{ story_id: string; version_id: string }>();
  for (const row of rows.results) await enqueueLanguageQa(db, row.story_id, row.version_id, now);
  return rows.results.length;
}

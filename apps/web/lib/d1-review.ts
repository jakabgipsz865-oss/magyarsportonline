import { seo, tabloid } from "@magyarsportonline/agents";
import { d1Timestamp, type D1Client } from "@magyarsportonline/db/d1";
import { buildFacebookPostText } from "./facebook-publication";
import { projectD1Story, relevantD1Knowledge } from "./d1-tabloid";
import { env } from "./env";

export interface D1ReviewItem {
  id: string;
  story_id: string;
  story_version_id: string;
  reason: string;
  created_at: string;
  title_hu: string;
  lead_hu: string;
  body_hu: string;
  quality_issues: string | null;
  source_url: string | null;
  source_title: string | null;
  source_body: string | null;
  content_origin: string | null;
}

const ITEM_SELECT = `SELECT q.id,q.story_id,q.story_version_id,q.reason,q.created_at,
  v.title_hu,v.lead_hu,v.body_hu,v.quality_issues,
  (SELECT r.source_url FROM story_sources ss JOIN raw_articles r ON r.id=ss.raw_article_id
    WHERE ss.story_id=q.story_id AND ss.excluded=0 ORDER BY ss.linked_at LIMIT 1) source_url,
  (SELECT r.title_original FROM story_sources ss JOIN raw_articles r ON r.id=ss.raw_article_id
    WHERE ss.story_id=q.story_id AND ss.excluded=0 ORDER BY ss.linked_at LIMIT 1) source_title,
  (SELECT r.body_original FROM story_sources ss JOIN raw_articles r ON r.id=ss.raw_article_id
    WHERE ss.story_id=q.story_id AND ss.excluded=0 ORDER BY ss.linked_at LIMIT 1) source_body,
  (SELECT r.content_origin FROM story_sources ss JOIN raw_articles r ON r.id=ss.raw_article_id
    WHERE ss.story_id=q.story_id AND ss.excluded=0 ORDER BY ss.linked_at LIMIT 1) content_origin
  FROM review_queue_items q JOIN story_versions v ON v.id=q.story_version_id`;

export async function listD1ReviewItems(db: D1Client, limit = 50): Promise<D1ReviewItem[]> {
  const result = await db.prepare(`${ITEM_SELECT} WHERE q.status='pending'
    AND (q.snoozed_until IS NULL OR julianday(q.snoozed_until)<=julianday('now'))
    ORDER BY q.created_at DESC LIMIT ?`).bind(Math.min(100, Math.max(1, limit))).all<D1ReviewItem>();
  return result.results;
}

export async function countD1PendingReviews(db: D1Client): Promise<number> {
  const row = await db.prepare("SELECT COUNT(*) AS count FROM review_queue_items WHERE status='pending'")
    .first<{ count: number }>();
  return row?.count ?? 0;
}

async function pendingItem(db: D1Client, id: string): Promise<D1ReviewItem | null> {
  return db.prepare(`${ITEM_SELECT} WHERE q.id=? AND q.status='pending'`).bind(id).first<D1ReviewItem>();
}

export type D1ReviewResult =
  | { ok: true; slug?: string }
  | { ok: false; error: "not_found" | "quality_blocked" | "already_resolved" };

async function qualityFlags(db: D1Client, item: D1ReviewItem) {
  if (item.content_origin !== "full_article" || !item.source_body || !item.source_title)
    return ["complete_source_required"];
  const source = await db.prepare(`SELECT r.language,r.title_original,r.body_original FROM story_sources ss
    JOIN raw_articles r ON r.id=ss.raw_article_id WHERE ss.story_id=? AND ss.excluded=0
    ORDER BY ss.linked_at LIMIT 1`).bind(item.story_id).first<{
      language: string; title_original: string; body_original: string }>();
  if (!source) return ["complete_source_required"];
  const knowledge = await relevantD1Knowledge(db, source);
  return tabloid.assessTabloidQuality({
    sourceContent: `${item.source_title}\n${item.source_body}`,
    output: { title_hu: item.title_hu, lead_hu: item.lead_hu, body_hu: item.body_hu },
    forbiddenRules: knowledge,
  }).map(flag => flag.code);
}

/** Human decisions use D1 only. An unresolved quality finding can never be approved. */
export async function decideD1Review(db: D1Client, id: string,
  decision: "approve" | "reject" | "snooze"): Promise<D1ReviewResult> {
  const item = await pendingItem(db, id);
  if (!item) return { ok: false, error: "not_found" };
  if (decision === "snooze") {
    const until = d1Timestamp(new Date(Date.now() + 4 * 60 * 60_000));
    const result = await db.prepare("UPDATE review_queue_items SET snoozed_until=? WHERE id=? AND status='pending'")
      .bind(until, id).run();
    return result.meta.changes ? { ok: true } : { ok: false, error: "already_resolved" };
  }
  if (!db.batch) throw new Error("D1 transactional batch binding is required for review decisions");
  const now = d1Timestamp(new Date());
  if (decision === "reject") {
    const result = await db.batch([
      db.prepare(`UPDATE stories SET status='retracted',last_updated_at=? WHERE id=?
        AND status!='published' AND EXISTS
        (SELECT 1 FROM review_queue_items WHERE id=? AND status='pending')`)
        .bind(now, item.story_id, id),
      db.prepare(`UPDATE review_queue_items SET status='rejected',resolved_at=?
        WHERE id=? AND status='pending' AND EXISTS
        (SELECT 1 FROM stories WHERE id=? AND status='retracted')`)
        .bind(now, id, item.story_id),
    ]);
    return result.every(row => row.meta.changes === 1)
      ? { ok: true } : { ok: false, error: "already_resolved" };
  }

  const version = await db.prepare(`SELECT is_ai_generated,is_published,generated_by_model,
    quality_issues FROM story_versions WHERE id=?`).bind(item.story_version_id)
    .first<{ is_ai_generated: number; is_published: number; generated_by_model: string;
      quality_issues: string | null }>();
  const unresolved = version?.quality_issues
    ? (JSON.parse(version.quality_issues) as Array<{ repaired?: boolean }>).some(flag => flag.repaired !== true)
    : false;
  if (!version || version.is_ai_generated !== 1 || version.is_published !== 0 ||
    unresolved || (await qualityFlags(db, item)).length > 0) {
    return { ok: false, error: "quality_blocked" };
  }
  const story = await db.prepare("SELECT slug,status FROM stories WHERE id=?")
    .bind(item.story_id).first<{ slug: string | null; status: string }>();
  if (!story || story.status === "published" || story.status === "retracted")
    return { ok: false, error: "already_resolved" };
  const slug = story.slug ?? `${seo.slugify(item.title_hu)}-${item.story_id.slice(0, 8)}`;
  const result = await db.batch([
    db.prepare(`UPDATE story_versions SET is_published=1 WHERE id=? AND is_published=0
      AND EXISTS (SELECT 1 FROM review_queue_items WHERE id=? AND status='pending')`)
      .bind(item.story_version_id, id),
    db.prepare(`UPDATE stories SET slug=?,status='published',current_version_id=?,
      published_at=?,last_updated_at=? WHERE id=? AND status NOT IN ('published','retracted')
      AND EXISTS (SELECT 1 FROM review_queue_items WHERE id=? AND status='pending')`)
      .bind(slug, item.story_version_id, now, now, item.story_id, id),
    db.prepare(`UPDATE review_queue_items SET status='approved',resolved_at=?
      WHERE id=? AND status='pending' AND EXISTS
      (SELECT 1 FROM stories WHERE id=? AND status='published' AND current_version_id=?)`)
      .bind(now, id, item.story_id, item.story_version_id),
  ]);
  if (result.some(row => row.meta.changes !== 1))
    throw new Error("D1 review changed during approval; check the story before retrying");
  await projectD1Story(db, item.story_id, item.story_version_id);

  // Manual approval never creates historical social posts. Both the source
  // receipt and publication must be after the explicit activation boundary.
  const fresh = await db.prepare(`SELECT r.first_seen_at,r.published_at_source FROM story_sources ss
    JOIN raw_articles r ON r.id=ss.raw_article_id WHERE ss.story_id=? AND ss.excluded=0
    ORDER BY ss.linked_at LIMIT 1`).bind(item.story_id)
    .first<{ first_seen_at: string | null; published_at_source: string | null }>();
  const start = env.FACEBOOK_AUTO_PUBLISH_START_AT;
  if (env.FACEBOOK_AUTO_PUBLISH && fresh?.first_seen_at && fresh.published_at_source &&
    new Date(fresh.first_seen_at) >= start && new Date(fresh.published_at_source) <= new Date(now) &&
    new Date(now).getTime() - new Date(fresh.published_at_source).getTime() <= 48 * 60 * 60_000 &&
    new Date(now) >= start) {
    const canonicalUrl = new URL(`/hir/${encodeURIComponent(slug)}`, env.SITE_URL).toString();
    await db.prepare(`INSERT INTO social_posts (id,story_id,story_version_id,platform,
      post_text,canonical_url,status) VALUES (?,?,?,'facebook',?,?,'queued')
      ON CONFLICT DO NOTHING`).bind(crypto.randomUUID(), item.story_id, item.story_version_id,
        buildFacebookPostText({ titleHu: item.title_hu, leadHu: item.lead_hu, canonicalUrl }),
        canonicalUrl).run();
  }
  return { ok: true, slug };
}

export async function editD1Review(db: D1Client, id: string, input: {
  titleHu: string; leadHu: string; bodyHu: string;
}): Promise<D1ReviewResult> {
  const item = await pendingItem(db, id);
  if (!item) return { ok: false, error: "not_found" };
  if (input.titleHu.trim().length < 5 || input.leadHu.trim().length < 20 ||
      input.bodyHu.trim().length < 60 || item.content_origin !== "full_article" ||
      !item.source_title || !item.source_body) {
    return { ok: false, error: "quality_blocked" };
  }
  const source = await db.prepare(`SELECT r.language,r.title_original,r.body_original FROM story_sources ss
    JOIN raw_articles r ON r.id=ss.raw_article_id WHERE ss.story_id=? AND ss.excluded=0
    ORDER BY ss.linked_at LIMIT 1`).bind(item.story_id).first<{
      language: string; title_original: string; body_original: string }>();
  if (!source) return { ok: false, error: "quality_blocked" };
  const knowledge = await relevantD1Knowledge(db, source);
  const flags = tabloid.assessTabloidQuality({
    sourceContent: `${item.source_title}\n${item.source_body}`,
    output: { title_hu: input.titleHu, lead_hu: input.leadHu, body_hu: input.bodyHu },
    forbiddenRules: knowledge,
  });
  const result = await db.prepare(`UPDATE story_versions SET title_hu=?,lead_hu=?,body_hu=?,quality_issues=?
    WHERE id=? AND is_published=0 AND EXISTS
      (SELECT 1 FROM review_queue_items WHERE id=? AND status='pending')`)
    .bind(input.titleHu.trim(), input.leadHu.trim(), input.bodyHu.trim(),
      flags.length ? JSON.stringify(flags.map(flag => ({ ...flag, repaired: false }))) : null,
      item.story_version_id, id).run();
  return result.meta.changes ? { ok: true } : { ok: false, error: "already_resolved" };
}

import { createHash } from "node:crypto";
import { readModelProjector, seo, tabloid } from "@magyarsportonline/agents";
import {
  D1PipelineJobRepository, D1StoryReadModelRepository, d1Timestamp,
  type D1Client,
} from "@magyarsportonline/db/d1";
import type { LlmClient } from "@magyarsportonline/llm";
import { TABLOID_PUBLIC_START, type SourceInlineImage, type TabloidSourceMode } from "@magyarsportonline/shared";
import { buildFacebookPostText } from "./facebook-publication";
import registry from "./tabloid-sources.json";

type Claim = { jobId: string; owner: string };
interface RawRow {
  id: string; source_id: string; source_url: string; title_original: string;
  body_original: string; language: string; image_url: string | null;
  inline_images: string; extracted_entities: string | null;
  published_at_source: string | null; ingested_at: string; first_seen_at: string | null;
  content_origin: string;
}
interface SourceRow { id: string; name: string; fetch_config: string }
interface StoryRow {
  id: string; slug: string | null; status: string; current_version_id: string | null;
  published_at: string | null; image_url: string | null; confidence_score: string | null;
  is_developing: number;
}
interface VersionRow {
  id: string; story_id: string; version_number: number;
  title_hu: string; lead_hu: string; body_hu: string;
  generated_by_model: string; prompt_version: string; is_ai_generated: number;
  quality_issues: string | null; is_published: number; created_at: string;
  change_summary_hu: string | null; meta_description: string | null;
  structured_data: string | null;
}
interface KnowledgeRow {
  instruction_hu: string | null; avoid_hu: string;
  source_phrase: string | null; match_terms: string; contexts: string;
  knowledge_type: string;
}

const pendingFor = (languageWarnings: string[]) => [{
  kind: "hard", code: "writer_validation_pending", field: "body",
  repaired: false, languageWarnings,
}];
const repairable = new Set([
  "foreign_language", "forbidden_terminology", "repetition",
  "malformed_hungarian", "writer_language_warning",
]);

function parseIssues(value: string | null): Array<{ code?: string; repaired?: boolean }> {
  return value ? JSON.parse(value) as Array<{ code?: string; repaired?: boolean }> : [];
}

function writerInput(raw: RawRow, source: SourceRow, knowledge: Array<{ instruction_hu: string | null; avoid_hu: string[] }>, claim: Claim, storyId: string) {
  return {
    language: raw.language, title: raw.title_original, content: raw.body_original,
    sourceName: source.name, sourceUrl: raw.source_url,
    publishedAt: raw.published_at_source ? new Date(raw.published_at_source).toISOString() : null,
    editorialKnowledge: knowledge,
    usageContext: { role: "primary" as const, rawArticleId: raw.id, storyId, jobId: claim.jobId },
  };
}

export async function relevantD1Knowledge(db: D1Client,
  raw: Pick<RawRow, "language" | "title_original" | "body_original">) {
  const rows = await db.prepare(`
    SELECT instruction_hu, avoid_hu, source_phrase, match_terms, contexts, knowledge_type
    FROM editorial_knowledge_entries
    WHERE status='active' AND sport='football' AND source_language=? AND target_language='hu'
    ORDER BY updated_at DESC LIMIT 300
  `).bind(raw.language).all<KnowledgeRow>();
  const text = `${raw.title_original}\n${raw.body_original}`.toLocaleLowerCase("hu-HU");
  const has = (term: string | null) => Boolean(term && term.length > 1 && text.includes(term.toLocaleLowerCase("hu-HU")));
  return rows.results.map(row => ({
    instruction_hu: row.instruction_hu,
    avoid_hu: JSON.parse(row.avoid_hu) as string[],
    source_phrase: row.source_phrase,
    match_terms: JSON.parse(row.match_terms) as string[],
    contexts: JSON.parse(row.contexts) as string[],
    knowledge_type: row.knowledge_type,
  })).filter(row => has(row.source_phrase) || row.match_terms.some(has) || row.avoid_hu.some(has) ||
    (["headline_rule", "grammar_style_rule", "learned_failure_pattern"].includes(row.knowledge_type) &&
      row.contexts.some(context => ["headline", "lead", "body", "tabloid"].includes(context))))
    .slice(0, 20);
}

async function latestVersion(db: D1Client, storyId: string): Promise<VersionRow | null> {
  return db.prepare(`SELECT * FROM story_versions WHERE story_id=? ORDER BY version_number DESC LIMIT 1`)
    .bind(storyId).first<VersionRow>();
}

async function updateDraft(db: D1Client, versionId: string, claim: Claim,
  output: Pick<tabloid.TabloidOutput, "title_hu" | "lead_hu" | "body_hu">,
  issues: unknown[]): Promise<void> {
  const changed = await db.prepare(`
    UPDATE story_versions SET title_hu=?, lead_hu=?, body_hu=?, quality_issues=?
    WHERE id=? AND is_published=0 AND EXISTS (
      SELECT 1 FROM pipeline_jobs WHERE id=? AND status='in_progress' AND claim_owner=?
    ) RETURNING id
  `).bind(output.title_hu, output.lead_hu, output.body_hu,
    issues.length ? JSON.stringify(issues) : null, versionId,
    claim.jobId, claim.owner).first<{ id: string }>();
  if (!changed) throw new Error("D1 draft claim expired before save");
}

async function claimTargetedRepair(db: D1Client, version: VersionRow, claim: Claim,
  flags: tabloid.TabloidQualityFlag[]): Promise<void> {
  const pending = flags.map(flag => ({ ...flag, repaired: false, repairStatus: "pending" }));
  const acquired = await db.prepare(`UPDATE story_versions SET quality_issues=?
    WHERE id=? AND is_published=0 AND quality_issues=? AND EXISTS
      (SELECT 1 FROM pipeline_jobs WHERE id=? AND status='in_progress' AND claim_owner=?)
    RETURNING id`).bind(JSON.stringify(pending), version.id, version.quality_issues,
      claim.jobId, claim.owner).first<{ id: string }>();
  if (!acquired) throw new Error("D1 Writer lease is active");
}

async function ensureReview(db: D1Client, storyId: string, versionId: string, claim: Claim,
  reason: "content_quality_failed" | "force_review_mode" = "content_quality_failed") {
  await db.prepare(`
    INSERT INTO review_queue_items (id, story_id, story_version_id, reason, status)
    SELECT ?, ?, ?, ?, 'pending'
    WHERE EXISTS (SELECT 1 FROM pipeline_jobs WHERE id=? AND status='in_progress' AND claim_owner=?)
      AND NOT EXISTS (SELECT 1 FROM review_queue_items
        WHERE story_version_id=? AND reason=? AND status='pending')
  `).bind(crypto.randomUUID(), storyId, versionId, reason,
    claim.jobId, claim.owner, versionId, reason).run();
}

export async function projectD1Story(db: D1Client, storyId: string, versionId: string) {
  const story = await db.prepare("SELECT * FROM stories WHERE id=?").bind(storyId).first<StoryRow>();
  const versions = await db.prepare("SELECT * FROM story_versions WHERE story_id=? ORDER BY version_number")
    .bind(storyId).all<VersionRow>();
  const version = versions.results.find(row => row.id === versionId);
  if (!story?.slug || !story.published_at || !version) throw new Error("D1 publication projection is incomplete");
  const sourceRows = await db.prepare(`
    SELECT s.name, s.reliability_tier, r.source_url, r.inline_images, ss.linked_at
    FROM story_sources ss JOIN raw_articles r ON r.id=ss.raw_article_id
      JOIN sources s ON s.id=r.source_id
    WHERE ss.story_id=? AND ss.excluded=0
  `).bind(storyId).all<{
    name: string; reliability_tier: "A" | "B" | "C";
    source_url: string; inline_images: string; linked_at: string;
  }>();
  const sourcesSummary = sourceRows.results.map(row => ({
    name: row.name, url: row.source_url,
    firstSeenAt: new Date(row.linked_at).toISOString(), reliabilityTier: row.reliability_tier,
  }));
  const inlineImages = sourceRows.results.flatMap(row =>
    (JSON.parse(row.inline_images) as SourceInlineImage[]).map(image => ({
      ...image, sourceName: row.name, sourceUrl: row.source_url,
    })));
  await new D1StoryReadModelRepository(db).upsert({
    storyId, slug: story.slug, titleHu: version.title_hu, leadHu: version.lead_hu,
    bodyHtml: readModelProjector.toBodyHtml(version.body_hu),
    imageUrl: story.image_url, inlineImages, isAiGenerated: version.is_ai_generated !== 0,
    metaDescription: version.meta_description,
    structuredData: version.structured_data ? JSON.parse(version.structured_data) : null,
    sourcesSummary, tags: [], category: null, confidenceScore: story.confidence_score,
    isDeveloping: story.is_developing !== 0,
    publishedAt: new Date(story.published_at), lastUpdatedAt: new Date(),
    versionHistorySummary: versions.results.filter(item => item.is_published !== 0).map(item => ({
      version_number: item.version_number, prompt_version: item.prompt_version,
      is_current: item.id === version.id, created_at: new Date(item.created_at).toISOString(),
      change_summary: item.change_summary_hu,
    })),
    credibilitySummary: null,
  });
}

export interface D1PublicationOptions {
  activationAt: Date;
  siteUrl: string;
  forceReviewMode: boolean;
  facebookEnabled: boolean;
  facebookStartAt: Date;
  now?: Date;
}

/** D1 publication path, fenced by the queue claim and a separate Writer lease. */
export async function publishD1Tabloid(
  db: D1Client, rawId: string, claim: Claim, llm: LlmClient,
  repairLlm: LlmClient, options: D1PublicationOptions,
): Promise<{ status: "published" | "review" | "skipped"; storyId?: string; versionId?: string; slug?: string }> {
  if (!db.batch) throw new Error("D1 transactional batch binding is unavailable");
  const jobs = new D1PipelineJobRepository(db);
  await jobs.assertActiveClaim(claim.jobId, claim.owner);
  const raw = await db.prepare("SELECT * FROM raw_articles WHERE id=?").bind(rawId).first<RawRow>();
  if (!raw) throw new Error("D1 source article missing");
  if (raw.content_origin !== "full_article") throw new Error("D1 Writer requires a complete source article");
  if (new Date(raw.ingested_at) < new Date(TABLOID_PUBLIC_START) ||
      !raw.first_seen_at || new Date(raw.first_seen_at) < options.activationAt)
    return { status: "skipped" };
  if (raw.published_at_source && new Date(raw.published_at_source) < options.activationAt)
    return { status: "skipped" };
  const source = await db.prepare("SELECT id,name,fetch_config FROM sources WHERE id=?")
    .bind(raw.source_id).first<SourceRow>();
  if (!source) throw new Error("D1 source missing");
  const config = JSON.parse(source.fetch_config) as { tabloid?: boolean; footballFeed?: boolean; mode?: TabloidSourceMode };
  if (!config.tabloid || !registry.some(item => item.id === source.id) ||
      !tabloid.isFootballTabloid(raw.title_original, raw.body_original,
        config.footballFeed !== false, config.mode, raw.source_url))
    return { status: "skipped" };

  const fingerprint = createHash("sha256").update(`tabloid:${raw.source_id}:${raw.id}`).digest("hex");
  const freshStoryId = crypto.randomUUID();
  await db.batch([
    db.prepare(`INSERT INTO stories (id, canonical_title, confidence_score, image_url)
      SELECT ?, ?, '0.000', ? WHERE NOT EXISTS
        (SELECT 1 FROM story_fingerprints WHERE fingerprint_hash=?)`)
      .bind(freshStoryId, raw.title_original, raw.image_url, fingerprint),
    db.prepare(`INSERT INTO story_fingerprints (fingerprint_hash, story_id)
      SELECT ?, ? WHERE NOT EXISTS (SELECT 1 FROM story_fingerprints WHERE fingerprint_hash=?)`)
      .bind(fingerprint, freshStoryId, fingerprint),
  ]);
  const link = await db.prepare("SELECT story_id FROM story_fingerprints WHERE fingerprint_hash=?")
    .bind(fingerprint).first<{ story_id: string }>();
  if (!link) throw new Error("D1 Story fingerprint not persisted");
  const storyId = link.story_id;
  const rawLink = await db.prepare(`UPDATE raw_articles SET story_id=?, ingest_status='merged'
    WHERE id=? AND (story_id IS NULL OR story_id=?)`)
    .bind(storyId, rawId, storyId).run();
  if (rawLink.meta.changes !== 1) throw new Error("D1 raw article belongs to another Story");
  await db.prepare(`INSERT INTO story_sources (id, story_id, raw_article_id, contribution_type)
    VALUES (?, ?, ?, 'initial') ON CONFLICT(story_id, raw_article_id) DO NOTHING`)
    .bind(crypto.randomUUID(), storyId, rawId).run();

  let version = await latestVersion(db, storyId);
  if (version && version.prompt_version !== tabloid.TABLOID_PROMPT) return { status: "skipped", storyId };
  const knowledge = await relevantD1Knowledge(db, raw);
  let freshlyWritten: tabloid.TabloidOutput | null = null;
  if (!version) {
    const expiresAt = d1Timestamp(new Date((options.now ?? new Date()).getTime() + 10 * 60_000));
    const lease = await db.prepare(`UPDATE raw_articles SET extracted_entities=json_set(
      coalesce(extracted_entities,'{}'), '$.tabloidWriterLease',
      json_object('owner', ?, 'expiresAt', ?))
      WHERE id=? AND (json_extract(extracted_entities,'$.tabloidWriterLease.expiresAt') IS NULL
        OR julianday(json_extract(extracted_entities,'$.tabloidWriterLease.expiresAt')) <= julianday(?))
      RETURNING id`).bind(claim.owner, expiresAt, rawId,
        d1Timestamp(options.now ?? new Date())).first<{ id: string }>();
    if (!lease) throw new Error("D1 Writer lease is active");
    try {
      version = await latestVersion(db, storyId);
      if (!version) {
        const input = writerInput(raw, source, knowledge, claim, storyId);
        // A provider/schema/network failure is retried through the durable
        // job with the inexpensive primary model. It must never invoke the
        // costly repair model for a full-article regeneration.
        const output = await tabloid.writeTabloid(llm, input);
        freshlyWritten = output;
        const versionId = crypto.randomUUID();
        const statements = [
          db.prepare(`UPDATE stories SET version_count=version_count+1 WHERE id=? AND EXISTS
            (SELECT 1 FROM pipeline_jobs WHERE id=? AND status='in_progress' AND claim_owner=?)`)
            .bind(storyId, claim.jobId, claim.owner),
          db.prepare(`INSERT INTO story_versions (id, story_id, version_number,
            title_hu, lead_hu, body_hu, generated_by_model, prompt_version,
            fact_consistency_score, quality_issues, is_ai_generated)
            SELECT ?, id, version_count, ?, ?, ?, ?, ?, '0.000', ?, 1
            FROM stories WHERE id=? AND EXISTS
              (SELECT 1 FROM pipeline_jobs WHERE id=? AND status='in_progress' AND claim_owner=?)`)
            .bind(versionId, output.title_hu, output.lead_hu, output.body_hu,
              output.generatedByModel, tabloid.TABLOID_PROMPT,
              JSON.stringify(pendingFor(output.language_warnings)),
              storyId, claim.jobId, claim.owner),
        ];
        const results = await db.batch(statements);
        if (results[1]?.meta.changes !== 1) throw new Error("D1 draft claim expired before save");
        version = await latestVersion(db, storyId);
      }
    } finally {
      await db.prepare(`UPDATE raw_articles SET extracted_entities=json_remove(
        coalesce(extracted_entities,'{}'), '$.tabloidWriterLease')
        WHERE id=? AND json_extract(extracted_entities,'$.tabloidWriterLease.owner')=?`)
        .bind(rawId, claim.owner).run();
    }
  }
  if (!version) throw new Error("D1 Writer draft missing");
  const issues = parseIssues(version.quality_issues);
  if (issues.some(issue => issue.code === "writer_validation_pending")) {
    const persistedWarnings = (issues.find(issue => issue.code === "writer_validation_pending") as
      { languageWarnings?: string[] } | undefined)?.languageWarnings ?? [];
    const initial = tabloid.assessTabloidQuality({
      sourceContent: `${raw.title_original}\n${raw.body_original}`,
      output: freshlyWritten ?? { title_hu: version.title_hu, lead_hu: version.lead_hu,
        body_hu: version.body_hu, language_warnings: persistedWarnings },
      forbiddenRules: knowledge,
    });
    let output = {
      title_hu: version.title_hu, lead_hu: version.lead_hu, body_hu: version.body_hu,
    };
    let flags = initial.map(flag => ({ ...flag, repaired: false }));
    if (initial.length && freshlyWritten && initial.every(flag => repairable.has(flag.code))) {
      await claimTargetedRepair(db, version, claim, initial);
      try {
        const repaired = await tabloid.repairTabloid(repairLlm, freshlyWritten, initial,
          { role: "targeted_repair", rawArticleId: raw.id, storyId, jobId: claim.jobId });
        output = repaired;
        const remaining = tabloid.assessTabloidQuality({
          sourceContent: `${raw.title_original}\n${raw.body_original}`,
          output: repaired, forbiddenRules: knowledge,
        });
        flags = [
          ...initial.map(flag => ({ ...flag, repaired: remaining.every(next => next.code !== flag.code),
            repairStatus: "success" })),
          ...remaining.map(flag => ({ ...flag, repaired: false, repairStatus: "failed" })),
        ];
      } catch {
        flags = initial.map(flag => ({ ...flag, repaired: false, repairStatus: "failed" }));
      }
    }
    await updateDraft(db, version.id, claim, output, flags);
    version = await latestVersion(db, storyId);
    if (!version) throw new Error("D1 draft vanished after validation");
  }
  const unresolved = parseIssues(version.quality_issues).filter(issue => issue.repaired !== true);
  if (unresolved.length) {
    // A persisted draft is never re-generated automatically. Quality failures
    // go to review; an explicit reviewer can request a later new version.
    await ensureReview(db, storyId, version.id, claim);
    return { status: "review", storyId, versionId: version.id };
  }
  if (options.forceReviewMode) {
    await ensureReview(db, storyId, version.id, claim, "force_review_mode");
    return { status: "review", storyId, versionId: version.id };
  }

  const story = await db.prepare("SELECT * FROM stories WHERE id=?").bind(storyId).first<StoryRow>();
  if (!story) throw new Error("D1 Story missing before publication");
  const slug = story.slug ?? `${seo.slugify(version.title_hu)}-${storyId.slice(0, 8)}`;
  const slugResult = await db.prepare(`UPDATE stories SET slug=? WHERE id=? AND slug IS NULL AND EXISTS
    (SELECT 1 FROM pipeline_jobs WHERE id=? AND status='in_progress' AND claim_owner=?)`)
    .bind(slug, storyId, claim.jobId, claim.owner).run();
  if (!story.slug && slugResult.meta.changes !== 1) throw new Error("D1 slug claim expired or collided");
  const now = options.now ?? new Date();
  const publishedAt = story.published_at ? new Date(story.published_at) : now;
  const firstSeenAt = raw.first_seen_at ? new Date(raw.first_seen_at) : null;
  const sourcePublishedAt = raw.published_at_source ? new Date(raw.published_at_source) : null;
  const freshForSocial = options.facebookEnabled && publishedAt >= options.facebookStartAt &&
    firstSeenAt !== null && firstSeenAt >= options.facebookStartAt &&
    firstSeenAt <= now && now.getTime() - firstSeenAt.getTime() <= 24 * 60 * 60_000 &&
    sourcePublishedAt !== null && sourcePublishedAt <= now &&
    now.getTime() - sourcePublishedAt.getTime() <= 48 * 60 * 60_000;
  const canonicalUrl = new URL(`/hir/${encodeURIComponent(slug)}`, options.siteUrl).toString();
  const statements = [
    db.prepare(`UPDATE story_versions SET is_published=1 WHERE id=? AND story_id=? AND EXISTS
      (SELECT 1 FROM pipeline_jobs WHERE id=? AND status='in_progress' AND claim_owner=?)
      AND EXISTS (SELECT 1 FROM stories WHERE id=? AND
        (status!='published' OR current_version_id=?))`)
      .bind(version.id, storyId, claim.jobId, claim.owner, storyId, version.id),
    db.prepare(`UPDATE stories SET status='published', current_version_id=?,
      published_at=?, last_updated_at=? WHERE id=? AND
      (status!='published' OR current_version_id=?) AND EXISTS
        (SELECT 1 FROM pipeline_jobs WHERE id=? AND status='in_progress' AND claim_owner=?)`)
      .bind(version.id, d1Timestamp(publishedAt), d1Timestamp(now), storyId,
        version.id, claim.jobId, claim.owner),
  ];
  if (freshForSocial) statements.push(db.prepare(`
    INSERT INTO social_posts (id, story_id, story_version_id, platform,
      post_text, canonical_url, status)
    SELECT ?, ?, ?, 'facebook', ?, ?, 'queued' WHERE EXISTS
      (SELECT 1 FROM pipeline_jobs WHERE id=? AND status='in_progress' AND claim_owner=?)
      AND EXISTS (SELECT 1 FROM stories WHERE id=? AND current_version_id=? AND status='published')
    ON CONFLICT DO NOTHING
  `).bind(crypto.randomUUID(), storyId, version.id,
    buildFacebookPostText({ titleHu: version.title_hu, leadHu: version.lead_hu, canonicalUrl }),
    canonicalUrl, claim.jobId, claim.owner, storyId, version.id));
  const result = await db.batch(statements);
  if (result[1]?.meta.changes !== 1) return { status: "skipped", storyId, versionId: version.id };
  await projectD1Story(db, storyId, version.id);
  return { status: "published", storyId, versionId: version.id, slug };
}

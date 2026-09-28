import { createHash } from "node:crypto";
import { readModelProjector, seo, sourceIngest, tabloid } from "@magyarsportonline/agents";
import { createEventEnvelope } from "@magyarsportonline/events";
import type { NewRawArticle, RawArticle, Source } from "@magyarsportonline/db";
import {
  TABLOID_PUBLIC_START,
  deduplicateSourceImages,
  type SourceInlineImage,
  type TabloidSourceMode,
} from "@magyarsportonline/shared";
import { revalidatePath } from "next/cache";
import { createIngestRepositories, createRepositories, type Repositories } from "./db";
import { env } from "./env";
import { getWriterLlmClient, getWriterRepairLlmClient } from "./llm";
import { getLogger } from "./logger";
import { buildFacebookPostText, enqueueFacebookPublicationSafely } from "./facebook-publication";
import { timedPipelineStage } from "./pipeline-timing";
import registry from "./tabloid-sources.json";

export function mergeInlineImages(
  ...groups: Array<SourceInlineImage[] | undefined>
): SourceInlineImage[] {
  return deduplicateSourceImages(groups.flatMap((group) => group ?? [])).slice(0, 8);
}

function hasUnresolvedTabloidIssues(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.some(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        "code" in item &&
        (item as { repaired?: boolean }).repaired !== true,
    )
  );
}

const REPAIRABLE_TABLOID_FLAGS = new Set([
  "foreign_language",
  "forbidden_terminology",
  "repetition",
  "malformed_hungarian",
  "writer_language_warning",
]);

const TABLOID_WRITER_LEASE_MS = 10 * 60_000;
const WRITER_VALIDATION_PENDING = {
  kind: "hard",
  code: "writer_validation_pending",
  field: "body",
  repaired: false,
  repairStatus: "pending",
};

export class TabloidWriterBusyError extends Error {
  readonly retryAfterMs = 60_000;

  constructor() {
    super("Tabloid writer lease is active; retry after the current Writer invocation finishes");
    this.name = "TabloidWriterBusyError";
  }
}

function hasWriterValidationPending(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.some(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        "code" in item &&
        item.code === WRITER_VALIDATION_PENDING.code,
    )
  );
}

/** Rebuild the public row after source-image metadata changes, without an LLM call. */
export async function refreshPublishedTabloidProjection(
  storyId: string,
  slug: string,
  repos: Repositories = createRepositories(),
) {
  const version = await repos.storyVersionRepository.getLatestPublished(storyId);
  if (!version) throw new Error("Published tabloid version missing");
  await readModelProjector.handleStoryPublished(
    {
      storyRepository: repos.storyRepository,
      storyVersionRepository: repos.storyVersionRepository,
      storySourceRepository: repos.storySourceRepository,
      storyCredibilityHistoryRepository: { listByStoryId: async () => [] },
      storyReadModelRepository: repos.storyReadModelRepository,
      logger: getLogger(),
    },
    {
      ...createEventEnvelope({ correlationId: crypto.randomUUID() }),
      type: "story/published",
      payload: { story_id: storyId, story_version_id: version.id },
    },
  );
  revalidatePath("/");
  revalidatePath(`/hir/${slug}`);
  return { storyId, versionId: version.id, slug, imagesRefreshed: true, llmCalls: 0 };
}

/** One accepted raw article owns one Story. Retries reuse its persisted draft. */
export async function publishTabloid(
  rawId: string,
  repos: Repositories = createRepositories(),
  options: { retryFailedWriter?: boolean; forceRewrite?: boolean; jobId?: string; jobOwner?: string } = {},
) {
  if (!env.TABLOID_AUTO_PUBLISH) return { paused: true, llmCalls: 0 };
  const jobClaim = options.jobId && options.jobOwner
    ? { jobId: options.jobId, owner: options.jobOwner }
    : undefined;
  const timing = { jobId: options.jobId, rawArticleId: rawId, leaseOwner: options.jobOwner };
  if (jobClaim) await timedPipelineStage("claim_validation", timing, () =>
    repos.pipelineJobRepository.assertActiveClaim(jobClaim.jobId, jobClaim.owner));
  const saveDraft = (
    versionId: string,
    content: Parameters<Repositories["storyVersionRepository"]["updateDraftContent"]>[1],
  ) => timedPipelineStage("draft_save", timing, () =>
    repos.storyVersionRepository.updateDraftContent(versionId, content, jobClaim));
  let raw = await timedPipelineStage("raw_load", timing, () => repos.rawArticleRepository.getById(rawId));
  if (!raw) throw new Error("Tabloid source article missing");
  const source = await repos.sourceRepository.getById(raw.sourceId);
  if (!source) throw new Error("Tabloid source missing");
  const config = source.fetchConfig as {
    tabloid?: boolean;
    footballFeed?: boolean;
    mode?: TabloidSourceMode;
    url?: string;
  };
  if (!registry.some((item) => item.id === source.id))
    return { skipped: true, reason: "source-not-in-tabloid-registry" };

  if (raw.contentOrigin !== "full_article") {
    if (!config.url) throw new Error("Tabloid source page configuration is missing");
    const sourceUrl = raw.sourceUrl;
    const page = await timedPipelineStage("full_article_fetch", timing, () =>
      new sourceIngest.ArticleFetcher().fetchWithMedia(sourceUrl, config.url));
    if (!page) throw new Error("Complete tabloid source page unavailable");
    await repos.rawArticleRepository.upgradeFromFullArticle(raw.id, {
      sourceUrl: raw.sourceUrl,
      titleOriginal: page.article.titleOriginal || raw.titleOriginal,
      subtitleOriginal: page.article.subtitleOriginal,
      bodyOriginal: page.article.bodyOriginal,
      authorOriginal: page.article.authorOriginal,
      publishedAtSource: page.article.publishedAtSource ?? raw.publishedAtSource,
      imageUrl: raw.imageUrl ?? page.media.primary?.url ?? null,
      inlineImages: mergeInlineImages(page.media.inlineImages),
    });
    raw = await repos.rawArticleRepository.getById(raw.id);
    if (!raw || raw.contentOrigin !== "full_article")
      throw new Error("Tabloid source article could not be upgraded to a full article");
  }

  if (!options.forceRewrite) {
    if (raw.ingestedAt < new Date(TABLOID_PUBLIC_START))
      return { skipped: true, reason: "before-public-start" };
    if (!config.tabloid) return { skipped: true, reason: "source-not-enabled-for-tabloid" };
    if (
      !tabloid.isFootballTabloid(
        raw.titleOriginal,
        raw.bodyOriginal,
        config.footballFeed !== false,
        config.mode,
        raw.sourceUrl,
      )
    )
      return { skipped: true, reason: "topic-filter" };
  }

  const { story } = await repos.storyRepository.createOrMatchByFingerprint(
    createHash("sha256").update(`tabloid:${raw.sourceId}:${raw.id}`).digest("hex"),
    {
      canonicalTitle: raw.titleOriginal,
      categoryId: null,
      confidenceScore: 0,
      riskLevel: null,
      isDeveloping: false,
      imageUrl: raw.imageUrl,
    },
  );
  const storyTiming = { ...timing, storyId: story.id };
  await repos.rawArticleRepository.linkToStory(raw.id, story.id);
  await repos.storySourceRepository.link(story.id, raw.id, "initial");

  let version = await repos.storyVersionRepository.getLatest(story.id);
  if (version && version.promptVersion !== tabloid.TABLOID_PROMPT && !options.forceRewrite)
    return { skipped: true, reason: "legacy-prompt-version" };

  if (!version || options.forceRewrite) {
    const leaseOwner = options.jobOwner ?? crypto.randomUUID();
    const leaseAcquired = await timedPipelineStage("writer_lease_claim", storyTiming, () =>
      repos.rawArticleRepository.claimTabloidWriter(
        raw.id,
        leaseOwner,
        new Date(Date.now() + TABLOID_WRITER_LEASE_MS),
      ));
    if (!leaseAcquired) {
      const concurrentlyPersisted = await repos.storyVersionRepository.getLatest(story.id);
      if (options.forceRewrite || !concurrentlyPersisted) throw new TabloidWriterBusyError();
      version = concurrentlyPersisted;
    } else {
      try {
        const knowledge = await repos.editorialKnowledgeRepository.findRelevant({
          sport: "football",
          sourceLanguage: raw.language,
          targetLanguage: "hu",
          contexts: ["headline", "lead", "body", "tabloid"],
          contextText: `${raw.titleOriginal}\n${raw.bodyOriginal}`,
        });
        const writerInput = {
          language: raw.language,
          title: raw.titleOriginal,
          content: raw.bodyOriginal,
          sourceName: source.name,
          sourceUrl: raw.sourceUrl,
          publishedAt: raw.publishedAtSource?.toISOString() ?? null,
          editorialKnowledge: knowledge,
          usageContext: {
            role: "primary" as const,
            rawArticleId: raw.id,
            storyId: story.id,
            ...(options.jobId ? { jobId: options.jobId } : {}),
          },
        };
        let result: Awaited<ReturnType<typeof tabloid.writeTabloid>>;
        let technicalFallback = false;
        try {
          result = await timedPipelineStage("writer", storyTiming, () =>
            tabloid.writeTabloid(getWriterLlmClient(), writerInput));
        } catch (error) {
          if (!(error instanceof tabloid.TabloidTechnicalError)) throw error;
          technicalFallback = true;
          result = await timedPipelineStage("writer_technical_fallback", storyTiming, () => tabloid.writeTabloid(getWriterRepairLlmClient(), {
            ...writerInput,
            usageContext: { ...writerInput.usageContext, role: "technical_fallback" },
          }));
        }

        // Persist the successful model response before any quality repair,
        // projection, social enqueue, or publication step can fail. Retries
        // reuse this exact draft and therefore never repeat the primary call.
        version = await timedPipelineStage("draft_create", storyTiming, () => repos.storyVersionRepository.createNextVersion(story.id, {
          titleHu: result.title_hu,
          leadHu: result.lead_hu,
          bodyHu: result.body_hu,
          changeSummaryHu: options.forceRewrite
            ? "A forrás részletesebb feldolgozása és a forrásképek beágyazása."
            : null,
          generatedByModel: technicalFallback
            ? tabloid.TABLOID_REPAIR_MODEL
            : result.generatedByModel,
          isAiGenerated: true,
          promptVersion: tabloid.TABLOID_PROMPT,
          factConsistencyScore: 0,
          selfCheckFallback: false,
          qualityIssues: [WRITER_VALIDATION_PENDING],
        }, jobClaim));

        const forbiddenRules = knowledge;
        const sourceContent = `${raw.titleOriginal}\n${raw.bodyOriginal}`;
        const validationStartedAt = Date.now();
        const initialFlags = tabloid.assessTabloidQuality({
          sourceContent,
          output: result,
          forbiddenRules,
        });
        getLogger().info({ ...storyTiming, stage: "initial_validation", durationMs: Date.now() - validationStartedAt, issueCount: initialFlags.length }, "pipeline stage completed");
        let finalResult = result;
        let repairStatus: "not_needed" | "success" | "failed" = "not_needed";

        if (initialFlags.length > 0 && !technicalFallback) {
          await saveDraft(version.id, {
            titleHu: result.title_hu,
            leadHu: result.lead_hu,
            bodyHu: result.body_hu,
            editorialRewriteApplied: false,
            qualityIssues: initialFlags.map((flag) => ({
              ...flag,
              repaired: false,
              repairStatus: "pending",
            })),
          });
          if (initialFlags.some((flag) => !REPAIRABLE_TABLOID_FLAGS.has(flag.code))) {
            await saveDraft(version.id, {
              titleHu: result.title_hu,
              leadHu: result.lead_hu,
              bodyHu: result.body_hu,
              editorialRewriteApplied: false,
              qualityIssues: initialFlags.map((flag) => ({
                ...flag,
                repaired: false,
                repairStatus: "not_applicable",
              })),
            });
            await repos.reviewQueueRepository.ensureContentQualityReview(story.id, version.id, jobClaim);
            return { skipped: true, reason: "quality-review", qualityCodes: initialFlags.map((flag) => flag.code) };
          }
          try {
            finalResult = await timedPipelineStage("targeted_repair", storyTiming, () => tabloid.repairTabloid(
              getWriterRepairLlmClient(),
              result,
              initialFlags,
              { ...writerInput.usageContext, role: "targeted_repair" },
            ));
            repairStatus = "success";
          } catch (error) {
            repairStatus = "failed";
            await saveDraft(version.id, {
              titleHu: result.title_hu,
              leadHu: result.lead_hu,
              bodyHu: result.body_hu,
              editorialRewriteApplied: false,
              qualityIssues: initialFlags.map((flag) => ({
                ...flag,
                repaired: false,
                repairStatus: "failed",
              })),
            });
            getLogger().error(
              { rawArticleId: raw.id, storyId: story.id, error },
              "Targeted Writer repair failed",
            );
            throw error;
          }
        }

        const finalFlags = tabloid.assessTabloidQuality({
          sourceContent,
          output: finalResult,
          forbiddenRules,
        });
        if (finalFlags.length > 0) {
          await saveDraft(version.id, {
            titleHu: finalResult.title_hu,
            leadHu: finalResult.lead_hu,
            bodyHu: finalResult.body_hu,
            editorialRewriteApplied: false,
            qualityIssues: finalFlags.map((flag) => ({
              ...flag,
              repaired: false,
              repairStatus: "failed",
            })),
          });
          await repos.reviewQueueRepository.ensureContentQualityReview(story.id, version.id, jobClaim);
          return { skipped: true, reason: "quality-review", qualityCodes: finalFlags.map((flag) => flag.code) };
        }

        await saveDraft(version.id, {
          titleHu: finalResult.title_hu,
          leadHu: finalResult.lead_hu,
          bodyHu: finalResult.body_hu,
          editorialRewriteApplied: false,
          qualityIssues: [
            ...initialFlags.map((flag) => ({
              ...flag,
              repaired: repairStatus === "success",
              repairStatus,
            })),
            ...(technicalFallback
              ? [{ kind: "hard", code: "technical_schema_failure", field: "body", repaired: true }]
              : []),
          ],
        });
        version = await repos.storyVersionRepository.getById(version.id);
      } finally {
        try {
          await timedPipelineStage("writer_lease_release", storyTiming, () =>
            repos.rawArticleRepository.releaseTabloidWriter(raw.id, leaseOwner));
        } catch (error) {
          getLogger().error(
            { rawArticleId: raw.id, storyId: story.id, error },
            "Failed to release Writer lease; expiry will recover it",
          );
        }
      }
    }
  }

  if (!version) throw new Error("Tabloid draft missing after Writer processing");

  // A Worker can be killed in the very small window after the response was
  // persisted but before deterministic validation completed. Resume that
  // state from the saved draft without another model call.
  if (hasWriterValidationPending(version.qualityIssues)) {
    const knowledge = await repos.editorialKnowledgeRepository.findRelevant({
      sport: "football",
      sourceLanguage: raw.language,
      targetLanguage: "hu",
      contexts: ["headline", "lead", "body", "tabloid"],
      contextText: `${raw.titleOriginal}\n${raw.bodyOriginal}`,
    });
    const resumedFlags = tabloid.assessTabloidQuality({
      sourceContent: `${raw.titleOriginal}\n${raw.bodyOriginal}`,
      output: {
        title_hu: version.titleHu,
        lead_hu: version.leadHu,
        body_hu: version.bodyHu,
        language_warnings: [],
      },
      forbiddenRules: knowledge,
    });
    await saveDraft(version.id, {
      titleHu: version.titleHu,
      leadHu: version.leadHu,
      bodyHu: version.bodyHu,
      editorialRewriteApplied: false,
      qualityIssues: resumedFlags.map((flag) => ({
        ...flag,
        repaired: false,
        repairStatus: "not_retried",
      })),
    });
    version = await repos.storyVersionRepository.getById(version.id);
    if (!version) throw new Error("Persisted Writer draft disappeared during validation resume");
  }

  if (hasUnresolvedTabloidIssues(version.qualityIssues)) {
    await repos.reviewQueueRepository.ensureContentQualityReview(story.id, version.id, jobClaim);
    return { skipped: true, reason: "quality-review", qualityCodes: [] };
  }
  const slug = story.slug ?? `${seo.slugify(version.titleHu)}-${story.id.slice(0, 8)}`;
  if (!story.slug && !(await repos.storyRepository.trySetSlug(story.id, slug, jobClaim)))
    throw new Error("Tabloid slug collision");
  const publishedAt = story.publishedAt ?? new Date();
  const now = Date.now();
  const firstSeen = raw.firstSeenAt?.getTime();
  const sourcePublished = raw.publishedAtSource?.getTime();
  const freshForSocial = env.FACEBOOK_AUTO_PUBLISH && !options.forceRewrite &&
    publishedAt >= env.FACEBOOK_AUTO_PUBLISH_START_AT &&
    firstSeen !== undefined && firstSeen >= env.FACEBOOK_AUTO_PUBLISH_START_AT.getTime() &&
    firstSeen <= now && now - firstSeen <= 24 * 60 * 60_000 &&
    sourcePublished !== undefined && sourcePublished <= now &&
    now - sourcePublished <= 48 * 60 * 60_000;
  const canonicalUrl = freshForSocial
    ? new URL(`/hir/${encodeURIComponent(slug)}`, env.SITE_URL).toString()
    : null;
  if (jobClaim) {
    if (!(await timedPipelineStage("publication", storyTiming, () =>
      repos.storyRepository.publishVersionIfClaim(story.id, version.id, publishedAt, jobClaim,
        canonicalUrl ? {
          canonicalUrl,
          postText: buildFacebookPostText({ titleHu: version.titleHu, leadHu: version.leadHu, canonicalUrl }),
        } : undefined))))
      return { skipped: true, reason: "already-published" };
  } else {
    await repos.storyVersionRepository.markPublished(version.id);
    await repos.storyRepository.publish(story.id, version.id, publishedAt);
  }
  await timedPipelineStage("read_model_projection", storyTiming, () => readModelProjector.handleStoryPublished(
    {
      storyRepository: repos.storyRepository,
      storyVersionRepository: repos.storyVersionRepository,
      storySourceRepository: repos.storySourceRepository,
      storyCredibilityHistoryRepository: { listByStoryId: async () => [] },
      storyReadModelRepository: repos.storyReadModelRepository,
      logger: getLogger(),
    },
    {
      ...createEventEnvelope({ correlationId: crypto.randomUUID() }),
      type: "story/published",
      payload: { story_id: story.id, story_version_id: version.id },
    },
  ));
  if (freshForSocial) {
    await timedPipelineStage("social_enqueue", storyTiming, () => enqueueFacebookPublicationSafely({
      storyId: story.id,
      storyVersionId: version.id,
      slug,
      titleHu: version.titleHu,
      leadHu: version.leadHu,
      publishedAt,
      status: "published",
    }));
  } else {
    getLogger().info(storyTiming, "Historical or undated article excluded from automatic social enqueue");
  }
  revalidatePath("/");
  revalidatePath(`/hir/${slug}`);
  return {
    storyId: story.id,
    versionId: version.id,
    slug,
    model: version.generatedByModel,
    published: true,
  };
}

type IngestSource = Pick<Source, "id" | "name" | "language" | "fetchConfig">;
type FetchCandidate = Pick<RawArticle,
  "id" | "sourceId" | "sourceUrl" | "titleOriginal" | "publishedAtSource" |
  "imageUrl" | "processingOwner" | "processingAttempts">;

interface TabloidIngestRepositories {
  pipelineJobRepository: Pick<Repositories["pipelineJobRepository"], "getStatusCounts">;
  sourceRepository: {
    listActive(): Promise<IngestSource[]>;
    recordFetchResult: Repositories["sourceRepository"]["recordFetchResult"];
  };
  rawArticleRepository: {
    insertTabloid(data: NewRawArticle, enqueue: boolean): Promise<{ id: string } | null>;
    claimTabloidFetchBatch(
      sourceIds: string[], limit: number, staleLockMs: number, now?: Date,
    ): Promise<FetchCandidate[]>;
    deferTabloidFetch: Repositories["rawArticleRepository"]["deferTabloidFetch"];
    upgradeAndEnqueueTabloid: Repositories["rawArticleRepository"]["upgradeAndEnqueueTabloid"];
  };
}

/** Persist every observed feed item before admitting any full-page fetch. */
export async function ingestTabloid(repos: TabloidIngestRepositories = createIngestRepositories()) {
  if (!env.TABLOID_AUTO_PUBLISH) return { paused: true, llmCalls: 0 };
  const queueBefore = await repos.pipelineJobRepository.getStatusCounts();
  const ingestBudget = Math.min(4, Math.max(0, 36 - queueBefore.pending - queueBefore.inProgress));
  const sources = (await repos.sourceRepository.listActive())
    .filter(
      (source) =>
        (source.fetchConfig as { tabloid?: boolean }).tabloid === true &&
        registry.some((item) => item.id === source.id),
    )
    .sort((a, b) => {
      const priority = (source: typeof a) =>
        (source.fetchConfig as { mode?: string }).mode === "DIRECT_GOSSIP" ? 0 : 1;
      return priority(a) - priority(b);
    });
  const results: Array<{
    sourceId: string;
    sourceName: string;
    seenCount: number;
    persistedCount: number;
    rejectedCount: number;
    ingestedCount: number;
    deferredWithoutFullArticle: number;
    status: "ok" | "error";
  }> = [];
  const adapter = new sourceIngest.RssSourceAdapter(undefined, false);
  // Eight concurrent feed fetches bound a slow source without serializing all feeds.
  for (let offset = 0; offset < sources.length; offset += 8) {
    await Promise.all(
      sources.slice(offset, offset + 8).map(async (source) => {
        let seenCount = 0;
        let persistedCount = 0;
        let rejectedCount = 0;
        try {
          const config = source.fetchConfig as {
            mode?: TabloidSourceMode;
            footballFeed?: boolean;
            feedUrls?: string[];
            url: string;
          };
          const feeds = await timedPipelineStage("rss_fetch", { sourceId: source.id }, () => Promise.allSettled(
            (config.feedUrls ?? [config.url]).map((url) => adapter.fetch({ url })),
          ));
          const articles = feeds.flatMap((result) =>
            result.status === "fulfilled" ? result.value : [],
          );
          if (feeds.every((result) => result.status === "rejected"))
            throw new Error("RSS fetch failed");
          const persistStartedAt = Date.now();
          for (const article of articles) {
            seenCount++;
            const accepted = tabloid.isFootballTabloid(
              article.titleOriginal,
              article.bodyOriginal,
              config.footballFeed !== false,
              config.mode,
              article.sourceUrl,
            );
            if (!accepted) rejectedCount++;
            const raw = await repos.rawArticleRepository.insertTabloid(
              {
                sourceId: source.id,
                sourceUrl: article.sourceUrl,
                titleOriginal: article.titleOriginal,
                bodyOriginal: article.bodyOriginal,
                subtitleOriginal: article.subtitleOriginal,
                authorOriginal: article.authorOriginal,
                imageUrl: article.imageUrl,
                inlineImages: article.inlineImages ?? [],
                language: source.language,
                publishedAtSource: article.publishedAtSource,
                contentOrigin: article.contentOrigin,
                extractedEntities: { rssGuid: article.guid ?? article.sourceUrl },
                rssTitle: article.titleOriginal,
                rssDescription: article.bodyOriginal,
                rssGuid: article.guid ?? article.sourceUrl,
                firstSeenAt: new Date(),
                processingStatus: accepted ? "awaiting_full_article" : "rejected_topic",
                decisionReason: accepted ? "awaiting_processing_capacity" : "topic_filter",
                processingAvailableAt: accepted ? new Date() : null,
              },
              false,
            );
            if (raw) persistedCount++;
          }
          getLogger().info({ sourceId: source.id, stage: "rss_receipt_persist", durationMs: Date.now() - persistStartedAt, seenCount, persistedCount, rejectedCount }, "pipeline stage completed");
          await repos.sourceRepository.recordFetchResult(source.id, { status: "ok" });
          results.push({
            sourceId: source.id,
            sourceName: source.name,
            seenCount,
            persistedCount,
            rejectedCount,
            ingestedCount: 0,
            deferredWithoutFullArticle: 0,
            status: "ok",
          });
        } catch {
          await repos.sourceRepository.recordFetchResult(source.id, { status: "error" });
          results.push({
            sourceId: source.id,
            sourceName: source.name,
            seenCount,
            persistedCount,
            rejectedCount,
            ingestedCount: 0,
            deferredWithoutFullArticle: 0,
            status: "error",
          });
        }
      }),
    );
  }
  const byId = new Map(sources.map((source) => [source.id, source]));
  let queuedCount = 0;
  let deferredWithoutFullArticle = 0;
  const candidates = await timedPipelineStage("full_article_claim", {}, () =>
    repos.rawArticleRepository.claimTabloidFetchBatch(
      [...byId.keys()], ingestBudget, 5 * 60_000,
    ));
  for (const raw of candidates) {
    const source = byId.get(raw.sourceId);
    const owner = raw.processingOwner;
    if (!source || !owner) continue;
    const config = source.fetchConfig as { url: string };
    try {
      const outcome = await timedPipelineStage("full_article_fetch", { sourceId: source.id, rawArticleId: raw.id, attempt: raw.processingAttempts, leaseOwner: owner }, () =>
        new sourceIngest.ArticleFetcher().fetchWithMediaDetailed(raw.sourceUrl, config.url));
      if (!outcome.page) {
        deferredWithoutFullArticle++;
        await repos.rawArticleRepository.deferTabloidFetch(raw.id, owner, outcome.failure ?? "full_article_unavailable", raw.processingAttempts);
        continue;
      }
      const page = outcome.page;
      const queued = await timedPipelineStage("raw_upgrade_and_enqueue", { sourceId: source.id, rawArticleId: raw.id, attempt: raw.processingAttempts, leaseOwner: owner }, () => repos.rawArticleRepository.upgradeAndEnqueueTabloid(raw.id, {
        sourceUrl: raw.sourceUrl,
        titleOriginal: page.article.titleOriginal || raw.titleOriginal,
        subtitleOriginal: page.article.subtitleOriginal,
        bodyOriginal: page.article.bodyOriginal,
        authorOriginal: page.article.authorOriginal,
        publishedAtSource: page.article.publishedAtSource ?? raw.publishedAtSource,
        imageUrl: raw.imageUrl ?? page.media.primary?.url ?? null,
        inlineImages: mergeInlineImages(page.media.inlineImages),
      }, owner));
      if (queued) {
        queuedCount++;
        const result = results.find((item) => item.sourceId === raw.sourceId);
        if (result) result.ingestedCount++;
      }
    } catch (error) {
      deferredWithoutFullArticle++;
      await repos.rawArticleRepository.deferTabloidFetch(
        raw.id, owner,
        error instanceof Error ? `full_article_error:${error.name}` : "full_article_error",
        raw.processingAttempts,
      );
    }
  }
  return {
    results,
    queueBefore,
    ingestBudget,
    ingestDeferred: ingestBudget === 0,
    queuedCount,
    deferredWithoutFullArticle,
  };
}

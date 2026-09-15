import { createHash } from "node:crypto";
import { readModelProjector, seo, sourceIngest, tabloid } from "@magyarsportonline/agents";
import { createEventEnvelope } from "@magyarsportonline/events";
import { isDailyLlmQuotaError, isGeminiDailyQuotaError } from "@magyarsportonline/llm";
import {
  TABLOID_PUBLIC_START,
  deduplicateSourceImages,
  type SourceInlineImage,
  type TabloidSourceMode,
} from "@magyarsportonline/shared";
import { revalidatePath } from "next/cache";
import { createRepositories, type Repositories } from "./db";
import { env } from "./env";
import { getWriterLlmClient, getWriterRepairLlmClient } from "./llm";
import { getLogger } from "./logger";
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

async function fetchCompleteTabloidArticle(
  article: sourceIngest.NormalizedArticle,
  publisherUrl: string,
): Promise<sourceIngest.NormalizedArticle | null> {
  const page = await new sourceIngest.ArticleFetcher().fetchWithMedia(
    article.sourceUrl,
    publisherUrl,
  );
  if (!page) return null;
  const { article: fetched, media: pageMedia } = page;
  const image = article.image ?? pageMedia?.primary ?? null;
  return {
    ...article,
    titleOriginal: fetched.titleOriginal || article.titleOriginal,
    subtitleOriginal: fetched.subtitleOriginal,
    bodyOriginal: fetched.bodyOriginal,
    authorOriginal: fetched.authorOriginal,
    publishedAtSource: fetched.publishedAtSource ?? article.publishedAtSource,
    imageUrl: image?.url ?? article.imageUrl,
    ...(image ? { image } : {}),
    inlineImages: pageMedia?.inlineImages.length
      ? mergeInlineImages(pageMedia.inlineImages)
      : mergeInlineImages(
          article.inlineImages,
          image ? [{ ...image, alt: null, caption: null, credit: null }] : undefined,
        ),
    contentOrigin: "full_article",
  };
}

/** One accepted raw article owns one Story. Retries reuse its persisted draft. */
export async function publishTabloid(
  rawId: string,
  repos: Repositories = createRepositories(),
  options: { retryFailedWriter?: boolean; forceRewrite?: boolean; jobId?: string } = {},
) {
  if (!env.TABLOID_AUTO_PUBLISH) return { paused: true, llmCalls: 0 };
  return repos.rawArticleRepository.withTabloidLock(rawId, async () => {
    let raw = await repos.rawArticleRepository.getById(rawId);
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
    // Legacy jobs may have been queued before full-page extraction became
    // mandatory. Upgrade them here so an RSS fragment can never be published.
    if (raw.contentOrigin !== "full_article") {
      if (!config.url) throw new Error("Tabloid source page configuration is missing");
      const page = await new sourceIngest.ArticleFetcher().fetchWithMedia(
        raw.sourceUrl,
        config.url,
      );
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
    await repos.rawArticleRepository.linkToStory(raw.id, story.id);
    await repos.storySourceRepository.link(story.id, raw.id, "initial");
    let version = await repos.storyVersionRepository.getLatest(story.id);
    if (version && version.promptVersion !== tabloid.TABLOID_PROMPT && !options.forceRewrite)
      return { skipped: true, reason: "legacy-prompt-version" };
    if (!version || options.forceRewrite) {
      if (options.retryFailedWriter || options.forceRewrite)
        await repos.rawArticleRepository.releaseTabloidQuotaDeferral(raw.id);
      if (!(await repos.rawArticleRepository.claimTabloidWriter(raw.id))) {
        version = await repos.storyVersionRepository.getLatest(story.id);
        if (!version) throw new Error("Tabloid writer already attempted; no reusable draft exists");
      }
      if (!version || options.forceRewrite) {
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
          result = await tabloid.writeTabloid(getWriterLlmClient(), writerInput);
        } catch (error) {
          if (error instanceof tabloid.TabloidTechnicalError) {
            technicalFallback = true;
            result = await tabloid.writeTabloid(getWriterRepairLlmClient(), {
              ...writerInput,
              usageContext: {
                ...writerInput.usageContext,
                role: "technical_fallback",
              },
            });
          } else {
            if (isDailyLlmQuotaError(error) || isGeminiDailyQuotaError(error))
              await repos.rawArticleRepository.releaseTabloidQuotaDeferral(raw.id);
            throw error;
          }
        }
        const forbiddenTerms = knowledge.flatMap((item) => item.avoid_hu);
        const sourceContent = `${raw.titleOriginal}\n${raw.bodyOriginal}`;
        const initialFlags = tabloid.assessTabloidQuality({
          sourceContent,
          output: result,
          forbiddenTerms,
        });
        let finalResult = result;
        let repairStatus: "not_needed" | "success" | "failed" = "not_needed";
        let primaryDraftVersionId: string | null = null;
        if (initialFlags.length > 0 && !technicalFallback) {
          version = await repos.storyVersionRepository.createNextVersion(story.id, {
            titleHu: result.title_hu,
            leadHu: result.lead_hu,
            bodyHu: result.body_hu,
            changeSummaryHu: "Flash-Lite draft; célzott nyelvi javítás szükséges.",
            generatedByModel: result.generatedByModel,
            isAiGenerated: true,
            promptVersion: tabloid.TABLOID_PROMPT,
            factConsistencyScore: 0,
            selfCheckFallback: false,
            qualityIssues: initialFlags.map((flag) => ({
              ...flag,
              repaired: false,
              repairStatus: "pending",
            })),
          });
          primaryDraftVersionId = version.id;
          if (initialFlags.some((flag) => !REPAIRABLE_TABLOID_FLAGS.has(flag.code))) {
            await repos.storyVersionRepository.updateDraftContent(primaryDraftVersionId, {
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
            throw new Error(
              `Tabloid quality gate failed: ${initialFlags.map((flag) => flag.code).join(",")}`,
            );
          }
          try {
            finalResult = await tabloid.repairTabloid(
              getWriterRepairLlmClient(),
              result,
              initialFlags,
              { ...writerInput.usageContext, role: "targeted_repair" },
            );
            repairStatus = "success";
          } catch (error) {
            repairStatus = "failed";
            await repos.storyVersionRepository.updateDraftContent(primaryDraftVersionId, {
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
          forbiddenTerms,
        });
        if (finalFlags.length > 0) {
          if (primaryDraftVersionId)
            await repos.storyVersionRepository.updateDraftContent(primaryDraftVersionId, {
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
          throw new Error(
            `Tabloid quality gate failed: ${finalFlags.map((flag) => flag.code).join(",")}`,
          );
        }
        const qualityIssues = [
          ...initialFlags.map((flag) => ({ ...flag, repaired: repairStatus === "success" })),
          ...(technicalFallback
            ? [{ kind: "hard", code: "technical_schema_failure", field: "body", repaired: true }]
            : []),
        ];
        result = finalResult;
        const versionInput = {
          titleHu: result.title_hu,
          leadHu: result.lead_hu,
          bodyHu: result.body_hu,
          changeSummaryHu: version
            ? "A forrás részletesebb feldolgozása és a forrásképek beágyazása."
            : null,
          generatedByModel: technicalFallback
            ? tabloid.TABLOID_REPAIR_MODEL
            : result.generatedByModel,
          isAiGenerated: true,
          promptVersion: tabloid.TABLOID_PROMPT,
          factConsistencyScore: 0,
          selfCheckFallback: false,
          qualityIssues,
        };
        if (primaryDraftVersionId) {
          await repos.storyVersionRepository.updateDraftContent(primaryDraftVersionId, {
            titleHu: result.title_hu,
            leadHu: result.lead_hu,
            bodyHu: result.body_hu,
            editorialRewriteApplied: false,
            qualityIssues,
          });
          version = await repos.storyVersionRepository.getById(primaryDraftVersionId);
        } else {
          version = await repos.storyVersionRepository.createNextVersion(story.id, versionInput);
        }
      }
      if (!version) throw new Error("Tabloid draft missing after Writer processing");
    }
    if (hasUnresolvedTabloidIssues(version.qualityIssues))
      throw new Error("Tabloid draft has unresolved quality flags; automatic AI retry is blocked");
    const slug = story.slug ?? `${seo.slugify(version.titleHu)}-${story.id.slice(0, 8)}`;
    if (!story.slug && !(await repos.storyRepository.trySetSlug(story.id, slug)))
      throw new Error("Tabloid slug collision");
    await repos.storyVersionRepository.markPublished(version.id);
    await repos.storyRepository.publish(story.id, version.id, story.publishedAt ?? new Date());
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
        payload: { story_id: story.id, story_version_id: version.id },
      },
    );
    revalidatePath("/");
    revalidatePath(`/hir/${slug}`);
    return {
      storyId: story.id,
      versionId: version.id,
      slug,
      model: version.generatedByModel,
      published: true,
    };
  });
}

/** RSS requests run concurrently; extraction is optional, RSS content is sufficient. */
export async function ingestTabloid(repos: Repositories = createRepositories()) {
  if (!env.TABLOID_AUTO_PUBLISH) return { paused: true, llmCalls: 0 };
  const queueBefore = await repos.pipelineJobRepository.getStatusCounts();
  let budget = Math.max(0, 36 - queueBefore.pending - queueBefore.inProgress);
  // Full-page extraction is CPU-heavy on Workers. Four new pages per minute
  // keeps the request bounded while the durable queue preserves throughput.
  const ingestBudget = Math.min(4, budget);
  budget = ingestBudget;
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
    ingestedCount: number;
    deferredWithoutFullArticle: number;
    status: "ok" | "error";
  }> = [];
  const adapter = new sourceIngest.RssSourceAdapter(undefined, false);
  // Eight concurrent feed fetches bound a slow source without serializing all feeds.
  for (let offset = 0; offset < sources.length; offset += 8) {
    await Promise.all(
      sources.slice(offset, offset + 8).map(async (source) => {
        let count = 0;
        let deferredWithoutFullArticle = 0;
        try {
          const config = source.fetchConfig as {
            mode?: TabloidSourceMode;
            footballFeed?: boolean;
            feedUrls?: string[];
            url: string;
          };
          const feeds = await Promise.allSettled(
            (config.feedUrls ?? [config.url]).map((url) => adapter.fetch({ url })),
          );
          const articles = feeds.flatMap((result) =>
            result.status === "fulfilled" ? result.value : [],
          );
          if (feeds.every((result) => result.status === "rejected"))
            throw new Error("RSS fetch failed");
          for (const article of articles.slice(0, 30).reverse()) {
            if (
              !article.publishedAtSource ||
              (source.ingestWatermarkAt && article.publishedAtSource <= source.ingestWatermarkAt)
            )
              continue;
            if (budget <= 0) break;
            const accepted = tabloid.isFootballTabloid(
              article.titleOriginal,
              article.bodyOriginal,
              config.footballFeed !== false,
              config.mode,
              article.sourceUrl,
            );
            if (accepted) budget--;
            // Persist/deduplicate the cheap RSS row before fetching HTML. The
            // old order repeatedly parsed full pages for rows already stored
            // by the former filter and could exceed the Worker CPU budget.
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
              },
              false,
            );
            if (!accepted) continue;
            if (!raw) {
              budget++;
              continue;
            }
            const complete = await fetchCompleteTabloidArticle(article, config.url);
            if (!complete) {
              budget++;
              deferredWithoutFullArticle++;
              continue;
            }
            const queued = await repos.rawArticleRepository.upgradeAndEnqueueTabloid(raw.id, {
              sourceUrl: complete.sourceUrl,
              titleOriginal: complete.titleOriginal,
              subtitleOriginal: complete.subtitleOriginal,
              bodyOriginal: complete.bodyOriginal,
              authorOriginal: complete.authorOriginal,
              publishedAtSource: complete.publishedAtSource,
              imageUrl: complete.imageUrl,
              inlineImages: complete.inlineImages ?? [],
            });
            if (queued) count++;
            else budget++;
          }
          await repos.sourceRepository.recordFetchResult(source.id, { status: "ok" });
          results.push({
            sourceId: source.id,
            sourceName: source.name,
            ingestedCount: count,
            deferredWithoutFullArticle,
            status: "ok",
          });
        } catch {
          await repos.sourceRepository.recordFetchResult(source.id, { status: "error" });
          results.push({
            sourceId: source.id,
            sourceName: source.name,
            ingestedCount: count,
            deferredWithoutFullArticle,
            status: "error",
          });
        }
      }),
    );
  }
  // Gradually recover complete articles that the former tabloid-only filter
  // stored but never queued. Full-page extraction happens before enqueueing,
  // so the writer never receives an RSS fragment.
  const backfillLimit = Math.min(2, budget);
  let backfilled = 0;
  let backfillDeferredWithoutFullArticle = 0;
  if (backfillLimit > 0) {
    const byId = new Map(sources.map((source) => [source.id, source]));
    const candidates = await repos.rawArticleRepository.listUnqueuedTabloidCandidates(
      [...byId.keys()],
      new Date(TABLOID_PUBLIC_START),
      100,
    );
    for (const raw of candidates) {
      if (backfilled >= backfillLimit) break;
      const source = byId.get(raw.sourceId);
      if (!source) continue;
      const config = source.fetchConfig as {
        mode?: TabloidSourceMode;
        footballFeed?: boolean;
        url: string;
      };
      if (
        !tabloid.isFootballTabloid(
          raw.titleOriginal,
          raw.bodyOriginal,
          config.footballFeed !== false,
          config.mode,
          raw.sourceUrl,
        )
      )
        continue;
      const page = await new sourceIngest.ArticleFetcher().fetchWithMedia(
        raw.sourceUrl,
        config.url,
      );
      if (!page) {
        backfillDeferredWithoutFullArticle++;
        continue;
      }
      const imageUrl = raw.imageUrl ?? page.media.primary?.url ?? null;
      const queued = await repos.rawArticleRepository.upgradeAndEnqueueTabloid(raw.id, {
        sourceUrl: raw.sourceUrl,
        titleOriginal: page.article.titleOriginal || raw.titleOriginal,
        subtitleOriginal: page.article.subtitleOriginal,
        bodyOriginal: page.article.bodyOriginal,
        authorOriginal: page.article.authorOriginal,
        publishedAtSource: page.article.publishedAtSource ?? raw.publishedAtSource,
        imageUrl,
        inlineImages: mergeInlineImages(page.media.inlineImages),
      });
      if (queued) backfilled++;
    }
  }
  return {
    results,
    queueBefore,
    ingestBudget,
    ingestDeferred: ingestBudget === 0,
    backfilled,
    backfillDeferredWithoutFullArticle,
  };
}

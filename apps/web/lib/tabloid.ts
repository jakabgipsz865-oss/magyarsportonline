import { createHash } from "node:crypto";
import { readModelProjector, seo, sourceIngest, tabloid } from "@magyarsportonline/agents";
import { createEventEnvelope } from "@magyarsportonline/events";
import { isDailyLlmQuotaError, isGeminiDailyQuotaError } from "@magyarsportonline/llm";
import {
  TABLOID_PUBLIC_START,
  type SourceInlineImage,
  type TabloidSourceMode,
} from "@magyarsportonline/shared";
import { revalidatePath } from "next/cache";
import { createRepositories, type Repositories } from "./db";
import { env } from "./env";
import { getWriterLlmClient } from "./llm";
import { getLogger } from "./logger";
import registry from "./tabloid-sources.json";

export function mergeInlineImages(
  ...groups: Array<SourceInlineImage[] | undefined>
): SourceInlineImage[] {
  const seen = new Set<string>();
  return groups
    .flatMap((group) => group ?? [])
    .filter((image) => {
      let key = image.url;
      try {
        const parsed = new URL(image.url);
        parsed.hash = "";
        parsed.pathname = parsed.pathname.replace(/-\d{2,5}x\d{2,5}(?=\.[a-z0-9]{2,5}$)/i, "");
        key = parsed.href;
      } catch {
        // URLs are validated before persistence; retain exact-value dedup as a fallback.
      }
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 8);
}

async function fetchCompleteTabloidArticle(
  article: sourceIngest.NormalizedArticle,
  publisherUrl: string,
): Promise<sourceIngest.NormalizedArticle | null> {
  const [fetched, pageMedia] = await Promise.all([
    new sourceIngest.ArticleFetcher().fetch(article.sourceUrl),
    sourceIngest.fetchArticleMedia(article.sourceUrl, publisherUrl),
  ]);
  // `null` means the page could not be inspected. An empty media object is
  // valid and proves that the source page was checked but contains no usable image.
  if (!fetched || !pageMedia) return null;
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
    inlineImages: mergeInlineImages(
      article.inlineImages,
      pageMedia?.inlineImages,
      image ? [{ ...image, alt: null, caption: null, credit: null }] : undefined,
    ),
    contentOrigin: "full_article",
  };
}

/** One accepted raw article owns one Story. Retries reuse its persisted draft. */
export async function publishTabloid(
  rawId: string,
  repos: Repositories = createRepositories(),
  options: { retryFailedWriter?: boolean; forceRewrite?: boolean } = {},
) {
  if (!env.TABLOID_AUTO_PUBLISH) return { paused: true, llmCalls: 0 };
  return repos.rawArticleRepository.withTabloidLock(rawId, async () => {
    const raw = await repos.rawArticleRepository.getById(rawId);
    if (!raw) throw new Error("Tabloid source article missing");
    const source = await repos.sourceRepository.getById(raw.sourceId);
    if (!source) throw new Error("Tabloid source missing");
    const config = source.fetchConfig as {
      tabloid?: boolean;
      footballFeed?: boolean;
      mode?: TabloidSourceMode;
    };
    if (!registry.some((item) => item.id === source.id))
      return { skipped: true, reason: "source-not-in-tabloid-registry" };
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
      if (!(await repos.rawArticleRepository.claimTabloidWriter(raw.id)))
        throw new Error("Tabloid writer already attempted; manual inspection required");
      const result = await tabloid
        .writeTabloid(getWriterLlmClient(), {
          language: raw.language,
          title: raw.titleOriginal,
          content: raw.bodyOriginal,
          sourceName: source.name,
          sourceUrl: raw.sourceUrl,
          publishedAt: raw.publishedAtSource?.toISOString() ?? null,
        })
        .catch(async (error: unknown) => {
          if (isDailyLlmQuotaError(error) || isGeminiDailyQuotaError(error))
            await repos.rawArticleRepository.releaseTabloidQuotaDeferral(raw.id);
          throw error;
        });
      version = await repos.storyVersionRepository.createNextVersion(story.id, {
        titleHu: result.title_hu,
        leadHu: result.lead_hu,
        bodyHu: result.body_hu,
        changeSummaryHu: version
          ? "A forrás részletesebb feldolgozása és a forrásképek beágyazása."
          : null,
        generatedByModel: tabloid.TABLOID_MODEL,
        isAiGenerated: true,
        promptVersion: tabloid.TABLOID_PROMPT,
        // Legacy columns retained for schema compatibility, never used as gates.
        factConsistencyScore: 0,
        selfCheckFallback: false,
      });
    }
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
  const ingestBudget = Math.min(12, budget);
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
            );
            if (accepted) budget--;
            const complete = accepted
              ? await fetchCompleteTabloidArticle(article, config.url)
              : article;
            if (accepted && !complete) {
              budget++;
              deferredWithoutFullArticle++;
              continue;
            }
            const stored = complete!;
            const raw = await repos.rawArticleRepository.insertTabloid(
              {
                sourceId: source.id,
                sourceUrl: stored.sourceUrl,
                titleOriginal: stored.titleOriginal,
                bodyOriginal: stored.bodyOriginal,
                subtitleOriginal: stored.subtitleOriginal,
                authorOriginal: stored.authorOriginal,
                imageUrl: stored.imageUrl,
                inlineImages: stored.inlineImages ?? [],
                language: source.language,
                publishedAtSource: stored.publishedAtSource,
                contentOrigin: stored.contentOrigin,
                extractedEntities: { rssGuid: stored.guid ?? stored.sourceUrl },
              },
              accepted,
            );
            if (accepted && !raw) budget++;
            if (accepted && raw) count++;
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
  return { results, queueBefore, ingestBudget, ingestDeferred: ingestBudget === 0 };
}

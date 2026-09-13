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
    if (raw.ingestedAt < new Date(TABLOID_PUBLIC_START)) return { skipped: true };
    const source = await repos.sourceRepository.getById(raw.sourceId);
    if (!source) throw new Error("Tabloid source missing");
    const config = source.fetchConfig as {
      tabloid?: boolean;
      footballFeed?: boolean;
      mode?: TabloidSourceMode;
    };
    if (!config.tabloid || !registry.some((item) => item.id === source.id))
      return { skipped: true };
    if (
      !tabloid.isFootballTabloid(
        raw.titleOriginal,
        raw.bodyOriginal,
        config.footballFeed !== false,
        config.mode,
      )
    )
      return { skipped: true };
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
      return { skipped: true };
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
    status: "ok" | "error";
  }> = [];
  const adapter = new sourceIngest.RssSourceAdapter(undefined, false);
  // Eight concurrent feed fetches bound a slow source without serializing all feeds.
  for (let offset = 0; offset < sources.length; offset += 8) {
    await Promise.all(
      sources.slice(offset, offset + 8).map(async (source) => {
        let count = 0;
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
            const pageMedia =
              accepted && (article.inlineImages?.length ?? 0) < 2
                ? await sourceIngest.fetchArticleMedia(article.sourceUrl, config.url)
                : null;
            const image = article.image ?? pageMedia?.primary ?? null;
            const inlineImages = mergeInlineImages(
              article.inlineImages,
              pageMedia?.inlineImages,
              image ? [{ ...image, alt: null, caption: null, credit: null }] : undefined,
            );
            const raw = await repos.rawArticleRepository.insertTabloid(
              {
                sourceId: source.id,
                sourceUrl: article.sourceUrl,
                titleOriginal: article.titleOriginal,
                bodyOriginal: article.bodyOriginal,
                subtitleOriginal: article.subtitleOriginal,
                authorOriginal: article.authorOriginal,
                imageUrl: image?.url ?? null,
                inlineImages,
                language: source.language,
                publishedAtSource: article.publishedAtSource,
                contentOrigin: article.contentOrigin,
                extractedEntities: { rssGuid: article.guid ?? article.sourceUrl },
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
            status: "ok",
          });
        } catch {
          await repos.sourceRepository.recordFetchResult(source.id, { status: "error" });
          results.push({
            sourceId: source.id,
            sourceName: source.name,
            ingestedCount: count,
            status: "error",
          });
        }
      }),
    );
  }
  return { results, queueBefore, ingestBudget, ingestDeferred: ingestBudget === 0 };
}

import { createHash } from "node:crypto";
import { readModelProjector, seo, sourceIngest, tabloid } from "@magyarsportonline/agents";
import { isDailyLlmQuotaError, isGeminiDailyQuotaError } from "@magyarsportonline/llm";
import { createEventEnvelope } from "@magyarsportonline/events";
import { revalidatePath } from "next/cache";
import { createRepositories, type Repositories } from "./db";
import { getWriterLlmClient } from "./llm";
import { getLogger } from "./logger";

/** One accepted raw article owns one Story. Retries reuse its persisted draft. */
export async function publishTabloid(rawId: string, repos: Repositories = createRepositories()) {
  return repos.rawArticleRepository.withTabloidLock(rawId, async () => {
    const raw = await repos.rawArticleRepository.getById(rawId);
    if (!raw) throw new Error("Tabloid source article missing");
    const source = await repos.sourceRepository.getById(raw.sourceId);
    if (!source) throw new Error("Tabloid source missing");
    const config = source.fetchConfig as { tabloid?: boolean; footballFeed?: boolean };
    if (!config.tabloid) return { skipped: true };
    if (
      !tabloid.isFootballTabloid(raw.titleOriginal, raw.bodyOriginal, config.footballFeed !== false)
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
    if (!version) {
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
        changeSummaryHu: null,
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
  const queueBefore = await repos.pipelineJobRepository.getStatusCounts();
  let budget = Math.max(0, 36 - queueBefore.pending - queueBefore.inProgress);
  const ingestBudget = Math.min(12, budget);
  budget = ingestBudget;
  const sources = (await repos.sourceRepository.listActive()).filter(
    (source) => (source.fetchConfig as { tabloid?: boolean }).tabloid === true,
  );
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
              article.publishedAtSource &&
              source.ingestWatermarkAt &&
              article.publishedAtSource <= source.ingestWatermarkAt
            )
              continue;
            if (budget <= 0) break;
            const accepted = tabloid.isFootballTabloid(
              article.titleOriginal,
              article.bodyOriginal,
              config.footballFeed !== false,
            );
            if (accepted) budget--;
            const raw = await repos.rawArticleRepository.insertTabloid(
              {
                sourceId: source.id,
                sourceUrl: article.sourceUrl,
                titleOriginal: article.titleOriginal,
                bodyOriginal: article.bodyOriginal,
                subtitleOriginal: article.subtitleOriginal,
                authorOriginal: article.authorOriginal,
                imageUrl: article.imageUrl,
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

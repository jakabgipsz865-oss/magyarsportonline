import { sourceIngest } from "@magyarsportonline/agents";
import { createEventEnvelope } from "@magyarsportonline/events";
import { createRepositories } from "./db";
import { buildQueueingEmitter } from "./pipeline";

const BBC_VIDEO_PATH = /\/sport\/football\/videos\//;
const LEGACY_BBC_STORY_IDS = [
  "60680bc2-025b-466a-a6c9-7cf9aa2f3af4",
  "462ba252-bc91-4b98-b1be-002dea41c292",
  "db601a87-0534-4a91-81fd-701fc2593797",
] as const;

export interface LegacyBbcRepairResult {
  storyId: string;
  rawArticleId: string;
  sourceUrlBefore: string;
  sourceUrlAfter: string;
  bodyLengthBefore: number;
  bodyLengthAfter: number;
  factCountBefore: number;
}

function recoveryUrl(resolvedUrl: string, originalUrl: string): string {
  const resolved = new URL(resolvedUrl);
  const videoId = new URL(originalUrl).pathname.split("/").filter(Boolean).at(-1);
  if (videoId) resolved.searchParams.set("from_video", videoId);
  return resolved.toString();
}

/** Idempotent, bounded recovery: only published BBC video-backed snippets are touched. */
export async function repairLegacyBbcVideoStories(): Promise<LegacyBbcRepairResult[]> {
  const repos = createRepositories();
  const emitter = buildQueueingEmitter(repos.pipelineJobRepository);
  const fetcher = new sourceIngest.ArticleFetcher();
  const repaired: LegacyBbcRepairResult[] = [];

  for (const storyId of LEGACY_BBC_STORY_IDS) {
    const story = await repos.storyRepository.getById(storyId);
    if (!story || story.status !== "published") continue;
    const articles = await repos.rawArticleRepository.listByStoryId(story.id);
    for (const article of articles) {
      if (article.contentOrigin !== "rss_snippet" || !BBC_VIDEO_PATH.test(article.sourceUrl)) {
        continue;
      }
      const fetched = await fetcher.fetch(article.sourceUrl);
      if (!fetched?.resolvedUrl) continue;

      const exactExisting = await repos.rawArticleRepository.findBySourceUrl(fetched.resolvedUrl);
      const sourceUrlAfter =
        exactExisting && exactExisting.id !== article.id
          ? recoveryUrl(fetched.resolvedUrl, article.sourceUrl)
          : fetched.resolvedUrl;
      const factCountBefore = (await repos.factRepository.listByStoryId(story.id)).length;
      const updated = await repos.rawArticleRepository.replaceWithResolvedFullArticle(article.id, {
        sourceUrl: sourceUrlAfter,
        titleOriginal: fetched.titleOriginal,
        subtitleOriginal: fetched.subtitleOriginal,
        bodyOriginal: fetched.bodyOriginal,
        authorOriginal: fetched.authorOriginal,
        publishedAtSource: fetched.publishedAtSource ?? article.publishedAtSource,
        imageUrl: article.imageUrl,
      });
      if (!updated) continue;

      await emitter.emit({
        ...createEventEnvelope({ correlationId: crypto.randomUUID() }),
        type: "story/created",
        payload: { story_id: story.id },
      });
      repaired.push({
        storyId: story.id,
        rawArticleId: article.id,
        sourceUrlBefore: article.sourceUrl,
        sourceUrlAfter,
        bodyLengthBefore: article.bodyOriginal.length,
        bodyLengthAfter: fetched.bodyOriginal.length,
        factCountBefore,
      });
    }
  }

  return repaired;
}

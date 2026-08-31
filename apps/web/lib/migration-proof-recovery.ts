import { sourceIngest } from "@magyarsportonline/agents";
import { createEventEnvelope } from "@magyarsportonline/events";
import { createRepositories } from "./db";
import { buildDispatcher } from "./pipeline";

const PROOF_STORY_IDS = [
  "60680bc2-025b-466a-a6c9-7cf9aa2f3af4", // BBC Farke
  "2de216a1-40cd-4a41-80cb-008bf3861950", // Daily Express
  "3f16d93d-650b-456b-9909-c5bec87a2c2d", // Daily Mirror
] as const;

export interface MigrationProofRecoveryResult {
  storyId: string;
  rawArticleId: string;
  sourceUrl: string;
  bodyLengthBefore: number;
  bodyLengthAfter: number;
}

/** Bounded migration proof: re-enrich and reprocess exactly three allowlisted Stories. */
export async function recoverMigrationProofStories(): Promise<MigrationProofRecoveryResult[]> {
  const repos = createRepositories();
  const dispatcher = buildDispatcher(repos);
  const fetcher = new sourceIngest.ArticleFetcher();
  const recovered: MigrationProofRecoveryResult[] = [];

  for (const storyId of PROOF_STORY_IDS) {
    const story = await repos.storyRepository.getById(storyId);
    if (!story) continue;
    const article = (await repos.rawArticleRepository.listByStoryId(story.id))[0];
    if (!article) continue;
    const fetched = await fetcher.fetch(article.sourceUrl);
    if (!fetched) continue;

    const sourceUrl = fetched.resolvedUrl ?? article.sourceUrl;
    const updated = await repos.rawArticleRepository.replaceWithResolvedFullArticle(article.id, {
      sourceUrl,
      titleOriginal: fetched.titleOriginal,
      subtitleOriginal: fetched.subtitleOriginal,
      bodyOriginal: fetched.bodyOriginal,
      authorOriginal: fetched.authorOriginal,
      publishedAtSource: fetched.publishedAtSource ?? article.publishedAtSource,
      imageUrl: article.imageUrl,
    });
    if (!updated) continue;

    await dispatcher.emit({
      ...createEventEnvelope({ correlationId: crypto.randomUUID() }),
      type: "story/created",
      payload: { story_id: story.id },
    });
    recovered.push({
      storyId: story.id,
      rawArticleId: article.id,
      sourceUrl,
      bodyLengthBefore: article.bodyOriginal.length,
      bodyLengthAfter: fetched.bodyOriginal.length,
    });
  }

  return recovered;
}

import { factVerification } from "@magyarsportonline/agents";
import type { PendingReviewItem } from "@magyarsportonline/db";
import { createRepositories, type Repositories } from "./db";

const { buildContradictionDetails } = factVerification;
type ContradictionDetail = factVerification.ContradictionDetail;

export interface ReviewSourceInfo {
  name: string;
  url: string;
  reliabilityTier: string;
}

export interface ReviewImageInfo {
  url: string;
  sourceName: string | null;
  licenseType: string | null;
  attributionRule: string | null;
}

export interface PendingReviewDetail extends PendingReviewItem {
  sources: ReviewSourceInfo[];
  fullArticleSourceCount: number;
  contradictions: ContradictionDetail[];
  image: ReviewImageInfo | null;
}

async function enrich(item: PendingReviewItem, repos: Repositories): Promise<PendingReviewDetail> {
  const [sources, facts, rawArticles] = await Promise.all([
    repos.storySourceRepository.summaryByStoryId(item.storyId),
    repos.factRepository.listByStoryIdWithSourceName(item.storyId),
    repos.rawArticleRepository.listByStoryId(item.storyId),
  ]);

  const contradictions = buildContradictionDetails(facts);

  let image: ReviewImageInfo | null = null;
  if (item.imageUrl) {
    const contributingArticle = rawArticles
      .filter((article) => article.imageUrl === item.imageUrl)
      .sort((a, b) => a.ingestedAt.getTime() - b.ingestedAt.getTime())[0];
    if (contributingArticle) {
      const source = await repos.sourceRepository.getById(contributingArticle.sourceId);
      image = {
        url: item.imageUrl,
        sourceName: source?.name ?? null,
        licenseType: source?.licenseType ?? null,
        attributionRule: source?.attributionRule ?? null,
      };
    }
  }

  return {
    ...item,
    sources: sources.map((source) => ({
      name: source.name,
      url: source.url,
      reliabilityTier: source.reliabilityTier,
    })),
    fullArticleSourceCount: rawArticles.filter(
      (article) => article.contentOrigin === "full_article",
    ).length,
    contradictions,
    image,
  };
}

/**
 * The review queue's full evidence view (2026-07-29, "admin review — teljes
 * bizonyíték jóváhagyás előtt" sprint): before approving/publishing a Story,
 * a human reviewer must be able to see the full Hungarian article (not just
 * title/lead), every contributing source and its article link, the
 * credibility score and its justification, any unresolved contradictions,
 * and — for the display image — which source it came from and that
 * source's license terms, so approval is never a blind click.
 */
export async function listPendingReviewDetails(
  repos: Repositories = createRepositories(),
  itemId?: string,
): Promise<PendingReviewDetail[]> {
  const items = await repos.reviewQueueRepository.listPending(itemId);
  return Promise.all(items.map((item) => enrich(item, repos)));
}

import { sourceIngest, tabloid } from "@magyarsportonline/agents";
import type { TabloidSourceMode } from "@magyarsportonline/shared";
import catalog from "./tabloid-source-catalog.json";

/** Feed quality uses at most 100 newest returned items, independently of freshness. */
export function preflightWindow(articles: sourceIngest.NormalizedArticle[], now: Date) {
  const age = (article: sourceIngest.NormalizedArticle) =>
    article.publishedAtSource ? now.getTime() - article.publishedAtSource.getTime() : Infinity;
  const current = articles.filter(
    (article) => age(article) >= -3600_000 && age(article) <= 48 * 3600_000,
  );
  const quality = [...articles]
    .sort((a, b) => (b.publishedAtSource?.getTime() ?? 0) - (a.publishedAtSource?.getTime() ?? 0))
    .slice(0, 100);
  return {
    current,
    quality,
    items30d: articles.filter(
      (article) => age(article) >= -3600_000 && age(article) <= 30 * 24 * 3600_000,
    ).length,
  };
}

export async function tabloidSourcePreflight(
  language?: string,
  includeImages = false,
  adapter: Pick<sourceIngest.RssSourceAdapter, "fetch"> = new sourceIngest.RssSourceAdapter(
    undefined,
    false,
  ),
) {
  const now = new Date();
  const entries = catalog.filter((source) => !language || source.language === language);
  const acceptedArticles: Array<{
    source: (typeof catalog)[number];
    article: sourceIngest.NormalizedArticle;
  }> = [];
  const rows: Array<{
    id: string;
    source: string;
    language: string;
    mode: string;
    tier: string;
    url: string;
    RSS_STATUS: "PASS" | "TIMEOUT/UNVERIFIED" | "FAIL/SKIP";
    RSS_VALID: boolean | null;
    FRESH_48H: boolean | null;
    returnedItems: number;
    qualityItems: number;
    items30d: number;
    accepted48h: number;
    currentItems: number;
    acceptedCount: number;
    eligible: boolean;
    reason: string | null;
    accepted: string[];
    rejected: string[];
  }> = [];
  for (let offset = 0; offset < entries.length; offset += 8) {
    await Promise.all(
      entries.slice(offset, offset + 8).map(async (source) => {
        try {
          const articles = await adapter.fetch({ url: source.url });
          const { current, quality, items30d } = preflightWindow(articles, now);
          const accepted = quality.filter((article) =>
            tabloid.isFootballTabloid(
              article.titleOriginal,
              article.bodyOriginal,
              source.footballFeed,
              source.mode as TabloidSourceMode,
            ),
          );
          const acceptedSet = new Set(accepted);
          const eligible = ["CORE", "SECONDARY"].includes(source.tier);
          if (eligible) acceptedArticles.push(...accepted.map((article) => ({ source, article })));
          rows.push({
            id: source.id,
            source: source.name,
            language: source.language,
            mode: source.mode,
            tier: source.tier,
            url: source.url,
            RSS_STATUS: "PASS",
            RSS_VALID: true,
            FRESH_48H: current.length > 0,
            returnedItems: articles.length,
            qualityItems: quality.length,
            items30d,
            accepted48h: current.filter((article) =>
              tabloid.isFootballTabloid(
                article.titleOriginal,
                article.bodyOriginal,
                source.footballFeed,
                source.mode as TabloidSourceMode,
              ),
            ).length,
            currentItems: current.length,
            acceptedCount: accepted.length,
            eligible,
            reason: ["CORE", "SECONDARY"].includes(source.tier) ? null : source.tier,
            accepted: accepted.slice(0, 10).map((article) => article.titleOriginal),
            rejected: quality
              .filter((article) => !acceptedSet.has(article))
              .slice(0, 10)
              .map((article) => article.titleOriginal),
          });
        } catch (error) {
          const timeout = /timeout|timed out|ETIMEDOUT|AbortError/i.test(String(error));
          rows.push({
            id: source.id,
            source: source.name,
            language: source.language,
            mode: source.mode,
            tier: source.tier,
            url: source.url,
            RSS_STATUS: timeout ? "TIMEOUT/UNVERIFIED" : "FAIL/SKIP",
            RSS_VALID: timeout ? null : false,
            FRESH_48H: null,
            returnedItems: 0,
            qualityItems: 0,
            items30d: 0,
            accepted48h: 0,
            currentItems: 0,
            acceptedCount: 0,
            eligible: false,
            reason: `SKIP: ${error instanceof Error ? error.message.slice(0, 200) : "HTTP/XML error"}`,
            accepted: [],
            rejected: [],
          });
        }
      }),
    );
  }
  rows.sort(
    (a, b) =>
      entries.findIndex((source) => source.id === a.id) -
      entries.findIndex((source) => source.id === b.id),
  );
  // Round-robin across sources: the ten-image sample is not dominated by the first feed.
  const sample: typeof acceptedArticles = [];
  for (let index = 0; sample.length < 10; index++) {
    const before = sample.length;
    for (const source of entries) {
      const item = acceptedArticles.filter((item) => item.source.id === source.id)[index];
      if (item) sample.push(item);
      if (sample.length === 10) break;
    }
    if (sample.length === before) break;
  }
  const images = includeImages
    ? await Promise.all(
        sample.map(async ({ source, article }) => {
          const htmlImage = await sourceIngest.fetchArticleImage(article.sourceUrl, source.url);
          const image = sourceIngest.selectRemoteImage([
            ...(article.imageCandidates ?? (article.image ? [article.image] : [])),
            ...(htmlImage ? [htmlImage] : []),
          ]);
          return {
            source: source.name,
            article: article.titleOriginal,
            articleUrl: article.sourceUrl,
            imageSource: image?.source ?? null,
            width: image?.width ?? null,
            height: image?.height ?? null,
            remoteUrlPresent: Boolean(image),
            imageUrl: image?.url ?? null,
          };
        }),
      )
    : [];
  return {
    observedAt: now.toISOString(),
    readOnly: true,
    qualityWindow: "latest 100 returned items; 30-day and 48-hour counts reported separately",
    llmCalls: 0,
    imageFileRequests: 0,
    rows,
    images,
  };
}

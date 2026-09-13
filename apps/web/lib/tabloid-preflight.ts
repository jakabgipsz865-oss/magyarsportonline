import { sourceIngest, tabloid } from "@magyarsportonline/agents";
import type { TabloidSourceMode } from "@magyarsportonline/shared";
import catalog from "./tabloid-source-catalog.json";

export async function tabloidSourcePreflight(language?: string, includeImages = false) {
  const now = new Date();
  const adapter = new sourceIngest.RssSourceAdapter(undefined, false);
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
    rss: "PASS" | "FAIL";
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
          const current = articles.filter(
            (article) =>
              article.publishedAtSource &&
              now.getTime() - article.publishedAtSource.getTime() <= 48 * 3600_000 &&
              now.getTime() - article.publishedAtSource.getTime() >= -3600_000,
          );
          const accepted = current.filter((article) =>
            tabloid.isFootballTabloid(
              article.titleOriginal,
              article.bodyOriginal,
              source.footballFeed,
              source.mode as TabloidSourceMode,
              article.sourceUrl,
            ),
          );
          const acceptedSet = new Set(accepted);
          const eligible = current.length > 0 && ["CORE", "SECONDARY"].includes(source.tier);
          if (eligible) acceptedArticles.push(...accepted.map((article) => ({ source, article })));
          rows.push({
            id: source.id,
            source: source.name,
            language: source.language,
            mode: source.mode,
            tier: source.tier,
            url: source.url,
            rss: current.length ? "PASS" : "FAIL",
            currentItems: current.length,
            acceptedCount: accepted.length,
            eligible,
            reason: current.length
              ? ["CORE", "SECONDARY"].includes(source.tier)
                ? null
                : source.tier
              : "SKIP: no dated items in the last 48 hours",
            accepted: accepted.slice(0, 5).map((article) => article.titleOriginal),
            rejected: current
              .filter((article) => !acceptedSet.has(article))
              .slice(0, 5)
              .map((article) => article.titleOriginal),
          });
        } catch (error) {
          rows.push({
            id: source.id,
            source: source.name,
            language: source.language,
            mode: source.mode,
            tier: source.tier,
            url: source.url,
            rss: "FAIL",
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
          const image =
            article.image ?? (await sourceIngest.fetchArticleImage(article.sourceUrl, source.url));
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
    llmCalls: 0,
    imageFileRequests: 0,
    rows,
    images,
  };
}

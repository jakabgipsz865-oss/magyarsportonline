import { readFile, writeFile } from "node:fs/promises";
import { tabloidSourcePreflight } from "../apps/web/lib/tabloid-preflight";
import {
  fetchArticleImage,
  selectRemoteImage,
} from "../packages/agents/src/source-ingest/remote-image";
import { isFootballTabloid } from "../packages/agents/src/tabloid";
import type { NormalizedArticle } from "../packages/agents/src/source-ingest/types";
import type { TabloidSourceMode } from "../packages/shared/src/tabloid-generation";
import gold from "../packages/agents/src/tabloid-editorial-gold.json";
const snapshot = JSON.parse(
  await readFile("/private/tmp/mso-calibration-rss-snapshot.json", "utf8"),
);
const baseline = JSON.parse(await readFile("docs/tabloid-calibration-image-baseline.json", "utf8"));
const report = await tabloidSourcePreflight(undefined, false, {
  async fetch(config: unknown) {
    const row = snapshot.rows.find((r: any) => r.source.url === (config as { url: string }).url);
    if (row.error) throw new Error(row.error);
    return row.articles.map((a: any) => ({
      ...a,
      publishedAtSource: a.publishedAtSource ? new Date(a.publishedAtSource) : null,
    })) as NormalizedArticle[];
  },
});
const previous = process.argv.includes("--reuse-images")
  ? JSON.parse(await readFile("docs/tabloid-calibration-report.json", "utf8"))
  : null;
const images =
  previous?.images ??
  (await Promise.all(
    baseline.images.map(async (old: any) => {
      const row = snapshot.rows.find((r: any) => r.source.name === old.source);
      const article = row.articles.find((a: any) => a.sourceUrl === old.articleUrl);
      const requests: Array<{ url: string; status: number; location: string | null }> = [];
      const fetcher: typeof fetch = async (input, init) => {
        const res = await fetch(input, init);
        requests.push({
          url: String(input),
          status: res.status,
          location: res.headers.get("location"),
        });
        return res;
      };
      const html = await fetchArticleImage(old.articleUrl, row.source.url, fetcher);
      const image = selectRemoteImage([
        ...(article?.imageCandidates ?? (article?.image ? [article.image] : [])),
        ...(html ? [html] : []),
      ]);
      return {
        source: old.source,
        article: old.article,
        articleUrl: old.articleUrl,
        baselinePresent: old.remoteUrlPresent,
        imageSource: image?.source ?? null,
        width: image?.width ?? null,
        height: image?.height ?? null,
        imageUrl: image?.url ?? null,
        remoteUrlPresent: !!image,
        fallback: !!image && image.width === null,
        htmlRequests: requests,
      };
    }),
  ));
const goldResults = gold.map((item) => ({
  id: item.id,
  source: item.source,
  title: item.title,
  origin: item.origin,
  expected: item.expected,
  results: Object.fromEntries(
    ["DIRECT_GOSSIP", "BROAD_TABLOID_FOOTBALL"].map((mode) => [
      mode,
      isFootballTabloid(item.title, item.content, item.footballFeed, mode as TabloidSourceMode),
    ]),
  ),
}));
const result = {
  ...report,
  rssObservedAt: snapshot.observedAt,
  imagesObservedAt: previous?.imagesObservedAt ?? previous?.observedAt ?? report.observedAt,
  images,
  gold: goldResults,
};
await writeFile("docs/tabloid-calibration-report.json", JSON.stringify(result, null, 2) + "\n");
console.log(
  JSON.stringify(
    {
      sources: report.rows.length,
      imagesBefore: images.filter((i: any) => i.baselinePresent).length,
      imagesAfter: images.filter((i: any) => i.remoteUrlPresent).length,
      goldPassed: goldResults.filter((i) => Object.values(i.results).every((v) => v === i.expected))
        .length,
      goldTotal: goldResults.length,
      failedImages: images
        .filter((i: any) => !i.remoteUrlPresent)
        .map((i: any) => ({ source: i.source, requests: i.htmlRequests })),
      llmCalls: 0,
      imageFileRequests: 0,
    },
    null,
    2,
  ),
);
process.exit(0);

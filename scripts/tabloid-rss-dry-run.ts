/** Read-only live RSS sampling: no DB, queues, LLM client, or publication. */
import { writeFile } from "node:fs/promises";
import registry from "../apps/web/lib/tabloid-sources.json";
import { RssSourceAdapter } from "../packages/agents/src/source-ingest/rss-adapter";
import { isFootballTabloid } from "../packages/agents/src/tabloid";
import { TABLOID_PUBLIC_PROMPT } from "../packages/shared/src/tabloid-generation";

const adapter = new RssSourceAdapter(undefined, false);
const fetchedAt = new Date();
const feeds = registry.flatMap((source) => source.feedUrls.map((url) => ({ source, url })));
const samples: Array<{
  language: string;
  source: string;
  title: string;
  content: string;
  url: string;
  publishedAt: string | null;
  accepted: boolean;
}> = [];
const failures: Array<{ source: string; url: string; error: string }> = [];
let stale = 0;
for (let offset = 0; offset < feeds.length; offset += 8) {
  await Promise.all(
    feeds.slice(offset, offset + 8).map(async ({ source, url }) => {
      try {
        for (const article of await adapter.fetch({ url })) {
          // Only a current (48-hour) item with a valid publication date is evidence.
          const age = article.publishedAtSource
            ? fetchedAt.getTime() - article.publishedAtSource.getTime()
            : Infinity;
          if (age < -3600000 || age > 48 * 3600000) {
            stale++;
            continue;
          }
          samples.push({
            language: source.language,
            source: source.name,
            title: article.titleOriginal,
            content: article.bodyOriginal,
            url: article.sourceUrl,
            publishedAt: article.publishedAtSource?.toISOString() ?? null,
            accepted: isFootballTabloid(
              article.titleOriginal,
              article.bodyOriginal,
              source.footballFeed,
              source.mode as "DIRECT_GOSSIP" | "BROAD_TABLOID_FOOTBALL",
            ),
          });
        }
      } catch (error) {
        failures.push({
          source: source.name,
          url,
          error: error instanceof Error ? error.message : "RSS fetch failed",
        });
      }
    }),
  );
}
const byLanguage = Object.fromEntries(
  ["en", "es", "it", "de"].map((language) => {
    const items = samples.filter((item) => item.language === language);
    const accepted = [
      ...new Map(items.filter((item) => item.accepted).map((item) => [item.url, item])).values(),
    ];
    return [
      language,
      {
        scanned: items.length,
        acceptedCount: accepted.length,
        accepted: accepted.slice(0, 10).map(({ title, url, source }) => ({ title, url, source })),
        rejected: items
          .filter((item) => !item.accepted)
          .slice(0, 5)
          .map(({ title, url, source }) => ({ title, url, source })),
      },
    ];
  }),
);
const report = {
  fetchedAt: fetchedAt.toISOString(),
  generation: TABLOID_PUBLIC_PROMPT,
  llmCalls: 0,
  feedsAttempted: feeds.length,
  staleOrUndatedExcluded: stale,
  failures,
  byLanguage,
};
await writeFile("docs/tabloid-v2-rss-proof.json", JSON.stringify(report, null, 2) + "\n");
await writeFile(
  "/private/tmp/mso-tabloid-v2-rss-samples.json",
  JSON.stringify(samples, null, 2) + "\n",
);
console.log(JSON.stringify(report, null, 2));

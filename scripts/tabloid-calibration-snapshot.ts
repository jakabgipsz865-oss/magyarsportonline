import { writeFile } from "node:fs/promises";
import { RssSourceAdapter } from "../packages/agents/src/source-ingest/rss-adapter";
import catalog from "../apps/web/lib/tabloid-source-catalog.json";
const adapter = new RssSourceAdapter(undefined, false);
const rows = [];
for (let i = 0; i < catalog.length; i += 8) {
  rows.push(
    ...(await Promise.all(
      catalog.slice(i, i + 8).map(async (source) => {
        try {
          return { source, articles: await adapter.fetch({ url: source.url }), error: null };
        } catch (error) {
          return {
            source,
            articles: [],
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }),
    )),
  );
}
await writeFile(
  "/private/tmp/mso-calibration-rss-snapshot.json",
  JSON.stringify({ observedAt: new Date().toISOString(), rows }),
);
console.log(
  JSON.stringify({
    sources: rows.length,
    ok: rows.filter((r) => !r.error).length,
    llmCalls: 0,
    imageFileRequests: 0,
  }),
);
process.exit(0);

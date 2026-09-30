// Bounded, read-only export of the already identified 124 Story cohort.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const [config, database, directory] = process.argv.slice(2);
if (!config || !database || !directory)
  throw new Error(
    "Usage: node scripts/export-number-corpus.mjs <wrangler-config> <database> <output-directory>",
  );
const manifest = JSON.parse(
  fs.readFileSync(
    new URL("../packages/agents/src/fixtures/number-audit-124-manifest.json", import.meta.url),
  ),
);
if (manifest.length !== 124 || manifest.some((r) => !/^[-a-f0-9]{36}$/.test(r.id)))
  throw new Error("Invalid manifest");
const ids = manifest.map((r) => `'${r.id}'`).join(",");
const queries = {
  texts: `SELECT s.id story_id,s.status,s.published_at,v.id version_id,v.title_hu,v.lead_hu,v.body_hu,v.quality_issues,r.id raw_article_id,r.language,r.source_url,r.title_original,r.body_original,r.content_origin,ss.contribution_type FROM stories s JOIN story_versions v ON v.story_id=s.id JOIN story_sources ss ON ss.story_id=s.id JOIN raw_articles r ON r.id=ss.raw_article_id WHERE s.id IN (${ids}) ORDER BY s.id,v.version_number`,
  recovery_metadata: `SELECT s.id story_id,s.first_seen_at story_first_seen_at,s.image_url story_image_url,r.id raw_article_id,r.source_id,r.image_url,r.inline_images,r.published_at_source,r.first_seen_at,r.ingested_at,src.name,src.base_url,src.language source_language,src.fetch_config,src.type,src.license_type,src.reliability_tier FROM stories s JOIN story_sources ss ON ss.story_id=s.id JOIN raw_articles r ON r.id=ss.raw_article_id JOIN sources src ON src.id=r.source_id WHERE s.id IN (${ids}) AND ss.excluded=0 ORDER BY s.id`,
};
fs.mkdirSync(directory, { recursive: true });
for (const [name, query] of Object.entries(queries)) {
  const packagePath = require.resolve("wrangler/package.json");
  const cli = path.join(path.dirname(packagePath), "bin/wrangler.js");
  const result = spawnSync(
    process.execPath,
    [cli, "d1", "execute", database, "--config", config, "--remote", "--json", "--command", query],
    {
      encoding: "utf8",
      env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
      maxBuffer: 20_000_000,
    },
  );
  if (result.status !== 0) throw new Error(`Read-only export failed: ${result.stderr}`);
  const [data] = JSON.parse(result.stdout);
  if (!data.success || data.meta.rows_written !== 0 || data.meta.changed_db !== false)
    throw new Error("Read-only invariant failed");
  fs.writeFileSync(path.join(directory, `${name}.json`), JSON.stringify(data.results, null, 2));
  console.log(name, data.results.length, "rows; rows_written=0");
}

// One-shot operator validation. Never imported by the web runtime.
// Only the explicitly verified Preview endpoint is accepted; no Writer imports.
import { readFile, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { createDatabaseClient } from "../packages/db/src/client";
import { RawArticleRepository } from "../packages/db/src/repositories/raw-article-repository";
import { SourceRepository } from "../packages/db/src/repositories/source-repository";
import { sql } from "../packages/db/node_modules/drizzle-orm";
import { RssSourceAdapter } from "../packages/agents/src/source-ingest/rss-adapter";
import {
  fetchArticleImage,
  selectRemoteImage,
} from "../packages/agents/src/source-ingest/remote-image";
import { isFootballTabloid } from "../packages/agents/src/tabloid";
import type { TabloidSourceMode } from "../packages/shared/src/tabloid-generation";
import registry from "../apps/web/lib/tabloid-sources.json";
import gold from "../packages/agents/src/tabloid-editorial-gold.json";

const expectedHost = "ep-withered-voice-a2h3cwp5-pooler.eu-central-1.aws.neon.tech";
const output = "docs/preview-rss-validation.json";
const runId = randomUUID();
const startedAt = new Date();
const check = (ok: unknown, message: string) => {
  if (!ok) throw new Error(message);
};
check(process.env.TABLOID_AUTO_PUBLISH === "false", "AUTO-PUBLISH must explicitly be false");
const connection = (await readFile("/private/tmp/mso-preview-validation-db", "utf8")).trim();
const target = new URL(connection);
check(target.hostname === expectedHost && target.pathname === "/neondb", "Preview target mismatch");
const db = createDatabaseClient(connection);
const rawRepo = new RawArticleRepository(db);
const sourceRepo = new SourceRepository(db);

async function snapshot() {
  const counts = await db.execute(sql`SELECT current_database() AS database,
    (SELECT count(*)::int FROM raw_articles) AS raw,
    (SELECT count(*)::int FROM pipeline_jobs) AS jobs,
    (SELECT count(*)::int FROM pipeline_jobs WHERE status IN ('pending','in_progress')) AS queue,
    (SELECT count(*)::int FROM stories) AS stories,
    (SELECT count(*)::int FROM story_versions) AS versions,
    (SELECT count(*)::int FROM agent_runs) AS agent_runs,
    (SELECT count(*)::int FROM sources WHERE is_active) AS active_sources,
    (SELECT md5(coalesce(string_agg(md5(row_to_json(t)::text),'' ORDER BY id),'')) FROM stories t) AS stories_hash,
    (SELECT md5(coalesce(string_agg(md5(row_to_json(t)::text),'' ORDER BY id),'')) FROM story_versions t) AS versions_hash,
    (SELECT md5(coalesce(string_agg(md5(row_to_json(t)::text),'' ORDER BY id),'')) FROM pipeline_jobs t) AS jobs_hash`);
  return counts[0];
}

async function main() {
  const before = await snapshot();
  check(before?.database === "neondb", "Database name mismatch");
  console.log(JSON.stringify({ previewBranch: "br-flat-sun-a25d40c9", before }));
  if (process.argv.includes("--inspect")) return;
  check(
    before.queue === 0 && before.active_sources === 0,
    "Preview has active jobs/sources; stop before writes",
  );
  const goldResults = gold.flatMap((item) =>
    (["DIRECT_GOSSIP", "BROAD_TABLOID_FOOTBALL"] as TabloidSourceMode[]).map((mode) => {
      const actual = isFootballTabloid(item.title, item.content, item.footballFeed, mode);
      return {
        id: item.id,
        source: item.source,
        title: item.title,
        mode,
        expected: item.expected,
        actual,
        pass: actual === item.expected,
      };
    }),
  );
  check(
    goldResults.every((g) => g.pass),
    "Editorial gold set failed; stop before ingest",
  );
  const adapter = new RssSourceAdapter(undefined, false);
  const rows: any[] = [];
  const http: any[] = [];
  const result: any = {
    runId,
    startedAt,
    environment: "preview",
    branch: "vercel-preview",
    branchId: "br-flat-sun-a25d40c9",
    sampling:
      "One live RSS fetch/feed; latest max 50 items/source within 48 hours. No historical padding.",
    before,
    gold: goldResults,
    rows,
    http,
    geminiCalls: 0,
    imageFileRequests: 0,
    writerQueued: 0,
    autoPublish: false,
  };
  const checkpoint = () => writeFile(output, JSON.stringify(result, null, 2) + "\n");
  for (const source of registry) {
    check(["CORE", "SECONDARY"].includes(source.tier), "Unapproved tier");
    const row: any = {
      source: source.name,
      sourceId: source.id,
      language: source.language,
      mode: source.mode,
      tier: source.tier,
      fetched: 0,
      fresh48h: 0,
      considered: 0,
      rawStored: 0,
      accept: 0,
      reject: 0,
      duplicate: 0,
      imageUrl: 0,
      writerQueued: 0,
      items: [],
    };
    rows.push(row);
    const feeds = await Promise.allSettled(source.feedUrls.map((url) => adapter.fetch({ url })));
    row.feeds = feeds.map((f, i) => ({
      url: source.feedUrls[i],
      status:
        f.status === "fulfilled"
          ? "RSS_VALID"
          : /timeout|timed out/i.test(String(f.reason))
            ? "TIMEOUT/UNVERIFIED"
            : "FAIL",
      items: f.status === "fulfilled" ? f.value.length : 0,
      error: f.status === "rejected" ? String(f.reason).slice(0, 180) : null,
    }));
    if (feeds.every((f) => f.status === "rejected")) {
      await checkpoint();
      continue;
    }
    const articles = feeds.flatMap((f) => (f.status === "fulfilled" ? f.value : []));
    row.fetched = articles.length;
    const fresh = articles.filter(
      (a) =>
        a.publishedAtSource &&
        a.publishedAtSource.getTime() >= startedAt.getTime() - 48 * 3600000 &&
        a.publishedAtSource <= startedAt,
    );
    row.fresh48h = fresh.length;
    const selected = fresh
      .sort((a, b) => b.publishedAtSource!.getTime() - a.publishedAtSource!.getTime())
      .slice(0, 50);
    row.considered = selected.length;
    // Registration keeps isActive=false. Explicit fetch above is the ONLY activation for this one shot.
    await sourceRepo.registerTabloidSource(source);
    for (let i = 0; i < selected.length; i += 4) {
      await Promise.all(
        selected.slice(i, i + 4).map(async (article) => {
          const accepted = isFootballTabloid(
            article.titleOriginal,
            article.bodyOriginal,
            source.footballFeed,
            source.mode as TabloidSourceMode,
          );
          const htmlFetcher: typeof fetch = async (input, init) => {
            const u = new URL(String(input));
            const a = new URL(article.sourceUrl);
            check(
              u.hostname === a.hostname &&
                u.pathname.replace(/\/$/, "") === a.pathname.replace(/\/$/, ""),
              "Unexpected HTML request",
            );
            check(!init?.method || init.method === "GET", "Only article HTML GET permitted");
            const response = await fetch(input, init);
            http.push({
              source: source.name,
              url: String(input),
              status: response.status,
              type: response.headers.get("content-type"),
            });
            return response;
          };
          const html = accepted
            ? await fetchArticleImage(article.sourceUrl, source.url, htmlFetcher)
            : null;
          const image = selectRemoteImage([
            ...(article.imageCandidates ?? (article.image ? [article.image] : [])),
            ...(html ? [html] : []),
          ]);
          const imageUrl = image?.url ?? null;
          const data = {
            sourceId: source.id,
            sourceUrl: article.sourceUrl,
            titleOriginal: article.titleOriginal,
            bodyOriginal: article.bodyOriginal,
            subtitleOriginal: article.subtitleOriginal,
            authorOriginal: article.authorOriginal,
            language: source.language,
            publishedAtSource: article.publishedAtSource,
            contentOrigin: article.contentOrigin,
            imageUrl,
            extractedEntities: {
              rssGuid: article.guid ?? article.sourceUrl,
              previewValidation: {
                runId,
                accepted,
                mode: source.mode,
                imageSource: image?.source ?? null,
                width: image?.width ?? null,
                height: image?.height ?? null,
              },
            },
          };
          // The existing atomic repository writes NO queue event, even for ACCEPT.
          const raw = await rawRepo.insertTabloid(data, false);
          const item: any = {
            title: article.titleOriginal,
            sourceUrl: article.sourceUrl,
            publishedAt: article.publishedAtSource,
            guid: article.guid ?? article.sourceUrl,
            accepted,
            rawId: raw?.id ?? null,
            duplicate: !raw,
            imageSource: image?.source ?? null,
            width: image?.width ?? null,
            height: image?.height ?? null,
            imageUrl,
            decisionReason: null,
          };
          if (raw) {
            check(raw.imageUrl === imageUrl, "Remote URL changed in DB");
            row.rawStored++;
            accepted ? row.accept++ : row.reject++;
            if (accepted && imageUrl) row.imageUrl++;
          } else row.duplicate++;
          row.items.push(item);
        }),
      );
    }
    await sourceRepo.recordFetchResult(source.id, { status: "ok" });
    await checkpoint();
    console.log(
      JSON.stringify({
        source: row.source,
        fetched: row.fetched,
        considered: row.considered,
        stored: row.rawStored,
        accept: row.accept,
        reject: row.reject,
        duplicate: row.duplicate,
        images: row.imageUrl,
        writer: 0,
      }),
    );
  }
  // Independent readback, including queue associations, verifies persisted raw rows.
  result.persisted =
    await db.execute(sql`SELECT r.id,r.source_id,r.source_url,r.title_original,r.image_url,r.story_id,r.extracted_entities->'previewValidation' AS decision,
    (SELECT count(*)::int FROM pipeline_jobs j WHERE j.event->'payload'->>'raw_article_id'=r.id::text) AS queued
    FROM raw_articles r WHERE r.extracted_entities->'previewValidation'->>'runId'=${runId} ORDER BY r.ingested_at,r.id`);
  result.after = await snapshot();
  result.verified = {
    rawStored: result.persisted.length,
    writerQueued: result.persisted.reduce((n: number, r: any) => n + r.queued, 0),
    noLinkedStories: result.persisted.every((r: any) => r.story_id === null),
    canonicalUnchanged:
      before.stories_hash === result.after.stories_hash &&
      before.versions_hash === result.after.versions_hash,
    queueUnchanged: before.jobs_hash === result.after.jobs_hash && result.after.queue === 0,
    agentRunsUnchanged: before.agent_runs === result.after.agent_runs,
    sourcesInactive: result.after.active_sources === 0,
    urlsUnchanged: result.persisted.every((p: any) =>
      rows.some((r) => r.items.some((i: any) => i.rawId === p.id && i.imageUrl === p.image_url)),
    ),
  };
  result.codeHashes = {};
  for (const f of [
    "packages/agents/src/tabloid.ts",
    "packages/agents/src/source-ingest/remote-image.ts",
    "apps/web/lib/tabloid-sources.json",
  ])
    result.codeHashes[f] = createHash("sha256")
      .update(await readFile(f))
      .digest("hex");
  result.finishedAt = new Date();
  await checkpoint();
  check(
    result.verified.writerQueued === 0 &&
      result.verified.canonicalUnchanged &&
      result.verified.queueUnchanged &&
      result.verified.urlsUnchanged,
    "Safety verification failed",
  );
  console.log(
    JSON.stringify({
      verified: result.verified,
      goldPassed: goldResults.filter((g) => g.pass).length,
      goldTotal: goldResults.length,
      report: output,
    }),
  );
}
try {
  await main();
} catch (error) {
  console.error(
    "Preview validation stopped:",
    String(error).replace(/postgres(?:ql)?:\/\/\S+/g, "[REDACTED]"),
  );
  process.exitCode = 1;
} finally {
  await db.$client.end({ timeout: 5 });
}
// rss-parser/HTTP keep-alive handles must not leave this one-shot operator running.
process.exit(process.exitCode ?? 0);

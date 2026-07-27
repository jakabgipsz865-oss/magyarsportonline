import { schema, type Database } from "@magyarsportonline/db";
import type { Logger } from "@magyarsportonline/observability";
import { eq } from "drizzle-orm";
import type { RecordAgentRun } from "../telemetry/agent-run-recorder.js";
import { runWithTelemetry } from "../telemetry/run-with-telemetry.js";
import { fetchRssFeed } from "./rss-fetcher.js";

export interface SourceIngestSourceInput {
  id: string;
  baseUrl: string;
  language: string;
}

export interface SourceIngestResult {
  newRawArticleIds: string[];
  skippedExistingCount: number;
}

/**
 * Source Ingest Agent (docs/architecture/02-agents.md §2.1). URL-level
 * dedup only — deciding whether a new RawArticle belongs to an existing
 * Story is the Deduplication/Story Merge Agents' job, not this one's.
 */
export async function runSourceIngestAgent(
  deps: { db: Database; logger: Logger; recordAgentRun: RecordAgentRun },
  input: { source: SourceIngestSourceInput; correlationId: string },
): Promise<SourceIngestResult> {
  return runWithTelemetry(
    deps,
    {
      agentName: "source-ingest",
      triggerEvent: "cron/dispatch-ingest",
      correlationId: input.correlationId,
    },
    async ({ log }) => {
      const items = await fetchRssFeed(input.source.baseUrl);
      log.info({ sourceId: input.source.id, itemCount: items.length }, "fetched RSS feed");

      const newRawArticleIds: string[] = [];
      let skippedExistingCount = 0;

      for (const item of items) {
        const existing = await deps.db.query.rawArticles.findFirst({
          where: eq(schema.rawArticles.sourceUrl, item.link),
        });
        if (existing) {
          skippedExistingCount += 1;
          continue;
        }

        const [inserted] = await deps.db
          .insert(schema.rawArticles)
          .values({
            sourceId: input.source.id,
            sourceUrl: item.link,
            titleOriginal: item.title,
            bodyOriginal: item.contentText,
            language: input.source.language,
            ingestStatus: "ingested",
            publishedAtSource: item.publishedAt ?? undefined,
          })
          .returning({ id: schema.rawArticles.id });

        if (inserted) {
          newRawArticleIds.push(inserted.id);
          log.info({ rawArticleId: inserted.id, sourceUrl: item.link }, "ingested new raw article");
        }
      }

      return { newRawArticleIds, skippedExistingCount };
    },
  );
}

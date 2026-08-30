import { createEventEnvelope } from "@magyarsportonline/events";
import type { RawArticleRepository, Source, SourceRepository } from "@magyarsportonline/db";
import type { Logger } from "@magyarsportonline/observability";
import type { AgentRunRecorder } from "../shared/with-agent-run";
import { withAgentRun } from "../shared/with-agent-run";
import type { SourceAdapter } from "./types";

export * from "./article-enriching-adapter";
export * from "./article-fetcher/index";
export * from "./rss-adapter";
export * from "./types";

export const AGENT_VERSION = "source-ingest@0.1.0";

export interface Emitter {
  emit(event: unknown): Promise<void>;
}

export interface SourceIngestDeps {
  sourceRepository: Pick<
    SourceRepository,
    "listActive" | "recordFetchResult" | "advanceIngestWatermark"
  >;
  rawArticleRepository: Pick<
    RawArticleRepository,
    "findBySourceUrl" | "insert" | "upgradeFromFullArticle"
  >;
  agentRunRepository: AgentRunRecorder;
  dispatcher: Emitter;
  /** One adapter per `Source.type` — a source whose type has no registered adapter is skipped with an error, not silently ignored. */
  adapters: Partial<Record<Source["type"], SourceAdapter>>;
  logger: Logger;
  /**
   * Caps how many *new* articles a single call processes, TOTAL ACROSS ALL
   * ACTIVE SOURCES in the run (2026-07-29 fix — this used to reset per
   * source, which meant N active sources could still process up to N ×
   * this value new articles in one request; a real production run with
   * BBC Sport + Sky Sports both active and this cap already at 1 still hit
   * Vercel's 60s `FUNCTION_INVOCATION_TIMEOUT`, HTTP 504, at 60.7s — 2
   * sources × 1 article each was still too much synchronous LLM work for
   * one Hobby-tier request). Each new article's downstream pipeline (dedup
   * → merge → fact verification → writing → SEO → publish gate) runs
   * synchronously, in the same request — with a real LLM provider this is
   * several sequential network calls per article. Leftover new articles
   * (from this source or any later one) are picked up by the next
   * scheduled ingest run (already-ingested URLs are never re-processed
   * either way). `undefined` (the default) means no cap.
   */
  maxNewArticlesPerRun?: number | undefined;
}

export interface SourceIngestResult {
  sourceId: string;
  sourceName: string;
  ingestedCount: number;
  status: "ok" | "error";
}

/**
 * Source Ingest Agent (docs/architecture/02-agents.md §2.1). Fetches every
 * active Source via its registered adapter, inserts new RawArticles
 * (URL-deduped), and emits `source/article.ingested` per new article — one
 * fresh correlation_id per article, since each starts an independent Story
 * lifecycle (docs/architecture/03-event-flow.md §3.6). No LLM call in this
 * agent, per §2.1: "tisztán determinisztikus fetch/parse".
 */
export async function runSourceIngest(deps: SourceIngestDeps): Promise<SourceIngestResult[]> {
  const sources = await deps.sourceRepository.listActive();
  const results: SourceIngestResult[] = [];
  // Shared across every source in this run — see maxNewArticlesPerRun's
  // doc comment for why this must be global, not reset per source.
  let remainingBudget = deps.maxNewArticlesPerRun;

  for (const source of sources) {
    // This id identifies the fetch-cycle's own agent_runs audit entry, not
    // any downstream Story chain — a single ingest run can fan out into N
    // independent correlation_id chains, one per new RawArticle (below).
    const runCorrelationId = crypto.randomUUID();
    const log = deps.logger.child({ agentName: "source-ingest", correlationId: runCorrelationId });

    if (remainingBudget !== undefined && remainingBudget <= 0) {
      log.info(
        { sourceId: source.id },
        "run-wide maxNewArticlesPerRun budget already exhausted by an earlier source, skipping",
      );
      results.push({
        sourceId: source.id,
        sourceName: source.name,
        ingestedCount: 0,
        status: "ok",
      });
      continue;
    }

    try {
      const ingestedCount = await withAgentRun(
        {
          agentRunRepository: deps.agentRunRepository,
          agentName: "source-ingest",
          correlationId: runCorrelationId,
          triggerEvent: "cron/dispatch-ingest",
        },
        () => ingestOneSource(deps, source, log, remainingBudget),
      );
      if (remainingBudget !== undefined) {
        remainingBudget -= ingestedCount;
      }
      await deps.sourceRepository.recordFetchResult(source.id, { status: "ok" });
      results.push({ sourceId: source.id, sourceName: source.name, ingestedCount, status: "ok" });
    } catch (error) {
      await deps.sourceRepository.recordFetchResult(source.id, { status: "error" });
      log.error(
        { error: error instanceof Error ? error.message : String(error) },
        "source ingest failed",
      );
      results.push({
        sourceId: source.id,
        sourceName: source.name,
        ingestedCount: 0,
        status: "error",
      });
    }
  }

  return results;
}

async function ingestOneSource(
  deps: SourceIngestDeps,
  source: Source,
  log: Logger,
  remainingBudget: number | undefined,
): Promise<number> {
  const adapter = deps.adapters[source.type];
  if (!adapter) {
    throw new Error(`No SourceAdapter registered for source type "${source.type}"`);
  }

  const articles = (await adapter.fetch(source.fetchConfig))
    .filter(
      (article): article is typeof article & { publishedAtSource: Date } =>
        article.publishedAtSource !== null && !Number.isNaN(article.publishedAtSource.getTime()),
    )
    .sort((a, b) => a.publishedAtSource.getTime() - b.publishedAtSource.getTime());
  let ingestedCount = 0;

  if (source.ingestWatermarkAt === null) {
    const newestPublishedAt = articles.at(-1)?.publishedAtSource;
    if (newestPublishedAt) {
      await deps.sourceRepository.advanceIngestWatermark(source.id, newestPublishedAt);
    }
    log.info({ sourceId: source.id }, "baseline fetch completed without ingesting feed backlog");
    return 0;
  }

  for (const article of articles) {
    if (remainingBudget !== undefined && ingestedCount >= remainingBudget) {
      log.info(
        { sourceId: source.id, cap: remainingBudget },
        "reached the run-wide maxNewArticlesPerRun budget, remaining new articles deferred to the next ingest",
      );
      break;
    }

    if (article.publishedAtSource <= source.ingestWatermarkAt) {
      log.info(
        { sourceId: source.id, sourceUrl: article.sourceUrl },
        "skipping article at or before source freshness watermark",
      );
      continue;
    }

    const existing = await deps.rawArticleRepository.findBySourceUrl(article.sourceUrl);
    if (existing) {
      if (existing.contentOrigin === "rss_snippet" && article.contentOrigin === "full_article") {
        const upgraded = await deps.rawArticleRepository.upgradeFromFullArticle(existing.id, {
          titleOriginal: article.titleOriginal,
          subtitleOriginal: article.subtitleOriginal,
          bodyOriginal: article.bodyOriginal,
          authorOriginal: article.authorOriginal,
          publishedAtSource: article.publishedAtSource,
          imageUrl: article.imageUrl,
        });
        if (upgraded) {
          log.info(
            { rawArticleId: existing.id, sourceUrl: article.sourceUrl },
            "upgraded existing RSS snippet to full-article provenance",
          );
        }
      }
      await deps.sourceRepository.advanceIngestWatermark(source.id, article.publishedAtSource);
      continue;
    }

    const rawArticle = await deps.rawArticleRepository.insert({
      sourceId: source.id,
      sourceUrl: article.sourceUrl,
      titleOriginal: article.titleOriginal,
      subtitleOriginal: article.subtitleOriginal,
      bodyOriginal: article.bodyOriginal,
      authorOriginal: article.authorOriginal,
      language: source.language,
      publishedAtSource: article.publishedAtSource,
      imageUrl: article.imageUrl,
      contentOrigin: article.contentOrigin,
    });

    const correlationId = crypto.randomUUID();
    await deps.dispatcher.emit({
      ...createEventEnvelope({ correlationId, id: correlationId }),
      type: "source/article.ingested",
      payload: { raw_article_id: rawArticle.id, source_id: source.id },
    });
    log.info({ correlationId, rawArticleId: rawArticle.id }, "ingested new RawArticle");
    await deps.sourceRepository.advanceIngestWatermark(source.id, article.publishedAtSource);
    ingestedCount++;
  }

  return ingestedCount;
}

import { createEventEnvelope } from "@magyarsportonline/events";
import type { RawArticleRepository, Source, SourceRepository } from "@magyarsportonline/db";
import type { Logger } from "@magyarsportonline/observability";
import type { AgentRunRecorder } from "../shared/with-agent-run";
import { withAgentRun } from "../shared/with-agent-run";
import type { SourceAdapter } from "./types";

export * from "./rss-adapter";
export * from "./types";

export const AGENT_VERSION = "source-ingest@0.1.0";

export interface Emitter {
  emit(event: unknown): Promise<void>;
}

export interface SourceIngestDeps {
  sourceRepository: Pick<SourceRepository, "listActive" | "recordFetchResult">;
  rawArticleRepository: Pick<RawArticleRepository, "findBySourceUrl" | "insert">;
  agentRunRepository: AgentRunRecorder;
  dispatcher: Emitter;
  /** One adapter per `Source.type` — a source whose type has no registered adapter is skipped with an error, not silently ignored. */
  adapters: Partial<Record<Source["type"], SourceAdapter>>;
  logger: Logger;
  /**
   * Caps how many *new* articles a single call processes per source, per run.
   * Each new article's downstream pipeline (dedup → merge → fact
   * verification → writing → SEO → publish gate) runs synchronously, in the
   * same request — with a real LLM provider this is several sequential
   * network calls per article, which can exceed a serverless function's
   * execution time limit for a large batch. Leftover new articles are picked
   * up by the next scheduled ingest run (already-ingested URLs are never
   * re-processed either way). `undefined` (the default) means no cap.
   */
  maxNewArticlesPerRun?: number | undefined;
}

export interface SourceIngestResult {
  sourceId: string;
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

  for (const source of sources) {
    // This id identifies the fetch-cycle's own agent_runs audit entry, not
    // any downstream Story chain — a single ingest run can fan out into N
    // independent correlation_id chains, one per new RawArticle (below).
    const runCorrelationId = crypto.randomUUID();
    const log = deps.logger.child({ agentName: "source-ingest", correlationId: runCorrelationId });

    try {
      const ingestedCount = await withAgentRun(
        {
          agentRunRepository: deps.agentRunRepository,
          agentName: "source-ingest",
          correlationId: runCorrelationId,
          triggerEvent: "cron/dispatch-ingest",
        },
        () => ingestOneSource(deps, source, log),
      );
      await deps.sourceRepository.recordFetchResult(source.id, { status: "ok" });
      results.push({ sourceId: source.id, ingestedCount, status: "ok" });
    } catch (error) {
      await deps.sourceRepository.recordFetchResult(source.id, { status: "error" });
      log.error(
        { error: error instanceof Error ? error.message : String(error) },
        "source ingest failed",
      );
      results.push({ sourceId: source.id, ingestedCount: 0, status: "error" });
    }
  }

  return results;
}

async function ingestOneSource(
  deps: SourceIngestDeps,
  source: Source,
  log: Logger,
): Promise<number> {
  const adapter = deps.adapters[source.type];
  if (!adapter) {
    throw new Error(`No SourceAdapter registered for source type "${source.type}"`);
  }

  const articles = await adapter.fetch(source.fetchConfig);
  let ingestedCount = 0;

  for (const article of articles) {
    if (deps.maxNewArticlesPerRun !== undefined && ingestedCount >= deps.maxNewArticlesPerRun) {
      log.info(
        { sourceId: source.id, cap: deps.maxNewArticlesPerRun },
        "reached maxNewArticlesPerRun for this run, remaining new articles deferred to the next ingest",
      );
      break;
    }

    const existing = await deps.rawArticleRepository.findBySourceUrl(article.sourceUrl);
    if (existing) {
      continue;
    }

    const rawArticle = await deps.rawArticleRepository.insert({
      sourceId: source.id,
      sourceUrl: article.sourceUrl,
      titleOriginal: article.titleOriginal,
      bodyOriginal: article.bodyOriginal,
      language: source.language,
      publishedAtSource: article.publishedAtSource,
    });

    const correlationId = crypto.randomUUID();
    await deps.dispatcher.emit({
      ...createEventEnvelope({ correlationId, id: correlationId }),
      type: "source/article.ingested",
      payload: { raw_article_id: rawArticle.id, source_id: source.id },
    });
    log.info({ correlationId, rawArticleId: rawArticle.id }, "ingested new RawArticle");
    ingestedCount++;
  }

  return ingestedCount;
}

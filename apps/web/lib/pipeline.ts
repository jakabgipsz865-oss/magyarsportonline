import {
  deduplication,
  editorialRewrite,
  factVerification,
  footballLexicon,
  hungarianWriter,
  publishGate,
  readModelProjector,
  seo,
  sourceIngest,
  storyMerge,
} from "@magyarsportonline/agents";
import {
  createEventEnvelope,
  createInProcessDispatcher,
  parseEvent,
  type InProcessDispatcher,
  type SportsNewsEvent,
} from "@magyarsportonline/events";
import {
  MODEL_TIERS,
  NOT_AI_TRANSLATED_NOTICE,
  NO_LLM_MODEL_LABEL,
  NoLlmClient,
} from "@magyarsportonline/llm";
import { createRepositories, type Repositories } from "./db";
import { env } from "./env";
import { getLlmClient } from "./llm";
import { getLogger } from "./logger";
import { calculateIngestBudget } from "./ingest-control";

/**
 * MVP-only coarse category input for the Deduplication Agent's fingerprint
 * (docs/adr/0005-mvp-end-to-end-scope-cuts.md decision 2) — the dev/demo
 * Source is a single-sport (football) feed, so there is exactly one coarse
 * bucket. Real multi-category classification is Fázis 4/8 work.
 */
const DEFAULT_CATEGORY_SLUG = "labdarugas";

/**
 * Wires every agent's event handler onto the in-process dispatcher
 * (docs/adr/0005-mvp-end-to-end-scope-cuts.md decision 1) — this function is
 * the MVP's entire "event bus registration", the direct analogue of what a
 * real Inngest `createFunction` registration block would do per agent.
 */
export function buildDispatcher(repos: Repositories = createRepositories()): InProcessDispatcher {
  const dispatcher = createInProcessDispatcher();
  const logger = getLogger();
  const llm = getLlmClient();

  dispatcher.on("source/article.ingested", (event) =>
    deduplication.handleSourceArticleIngested(
      {
        rawArticleRepository: repos.rawArticleRepository,
        entityRepository: repos.entityRepository,
        storyMatchRepository: repos.storyMatchRepository,
        agentRunRepository: repos.agentRunRepository,
        dispatcher,
        logger,
        defaultCategorySlug: DEFAULT_CATEGORY_SLUG,
      },
      event,
    ),
  );

  dispatcher.on("story/candidate.identified", (event) =>
    storyMerge.handleStoryCandidateIdentified(
      {
        storyRepository: repos.storyRepository,
        rawArticleRepository: repos.rawArticleRepository,
        storySourceRepository: repos.storySourceRepository,
        storyMatchRepository: repos.storyMatchRepository,
        entityRepository: repos.entityRepository,
        agentRunRepository: repos.agentRunRepository,
        dispatcher,
        logger,
      },
      event,
    ),
  );

  const factVerificationDeps = {
    storyRepository: repos.storyRepository,
    rawArticleRepository: repos.rawArticleRepository,
    sourceRepository: repos.sourceRepository,
    factRepository: repos.factRepository,
    storySourceRepository: repos.storySourceRepository,
    storyCredibilityHistoryRepository: repos.storyCredibilityHistoryRepository,
    llm,
    agentRunRepository: repos.agentRunRepository,
    dispatcher,
    logger,
  };
  dispatcher.on("story/created", (event) =>
    factVerification.handleFactVerificationTrigger(factVerificationDeps, event),
  );
  dispatcher.on("story/merge.completed", (event) => {
    // Only genuinely new information re-triggers Fact Verification — a plain
    // corroboration bumps confidence elsewhere without a re-write
    // (docs/architecture/02-agents.md §2.3 "downstream szabály").
    if (event.payload.update_type !== "new_info") {
      return Promise.resolve();
    }
    return factVerification.handleFactVerificationTrigger(factVerificationDeps, event);
  });

  dispatcher.on("story/facts.verified", (event) =>
    hungarianWriter.handleStoryFactsVerified(
      {
        storyRepository: repos.storyRepository,
        storyVersionRepository: repos.storyVersionRepository,
        factRepository: repos.factRepository,
        editorialCorrectionRepository: repos.editorialCorrectionRepository,
        editorialCorrectionApplicationRepository: repos.editorialCorrectionApplicationRepository,
        llm,
        agentRunRepository: repos.agentRunRepository,
        dispatcher,
        logger,
      },
      event,
    ),
  );

  dispatcher.on("story/content.drafted", (event) =>
    editorialRewrite.handleStoryContentDrafted(
      {
        storyRepository: repos.storyRepository,
        storyVersionRepository: repos.storyVersionRepository,
        factRepository: repos.factRepository,
        editorialCorrectionRepository: repos.editorialCorrectionRepository,
        editorialCorrectionApplicationRepository: repos.editorialCorrectionApplicationRepository,
        llm,
        agentRunRepository: repos.agentRunRepository,
        dispatcher,
        logger,
      },
      event,
    ),
  );

  dispatcher.on("story/editorial.rewritten", (event) =>
    seo.handleStoryEditorialRewritten(
      {
        storyRepository: repos.storyRepository,
        storyVersionRepository: repos.storyVersionRepository,
        agentRunRepository: repos.agentRunRepository,
        dispatcher,
        logger,
      },
      event,
    ),
  );

  dispatcher.on("story/seo.ready", (event) =>
    publishGate.handleStorySeoReady(
      {
        storyRepository: repos.storyRepository,
        storyVersionRepository: repos.storyVersionRepository,
        factRepository: repos.factRepository,
        storySourceRepository: repos.storySourceRepository,
        reviewQueueRepository: repos.reviewQueueRepository,
        agentRunRepository: repos.agentRunRepository,
        dispatcher,
        logger,
        forceReviewMode: env.FORCE_REVIEW_MODE,
      },
      event,
    ),
  );

  dispatcher.on("story/published", (event) =>
    readModelProjector.handleStoryPublished(
      {
        storyRepository: repos.storyRepository,
        storyVersionRepository: repos.storyVersionRepository,
        storySourceRepository: repos.storySourceRepository,
        storyCredibilityHistoryRepository: repos.storyCredibilityHistoryRepository,
        storyReadModelRepository: repos.storyReadModelRepository,
        logger,
      },
      event,
    ),
  );

  return dispatcher;
}

/**
 * Minimal `Emitter`-shaped object (every agent's `Deps.dispatcher` only ever
 * needs `emit(event): Promise<void>` — see e.g.
 * packages/agents/src/deduplication/index.ts's own local `Emitter`
 * interface) that ENQUEUES instead of synchronously invoking a handler
 * (2026-07-29, async pipeline sprint, docs/open-decisions.md #12). This is
 * the entire swap-in replacement for `InProcessDispatcher` on the real
 * ingest path: every agent's business logic is untouched, only how an
 * emitted event reaches the next stage changes — from "call the handler
 * right now, in this HTTP request" to "durably persist it, a later worker
 * invocation picks it up." `parseEvent` re-validates before persisting so a
 * malformed event fails loudly at enqueue time, not silently at dequeue
 * time.
 */
export function buildQueueingEmitter(
  pipelineJobRepository: Pick<Repositories["pipelineJobRepository"], "enqueue">,
): { emit(event: unknown): Promise<void> } {
  return {
    async emit(event: unknown) {
      const validated = parseEvent(event);
      await pipelineJobRepository.enqueue(validated);
    },
  };
}

/**
 * The worker-side counterpart of `buildDispatcher` — processes exactly ONE
 * claimed job's event by routing it to the same agent handler (with the
 * same deps) `buildDispatcher` would have called synchronously, except the
 * `dispatcher` dep passed to that handler is the QUEUEING emitter, so
 * anything IT emits also becomes a new job rather than a nested synchronous
 * call. This is what turns the pipeline into a chain of independently
 * retryable jobs instead of one long call stack.
 *
 * Event types with no registered handler here (`story/updated.published`,
 * `story/review.requested`, `story/review.resolved`, `story/retracted`,
 * `social/posted`) are a deliberate silent no-op — identical to
 * `InProcessDispatcher.emit`'s behavior today when no `.on()` handler
 * matches (e.g. `story/review.requested` is emitted by Publish Gate, which
 * itself directly writes the `review_queue` row; nothing downstream
 * currently subscribes to the event itself).
 */
export async function dispatchJobToHandler(
  event: SportsNewsEvent,
  repos: Repositories,
  emitter: { emit(event: unknown): Promise<void> },
): Promise<void> {
  const logger = getLogger();
  const llm = getLlmClient();

  switch (event.type) {
    case "source/article.ingested":
      return deduplication.handleSourceArticleIngested(
        {
          rawArticleRepository: repos.rawArticleRepository,
          entityRepository: repos.entityRepository,
          storyMatchRepository: repos.storyMatchRepository,
          agentRunRepository: repos.agentRunRepository,
          dispatcher: emitter,
          logger,
          defaultCategorySlug: DEFAULT_CATEGORY_SLUG,
        },
        event,
      );

    case "story/candidate.identified":
      return storyMerge.handleStoryCandidateIdentified(
        {
          storyRepository: repos.storyRepository,
          rawArticleRepository: repos.rawArticleRepository,
          storySourceRepository: repos.storySourceRepository,
          storyMatchRepository: repos.storyMatchRepository,
          entityRepository: repos.entityRepository,
          agentRunRepository: repos.agentRunRepository,
          dispatcher: emitter,
          logger,
        },
        event,
      );

    case "story/created":
    case "story/merge.completed": {
      if (event.type === "story/merge.completed" && event.payload.update_type !== "new_info") {
        return;
      }
      return factVerification.handleFactVerificationTrigger(
        {
          storyRepository: repos.storyRepository,
          rawArticleRepository: repos.rawArticleRepository,
          sourceRepository: repos.sourceRepository,
          factRepository: repos.factRepository,
          storySourceRepository: repos.storySourceRepository,
          storyCredibilityHistoryRepository: repos.storyCredibilityHistoryRepository,
          llm,
          agentRunRepository: repos.agentRunRepository,
          dispatcher: emitter,
          logger,
        },
        event,
      );
    }

    case "story/facts.verified":
      return hungarianWriter.handleStoryFactsVerified(
        {
          storyRepository: repos.storyRepository,
          storyVersionRepository: repos.storyVersionRepository,
          factRepository: repos.factRepository,
          editorialCorrectionRepository: repos.editorialCorrectionRepository,
          editorialCorrectionApplicationRepository: repos.editorialCorrectionApplicationRepository,
          llm,
          agentRunRepository: repos.agentRunRepository,
          dispatcher: emitter,
          logger,
        },
        event,
      );

    case "story/content.drafted":
      return editorialRewrite.handleStoryContentDrafted(
        {
          storyRepository: repos.storyRepository,
          storyVersionRepository: repos.storyVersionRepository,
          factRepository: repos.factRepository,
          editorialCorrectionRepository: repos.editorialCorrectionRepository,
          editorialCorrectionApplicationRepository: repos.editorialCorrectionApplicationRepository,
          llm,
          agentRunRepository: repos.agentRunRepository,
          dispatcher: emitter,
          logger,
        },
        event,
      );

    case "story/editorial.rewritten":
      return seo.handleStoryEditorialRewritten(
        {
          storyRepository: repos.storyRepository,
          storyVersionRepository: repos.storyVersionRepository,
          agentRunRepository: repos.agentRunRepository,
          dispatcher: emitter,
          logger,
        },
        event,
      );

    case "story/seo.ready":
      return publishGate.handleStorySeoReady(
        {
          storyRepository: repos.storyRepository,
          storyVersionRepository: repos.storyVersionRepository,
          factRepository: repos.factRepository,
          storySourceRepository: repos.storySourceRepository,
          reviewQueueRepository: repos.reviewQueueRepository,
          agentRunRepository: repos.agentRunRepository,
          dispatcher: emitter,
          logger,
          forceReviewMode: env.FORCE_REVIEW_MODE,
        },
        event,
      );

    case "story/published":
      return readModelProjector.handleStoryPublished(
        {
          storyRepository: repos.storyRepository,
          storyVersionRepository: repos.storyVersionRepository,
          storySourceRepository: repos.storySourceRepository,
          storyCredibilityHistoryRepository: repos.storyCredibilityHistoryRepository,
          storyReadModelRepository: repos.storyReadModelRepository,
          logger,
        },
        event,
      );

    default:
      return;
  }
}

/**
 * A real LLM provider call chain (fact verification + writing + self-check,
 * up to 3 sequential network round-trips per article) can take long enough
 * per article that processing an entire RSS backlog in one synchronous HTTP
 * request risks exceeding the serverless function's execution time limit —
 * a risk that didn't exist while every call fell back instantly to the
 * deterministic No-LLM client.
 *
 * 2026-07-29 (async pipeline sprint, docs/open-decisions.md #12): this cap
 * no longer bounds LLM work — `runIngestPipeline` now only ENQUEUES a job
 * per new article (`buildQueueingEmitter`) instead of running the full
 * downstream chain synchronously, so this request is fast and non-LLM
 * regardless of how many new articles it finds. The cap still exists as a
 * plain sanity bound against enqueueing an unbounded backlog in one run
 * (e.g. a feed's very first activation), raised well above the old
 * per-request-safety value now that it isn't gating timeout risk anymore.
 */
/**
 * Entry point for `/api/internal/cron/dispatch-ingest` (docs/architecture/06-deployment.md
 * §6.5): fetches every active Source and, for each new RawArticle, ENQUEUES
 * `source/article.ingested` (2026-07-29 — previously this chain-reacted
 * synchronously through the entire pipeline in the same request; see
 * `buildQueueingEmitter`'s doc comment). A separate worker
 * (`/api/internal/jobs/process`) drains the queue on its own schedule.
 */
export async function runIngestPipeline(): Promise<{
  results: Awaited<ReturnType<typeof sourceIngest.runSourceIngest>>;
  queueBefore: Awaited<ReturnType<Repositories["pipelineJobRepository"]["getStatusCounts"]>>;
  ingestBudget: number;
  ingestDeferred: boolean;
}> {
  const repos = createRepositories();
  const dispatcher = buildQueueingEmitter(repos.pipelineJobRepository);
  const queueBefore = await repos.pipelineJobRepository.getStatusCounts();
  const ingestBudget = calculateIngestBudget(queueBefore);

  const logger = getLogger();
  if (ingestBudget === 0) {
    logger.warn(
      { queue: queueBefore },
      "ingest deferred because the durable pipeline queue is above its pressure limit",
    );
  }
  const results = await sourceIngest.runSourceIngest({
    sourceRepository: repos.sourceRepository,
    rawArticleRepository: repos.rawArticleRepository,
    agentRunRepository: repos.agentRunRepository,
    dispatcher,
    // Source Fetcher (2026-07-28-i sprint): az RSS-adaptert becsomagoljuk
    // egy dekorátorral, ami a rövid contentSnippet helyett a cikkoldalról
    // letöltött, teljes törzset adja tovább, HA van a domainhez
    // regisztrált extractor (jelenleg csak BBC Sport) — minden más forrás,
    // vagy bármilyen letöltési/kinyerési hiba esetén az eredeti RSS
    // snippetre esik vissza, a pipeline sosem áll le emiatt.
    adapters: {
      rss: new sourceIngest.ArticleEnrichingSourceAdapter(
        new sourceIngest.RssSourceAdapter(),
        new sourceIngest.ArticleFetcher(undefined, undefined, logger),
        logger,
      ),
    },
    logger,
    maxNewArticlesPerRun: ingestBudget,
  });
  return { results, queueBefore, ingestBudget, ingestDeferred: ingestBudget === 0 };
}

/**
 * Enqueues complete Fact Verification → Hungarian Writer → Editorial
 * Rewrite → SEO → Publish Gate regeneration for Stories backed by a fetched
 * full article. Normal mode selects fallback or quality-failing versions;
 * a controlled rollout may force fresh automatic versions for every
 * candidate. Existing versions remain as an immutable audit trail.
 */
export async function reprocessNoLlmStories(options: {
  limit: number;
  includePublished: boolean;
  forceRegeneration: boolean;
}): Promise<{ reprocessedStoryIds: string[] }> {
  const repos = createRepositories();
  const emitter = buildQueueingEmitter(repos.pipelineJobRepository);

  const summaries = await repos.storyVersionRepository.listLatestVersionSummaries();
  const recentStories = await repos.storyRepository.listRecent(2_000);
  const statusByStoryId = new Map(recentStories.map((story) => [story.id, story.status]));
  // Regenerate currently public content first. This guarantees that a
  // production rollout replaces or retracts every old public version before
  // filling the remaining target with unpublished candidates.
  const orderedSummaries = [...summaries].sort(
    (a, b) =>
      Number(statusByStoryId.get(b.storyId) === "published") -
      Number(statusByStoryId.get(a.storyId) === "published"),
  );
  const storyIds: string[] = [];
  for (const summary of orderedSummaries) {
    if (storyIds.length >= options.limit) {
      break;
    }
    let needsRegeneration =
      options.forceRegeneration ||
      summary.generatedByModel === NO_LLM_MODEL_LABEL ||
      !summary.isAiGenerated;
    const facts = (await repos.factRepository.listByStoryId(summary.storyId)).map(
      hungarianWriter.toWriterFact,
    );
    const quality = hungarianWriter.assessContentQuality({
      titleHu: summary.titleHu,
      leadHu: summary.leadHu,
      bodyHu: summary.bodyHu,
      facts,
    });
    needsRegeneration ||= !quality.passed;
    if (!needsRegeneration) {
      continue;
    }
    const fullArticleSourceCount = await repos.storySourceRepository.countFullArticleByStoryId(
      summary.storyId,
    );
    if (fullArticleSourceCount > 0) {
      storyIds.push(summary.storyId);
    }
  }

  for (const storyId of storyIds) {
    await emitter.emit({
      ...createEventEnvelope({ correlationId: crypto.randomUUID() }),
      type: "story/created",
      payload: { story_id: storyId },
    });
  }

  return { reprocessedStoryIds: storyIds };
}

async function emitFactsVerifiedForStory(
  repos: Repositories,
  dispatcher: ReturnType<typeof buildDispatcher>,
  logger: ReturnType<typeof getLogger>,
  storyId: string,
): Promise<boolean> {
  const story = await repos.storyRepository.getById(storyId);
  if (!story || story.riskLevel === null) {
    // Shouldn't happen post-Fact-Verification — skip defensively rather than crash the whole batch.
    logger.warn({ storyId }, "reprocess: story missing or never risk-classified, skipping");
    return false;
  }

  const facts = await repos.factRepository.listByStoryId(storyId);
  const hasContradiction = facts.some((fact) => fact.isContradicted);
  const correlationId = crypto.randomUUID();

  // dispatcher.emit (not a direct handler call) so the same registered
  // wiring as a normal ingest run carries this through
  // hungarian-writer → seo → publish-gate → (if auto-published) the
  // read-model projector.
  await dispatcher.emit({
    ...createEventEnvelope({ correlationId }),
    type: "story/facts.verified",
    payload: {
      story_id: storyId,
      confidence_score: Number(story.confidenceScore),
      risk_level: story.riskLevel,
      // Not persisted on Story and not read by any current handler
      // (hungarian-writer/seo/publish-gate all key off risk_level, not
      // this flag) — false is safe here; we're re-writing from the
      // already-verified Fact set, not re-scanning raw text.
      prompt_injection_suspected: false,
      has_contradiction: hasContradiction,
    },
  });
  return true;
}

/**
 * Entry point for `/api/internal/reprocess-story`: unconditionally re-runs
 * Hungarian Writer → SEO → Publish Gate for exactly one, caller-specified
 * Story — for the case where a specific Story is already known to be broken
 * (e.g. reported by a user) but wasn't reached by `reprocessNoLlmStories`'s
 * candidate scan within its per-call batch cap. Skips the "is this a
 * candidate" check entirely since the caller already knows it needs
 * rewriting.
 */
export async function reprocessStoryById(storyId: string): Promise<{ reprocessed: boolean }> {
  const repos = createRepositories();
  const dispatcher = buildDispatcher(repos);
  const logger = getLogger();
  const reprocessed = await emitFactsVerifiedForStory(repos, dispatcher, logger, storyId);
  return { reprocessed };
}

/**
 * Entry point for `/api/internal/backfill-ai-labels`: idempotently corrects
 * the `isAiGenerated`/`generatedByModel` mislabeling bug (Content Quality &
 * Reliability Hardening sprint) where a `StoryVersion` produced by a real,
 * successful Hungarian Writer LLM call was recorded as
 * `NO_LLM_MODEL_LABEL`/`isAiGenerated: false` purely because the *self-check*
 * step's own call happened to fall back to No-LLM. Detects those rows by the
 * one signal that survives the original bug — a genuine No-LLM row's
 * `lead_hu` is always the exact deterministic disclaimer text
 * (`no-llm-client.ts` `NOT_AI_TRANSLATED_NOTICE`); a mislabeled real row's
 * `lead_hu` is real generated Hungarian text and never matches it verbatim.
 * Only touches the two label columns — title/lead/body are never rewritten
 * here (that's what `reprocessNoLlmStories`'s Content Quality Gate path is
 * for). Safe to call repeatedly: once corrected, a row stops matching.
 */
export async function backfillMislabeledAiGenerated(): Promise<{ correctedCount: number }> {
  const repos = createRepositories();
  const llm = getLlmClient();
  const correctModelLabel = llm.modelLabel ?? MODEL_TIERS.writing;

  const correctedCount = await repos.storyVersionRepository.backfillMislabeledAiGenerated(
    correctModelLabel,
    NO_LLM_MODEL_LABEL,
    NOT_AI_TRANSLATED_NOTICE,
  );

  return { correctedCount };
}

/**
 * Entry point for `/api/internal/editorial-ab-test`: the 50-article A/B
 * comparison the "MagyarSportOnline editorial style" sprint asked for
 * (current pipeline output vs. the Editorial Rewrite Agent pass — see
 * packages/agents/src/editorial-rewrite/ab-test.ts). Read-only — never
 * writes to the database, only calls the LLM to produce a candidate rewrite
 * and a blind judge verdict in memory.
 *
 * Batched like `reprocessNoLlmStories` (Vercel Hobby's 60s `maxDuration`
 * can't fit 50 articles' worth of sequential LLM calls in one request) — the
 * caller (a GitHub Actions workflow, not a human) pages through with
 * `offset`/`limit` until `nextOffset` is null.
 */
export async function runEditorialAbTestBatch(options: { offset: number; limit: number }): Promise<{
  results: Awaited<ReturnType<typeof editorialRewrite.runAbComparison>>[];
  errors: Array<{ storyId: string; message: string }>;
  totalCandidates: number;
  nextOffset: number | null;
}> {
  const repos = createRepositories();
  const llm = getLlmClient();
  if (llm instanceof NoLlmClient) {
    throw new Error(
      "editorial-ab-test: LLM_PROVIDER=none — nothing to compare without a real provider",
    );
  }

  // Only AI-generated versions are meaningful to compare — a No-LLM
  // passthrough has no "style" of its own to rewrite.
  const candidates = (await repos.storyVersionRepository.listLatestVersionSummaries()).filter(
    (summary) => summary.isAiGenerated,
  );
  const batch = candidates.slice(options.offset, options.offset + options.limit);

  // Sequential, not Promise.all: each article is already up to three
  // sequential LLM round-trips, and running several articles' calls
  // concurrently risks tripping Cloudflare Workers AI rate limits — this
  // is a diagnostic tool, not the latency-sensitive publish path. Each
  // article's failure (a schema-validation error, a provider error the
  // fallback chain didn't fully absorb, an effective per-call timeout) is
  // caught here so one bad article doesn't lose the rest of the batch —
  // the LLM client stack itself has no distinct "timeout" signal (see
  // ab-test.ts's UsageMeteringLlmClient comment), so every such failure is
  // reported together as a processing error.
  const results: Awaited<ReturnType<typeof editorialRewrite.runAbComparison>>[] = [];
  const errors: Array<{ storyId: string; message: string }> = [];
  for (const summary of batch) {
    try {
      const facts = (await repos.factRepository.listByStoryId(summary.storyId)).map(
        hungarianWriter.toWriterFact,
      );
      const result = await editorialRewrite.runAbComparison(llm, {
        storyId: summary.storyId,
        facts,
        titleHu: summary.titleHu,
        leadHu: summary.leadHu,
        bodyHu: summary.bodyHu,
      });
      results.push(result);
    } catch (error) {
      errors.push({
        storyId: summary.storyId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const nextOffset =
    options.offset + options.limit < candidates.length ? options.offset + options.limit : null;

  return { results, errors, totalCandidates: candidates.length, nextOffset };
}

/**
 * `runEditorialAbTestBatch` plus persistence, for the human-reviewable
 * `/internal/editorial-ab-review` admin page (2026-07-28 sprint — "ne
 * tekintsd késznek a tesztet, amíg ezt az oldalt emberként át nem tudom
 * nézni"). Writes ONLY to the dedicated `editorial_ab_snapshots` table (one
 * row per Story, upserted) — never touches `story_versions` or anything the
 * public site reads, so this cannot publish or alter a single word of the
 * live site. `runEditorialAbTestBatch` itself stays pure/read-only, matching
 * its own doc comment — this wrapper is the only thing that writes.
 */
export async function runEditorialAbReviewBatch(options: {
  offset: number;
  limit: number;
}): Promise<{
  results: Awaited<ReturnType<typeof editorialRewrite.runAbComparison>>[];
  errors: Array<{ storyId: string; message: string }>;
  totalCandidates: number;
  nextOffset: number | null;
}> {
  const batch = await runEditorialAbTestBatch(options);
  const repos = createRepositories();

  for (const result of batch.results) {
    const originalSources = await repos.storySourceRepository.originalContentByStoryId(
      result.storyId,
    );
    const searchText = [
      ...originalSources.map((source) => `${source.titleOriginal}\n${source.bodyOriginal}`),
      result.pipelineA.titleHu,
      result.pipelineA.leadHu,
      result.pipelineA.bodyHu,
      result.pipelineB.titleHu,
      result.pipelineB.leadHu,
      result.pipelineB.bodyHu,
    ].join("\n");
    const lexiconMatches = footballLexicon.findRelevantLexiconEntries(searchText, 30);

    await repos.editorialAbSnapshotRepository.upsert({
      storyId: result.storyId,
      titleA: result.pipelineA.titleHu,
      leadA: result.pipelineA.leadHu,
      bodyA: result.pipelineA.bodyHu,
      titleB: result.pipelineB.titleHu,
      leadB: result.pipelineB.leadHu,
      bodyB: result.pipelineB.bodyHu,
      rewriteAccepted: result.pipelineB.rewriteAccepted,
      rejectionKind: result.pipelineB.rejectionKind,
      rejectionReason: result.pipelineB.rejectionReason,
      qualityA: result.pipelineA.quality,
      qualityB: result.pipelineB.quality,
      judge: result.judge,
      perCallUsage: result.perCallUsage,
      totalUsage: result.totalUsage,
      durationMs: result.durationMs,
      lexiconMatches,
      originalSources,
    });
  }

  return batch;
}

/**
 * Entry point for `/api/internal/story-repair/invalid-merge`: data-repair
 * operation for a Story proven to be a false-positive merge from the OLD
 * single-entity fingerprint matcher (2026-07-29, docs/open-decisions.md
 * #14 — the real 16-article "Henry Coates"/"Premier League" false merge
 * from before the scored, multi-factor matcher landed). Never deletes
 * anything — archives the Story (`status = 'invalid_merge'`, excluded from
 * `StoryRepository.listRecent` and from `StoryMatchRepository.
 * findCandidateStories`, so it can never again surface as a credibility
 * sample or be re-merged into), rejects any pending `review_queue_items`
 * row for it (`ReviewQueueRepository.listPending()` has no Story-status
 * filter, so without this an already-queued item would still show up in
 * the admin review/publish queue after archival), defensively deletes any
 * `story_read_model` row (the only table every public surface reads from —
 * `/hir/[slug]`, sitemap, RSS, `api/v1/stories`), detaches every
 * contributing RawArticle back to `ingested`, and re-enqueues each one
 * through the NOW-FIXED matching pipeline so they get a chance to be
 * correctly split into their own (or genuinely shared) Stories from
 * scratch.
 */
export async function repairInvalidMerge(
  storyId: string,
  reasonHu: string,
): Promise<{ detachedArticleIds: string[] }> {
  const repos = createRepositories();
  const emitter = buildQueueingEmitter(repos.pipelineJobRepository);

  const articles = await repos.rawArticleRepository.listByStoryId(storyId);

  for (const article of articles) {
    await repos.storySourceRepository.unlink(storyId, article.id);
    await repos.rawArticleRepository.detachFromStory(article.id);
  }

  await repos.storyRepository.markInvalidMerge(storyId, reasonHu);
  await repos.reviewQueueRepository.rejectAllPendingForStory(storyId, reasonHu);
  await repos.storyReadModelRepository.deleteByStoryId(storyId);

  for (const article of articles) {
    await emitter.emit({
      ...createEventEnvelope({ correlationId: crypto.randomUUID() }),
      type: "source/article.ingested",
      payload: { raw_article_id: article.id, source_id: article.sourceId },
    });
  }

  return { detachedArticleIds: articles.map((article) => article.id) };
}

import {
  deduplication,
  factVerification,
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
  type InProcessDispatcher,
} from "@magyarsportonline/events";
import { NO_LLM_MODEL_LABEL } from "@magyarsportonline/llm";
import { createRepositories, type Repositories } from "./db";
import { getLlmClient } from "./llm";
import { getLogger } from "./logger";

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
        llm,
        agentRunRepository: repos.agentRunRepository,
        dispatcher,
        logger,
      },
      event,
    ),
  );

  dispatcher.on("story/content.drafted", (event) =>
    seo.handleStoryContentDrafted(
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
        reviewQueueRepository: repos.reviewQueueRepository,
        agentRunRepository: repos.agentRunRepository,
        dispatcher,
        logger,
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
        storyReadModelRepository: repos.storyReadModelRepository,
        logger,
      },
      event,
    ),
  );

  return dispatcher;
}

/**
 * Entry point for `/api/internal/cron/dispatch-ingest` (docs/architecture/06-deployment.md
 * §6.5): fetches every active Source and runs it all the way through the
 * pipeline — ingest → dedup → merge → fact verification → writing → SEO →
 * publish gate → read-model projection — synchronously, in-process, because
 * `source/article.ingested`'s handler chain-reacts through every
 * `dispatcher.on` registration above before `runSourceIngest` returns.
 */
/**
 * A real LLM provider call chain (fact verification + writing + self-check,
 * up to 3 sequential network round-trips per article) can take long enough
 * per article that processing an entire RSS backlog in one synchronous HTTP
 * request risks exceeding the serverless function's execution time limit —
 * a risk that didn't exist while every call fell back instantly to the
 * deterministic No-LLM client. Capping new articles per run keeps each
 * ingest request bounded; anything left over is picked up by the next
 * scheduled run (URLs already ingested are never reprocessed either way).
 */
const DEFAULT_MAX_NEW_ARTICLES_PER_RUN = 2;

export async function runIngestPipeline(): Promise<
  Awaited<ReturnType<typeof sourceIngest.runSourceIngest>>
> {
  const repos = createRepositories();
  const dispatcher = buildDispatcher(repos);

  return sourceIngest.runSourceIngest({
    sourceRepository: repos.sourceRepository,
    rawArticleRepository: repos.rawArticleRepository,
    agentRunRepository: repos.agentRunRepository,
    dispatcher,
    adapters: { rss: new sourceIngest.RssSourceAdapter() },
    logger: getLogger(),
    maxNewArticlesPerRun: DEFAULT_MAX_NEW_ARTICLES_PER_RUN,
  });
}

/**
 * Entry point for `/api/internal/reprocess-no-llm`: finds every Story whose
 * *latest* version is still the deterministic `NoLlmClient` passthrough
 * (`NO_LLM_MODEL_LABEL`) and re-emits `story/facts.verified` for it — this
 * re-runs Hungarian Writer → SEO → Publish Gate with whichever LLM provider
 * is *currently* configured, without touching Fact Verification (the
 * underlying facts haven't changed, only the writer's ability to translate
 * them has). Safe/additive: `createNextVersion` never overwrites a prior
 * version, so a story already re-written via corroboration is untouched
 * (`listStoryIdsWithLatestModel` only matches the *latest* version).
 *
 * One-off operational tool for the situation where a misconfigured
 * `CLOUDFLARE_API_TOKEN` (or similar) got fixed after articles had already
 * been ingested and fallen back to No-LLM — not part of the regular
 * ingest/publish flow.
 */
export async function reprocessNoLlmStories(): Promise<{ reprocessedStoryIds: string[] }> {
  const repos = createRepositories();
  const dispatcher = buildDispatcher(repos);
  const logger = getLogger();

  // Same per-request time-budget reasoning as DEFAULT_MAX_NEW_ARTICLES_PER_RUN
  // above — each reprocessed Story is another real writer + self-check call
  // chain. Remaining candidates stay picked up by the next call.
  const allStoryIds =
    await repos.storyVersionRepository.listStoryIdsWithLatestModel(NO_LLM_MODEL_LABEL);
  const storyIds = allStoryIds.slice(0, DEFAULT_MAX_NEW_ARTICLES_PER_RUN);

  for (const storyId of storyIds) {
    const story = await repos.storyRepository.getById(storyId);
    if (!story || story.riskLevel === null) {
      // Shouldn't happen post-Fact-Verification — skip defensively rather than crash the whole batch.
      logger.warn(
        { storyId },
        "reprocess-no-llm: story missing or never risk-classified, skipping",
      );
      continue;
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
  }

  return { reprocessedStoryIds: storyIds };
}

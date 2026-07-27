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
import { createInProcessDispatcher, type InProcessDispatcher } from "@magyarsportonline/events";
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
  });
}

import {
  AgentRunRepository,
  CategoryRepository,
  EditorialAbSnapshotRepository,
  EditorialCorrectionApplicationRepository,
  EditorialCorrectionRepository,
  EditorialKnowledgeRepository,
  EntityRepository,
  FactRepository,
  LlmUsageRepository,
  KnowledgePortabilityRepository,
  MissedMergeReviewRepository,
  PipelineJobRepository,
  RawArticleRepository,
  ReviewQueueRepository,
  SourceRepository,
  StoryCredibilityHistoryRepository,
  StoryMatchRepository,
  StoryReadModelRepository,
  StoryRepository,
  StorySourceRepository,
  StoryVersionRepository,
  createDatabaseClient,
  type Database,
} from "@magyarsportonline/db";
import { env } from "./env";

let cachedDb: Database | undefined;

/** Lazily-created, process-wide Drizzle client — see packages/db/src/client.ts for why the connection string is a parameter, not a direct `process.env` read. */
export function getDb(): Database {
  cachedDb ??= createDatabaseClient(env.DATABASE_URL);
  return cachedDb;
}

/** Bounded-context repository bag (docs/architecture/09-architecture-review.md §4) — construct once per request, pass the slice each agent actually needs. */
export function createRepositories(db: Database = getDb()) {
  return {
    agentRunRepository: new AgentRunRepository(db),
    categoryRepository: new CategoryRepository(db),
    editorialAbSnapshotRepository: new EditorialAbSnapshotRepository(db),
    editorialCorrectionApplicationRepository: new EditorialCorrectionApplicationRepository(db),
    editorialCorrectionRepository: new EditorialCorrectionRepository(db),
    editorialKnowledgeRepository: new EditorialKnowledgeRepository(db),
    entityRepository: new EntityRepository(db),
    factRepository: new FactRepository(db),
    llmUsageRepository: new LlmUsageRepository(db),
    knowledgePortabilityRepository: new KnowledgePortabilityRepository(db),
    missedMergeReviewRepository: new MissedMergeReviewRepository(db),
    pipelineJobRepository: new PipelineJobRepository(db),
    rawArticleRepository: new RawArticleRepository(db),
    reviewQueueRepository: new ReviewQueueRepository(db),
    sourceRepository: new SourceRepository(db),
    storyCredibilityHistoryRepository: new StoryCredibilityHistoryRepository(db),
    storyMatchRepository: new StoryMatchRepository(db),
    storyReadModelRepository: new StoryReadModelRepository(db),
    storyRepository: new StoryRepository(db),
    storySourceRepository: new StorySourceRepository(db),
    storyVersionRepository: new StoryVersionRepository(db),
  };
}

export type Repositories = ReturnType<typeof createRepositories>;

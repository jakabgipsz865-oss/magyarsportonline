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
  SocialPostRepository,
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
import { getCloudflareContext } from "@opennextjs/cloudflare/cloudflare-context";
import { cache } from "react";
import { env } from "./env";

let cachedNodeDb: Database | undefined;

const createWorkerDatabase = cache((connectionString: string): Database => {
  return createDatabaseClient(connectionString, {
    // Workers allow at most six simultaneous outbound connections per
    // request. Hyperdrive owns the durable pool behind these short-lived
    // request clients.
    max: 5,
    // The schema contains PostgreSQL arrays, so Postgres.js must load type
    // metadata instead of treating arrays as opaque strings.
    fetchTypes: true,
    prepare: true,
  });
});

function hyperdriveConnectionString(): string | undefined {
  try {
    return getCloudflareContext().env.HYPERDRIVE?.connectionString;
  } catch {
    // `next build`, unit tests, and standalone Node development do not have
    // a Cloudflare request context. They intentionally fall back to the
    // explicit DATABASE_URL below.
    return undefined;
  }
}

/**
 * Returns a request-scoped Hyperdrive client in Workers and a process-wide
 * client in Node/local tooling. A database connection must never be shared
 * across Worker requests; Hyperdrive performs the actual connection pooling.
 */
export function getDb(): Database {
  const hyperdriveUrl = hyperdriveConnectionString();
  if (hyperdriveUrl) return createWorkerDatabase(hyperdriveUrl);

  if (!env.DATABASE_URL) {
    throw new Error("Database is not configured: set the HYPERDRIVE binding or DATABASE_URL");
  }

  cachedNodeDb ??= createDatabaseClient(env.DATABASE_URL);
  return cachedNodeDb;
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
    socialPostRepository: new SocialPostRepository(db),
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

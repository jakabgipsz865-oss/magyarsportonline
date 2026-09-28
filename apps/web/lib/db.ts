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
import {
  D1PublicCategoryRepository,
  D1PublicEntityRepository,
  D1PipelineJobRepository,
  D1LlmUsageRepository,
  D1RawArticleIngestRepository,
  D1SocialPostRepository,
  D1SourceIngestRepository,
  D1StoryReadModelRepository,
  type D1Client,
} from "@magyarsportonline/db/d1";
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

export function d1Binding(): D1Client | undefined {
  try {
    return getCloudflareContext().env.DB;
  } catch {
    return undefined;
  }
}

/**
 * Returns a request-scoped Hyperdrive client in Workers and a process-wide
 * client in Node/local tooling. A database connection must never be shared
 * across Worker requests; Hyperdrive performs the actual connection pooling.
 */
export function getDb(): Database {
  if (d1Binding()) {
    throw new Error("PostgreSQL repositories are unavailable in D1 mode; port this route explicitly");
  }
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

/**
 * All public database reads can use the isolated D1 binding. The production
 * Worker has no DB binding yet and retains its existing PostgreSQL path.
 * A D1-only test deployment must omit both Hyperdrive and DATABASE_URL, so
 * an unported internal route fails closed instead of silently reading Neon.
 */
export function createPublicRepositories() {
  const d1 = d1Binding();
  if (d1) {
    return {
      storyReadModelRepository: new D1StoryReadModelRepository(d1),
      categoryRepository: new D1PublicCategoryRepository(d1),
      entityRepository: new D1PublicEntityRepository(d1),
    };
  }
  const repositories = createRepositories();
  return {
    storyReadModelRepository: repositories.storyReadModelRepository,
    categoryRepository: repositories.categoryRepository,
    entityRepository: repositories.entityRepository,
  };
}

/** Facebook intents use the same backing store as the active Worker. */
export function createSocialPostRepository() {
  const d1 = d1Binding();
  return d1 ? new D1SocialPostRepository(d1) : createRepositories().socialPostRepository;
}

/** Metering and hard request caps follow the active database binding. */
export function createLlmUsageRepository() {
  const d1 = d1Binding();
  return d1 ? new D1LlmUsageRepository(d1) : createRepositories().llmUsageRepository;
}

/** RSS receipt and full-page fetch use D1 without enabling the Writer path. */
export function createIngestRepositories() {
  const d1 = d1Binding();
  if (d1) {
    const jobs = new D1PipelineJobRepository(d1);
    const raw = new D1RawArticleIngestRepository(d1);
    const activationBoundary = () => {
      if (!env.D1_PIPELINE_START_AT) {
        throw new Error("D1_PIPELINE_START_AT is required before D1 ingestion is enabled");
      }
      return env.D1_PIPELINE_START_AT;
    };
    return {
      pipelineJobRepository: {
        getStatusCounts: () => jobs.getStatusCounts(new Date(), activationBoundary()),
      },
      sourceRepository: new D1SourceIngestRepository(d1),
      rawArticleRepository: {
        insertTabloid: raw.insertTabloid.bind(raw),
        deferTabloidFetch: raw.deferTabloidFetch.bind(raw),
        upgradeAndEnqueueTabloid: raw.upgradeAndEnqueueTabloid.bind(raw),
        claimTabloidFetchBatch: (sourceIds: string[], limit: number, staleLockMs: number, now = new Date()) =>
          raw.claimTabloidFetchBatch(sourceIds, limit, staleLockMs, now, activationBoundary()),
      },
    };
  }
  const repos = createRepositories();
  return {
    pipelineJobRepository: repos.pipelineJobRepository,
    sourceRepository: repos.sourceRepository,
    rawArticleRepository: repos.rawArticleRepository,
  };
}

import {
  computeFingerprint,
  type EntityRepository,
  type RawArticleRepository,
} from "@magyarsportonline/db";
import { createEventEnvelope, type SportsNewsEvent } from "@magyarsportonline/events";
import type { Logger } from "@magyarsportonline/observability";
import type { AgentRunRecorder } from "../shared/with-agent-run";
import { withAgentRun } from "../shared/with-agent-run";
import { toDateBucket } from "./date-bucket";
import { matchPrimaryEntity } from "./entity-matcher";

export * from "./date-bucket";
export * from "./entity-matcher";

export const AGENT_VERSION = "deduplication@0.1.0";

export interface Emitter {
  emit(event: unknown): Promise<void>;
}

export interface DeduplicationDeps {
  rawArticleRepository: Pick<RawArticleRepository, "getById">;
  entityRepository: Pick<EntityRepository, "listAll">;
  agentRunRepository: AgentRunRecorder;
  dispatcher: Emitter;
  logger: Logger;
  /**
   * MVP-only coarse category input for the fingerprint (docs/adr/0005-mvp-end-to-end-scope-cuts.md
   * decision 2) — NOT the same thing as `Story.category_id` (that's the SEO
   * Agent's taxonomy assignment, Fázis 8). A single-source, single-sport dev
   * feed has exactly one coarse bucket; multi-category classification is a
   * Fázis 4 concern (real entity/category extraction), not this agent's.
   */
  defaultCategorySlug: string;
}

type SourceArticleIngestedEvent = Extract<SportsNewsEvent, { type: "source/article.ingested" }>;

/**
 * Deduplication Agent, MVP scope (docs/architecture/02-agents.md §2.2,
 * docs/adr/0005-mvp-end-to-end-scope-cuts.md decision 2). Computes the
 * coarse dedup fingerprint and always reports `match_type: "NEW_STORY"` —
 * the fingerprint itself, not this agent, is the actual MATCH/NEW_STORY
 * decision authority in the MVP: the Story Merge Agent's
 * `StoryRepository.createOrMatchByFingerprint` looks up `story_fingerprints`
 * under an advisory lock and can turn this into a MATCH. The pgvector
 * embedding-based semantic matching that would let this agent itself
 * distinguish MATCH/AMBIGUOUS is Fázis 4 (deferred).
 */
export async function handleSourceArticleIngested(
  deps: DeduplicationDeps,
  event: SourceArticleIngestedEvent,
): Promise<void> {
  await withAgentRun(
    {
      agentRunRepository: deps.agentRunRepository,
      agentName: "deduplication",
      correlationId: event.correlation_id,
      triggerEvent: event.type,
    },
    async () => {
      const rawArticle = await deps.rawArticleRepository.getById(event.payload.raw_article_id);
      if (!rawArticle) {
        throw new Error(`RawArticle "${event.payload.raw_article_id}" not found`);
      }

      const entities = await deps.entityRepository.listAll();
      const primary = matchPrimaryEntity(
        `${rawArticle.titleOriginal} ${rawArticle.bodyOriginal}`,
        entities,
      );
      // No matched entity: fall back to a title-derived key so the
      // fingerprint stays deterministic per article — such an article will
      // essentially never coincide with another's fingerprint, which is the
      // safe default (treated as its own Story) when we can't identify a
      // shared subject.
      const primaryEntityId =
        primary?.entityId ?? `no-entity:${rawArticle.titleOriginal.toLowerCase()}`;
      const dateBucket = toDateBucket(rawArticle.publishedAtSource ?? rawArticle.ingestedAt);
      const fingerprintHash = computeFingerprint({
        category: deps.defaultCategorySlug,
        primaryEntityId,
        dateBucket,
      });

      await deps.dispatcher.emit({
        ...createEventEnvelope({ correlationId: event.correlation_id }),
        type: "story/candidate.identified",
        payload: {
          raw_article_id: rawArticle.id,
          match_type: "NEW_STORY",
          fingerprint_hash: fingerprintHash,
        },
      });

      deps.logger.info(
        { correlationId: event.correlation_id, rawArticleId: rawArticle.id, fingerprintHash },
        "computed dedup fingerprint",
      );
    },
  );
}

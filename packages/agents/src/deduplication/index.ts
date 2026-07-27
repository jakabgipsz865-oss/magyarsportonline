import { computeFingerprint, schema, type Database } from "@magyarsportonline/db";
import type { Logger } from "@magyarsportonline/observability";
import { eq } from "drizzle-orm";
import type { RecordAgentRun } from "../telemetry/agent-run-recorder.js";
import { runWithTelemetry } from "../telemetry/run-with-telemetry.js";
import { formatDateBucket } from "./date-bucket.js";
import { matchEntities } from "./entity-matcher.js";

export interface DeduplicationInput {
  rawArticle: {
    id: string;
    titleOriginal: string;
    bodyOriginal: string;
    publishedAtSource: Date | null;
    ingestedAt: Date;
  };
  /**
   * MVP simplification (docs/adr/0006-mvp-fingerprint-only-dedup.md): full
   * text-based category classification is out of scope, so the caller
   * supplies the category to fingerprint against.
   */
  categorySlug: string;
  correlationId: string;
}

export interface DeduplicationResult {
  matchType: "NEW_STORY" | "MATCH";
  fingerprintHash: string | null;
  matchedStoryId?: string;
  matchedEntityIds: string[];
}

/**
 * Deduplication Agent (docs/architecture/02-agents.md §2.2), MVP scope per
 * ADR 0006: fingerprint-only matching, no embedding search. If no seeded
 * entity is recognized in the text, dedup cannot key off anything reliable
 * — the article is treated as NEW_STORY without a fingerprint (logged as a
 * warning; in production this would instead fall back to the
 * embedding-based path, which doesn't exist yet in the MVP).
 */
export async function runDeduplicationAgent(
  deps: { db: Database; logger: Logger; recordAgentRun: RecordAgentRun },
  input: DeduplicationInput,
): Promise<DeduplicationResult> {
  return runWithTelemetry(
    deps,
    {
      agentName: "deduplication",
      triggerEvent: "source/article.ingested",
      correlationId: input.correlationId,
    },
    async ({ log }) => {
      const entities = await deps.db.select().from(schema.entities);
      const matched = matchEntities(
        `${input.rawArticle.titleOriginal} ${input.rawArticle.bodyOriginal}`,
        entities,
      );

      if (matched.length === 0) {
        log.warn(
          { rawArticleId: input.rawArticle.id },
          "no known entity matched — NEW_STORY without fingerprint dedup",
        );
        return { matchType: "NEW_STORY", fingerprintHash: null, matchedEntityIds: [] };
      }

      const primaryEntity = matched[0];
      if (!primaryEntity) {
        throw new Error("unreachable: matched.length > 0 but matched[0] is undefined");
      }
      const dateBucket = formatDateBucket(
        input.rawArticle.publishedAtSource ?? input.rawArticle.ingestedAt,
      );
      const fingerprintHash = computeFingerprint({
        category: input.categorySlug,
        primaryEntityId: primaryEntity.id,
        dateBucket,
      });

      const existing = await deps.db.query.storyFingerprints.findFirst({
        where: eq(schema.storyFingerprints.fingerprintHash, fingerprintHash),
      });

      const matchedEntityIds = matched.map((entity) => entity.id);

      if (existing) {
        log.info(
          { rawArticleId: input.rawArticle.id, storyId: existing.storyId, fingerprintHash },
          "fingerprint MATCH — belongs to existing Story",
        );
        return {
          matchType: "MATCH",
          fingerprintHash,
          matchedStoryId: existing.storyId,
          matchedEntityIds,
        };
      }

      log.info(
        { rawArticleId: input.rawArticle.id, fingerprintHash },
        "fingerprint NEW_STORY — no existing Story for this fingerprint",
      );
      return { matchType: "NEW_STORY", fingerprintHash, matchedEntityIds };
    },
  );
}

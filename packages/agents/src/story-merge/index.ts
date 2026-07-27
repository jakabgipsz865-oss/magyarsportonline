import { schema, withFingerprintLock, type Database } from "@magyarsportonline/db";
import type { Logger } from "@magyarsportonline/observability";
import type { SourceReliabilityTier, StorySourceContributionType } from "@magyarsportonline/shared";
import { eq } from "drizzle-orm";
import type { RecordAgentRun } from "../telemetry/agent-run-recorder.js";
import { runWithTelemetry } from "../telemetry/run-with-telemetry.js";
import { computeConfidenceScore } from "../shared/confidence-score.js";
import { getContributingSources } from "../shared/contributing-sources.js";
import { extractQuickFacts } from "../shared/quick-fact-extractor.js";
import type { DeduplicationResult } from "../deduplication/index.js";

// Drizzle's postgres-js transaction callback type isn't exported cleanly for
// reuse across files; this narrows to exactly what this module needs.
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

export interface StoryMergeInput {
  dedup: DeduplicationResult;
  rawArticle: {
    id: string;
    titleOriginal: string;
    bodyOriginal: string;
  };
  sourceReliabilityTier: SourceReliabilityTier;
  correlationId: string;
}

export interface StoryMergeResult {
  storyId: string;
  isNewStory: boolean;
  contributionType: StorySourceContributionType;
  /** True only for isNewStory=false + contributionType="new_info" — this is what the caller uses to decide whether Fact Verification should run at all (docs/architecture/02-agents.md §2.3). */
  requiresFactVerification: boolean;
}

async function createNewStory(
  tx: Tx,
  input: StoryMergeInput,
  log: Logger,
): Promise<StoryMergeResult> {
  const [story] = await tx
    .insert(schema.stories)
    .values({
      canonicalTitle: input.rawArticle.titleOriginal,
      status: "draft",
      isDeveloping: true,
    })
    .returning();
  if (!story) throw new Error("failed to insert new story");

  if (input.dedup.fingerprintHash) {
    await tx.insert(schema.storyFingerprints).values({
      fingerprintHash: input.dedup.fingerprintHash,
      storyId: story.id,
    });
  }

  await tx.insert(schema.storySources).values({
    storyId: story.id,
    rawArticleId: input.rawArticle.id,
    contributionType: "initial",
  });

  if (input.dedup.matchedEntityIds.length > 0) {
    await tx.insert(schema.storyEntities).values(
      input.dedup.matchedEntityIds.map((entityId, index) => ({
        storyId: story.id,
        entityId,
        role: index === 0 ? ("subject" as const) : ("mentioned" as const),
      })),
    );
  }

  log.info({ storyId: story.id }, "created new Story");
  return {
    storyId: story.id,
    isNewStory: true,
    contributionType: "initial",
    requiresFactVerification: true,
  };
}

async function attachToExistingStory(
  tx: Tx,
  storyId: string,
  input: StoryMergeInput,
  log: Logger,
): Promise<StoryMergeResult> {
  const existingFacts = await tx
    .select({ factType: schema.facts.factType })
    .from(schema.facts)
    .where(eq(schema.facts.storyId, storyId));
  const existingFactTypes = new Set(existingFacts.map((f) => f.factType));

  const quickFacts = extractQuickFacts(
    `${input.rawArticle.titleOriginal} ${input.rawArticle.bodyOriginal}`,
  );
  const hasNewFactType = quickFacts.some((fact) => !existingFactTypes.has(fact.factType));
  const contributionType: StorySourceContributionType = hasNewFactType
    ? "new_info"
    : "corroboration";

  await tx.insert(schema.storySources).values({
    storyId,
    rawArticleId: input.rawArticle.id,
    contributionType,
  });

  log.info(
    { storyId, contributionType },
    `RawArticle attached to existing Story as ${contributionType}`,
  );

  if (contributionType === "corroboration") {
    // Per docs/architecture/02-agents.md §2.3: pure corroboration never
    // triggers Fact Verification/Writer — only the confidence score moves,
    // computed directly here to avoid the LLM cost of a full re-extraction.
    const contributors = await getContributingSources(tx, storyId);
    const story = await tx.query.stories.findFirst({
      where: eq(schema.stories.id, storyId),
    });
    const confidenceScore = computeConfidenceScore({
      independentSourceCount: contributors.length,
      reliabilityTiers: contributors.map((c) => c.reliabilityTier),
      contradictionCount: 0,
      isDeveloping: story?.isDeveloping ?? true,
    });
    await tx
      .update(schema.stories)
      .set({ confidenceScore: confidenceScore.toFixed(3), lastUpdatedAt: new Date() })
      .where(eq(schema.stories.id, storyId));
    log.info({ storyId, confidenceScore }, "confidence score updated (corroboration only)");
  }

  return {
    storyId,
    isNewStory: false,
    contributionType,
    requiresFactVerification: contributionType === "new_info",
  };
}

/**
 * Story Merge Agent (docs/architecture/02-agents.md §2.3). The
 * NEW_STORY-with-fingerprint path is wrapped in the advisory lock from
 * ADR/03-event-flow.md §3.7 to close the Story-creation race window: two
 * concurrent RawArticles for the same event can no longer both win
 * NEW_STORY, because the second transaction blocks until the first commits
 * and then sees the just-created story_fingerprints row.
 */
export async function runStoryMergeAgent(
  deps: { db: Database; logger: Logger; recordAgentRun: RecordAgentRun },
  input: StoryMergeInput,
): Promise<StoryMergeResult> {
  return runWithTelemetry(
    deps,
    {
      agentName: "story-merge",
      triggerEvent: "story/candidate.identified",
      correlationId: input.correlationId,
    },
    async ({ log }) => {
      if (input.dedup.matchType === "MATCH" && input.dedup.matchedStoryId) {
        const storyId = input.dedup.matchedStoryId;
        return deps.db.transaction((tx) => attachToExistingStory(tx, storyId, input, log));
      }

      if (input.dedup.fingerprintHash) {
        const fingerprintHash = input.dedup.fingerprintHash;
        return deps.db.transaction((tx) =>
          withFingerprintLock(tx, fingerprintHash, async () => {
            const existing = await tx.query.storyFingerprints.findFirst({
              where: eq(schema.storyFingerprints.fingerprintHash, fingerprintHash),
            });
            if (existing) {
              log.info(
                { fingerprintHash, storyId: existing.storyId },
                "race window closed: fingerprint was created concurrently, joining existing Story",
              );
              return attachToExistingStory(tx, existing.storyId, input, log);
            }
            return createNewStory(tx, input, log);
          }),
        );
      }

      // No entity recognized -> no fingerprint -> nothing to lock on.
      return deps.db.transaction((tx) => createNewStory(tx, input, log));
    },
  );
}

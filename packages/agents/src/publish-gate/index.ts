import type {
  FactRepository,
  ReviewQueueRepository,
  StoryRepository,
  StoryVersionRepository,
} from "@magyarsportonline/db";
import { createEventEnvelope, type SportsNewsEvent } from "@magyarsportonline/events";
import type { Logger } from "@magyarsportonline/observability";
import type { AgentRunRecorder } from "../shared/with-agent-run";
import { withAgentRun } from "../shared/with-agent-run";
import { decidePublish } from "./rule";

export * from "./rule";

export const AGENT_VERSION = "publish-gate@0.1.0";

export interface Emitter {
  emit(event: unknown): Promise<void>;
}

export interface PublishGateDeps {
  storyRepository: Pick<StoryRepository, "getById" | "publish" | "updateStatus">;
  storyVersionRepository: Pick<StoryVersionRepository, "markPublished">;
  factRepository: Pick<FactRepository, "listByStoryId">;
  reviewQueueRepository: Pick<ReviewQueueRepository, "insert">;
  agentRunRepository: AgentRunRecorder;
  dispatcher: Emitter;
  logger: Logger;
}

type Trigger = Extract<SportsNewsEvent, { type: "story/seo.ready" }>;

/**
 * Publish Gate (docs/architecture/02-agents.md §2.7). `has_contradiction` is
 * recomputed here from `Fact.is_contradicted` rows rather than carried on
 * the Story — the schema has no dedicated Story field for it, and the Fact
 * Verification Agent already flags contradicted facts individually, so
 * re-deriving it here needs no schema change.
 */
export async function handleStorySeoReady(deps: PublishGateDeps, event: Trigger): Promise<void> {
  await withAgentRun(
    {
      agentRunRepository: deps.agentRunRepository,
      agentName: "publish-gate",
      correlationId: event.correlation_id,
      triggerEvent: event.type,
      storyId: event.payload.story_id,
    },
    async () => {
      const story = await deps.storyRepository.getById(event.payload.story_id);
      if (!story) {
        throw new Error(`Story "${event.payload.story_id}" not found`);
      }

      const facts = await deps.factRepository.listByStoryId(story.id);
      const hasContradiction = facts.some((fact) => fact.isContradicted);
      const confidenceScore = story.confidenceScore === null ? 0 : Number(story.confidenceScore);
      // Missing risk_level (shouldn't happen post-Fact-Verification) is treated conservatively.
      const riskLevel = story.riskLevel ?? "high";

      const decision = decidePublish({ riskLevel, confidenceScore, hasContradiction });

      if (decision.autoPublish) {
        const publishedAt = new Date();
        await deps.storyVersionRepository.markPublished(event.payload.story_version_id);
        await deps.storyRepository.publish(story.id, event.payload.story_version_id, publishedAt);
        await deps.dispatcher.emit({
          ...createEventEnvelope({ correlationId: event.correlation_id }),
          type: "story/published",
          payload: { story_id: story.id, story_version_id: event.payload.story_version_id },
        });
        deps.logger.info(
          { correlationId: event.correlation_id, storyId: story.id },
          "publish gate: auto-published",
        );
      } else {
        await deps.reviewQueueRepository.insert({
          storyId: story.id,
          storyVersionId: event.payload.story_version_id,
          reason: decision.reason,
        });
        await deps.storyRepository.updateStatus(story.id, "pending_review");
        await deps.dispatcher.emit({
          ...createEventEnvelope({ correlationId: event.correlation_id }),
          type: "story/review.requested",
          payload: { story_id: story.id, reason: decision.reason },
        });
        deps.logger.info(
          { correlationId: event.correlation_id, storyId: story.id, reason: decision.reason },
          "publish gate: sent to review queue",
        );
      }
    },
  );
}

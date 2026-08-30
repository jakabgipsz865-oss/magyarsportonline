import type {
  EditorialCorrectionApplicationRepository,
  EditorialCorrectionRepository,
  FactRepository,
  StoryRepository,
  StoryVersionRepository,
} from "@magyarsportonline/db";
import { createEventEnvelope, type SportsNewsEvent } from "@magyarsportonline/events";
import type { LlmClient } from "@magyarsportonline/llm";
import type { Logger } from "@magyarsportonline/observability";
import type { AgentRunRecorder } from "../shared/with-agent-run";
import { withAgentRun } from "../shared/with-agent-run";

export * from "./ab-test";
export * from "./readability";
export * from "./rewrite";
export * from "./style-guide";

export const AGENT_VERSION = "editorial-rewrite@0.2.0";

export interface Emitter {
  emit(event: unknown): Promise<void>;
}

export interface EditorialRewriteDeps {
  storyRepository: Pick<StoryRepository, "getById">;
  storyVersionRepository: Pick<StoryVersionRepository, "getById" | "updateDraftContent">;
  factRepository: Pick<FactRepository, "listByStoryId">;
  editorialCorrectionRepository: Pick<EditorialCorrectionRepository, "listRecent">;
  editorialCorrectionApplicationRepository: Pick<
    EditorialCorrectionApplicationRepository,
    "create"
  >;
  llm: LlmClient;
  agentRunRepository: AgentRunRecorder;
  dispatcher: Emitter;
  logger: Logger;
}

type Trigger = Extract<SportsNewsEvent, { type: "story/content.drafted" }>;

/**
 * Editorial Rewrite Agent (docs/editorial-style-guide.md): sits between the
 * Hungarian Writer and SEO agents. The Writer already performs one targeted
 * quality fix and a second fact check. This stage therefore preserves that
 * final Writer version and only emits the downstream compatibility event.
 */
export async function handleStoryContentDrafted(
  deps: EditorialRewriteDeps,
  event: Trigger,
): Promise<void> {
  await withAgentRun(
    {
      agentRunRepository: deps.agentRunRepository,
      agentName: "editorial-rewrite",
      correlationId: event.correlation_id,
      triggerEvent: event.type,
      storyId: event.payload.story_id,
    },
    async () => {
      const story = await deps.storyRepository.getById(event.payload.story_id);
      if (!story) {
        throw new Error(`Story "${event.payload.story_id}" not found`);
      }

      const version = await deps.storyVersionRepository.getById(event.payload.story_version_id);
      if (!version) {
        throw new Error(`StoryVersion "${event.payload.story_version_id}" not found`);
      }

      const editorialRewriteApplied = false;

      const hasQualityIssues =
        Array.isArray(version.qualityIssues) && version.qualityIssues.length > 0;

      if (version.isPublished) {
        // Shouldn't happen at this pipeline stage (Publish Gate runs after
        // SEO, which runs after this agent) — defensive guard only, so a
        // stray re-emission of content.drafted can never rewrite published
        // history (story-version-repository.ts updateDraftContent's own
        // WHERE guard would refuse it anyway; this just avoids the wasted
        // LLM call).
        deps.logger.warn(
          { correlationId: event.correlation_id, storyId: story.id, versionId: version.id },
          "editorial rewrite: version already published, skipping",
        );
      } else if (hasQualityIssues) {
        deps.logger.info(
          { correlationId: event.correlation_id, storyId: story.id, versionId: version.id },
          "editorial rewrite: Writer quality issues remain, skipping redundant LLM rewrite",
        );
      } else {
        deps.logger.info(
          { correlationId: event.correlation_id, storyId: story.id, versionId: version.id },
          "editorial rewrite: deterministic quality gate passed, skipping LLM rewrite",
        );
      }

      await deps.dispatcher.emit({
        ...createEventEnvelope({ correlationId: event.correlation_id }),
        type: "story/editorial.rewritten",
        payload: {
          story_id: story.id,
          story_version_id: version.id,
          editorial_rewrite_applied: editorialRewriteApplied,
        },
      });

      deps.logger.info(
        { correlationId: event.correlation_id, storyId: story.id, editorialRewriteApplied },
        "editorial rewrite agent completed",
      );
    },
  );
}

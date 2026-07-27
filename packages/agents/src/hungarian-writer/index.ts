import type {
  FactRepository,
  StoryRepository,
  StoryVersionRepository,
} from "@magyarsportonline/db";
import { createEventEnvelope, type SportsNewsEvent } from "@magyarsportonline/events";
import { MODEL_TIERS, type LlmClient } from "@magyarsportonline/llm";
import type { Logger } from "@magyarsportonline/observability";
import { toWriterFact } from "./facts";
import { generateStoryVersion, type PreviousVersionContent } from "./generation";
import { selfCheckContent } from "./self-check";
import type { AgentRunRecorder } from "../shared/with-agent-run";
import { withAgentRun } from "../shared/with-agent-run";

export * from "./facts";
export * from "./generation";
export * from "./self-check";

export const AGENT_VERSION = "hungarian-writer@0.1.0";

/** One regenerate attempt if the self-check flags the first draft as inconsistent (docs/architecture/02-agents.md §2.5: "max 2 retry"). */
export const MAX_SELF_CHECK_ATTEMPTS = 2;

const FALLBACK_UPDATE_SUMMARY = "Frissítés az új információk alapján.";

export interface Emitter {
  emit(event: unknown): Promise<void>;
}

export interface HungarianWriterDeps {
  storyRepository: Pick<StoryRepository, "getById">;
  storyVersionRepository: Pick<StoryVersionRepository, "getLatest" | "createNextVersion">;
  factRepository: Pick<FactRepository, "listByStoryId">;
  llm: LlmClient;
  agentRunRepository: AgentRunRecorder;
  dispatcher: Emitter;
  logger: Logger;
}

type Trigger = Extract<SportsNewsEvent, { type: "story/facts.verified" }>;

/**
 * Hungarian Writer Agent (docs/architecture/02-agents.md §2.5). Generates
 * from the Fact set only (never raw source text — see facts.ts), then
 * re-verifies its own output against the same Fact set (self-check.ts),
 * regenerating once if the first draft is flagged inconsistent. Always
 * creates a `StoryVersion`, even after the retry budget is exhausted — the
 * confidence gate on whether that version auto-publishes is the Publish
 * Gate's job (docs/architecture/02-agents.md §2.7), not this agent's.
 */
export async function handleStoryFactsVerified(
  deps: HungarianWriterDeps,
  event: Trigger,
): Promise<void> {
  await withAgentRun(
    {
      agentRunRepository: deps.agentRunRepository,
      agentName: "hungarian-writer",
      correlationId: event.correlation_id,
      triggerEvent: event.type,
      storyId: event.payload.story_id,
    },
    async () => {
      const story = await deps.storyRepository.getById(event.payload.story_id);
      if (!story) {
        throw new Error(`Story "${event.payload.story_id}" not found`);
      }

      const facts = (await deps.factRepository.listByStoryId(story.id)).map(toWriterFact);
      const previousVersionRow = await deps.storyVersionRepository.getLatest(story.id);
      const previousVersion: PreviousVersionContent | null = previousVersionRow
        ? {
            titleHu: previousVersionRow.titleHu,
            leadHu: previousVersionRow.leadHu,
            bodyHu: previousVersionRow.bodyHu,
          }
        : null;

      let generated = await generateStoryVersion(deps.llm, { facts, previousVersion });
      let check = await selfCheckContent(deps.llm, { facts, ...generated });

      for (let attempt = 1; attempt < MAX_SELF_CHECK_ATTEMPTS && !check.consistent; attempt++) {
        deps.logger.warn(
          { correlationId: event.correlation_id, storyId: story.id, issues: check.issues },
          "self-check flagged the draft as inconsistent, regenerating",
        );
        generated = await generateStoryVersion(deps.llm, { facts, previousVersion });
        check = await selfCheckContent(deps.llm, { facts, ...generated });
      }

      const changeSummaryHu = previousVersion
        ? (generated.changeSummaryHu ?? FALLBACK_UPDATE_SUMMARY)
        : null;

      const version = await deps.storyVersionRepository.createNextVersion(story.id, {
        titleHu: generated.titleHu,
        leadHu: generated.leadHu,
        bodyHu: generated.bodyHu,
        changeSummaryHu,
        generatedByModel: MODEL_TIERS.writing,
        promptVersion: AGENT_VERSION,
        factConsistencyScore: check.factConsistencyScore,
      });

      await deps.dispatcher.emit({
        ...createEventEnvelope({ correlationId: event.correlation_id }),
        type: "story/content.drafted",
        payload: {
          story_id: story.id,
          story_version_id: version.id,
          fact_consistency_score: check.factConsistencyScore,
        },
      });

      deps.logger.info(
        { correlationId: event.correlation_id, storyId: story.id, versionId: version.id },
        "hungarian writer completed",
      );
    },
  );
}

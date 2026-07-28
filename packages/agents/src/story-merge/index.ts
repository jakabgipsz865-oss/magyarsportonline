import type {
  RawArticleRepository,
  StoryRepository,
  StorySourceRepository,
} from "@magyarsportonline/db";
import { createEventEnvelope, type SportsNewsEvent } from "@magyarsportonline/events";
import type { Logger } from "@magyarsportonline/observability";
import type { AgentRunRecorder } from "../shared/with-agent-run";
import { withAgentRun } from "../shared/with-agent-run";

export const AGENT_VERSION = "story-merge@0.1.0";

/** Per docs/architecture/01-data-model.md §1.4: a single corroborating source starts at the bottom of the source_corroboration_score band. */
const INITIAL_CONFIDENCE_SCORE = 0.3;

export interface Emitter {
  emit(event: unknown): Promise<void>;
}

export interface StoryMergeDeps {
  storyRepository: Pick<StoryRepository, "createOrMatchByFingerprint" | "setImageUrlIfMissing">;
  rawArticleRepository: Pick<RawArticleRepository, "getById" | "linkToStory">;
  storySourceRepository: Pick<StorySourceRepository, "link">;
  agentRunRepository: AgentRunRecorder;
  dispatcher: Emitter;
  logger: Logger;
}

type StoryCandidateIdentifiedEvent = Extract<
  SportsNewsEvent,
  { type: "story/candidate.identified" }
>;

/**
 * Story Merge Agent (docs/architecture/02-agents.md §2.3). The fingerprint
 * lock (`StoryRepository.createOrMatchByFingerprint`) is the actual
 * NEW_STORY/MATCH decision in this MVP (docs/adr/0005-mvp-end-to-end-scope-cuts.md
 * decision 2) — this agent trusts its `created` result regardless of what
 * `match_type` the Deduplication Agent reported.
 *
 * The "gyors tény-diff" that would classify a MATCH as `corroboration` vs.
 * `new_info` (§2.3) needs an existing `Fact` set to diff against, which only
 * exists after Fact Verification has run at least once — a genuine
 * ordering constraint the full architecture doesn't need to resolve because
 * it isn't itself the extraction step. For the MVP this agent always
 * classifies a MATCH as `new_info`, which is also the behaviourally correct
 * default for the MVP's explicit requirement that a new source updates the
 * Story (re-runs Fact Verification → Writer, bumps confidence) rather than
 * silently no-op'ing.
 */
export async function handleStoryCandidateIdentified(
  deps: StoryMergeDeps,
  event: StoryCandidateIdentifiedEvent,
): Promise<void> {
  await withAgentRun(
    {
      agentRunRepository: deps.agentRunRepository,
      agentName: "story-merge",
      correlationId: event.correlation_id,
      triggerEvent: event.type,
    },
    async () => {
      const rawArticle = await deps.rawArticleRepository.getById(event.payload.raw_article_id);
      if (!rawArticle) {
        throw new Error(`RawArticle "${event.payload.raw_article_id}" not found`);
      }

      const { story, created } = await deps.storyRepository.createOrMatchByFingerprint(
        event.payload.fingerprint_hash,
        {
          canonicalTitle: rawArticle.titleOriginal,
          categoryId: null,
          confidenceScore: INITIAL_CONFIDENCE_SCORE,
          riskLevel: null,
          isDeveloping: true,
          imageUrl: rawArticle.imageUrl,
        },
      );

      await deps.rawArticleRepository.linkToStory(rawArticle.id, story.id);

      if (!created && rawArticle.imageUrl) {
        // A later corroborating source can still supply the Story's first
        // image if the original source didn't have one.
        await deps.storyRepository.setImageUrlIfMissing(story.id, rawArticle.imageUrl);
      }

      if (created) {
        await deps.storySourceRepository.link(story.id, rawArticle.id, "initial");
        await deps.dispatcher.emit({
          ...createEventEnvelope({ correlationId: event.correlation_id }),
          type: "story/created",
          payload: { story_id: story.id },
        });
      } else {
        await deps.storySourceRepository.link(story.id, rawArticle.id, "new_info");
        await deps.dispatcher.emit({
          ...createEventEnvelope({ correlationId: event.correlation_id }),
          type: "story/merge.completed",
          payload: { story_id: story.id, update_type: "new_info" },
        });
      }

      deps.logger.info(
        { correlationId: event.correlation_id, storyId: story.id, created },
        "story merge completed",
      );
    },
  );
}

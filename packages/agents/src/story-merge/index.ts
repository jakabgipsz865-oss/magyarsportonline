import type {
  EntityRepository,
  RawArticleRepository,
  StoryMatchRepository,
  StoryRepository,
  StorySourceRepository,
} from "@magyarsportonline/db";
import { createEventEnvelope, type SportsNewsEvent } from "@magyarsportonline/events";
import type { Logger } from "@magyarsportonline/observability";
import type { AgentRunRecorder } from "../shared/with-agent-run";
import { withAgentRun } from "../shared/with-agent-run";
import { extractEntityMentions } from "../deduplication/entity-mentions";
import { isSpecificEntityType } from "../deduplication/story-match";
import { classifyMatchContribution } from "./contribution-classifier";

export const AGENT_VERSION = "story-merge@0.2.0";

/** Per docs/architecture/01-data-model.md §1.4: a single corroborating source starts at the bottom of the source_corroboration_score band. */
const INITIAL_CONFIDENCE_SCORE = 0.3;

export interface Emitter {
  emit(event: unknown): Promise<void>;
}

export interface StoryMergeDeps {
  storyRepository: Pick<
    StoryRepository,
    "createOrMatchByFingerprint" | "insertNew" | "lockAndGetById" | "setImageUrlIfMissing"
  >;
  rawArticleRepository: Pick<RawArticleRepository, "getById" | "linkToStory">;
  storySourceRepository: Pick<StorySourceRepository, "link">;
  storyMatchRepository: Pick<StoryMatchRepository, "setResultingStory">;
  entityRepository: Pick<EntityRepository, "listAll" | "linkToStory">;
  agentRunRepository: AgentRunRecorder;
  dispatcher: Emitter;
  logger: Logger;
}

type StoryCandidateIdentifiedEvent = Extract<
  SportsNewsEvent,
  { type: "story/candidate.identified" }
>;

/**
 * Story Merge Agent (docs/architecture/02-agents.md §2.3), rewritten
 * 2026-07-29 ("téves Story-összevonás megszüntetése" sprint) to act on the
 * Deduplication Agent's REAL match decision (`match_type`, now genuinely
 * MATCH/AMBIGUOUS/NEW_STORY, not always NEW_STORY) instead of blindly
 * trusting a coarse fingerprint lookup as the true decision authority:
 *
 * - MATCH: the Dedup Agent already resolved WHICH existing Story to merge
 *   into (`story_id`, backed by a real scored match — at least one
 *   specific team/player entity shared, plus enough corroboration). Locks
 *   that Story by its own id and appends this article as a corroborating
 *   source.
 * - NEW_STORY: no candidate shared a specific entity at all (or none
 *   existed). Creates via the fingerprint-keyed race-safety lock as
 *   before — but the fingerprint is now built from a SPECIFIC entity (or a
 *   per-article fallback), never a generic competition/league entity, so
 *   it can no longer coincide across unrelated articles the way the old
 *   scheme did.
 * - AMBIGUOUS: a specific entity WAS shared with some candidate, but not
 *   enough to auto-merge (rule 6: uncertain → manual review, never a
 *   silent merge) — creates its OWN Story unconditionally (no fingerprint
 *   lookup at all, see `StoryRepository.insertNew`'s doc comment for why),
 *   leaving the `story_match_decisions` row from the Dedup Agent as
 *   `needs_review`/`pending` for a human to resolve later.
 *
 * Every path also records this article's own title/lead entity mentions
 * into `story_entities` (`role: "subject"`) so LATER articles' candidate
 * lookups can find this Story.
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

      const entities = await deps.entityRepository.listAll();
      const mentions = extractEntityMentions(rawArticle, entities);

      async function linkStoryEntities(storyId: string): Promise<void> {
        for (const mention of mentions) {
          const role = isSpecificEntityType(mention.entity.type)
            ? ("subject" as const)
            : ("mentioned" as const);
          await deps.entityRepository.linkToStory(storyId, mention.entity.entityId, role);
        }
      }

      if (event.payload.match_type === "MATCH") {
        const storyId = event.payload.story_id;
        if (!storyId) {
          throw new Error('story/candidate.identified with match_type "MATCH" is missing story_id');
        }

        const story = await deps.storyRepository.lockAndGetById(storyId);
        await deps.rawArticleRepository.linkToStory(rawArticle.id, story.id);
        if (rawArticle.imageUrl) {
          await deps.storyRepository.setImageUrlIfMissing(story.id, rawArticle.imageUrl);
        }
        const contributionType = classifyMatchContribution(
          rawArticle.titleOriginal,
          story.canonicalTitle,
          entities,
        );
        await linkStoryEntities(story.id);
        await deps.storySourceRepository.link(story.id, rawArticle.id, contributionType);
        await deps.dispatcher.emit({
          ...createEventEnvelope({ correlationId: event.correlation_id }),
          type: "story/merge.completed",
          payload: { story_id: story.id, update_type: contributionType },
        });
        deps.logger.info(
          { correlationId: event.correlation_id, storyId: story.id, matchType: "MATCH" },
          "story merge completed",
        );
        return;
      }

      if (event.payload.match_type === "AMBIGUOUS") {
        const story = await deps.storyRepository.insertNew({
          canonicalTitle: rawArticle.titleOriginal,
          categoryId: null,
          confidenceScore: INITIAL_CONFIDENCE_SCORE,
          riskLevel: null,
          isDeveloping: false,
          imageUrl: rawArticle.imageUrl,
        });
        await deps.rawArticleRepository.linkToStory(rawArticle.id, story.id);
        await deps.storyMatchRepository.setResultingStory(rawArticle.id, story.id);
        await linkStoryEntities(story.id);
        await deps.storySourceRepository.link(story.id, rawArticle.id, "initial");
        await deps.dispatcher.emit({
          ...createEventEnvelope({ correlationId: event.correlation_id }),
          type: "story/created",
          payload: { story_id: story.id },
        });
        deps.logger.info(
          { correlationId: event.correlation_id, storyId: story.id, matchType: "AMBIGUOUS" },
          "story created pending manual merge review",
        );
        return;
      }

      // NEW_STORY
      const { story, created } = await deps.storyRepository.createOrMatchByFingerprint(
        event.payload.fingerprint_hash,
        {
          canonicalTitle: rawArticle.titleOriginal,
          categoryId: null,
          confidenceScore: INITIAL_CONFIDENCE_SCORE,
          riskLevel: null,
          isDeveloping: false,
          imageUrl: rawArticle.imageUrl,
        },
      );

      await deps.rawArticleRepository.linkToStory(rawArticle.id, story.id);
      await deps.storyMatchRepository.setResultingStory(rawArticle.id, story.id);
      await linkStoryEntities(story.id);

      if (!created && rawArticle.imageUrl) {
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
        // A same-instant race between two NEW_STORY decisions that both
        // resolved to the exact same specific-entity+sport+day fingerprint
        // — a real, desired collision now (see the fingerprint's doc
        // comment in deduplication/index.ts), not the old generic-entity bug.
        await deps.storySourceRepository.link(story.id, rawArticle.id, "new_info");
        await deps.dispatcher.emit({
          ...createEventEnvelope({ correlationId: event.correlation_id }),
          type: "story/merge.completed",
          payload: { story_id: story.id, update_type: "new_info" },
        });
      }

      deps.logger.info(
        { correlationId: event.correlation_id, storyId: story.id, created, matchType: "NEW_STORY" },
        "story merge completed",
      );
    },
  );
}

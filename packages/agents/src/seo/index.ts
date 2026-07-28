import type { StoryRepository, StoryVersionRepository } from "@magyarsportonline/db";
import { createEventEnvelope, type SportsNewsEvent } from "@magyarsportonline/events";
import type { Logger } from "@magyarsportonline/observability";
import type { AgentRunRecorder } from "../shared/with-agent-run";
import { withAgentRun } from "../shared/with-agent-run";
import { slugify } from "./slug";

export * from "./slug";

export const AGENT_VERSION = "seo@0.1.0";
export const MAX_SLUG_COLLISION_RETRIES = 5;

export interface Emitter {
  emit(event: unknown): Promise<void>;
}

export interface SeoDeps {
  storyRepository: Pick<StoryRepository, "getById" | "trySetSlug">;
  storyVersionRepository: Pick<StoryVersionRepository, "getLatest">;
  agentRunRepository: AgentRunRecorder;
  dispatcher: Emitter;
  logger: Logger;
}

type Trigger = Extract<SportsNewsEvent, { type: "story/editorial.rewritten" }>;

/**
 * SEO Agent, MVP scope (docs/architecture/02-agents.md §2.6,
 * docs/adr/0005-mvp-end-to-end-scope-cuts.md decision 4): slug generation
 * only, assigned once on the first version and never touched again. Meta
 * description, tag/category taxonomy assignment, and schema.org JSON-LD
 * generation are Fázis 8 — `story_versions.meta_description`/`.seo_tags`/
 * `.structured_data` stay `null` until then.
 *
 * Triggered by `story/editorial.rewritten`, not `story/content.drafted`
 * directly — the Editorial Rewrite Agent (packages/agents/src/editorial-rewrite)
 * sits between the Hungarian Writer and this agent so the slug is always
 * derived from the final (possibly stylistically rewritten) title.
 */
export async function handleStoryEditorialRewritten(deps: SeoDeps, event: Trigger): Promise<void> {
  await withAgentRun(
    {
      agentRunRepository: deps.agentRunRepository,
      agentName: "seo",
      correlationId: event.correlation_id,
      triggerEvent: event.type,
      storyId: event.payload.story_id,
    },
    async () => {
      const story = await deps.storyRepository.getById(event.payload.story_id);
      if (!story) {
        throw new Error(`Story "${event.payload.story_id}" not found`);
      }

      if (!story.slug) {
        const version = await deps.storyVersionRepository.getLatest(story.id);
        const baseSlug = slugify(version?.titleHu ?? story.canonicalTitle);

        let assigned = false;
        for (let attempt = 0; attempt <= MAX_SLUG_COLLISION_RETRIES && !assigned; attempt++) {
          const candidate = attempt === 0 ? baseSlug : `${baseSlug}-${attempt + 1}`;
          assigned = await deps.storyRepository.trySetSlug(story.id, candidate);
        }
        if (!assigned) {
          throw new Error(
            `Could not assign a unique slug for Story "${story.id}" after ${MAX_SLUG_COLLISION_RETRIES} retries`,
          );
        }
      }

      await deps.dispatcher.emit({
        ...createEventEnvelope({ correlationId: event.correlation_id }),
        type: "story/seo.ready",
        payload: { story_id: story.id, story_version_id: event.payload.story_version_id },
      });

      deps.logger.info(
        { correlationId: event.correlation_id, storyId: story.id },
        "seo agent completed",
      );
    },
  );
}

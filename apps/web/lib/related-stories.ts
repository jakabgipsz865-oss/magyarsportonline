import type { Entity } from "@magyarsportonline/db";
import { deduplication } from "@magyarsportonline/agents";
import type { StorySummaryView } from "./story-view";

const { entityMatchesText } = deduplication;

const RELATED_STORIES_LIMIT = 3;

/**
 * Stories sharing a mentioned team/competition with `current` come first
 * (most recent first within that group), padded out with other recent
 * stories if there aren't enough — never returns `current` itself.
 */
export function pickRelatedStories(
  current: StorySummaryView,
  candidates: StorySummaryView[],
  entities: Entity[],
): StorySummaryView[] {
  const others = candidates.filter((story) => story.id !== current.id);
  const currentText = `${current.title} ${current.lead}`;
  const sharedEntities = entities.filter((entity) => entityMatchesText(entity, currentText));

  const related: StorySummaryView[] = [];
  const seen = new Set<string>();

  if (sharedEntities.length > 0) {
    for (const story of others) {
      if (related.length >= RELATED_STORIES_LIMIT) break;
      const storyText = `${story.title} ${story.lead}`;
      if (sharedEntities.some((entity) => entityMatchesText(entity, storyText))) {
        related.push(story);
        seen.add(story.id);
      }
    }
  }

  for (const story of others) {
    if (related.length >= RELATED_STORIES_LIMIT) break;
    if (!seen.has(story.id)) {
      related.push(story);
      seen.add(story.id);
    }
  }

  return related;
}

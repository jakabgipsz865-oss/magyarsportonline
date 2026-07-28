import type { Entity } from "@magyarsportonline/db";
import { deduplication } from "@magyarsportonline/agents";
import type { StorySummaryView } from "./story-view";

const { entityMatchesText } = deduplication;

const TICKER_SIZE = 5;
const FEATURED_SIZE = 3;
const POPULAR_ENTITIES_LIMIT = 8;

export interface HomepageView {
  ticker: StorySummaryView[];
  hero: StorySummaryView | null;
  featured: StorySummaryView[];
  river: StorySummaryView[];
  popularEntities: Entity[];
}

/**
 * Pure layout split for the homepage — no I/O, so it's cheap to unit test
 * the "which story goes where" logic separately from data fetching.
 * `stories` is assumed already sorted newest-first
 * (`StoryReadModelRepository.listPublished` orders by `publishedAt desc`).
 */
export function buildHomepageView(stories: StorySummaryView[], entities: Entity[]): HomepageView {
  const hero = stories[0] ?? null;
  const featured = stories.slice(1, 1 + FEATURED_SIZE);
  const river = stories.slice(1 + FEATURED_SIZE);
  const ticker = stories.slice(0, TICKER_SIZE);

  const combinedText = stories.map((story) => `${story.title} ${story.lead}`).join(" \n ");
  const popularEntities = entities
    .filter((entity) => entityMatchesText(entity, combinedText))
    .slice(0, POPULAR_ENTITIES_LIMIT);

  return { ticker, hero, featured, river, popularEntities };
}

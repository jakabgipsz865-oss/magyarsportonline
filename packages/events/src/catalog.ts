import { RISK_LEVELS, REVIEW_QUEUE_REASONS } from "@magyarsportonline/shared";
import { z } from "zod";
import { eventEnvelopeSchema } from "./envelope";

/**
 * Event catalog per docs/architecture/03-event-flow.md §3.2, extended with
 * the review-driven `story/updated.published` event referenced by the
 * Social Media Agent trigger (docs/architecture/02-agents.md §2.8) for
 * significant post-publish updates.
 *
 * Each event is `{ ...envelope, type: "<literal>", payload: <schema> }`.
 * This module defines the *contract only* — no agent subscribes to or
 * publishes these yet (that begins in Fázis 2/3 of the roadmap). Locking the
 * shape in now avoids a breaking payload migration once agents exist.
 */

function defineEvent<Type extends string, Payload extends z.ZodTypeAny>(
  type: Type,
  payload: Payload,
) {
  return eventEnvelopeSchema.extend({
    type: z.literal(type),
    payload,
  });
}

export const sourceArticleIngestedEvent = defineEvent(
  "source/article.ingested",
  z.object({
    raw_article_id: z.string().uuid(),
    source_id: z.string().uuid(),
  }),
);

export const storyCandidateIdentifiedEvent = defineEvent(
  "story/candidate.identified",
  z.object({
    raw_article_id: z.string().uuid(),
    match_type: z.enum(["NEW_STORY", "MATCH", "AMBIGUOUS"]),
    story_id: z.string().uuid().optional(),
    candidates: z
      .array(
        z.object({
          story_id: z.string().uuid(),
          score: z.number().min(0).max(1),
        }),
      )
      .optional(),
    // A story-létrehozási race condition javításához (09-architecture-review.md
    // §9, 03-event-flow.md §3.7) minden NEW_STORY jelöltnek fingerprintet
    // kell vinnie, amit a Story Merge Agent advisory lock kulcsként használ.
    fingerprint_hash: z.string().min(1),
  }),
);

export const storyCreatedEvent = defineEvent(
  "story/created",
  z.object({
    story_id: z.string().uuid(),
  }),
);

export const storyMergeCompletedEvent = defineEvent(
  "story/merge.completed",
  z.object({
    story_id: z.string().uuid(),
    update_type: z.enum(["new_info", "corroboration"]),
  }),
);

export const storyFactsVerifiedEvent = defineEvent(
  "story/facts.verified",
  z.object({
    story_id: z.string().uuid(),
    confidence_score: z.number().min(0).max(1),
    risk_level: z.enum(RISK_LEVELS),
    has_contradiction: z.boolean(),
    // Review-kiegészítés (09-architecture-review.md §8): a prompt injection
    // gyanú-jelző a risk-osztályozó kimenetének explicit része, nem csak
    // mellékesen a risk_level="high"-ba kódolva — auditálhatóság miatt.
    prompt_injection_suspected: z.boolean(),
  }),
);

export const storyContentDraftedEvent = defineEvent(
  "story/content.drafted",
  z.object({
    story_id: z.string().uuid(),
    story_version_id: z.string().uuid(),
    fact_consistency_score: z.number().min(0).max(1),
  }),
);

export const storySeoReadyEvent = defineEvent(
  "story/seo.ready",
  z.object({
    story_id: z.string().uuid(),
    story_version_id: z.string().uuid(),
  }),
);

export const storyPublishedEvent = defineEvent(
  "story/published",
  z.object({
    story_id: z.string().uuid(),
    story_version_id: z.string().uuid(),
  }),
);

export const storyUpdatedPublishedEvent = defineEvent(
  "story/updated.published",
  z.object({
    story_id: z.string().uuid(),
    story_version_id: z.string().uuid(),
    is_significant_update: z.boolean(),
  }),
);

export const storyReviewRequestedEvent = defineEvent(
  "story/review.requested",
  z.object({
    story_id: z.string().uuid(),
    reason: z.enum(REVIEW_QUEUE_REASONS),
  }),
);

export const storyReviewResolvedEvent = defineEvent(
  "story/review.resolved",
  z.object({
    story_id: z.string().uuid(),
    decision: z.enum(["approved", "rejected"]),
    reviewed_by: z.string().uuid(),
  }),
);

export const storyRetractedEvent = defineEvent(
  "story/retracted",
  z.object({
    story_id: z.string().uuid(),
    reason: z.string().min(1),
  }),
);

export const socialPostedEvent = defineEvent(
  "social/posted",
  z.object({
    story_id: z.string().uuid(),
    story_version_id: z.string().uuid(),
    platform: z.enum(["facebook", "threads", "x"]),
    external_post_id: z.string().min(1),
  }),
);

export const eventCatalog = {
  "source/article.ingested": sourceArticleIngestedEvent,
  "story/candidate.identified": storyCandidateIdentifiedEvent,
  "story/created": storyCreatedEvent,
  "story/merge.completed": storyMergeCompletedEvent,
  "story/facts.verified": storyFactsVerifiedEvent,
  "story/content.drafted": storyContentDraftedEvent,
  "story/seo.ready": storySeoReadyEvent,
  "story/published": storyPublishedEvent,
  "story/updated.published": storyUpdatedPublishedEvent,
  "story/review.requested": storyReviewRequestedEvent,
  "story/review.resolved": storyReviewResolvedEvent,
  "story/retracted": storyRetractedEvent,
  "social/posted": socialPostedEvent,
} as const;

export type EventType = keyof typeof eventCatalog;

export const sportsNewsEventSchema = z.discriminatedUnion("type", [
  sourceArticleIngestedEvent,
  storyCandidateIdentifiedEvent,
  storyCreatedEvent,
  storyMergeCompletedEvent,
  storyFactsVerifiedEvent,
  storyContentDraftedEvent,
  storySeoReadyEvent,
  storyPublishedEvent,
  storyUpdatedPublishedEvent,
  storyReviewRequestedEvent,
  storyReviewResolvedEvent,
  storyRetractedEvent,
  socialPostedEvent,
]);

export type SportsNewsEvent = z.infer<typeof sportsNewsEventSchema>;

export type EventPayload<T extends EventType> = z.infer<(typeof eventCatalog)[T]>["payload"];

/** Validates an unknown value against the full event catalog. */
export function parseEvent(value: unknown): SportsNewsEvent {
  return sportsNewsEventSchema.parse(value);
}

/** Validates an unknown value against a single, known event type. */
export function parseEventOfType<T extends EventType>(
  type: T,
  value: unknown,
): z.infer<(typeof eventCatalog)[T]> {
  return eventCatalog[type].parse(value) as z.infer<(typeof eventCatalog)[T]>;
}

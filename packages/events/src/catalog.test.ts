import { describe, expect, it } from "vitest";
import { createEventEnvelope } from "./envelope.js";
import {
  parseEvent,
  parseEventOfType,
  storyFactsVerifiedEvent,
  storyPublishedEvent,
} from "./catalog.js";

const STORY_ID = "f47ac10b-58cc-4372-a567-0e02b2c3d479";
const VERSION_ID = "9b2e6f2a-6b8e-4e3e-9b7a-2f4a9c1d0e11";
const CORRELATION_ID = "1c2d3e4f-5a6b-7c8d-9e0f-1a2b3c4d5e6f";

describe("event envelope", () => {
  it("defaults trace_id to correlation_id", () => {
    const envelope = createEventEnvelope({ correlationId: CORRELATION_ID });
    expect(envelope.trace_id).toBe(CORRELATION_ID);
    expect(envelope.version).toBe(1);
  });
});

describe("event catalog", () => {
  it("accepts a valid story/published event", () => {
    const event = {
      ...createEventEnvelope({ correlationId: CORRELATION_ID }),
      type: "story/published" as const,
      payload: { story_id: STORY_ID, story_version_id: VERSION_ID },
    };
    expect(() => storyPublishedEvent.parse(event)).not.toThrow();
    expect(parseEvent(event).type).toBe("story/published");
  });

  it("rejects a story/facts.verified event with an out-of-range confidence_score", () => {
    const event = {
      ...createEventEnvelope({ correlationId: CORRELATION_ID }),
      type: "story/facts.verified" as const,
      payload: {
        story_id: STORY_ID,
        confidence_score: 1.5,
        risk_level: "low" as const,
        has_contradiction: false,
        prompt_injection_suspected: false,
      },
    };
    expect(() => storyFactsVerifiedEvent.parse(event)).toThrow();
  });

  it("rejects an unknown event type via the discriminated union", () => {
    const event = {
      ...createEventEnvelope({ correlationId: CORRELATION_ID }),
      type: "story/teleported",
      payload: {},
    };
    expect(() => parseEvent(event)).toThrow();
  });

  it("parseEventOfType narrows to the requested event's payload shape", () => {
    const event = {
      ...createEventEnvelope({ correlationId: CORRELATION_ID }),
      type: "story/published" as const,
      payload: { story_id: STORY_ID, story_version_id: VERSION_ID },
    };
    const parsed = parseEventOfType("story/published", event);
    expect(parsed.payload.story_id).toBe(STORY_ID);
  });

  it("requires fingerprint_hash on story/candidate.identified", () => {
    const event = {
      ...createEventEnvelope({ correlationId: CORRELATION_ID }),
      type: "story/candidate.identified" as const,
      payload: {
        raw_article_id: STORY_ID,
        match_type: "NEW_STORY" as const,
      },
    };
    expect(() => parseEvent(event)).toThrow();
  });
});

import { describe, expect, it } from "vitest";
import { createEventEnvelope } from "./envelope";
import { createInProcessDispatcher } from "./dispatcher";

const STORY_ID = "f47ac10b-58cc-4372-a567-0e02b2c3d479";
const VERSION_ID = "9b2e6f2a-6b8e-4e3e-9b7a-2f4a9c1d0e11";
const CORRELATION_ID = "1c2d3e4f-5a6b-7c8d-9e0f-1a2b3c4d5e6f";

function storyCreatedEvent() {
  return {
    ...createEventEnvelope({ correlationId: CORRELATION_ID }),
    type: "story/created" as const,
    payload: { story_id: STORY_ID },
  };
}

describe("InProcessDispatcher", () => {
  it("invokes a handler subscribed to the emitted event's type", async () => {
    const dispatcher = createInProcessDispatcher();
    const received: string[] = [];
    dispatcher.on("story/created", async (event) => {
      received.push(event.payload.story_id);
    });

    await dispatcher.emit(storyCreatedEvent());

    expect(received).toEqual([STORY_ID]);
  });

  it("runs multiple handlers for the same type in registration order", async () => {
    const dispatcher = createInProcessDispatcher();
    const order: string[] = [];
    dispatcher.on("story/created", async () => {
      order.push("first");
    });
    dispatcher.on("story/created", async () => {
      order.push("second");
    });

    await dispatcher.emit(storyCreatedEvent());

    expect(order).toEqual(["first", "second"]);
  });

  it("does not invoke handlers subscribed to a different event type", async () => {
    const dispatcher = createInProcessDispatcher();
    let called = false;
    dispatcher.on("story/published", async () => {
      called = true;
    });

    await dispatcher.emit(storyCreatedEvent());

    expect(called).toBe(false);
  });

  it("is a no-op when no handler is registered for the event's type", async () => {
    const dispatcher = createInProcessDispatcher();
    await expect(dispatcher.emit(storyCreatedEvent())).resolves.toBeUndefined();
  });

  it("rejects a malformed event before invoking any handler", async () => {
    const dispatcher = createInProcessDispatcher();
    let called = false;
    dispatcher.on("story/published", async () => {
      called = true;
    });

    const malformed = {
      ...createEventEnvelope({ correlationId: CORRELATION_ID }),
      type: "story/published" as const,
      payload: { story_id: "not-a-uuid", story_version_id: VERSION_ID },
    };

    await expect(dispatcher.emit(malformed)).rejects.toThrow();
    expect(called).toBe(false);
  });

  it("propagates a handler's thrown error to the caller", async () => {
    const dispatcher = createInProcessDispatcher();
    dispatcher.on("story/created", async () => {
      throw new Error("story merge failed");
    });

    await expect(dispatcher.emit(storyCreatedEvent())).rejects.toThrow("story merge failed");
  });
});

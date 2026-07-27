import { parseEvent, type EventType, type SportsNewsEvent } from "./catalog";

type HandlerFor<T extends EventType> = (
  event: Extract<SportsNewsEvent, { type: T }>,
) => Promise<void>;

/**
 * In-process substitute for the Inngest event bus
 * (docs/adr/0005-mvp-end-to-end-scope-cuts.md decision 1). Agents subscribe
 * by event type exactly as they would register an Inngest function
 * (docs/architecture/02-agents.md §2.0's `Agent(event, ctx) → { writes,
 * emits }` contract already assumes no direct agent-to-agent calls); `emit`
 * validates the event against the catalog and runs every matching handler in
 * registration order, awaiting each one.
 *
 * This has none of Inngest's durability (no retry/backoff/dead-letter/
 * concurrency limits, docs/architecture/03-event-flow.md §3.1) — it exists
 * purely so the same agent functions can be exercised end-to-end without an
 * external service. Swapping to real Inngest later means registering these
 * same handlers as `inngest.createFunction` step functions instead of
 * `dispatcher.on`; no agent logic changes.
 */
export class InProcessDispatcher {
  private readonly handlers = new Map<EventType, Array<HandlerFor<EventType>>>();

  on<T extends EventType>(type: T, handler: HandlerFor<T>): void {
    const existing = this.handlers.get(type) ?? [];
    existing.push(handler as unknown as HandlerFor<EventType>);
    this.handlers.set(type, existing);
  }

  /** Validates `event` against the catalog, then awaits every subscribed handler in order. */
  async emit(event: SportsNewsEvent): Promise<void> {
    const validated = parseEvent(event);
    const matching = this.handlers.get(validated.type as EventType) ?? [];
    for (const handler of matching) {
      await handler(validated);
    }
  }
}

export function createInProcessDispatcher(): InProcessDispatcher {
  return new InProcessDispatcher();
}

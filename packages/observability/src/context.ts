/**
 * Fields every agent-emitted log line must carry, per
 * docs/architecture/03-event-flow.md §3.8 and
 * docs/architecture/09-architecture-review.md §10. `correlationId` doubles
 * as the OpenTelemetry `traceId` today (see packages/events'
 * `createEventEnvelope`) — kept as a distinct field name here too so a
 * future split doesn't require renaming every log call site.
 *
 * `agentName` is typed optional here because it is normally supplied once,
 * via `createAgentLogger`, rather than repeated on every call site — the
 * "every log line carries an agent name" invariant is enforced by always
 * logging through a `createAgentLogger`-bound child, not by the type
 * checker (pino's child-binding pattern merges bound fields at the
 * destination, which the type system can't see across the two calls).
 */
export interface AgentLogContext {
  agentName?: string;
  correlationId?: string;
  traceId?: string;
  storyId?: string;
  rawArticleId?: string;
  [extra: string]: unknown;
}

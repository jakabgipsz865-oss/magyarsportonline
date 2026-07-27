import { z } from "zod";

/**
 * Common envelope for every event on the bus, per
 * docs/architecture/03-event-flow.md §3.2 and §3.5, extended with
 * `trace_id` per the review's tracing requirement
 * (docs/architecture/03-event-flow.md §3.8 / 09-architecture-review.md §10).
 *
 * `trace_id` is carried separately from `correlation_id` even though the two
 * are set equal at emission time today — this keeps the door open for a
 * future distinction (e.g. a single correlation_id spanning multiple
 * OpenTelemetry traces) without a payload shape change.
 */
export const eventEnvelopeSchema = z.object({
  id: z.string().uuid(),
  version: z.literal(1),
  occurred_at: z.string().datetime(),
  correlation_id: z.string().uuid(),
  trace_id: z.string().uuid(),
});

export type EventEnvelope = z.infer<typeof eventEnvelopeSchema>;

/**
 * Builds the envelope fields for a new event. Callers pass an explicit
 * `correlationId` for every event except the very first one in a Story's
 * lifecycle (source/article.ingested), where a fresh id doubles as both
 * `id` and `correlation_id`.
 */
export function createEventEnvelope(params: {
  correlationId: string;
  id?: string;
  occurredAt?: Date;
  traceId?: string;
}): EventEnvelope {
  const correlationId = params.correlationId;
  return eventEnvelopeSchema.parse({
    id: params.id ?? crypto.randomUUID(),
    version: 1,
    occurred_at: (params.occurredAt ?? new Date()).toISOString(),
    correlation_id: correlationId,
    trace_id: params.traceId ?? correlationId,
  });
}

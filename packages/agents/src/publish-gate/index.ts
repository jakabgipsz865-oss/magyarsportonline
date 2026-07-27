import { schema, type Database } from "@magyarsportonline/db";
import type { Logger } from "@magyarsportonline/observability";
import type { RiskLevel } from "@magyarsportonline/shared";
import { eq, sql } from "drizzle-orm";
import type { RecordAgentRun } from "../telemetry/agent-run-recorder.js";
import { runWithTelemetry } from "../telemetry/run-with-telemetry.js";
import { decidePublishGate, type PublishGateDecision } from "./decide.js";

export interface PublishGateAgentInput {
  storyId: string;
  storyVersionId: string;
  factVerification: {
    confidenceScore: number;
    riskLevel: RiskLevel;
    hasContradiction: boolean;
  };
  correlationId: string;
}

/**
 * Publish Gate (docs/architecture/02-agents.md §2.7). Applies the pure
 * decision from decide.ts and then performs the corresponding DB write —
 * kept as two functions so the decision logic is trivially unit-testable
 * without a database (decide.test.ts) while this orchestration layer only
 * needs integration coverage for the write side-effects.
 */
export async function runPublishGateAgent(
  deps: { db: Database; logger: Logger; recordAgentRun: RecordAgentRun },
  input: PublishGateAgentInput,
): Promise<PublishGateDecision> {
  return runWithTelemetry(
    deps,
    {
      agentName: "publish-gate",
      triggerEvent: "story/seo.ready",
      correlationId: input.correlationId,
      storyId: input.storyId,
    },
    async ({ log }) => {
      const decision = decidePublishGate(input.factVerification);
      const now = new Date();

      if (decision.decision === "auto_publish") {
        await deps.db.transaction(async (tx) => {
          await tx
            .update(schema.storyVersions)
            .set({ isPublished: true })
            .where(eq(schema.storyVersions.id, input.storyVersionId));
          await tx
            .update(schema.stories)
            .set({
              status: "published",
              publishedAt: sql`coalesce(${schema.stories.publishedAt}, ${now.toISOString()}::timestamptz)`,
              currentVersionId: input.storyVersionId,
              isDeveloping: false,
              lastUpdatedAt: now,
            })
            .where(eq(schema.stories.id, input.storyId));
        });
        log.info({ storyId: input.storyId }, "Publish Gate: auto-published");
      } else {
        await deps.db.insert(schema.reviewQueueItems).values({
          storyId: input.storyId,
          storyVersionId: input.storyVersionId,
          reason: decision.reason,
          status: "pending",
        });
        await deps.db
          .update(schema.stories)
          .set({ status: "pending_review", lastUpdatedAt: now })
          .where(eq(schema.stories.id, input.storyId));
        log.info(
          { storyId: input.storyId, reason: decision.reason },
          "Publish Gate: sent to review queue",
        );
      }

      return decision;
    },
  );
}

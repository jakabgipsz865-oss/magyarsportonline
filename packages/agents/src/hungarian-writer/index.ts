import { schema, withFingerprintLock, type Database } from "@magyarsportonline/db";
import { isLlmConfigured, type LlmClient } from "@magyarsportonline/llm";
import type { Logger } from "@magyarsportonline/observability";
import { eq, sql } from "drizzle-orm";
import type { RecordAgentRun } from "../telemetry/agent-run-recorder.js";
import { runWithTelemetry } from "../telemetry/run-with-telemetry.js";
import { generateWithLlm, type WriterOutput } from "./llm-writer.js";
import { selfCheckWithLlm } from "./self-check.js";
import { renderTemplateFallback } from "./template-fallback.js";

export interface HungarianWriterInput {
  storyId: string;
  correlationId: string;
}

export interface HungarianWriterResult {
  storyVersionId: string;
  versionNumber: number;
  factConsistencyScore: number;
  generatedByModel: string;
}

const WRITER_PROMPT_VERSION = "v1";
const MAX_GENERATION_ATTEMPTS = 2;

/**
 * Hungarian Writer Agent (docs/architecture/02-agents.md §2.5). Reads ONLY
 * the structured `Fact` rows for the Story — never raw source text — and
 * either calls the LLM (with a self-check retry loop) or, when
 * `ANTHROPIC_API_KEY` is unset, falls back to the deterministic,
 * explicitly-not-AI template renderer (docs/adr/0007-mvp-llm-fallback-mode.md).
 *
 * Version numbering reuses the fingerprint advisory-lock mechanism
 * (docs/architecture/03-event-flow.md §3.7) keyed by
 * `story-version:<storyId>` — the same `pg_advisory_xact_lock` primitive,
 * just serializing "what's the next version_number" instead of
 * "does this Story already exist", which is exactly the generic tool it
 * already was.
 */
export async function runHungarianWriterAgent(
  deps: {
    db: Database;
    logger: Logger;
    recordAgentRun: RecordAgentRun;
    llmClient?: LlmClient;
    llmApiKey?: string;
  },
  input: HungarianWriterInput,
): Promise<HungarianWriterResult> {
  return runWithTelemetry(
    deps,
    {
      agentName: "hungarian-writer",
      triggerEvent: "story/facts.verified",
      correlationId: input.correlationId,
      storyId: input.storyId,
    },
    async ({ log, recordCost }) => {
      const story = await deps.db.query.stories.findFirst({
        where: eq(schema.stories.id, input.storyId),
      });
      if (!story) throw new Error(`Story ${input.storyId} not found`);

      const factRows = await deps.db
        .select({ factType: schema.facts.factType, payload: schema.facts.payload })
        .from(schema.facts)
        .where(eq(schema.facts.storyId, input.storyId));

      const [existingVersionCount] = await deps.db
        .select({ count: sql<number>`count(*)` })
        .from(schema.storyVersions)
        .where(eq(schema.storyVersions.storyId, input.storyId));
      const isUpdate = (existingVersionCount?.count ?? 0) > 0;

      let output: WriterOutput;
      let generatedByModel: string;
      let factConsistencyScore: number;

      if (deps.llmClient && isLlmConfigured(deps.llmApiKey)) {
        let llmOutput: WriterOutput | null = null;
        let selfCheckIssues: string[] = [];

        for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt += 1) {
          const attemptOutput = await generateWithLlm(
            deps.llmClient,
            factRows,
            isUpdate,
            recordCost,
          );
          if (!attemptOutput) {
            log.warn({ attempt }, "writer LLM output unparseable, retrying");
            continue;
          }
          const combinedText = `${attemptOutput.titleHu} ${attemptOutput.leadHu} ${attemptOutput.bodyHu}`;
          const selfCheck = await selfCheckWithLlm(
            deps.llmClient,
            factRows,
            combinedText,
            recordCost,
          );
          if (selfCheck?.consistent) {
            llmOutput = attemptOutput;
            selfCheckIssues = [];
            break;
          }
          selfCheckIssues = selfCheck?.issues ?? ["self-check failed to run"];
          log.warn(
            { attempt, issues: selfCheckIssues },
            "self-check found inconsistencies, retrying",
          );
          llmOutput = attemptOutput; // keep the last attempt in case retries are exhausted
        }

        if (!llmOutput) {
          throw new Error(
            "Hungarian Writer Agent: LLM failed to produce parseable output after retries",
          );
        }

        output = llmOutput;
        generatedByModel = "claude-sonnet-5";
        factConsistencyScore = selfCheckIssues.length === 0 ? 1.0 : 0.5;
      } else {
        log.info(
          { storyId: input.storyId },
          "ANTHROPIC_API_KEY not configured — using template fallback (docs/adr/0007-mvp-llm-fallback-mode.md)",
        );
        const fallback = renderTemplateFallback(
          { canonicalTitle: story.canonicalTitle, facts: factRows },
          isUpdate,
        );
        output = fallback;
        generatedByModel = "template-fallback-v1";
        factConsistencyScore = 1.0;
      }

      const storyVersion = await deps.db.transaction(async (tx) => {
        return withFingerprintLock(tx, `story-version:${input.storyId}`, async () => {
          const [row] = await tx
            .select({ max: sql<number>`coalesce(max(${schema.storyVersions.versionNumber}), 0)` })
            .from(schema.storyVersions)
            .where(eq(schema.storyVersions.storyId, input.storyId));
          const versionNumber = (row?.max ?? 0) + 1;

          const [inserted] = await tx
            .insert(schema.storyVersions)
            .values({
              storyId: input.storyId,
              versionNumber,
              titleHu: output.titleHu,
              leadHu: output.leadHu,
              bodyHu: output.bodyHu,
              changeSummaryHu: output.changeSummaryHu,
              generatedByModel,
              promptVersion: WRITER_PROMPT_VERSION,
              factConsistencyScore: factConsistencyScore.toFixed(3),
              isPublished: false,
            })
            .returning();
          if (!inserted) throw new Error("failed to insert story version");
          return inserted;
        });
      });

      await deps.db
        .update(schema.stories)
        .set({
          status: "written",
          versionCount: storyVersion.versionNumber,
          lastUpdatedAt: new Date(),
        })
        .where(eq(schema.stories.id, input.storyId));

      log.info(
        { storyId: input.storyId, versionNumber: storyVersion.versionNumber, generatedByModel },
        "Hungarian StoryVersion created",
      );

      return {
        storyVersionId: storyVersion.id,
        versionNumber: storyVersion.versionNumber,
        factConsistencyScore,
        generatedByModel,
      };
    },
  );
}

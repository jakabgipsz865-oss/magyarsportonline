import { schema, type Database } from "@magyarsportonline/db";
import type { LlmClient } from "@magyarsportonline/llm";
import type { Logger } from "@magyarsportonline/observability";
import type { RiskLevel } from "@magyarsportonline/shared";
import { eq, sql } from "drizzle-orm";
import { computeConfidenceScore } from "../shared/confidence-score.js";
import { getContributingSources } from "../shared/contributing-sources.js";
import { extractQuickFacts } from "../shared/quick-fact-extractor.js";
import type { RecordAgentRun } from "../telemetry/agent-run-recorder.js";
import { runWithTelemetry } from "../telemetry/run-with-telemetry.js";
import { decideFactMergeAction, type ExistingFactRow } from "./fact-merge.js";
import { extractFactsWithLlm, type ExtractedFact } from "./llm-extractor.js";
import { detectPromptInjection } from "./prompt-injection.js";
import { classifyRisk } from "./risk-classifier.js";

export interface FactVerificationInput {
  storyId: string;
  rawArticle: {
    id: string;
    titleOriginal: string;
    bodyOriginal: string;
  };
  correlationId: string;
}

export interface FactVerificationResult {
  confidenceScore: number;
  riskLevel: RiskLevel;
  hasContradiction: boolean;
  promptInjectionSuspected: boolean;
  extractionMethod: "llm" | "rule_based_fallback";
}

/**
 * Fact Verification Agent (docs/architecture/02-agents.md §2.4). Extracts
 * structured facts from ONE RawArticle at a time — the caller (the demo
 * orchestrator / eventually Story Merge's event trigger) only invokes this
 * for a Story's "initial" or "new_info" contributions, never for pure
 * corroboration (docs/architecture/09-architecture-review.md §7
 * extraction-cap rule): that's what keeps this agent's LLM-call volume
 * Story-scoped rather than RawArticle-scoped.
 */
export async function runFactVerificationAgent(
  deps: {
    db: Database;
    logger: Logger;
    recordAgentRun: RecordAgentRun;
    llmClient?: LlmClient;
  },
  input: FactVerificationInput,
): Promise<FactVerificationResult> {
  return runWithTelemetry(
    deps,
    {
      agentName: "fact-verification",
      triggerEvent: "story/merge.completed",
      correlationId: input.correlationId,
      storyId: input.storyId,
    },
    async ({ log, recordCost }) => {
      const text = `${input.rawArticle.titleOriginal} ${input.rawArticle.bodyOriginal}`;
      const promptInjectionSuspected = detectPromptInjection(text);

      let extracted: ExtractedFact[];
      let extractionMethod: "llm" | "rule_based_fallback";

      if (deps.llmClient) {
        const llmResult = await extractFactsWithLlm(deps.llmClient, text, recordCost);
        if (llmResult === null) {
          log.warn(
            { rawArticleId: input.rawArticle.id },
            "LLM extraction returned unparseable output — falling back to rule-based extraction",
          );
          extracted = extractQuickFacts(text);
          extractionMethod = "rule_based_fallback";
        } else {
          extracted = llmResult;
          extractionMethod = "llm";
        }
      } else {
        log.info(
          { rawArticleId: input.rawArticle.id },
          "ANTHROPIC_API_KEY not configured — using rule-based fallback extraction (docs/adr/0007-mvp-llm-fallback-mode.md)",
        );
        extracted = extractQuickFacts(text);
        extractionMethod = "rule_based_fallback";
      }

      const existingFacts: ExistingFactRow[] = await deps.db
        .select({
          id: schema.facts.id,
          factType: schema.facts.factType,
          payload: schema.facts.payload,
        })
        .from(schema.facts)
        .where(eq(schema.facts.storyId, input.storyId));

      for (const fact of extracted) {
        const action = decideFactMergeAction(fact, existingFacts);
        if (action.kind === "insert") {
          await deps.db.insert(schema.facts).values({
            storyId: input.storyId,
            rawArticleId: input.rawArticle.id,
            factType: fact.factType,
            payload: fact.payload,
          });
        } else if (action.kind === "corroborate") {
          await deps.db
            .update(schema.facts)
            .set({ corroborationCount: sql`${schema.facts.corroborationCount} + 1` })
            .where(eq(schema.facts.id, action.existingFactId));
        } else {
          await deps.db.insert(schema.facts).values({
            storyId: input.storyId,
            rawArticleId: input.rawArticle.id,
            factType: fact.factType,
            payload: fact.payload,
            isContradicted: true,
          });
          await deps.db
            .update(schema.facts)
            .set({ isContradicted: true })
            .where(eq(schema.facts.id, action.existingFactId));
          log.warn(
            { storyId: input.storyId, factType: fact.factType },
            "contradiction detected against an existing fact",
          );
        }
      }

      const allFacts = await deps.db
        .select({ isContradicted: schema.facts.isContradicted })
        .from(schema.facts)
        .where(eq(schema.facts.storyId, input.storyId));
      const contradictionCount = allFacts.filter((f) => f.isContradicted).length;
      const hasContradiction = contradictionCount > 0;

      const riskLevel = classifyRisk(text, promptInjectionSuspected);

      const contributors = await getContributingSources(deps.db, input.storyId);
      const story = await deps.db.query.stories.findFirst({
        where: eq(schema.stories.id, input.storyId),
      });
      const confidenceScore = computeConfidenceScore({
        independentSourceCount: contributors.length,
        reliabilityTiers: contributors.map((c) => c.reliabilityTier),
        contradictionCount,
        isDeveloping: story?.isDeveloping ?? true,
      });

      await deps.db
        .update(schema.stories)
        .set({
          confidenceScore: confidenceScore.toFixed(3),
          riskLevel,
          status: "fact_checked",
          lastUpdatedAt: new Date(),
        })
        .where(eq(schema.stories.id, input.storyId));

      log.info(
        { storyId: input.storyId, confidenceScore, riskLevel, hasContradiction, extractionMethod },
        "fact verification complete",
      );

      return {
        confidenceScore,
        riskLevel,
        hasContradiction,
        promptInjectionSuspected,
        extractionMethod,
      };
    },
  );
}

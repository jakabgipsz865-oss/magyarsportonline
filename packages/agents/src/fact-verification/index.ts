import type {
  FactRepository,
  RawArticleRepository,
  SourceRepository,
  StoryCredibilityHistoryRepository,
  StoryRepository,
  StorySourceRepository,
} from "@magyarsportonline/db";
import { createEventEnvelope, type SportsNewsEvent } from "@magyarsportonline/events";
import type { LlmClient } from "@magyarsportonline/llm";
import type { Logger } from "@magyarsportonline/observability";
import type { SourceReliabilityTier } from "@magyarsportonline/shared";
import type { AgentRunRecorder } from "../shared/with-agent-run";
import { withAgentRun } from "../shared/with-agent-run";
import { computeConfidenceScore } from "./confidence-score";
import { findContradictedFactIds } from "./contradiction-check";
import { extractFacts } from "./extraction";
import { recomputeCredibilityForStory } from "./recompute-credibility";
import { classifyRisk } from "./risk-classifier";

export * from "./claim-merge";
export * from "./confidence-score";
export * from "./contradiction-check";
export * from "./credibility-score";
export * from "./extraction";
export * from "./recompute-credibility";
export * from "./risk-classifier";

export const AGENT_VERSION = "fact-verification@0.1.0";

/**
 * Full LLM extraction runs only for the first N sources per Story
 * (docs/architecture/02-agents.md §2.4 review addendum — the single biggest
 * LLM-cost lever). Any RawArticle beyond this limit is not processed by
 * this MVP slice at all — the "cheap non-LLM fingerprint corroboration"
 * fallback for the overflow is Fázis 6 follow-up work.
 */
export const EXTRACTION_LIMIT = 3;

export interface Emitter {
  emit(event: unknown): Promise<void>;
}

export interface FactVerificationDeps {
  storyRepository: Pick<
    StoryRepository,
    "getById" | "updateFactVerificationResult" | "updateCredibilityResult"
  >;
  rawArticleRepository: Pick<RawArticleRepository, "listByStoryId">;
  sourceRepository: Pick<SourceRepository, "getById">;
  factRepository: Pick<
    FactRepository,
    | "insertMany"
    | "markContradicted"
    | "bumpCorroboration"
    | "listByStoryId"
    | "listByStoryIdWithSourceName"
  >;
  storySourceRepository: Pick<StorySourceRepository, "sourcesWithMetaByStoryId">;
  storyCredibilityHistoryRepository: Pick<StoryCredibilityHistoryRepository, "insert">;
  llm: LlmClient;
  agentRunRepository: AgentRunRecorder;
  dispatcher: Emitter;
  logger: Logger;
}

type FactVerificationTrigger =
  | Extract<SportsNewsEvent, { type: "story/created" }>
  | Extract<SportsNewsEvent, { type: "story/merge.completed" }>;

/**
 * Fact Verification Agent (docs/architecture/02-agents.md §2.4). Extracts
 * structured Facts from up to `EXTRACTION_LIMIT` sources, runs a
 * same-fact-type contradiction check, computes the Confidence Score
 * (confidence-score.ts) and risk level (risk-classifier.ts), then emits
 * `story/facts.verified`. Never passes raw source text downstream — the
 * Hungarian Writer Agent only ever sees the `Fact` rows this agent writes.
 */
export async function handleFactVerificationTrigger(
  deps: FactVerificationDeps,
  event: FactVerificationTrigger,
): Promise<void> {
  await withAgentRun(
    {
      agentRunRepository: deps.agentRunRepository,
      agentName: "fact-verification",
      correlationId: event.correlation_id,
      triggerEvent: event.type,
      storyId: event.payload.story_id,
    },
    async () => {
      const story = await deps.storyRepository.getById(event.payload.story_id);
      if (!story) {
        throw new Error(`Story "${event.payload.story_id}" not found`);
      }

      const rawArticles = await deps.rawArticleRepository.listByStoryId(story.id);
      const sortedArticles = [...rawArticles].sort(
        (a, b) => a.ingestedAt.getTime() - b.ingestedAt.getTime(),
      );
      const articlesToExtract = sortedArticles.slice(0, EXTRACTION_LIMIT);

      const newFacts = [];
      for (const article of articlesToExtract) {
        const extracted = await extractFacts(deps.llm, article);
        for (const fact of extracted) {
          newFacts.push({
            storyId: story.id,
            rawArticleId: article.id,
            factType: fact.factType,
            payload: {
              detail_hu: fact.detailHu,
              quote_original: fact.quoteOriginal,
              quote_speaker: fact.quoteSpeaker,
            },
          });
        }
      }
      const savedFacts = await deps.factRepository.insertMany(newFacts);

      const contradictedIds = findContradictedFactIds(savedFacts);
      for (const factId of contradictedIds) {
        await deps.factRepository.markContradicted(factId);
      }
      const hasContradiction = contradictedIds.length > 0;

      const combinedText = sortedArticles
        .map((article) => `${article.titleOriginal}\n${article.bodyOriginal}`)
        .join("\n\n");
      const uniqueSourceIds = [...new Set(sortedArticles.map((article) => article.sourceId))];
      const risk = classifyRisk({ text: combinedText, sourceCount: uniqueSourceIds.length });

      const reliabilityTiers: SourceReliabilityTier[] = [];
      for (const sourceId of uniqueSourceIds) {
        const source = await deps.sourceRepository.getById(sourceId);
        if (source) {
          reliabilityTiers.push(source.reliabilityTier);
        }
      }

      const confidenceScore = computeConfidenceScore({
        sourceCount: uniqueSourceIds.length,
        reliabilityTiers,
        hasContradiction,
        isDeveloping: story.isDeveloping,
      });

      await deps.storyRepository.updateFactVerificationResult(story.id, {
        confidenceScore,
        riskLevel: risk.riskLevel,
        isDeveloping: story.isDeveloping,
      });

      // Hitelességi mutató v1 (2026-07-28) — a story_sources linkeket a
      // Story Merge Agent már létrehozta ezt megelőzően a pipeline-ban, így
      // a most beszúrt Fact-ok forrás-eredete már megtalálható. Ugyanezt a
      // függvényt hívja az admin "Újraszámolás" is (recompute-credibility.ts).
      const credibilityResult = await recomputeCredibilityForStory(
        {
          factRepository: deps.factRepository,
          storySourceRepository: deps.storySourceRepository,
          storyRepository: deps.storyRepository,
          storyCredibilityHistoryRepository: deps.storyCredibilityHistoryRepository,
        },
        story.id,
      );

      await deps.dispatcher.emit({
        ...createEventEnvelope({ correlationId: event.correlation_id }),
        type: "story/facts.verified",
        payload: {
          story_id: story.id,
          confidence_score: confidenceScore,
          risk_level: risk.riskLevel,
          has_contradiction: hasContradiction,
          prompt_injection_suspected: risk.promptInjectionSuspected,
        },
      });

      deps.logger.info(
        {
          correlationId: event.correlation_id,
          storyId: story.id,
          confidenceScore,
          riskLevel: risk.riskLevel,
          credibilityScore: credibilityResult.score,
          credibilityBand: credibilityResult.band,
        },
        "fact verification completed",
      );
    },
  );
}

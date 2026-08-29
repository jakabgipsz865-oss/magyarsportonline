import type {
  EditorialKnowledgeRepository,
  FactRepository,
  StoryRepository,
  StoryVersionRepository,
} from "@magyarsportonline/db";
import { createEventEnvelope, type SportsNewsEvent } from "@magyarsportonline/events";
import {
  MODEL_TIERS,
  NoLlmClient,
  NO_LLM_MODEL_LABEL,
  type LlmClient,
} from "@magyarsportonline/llm";
import type { Logger } from "@magyarsportonline/observability";
import { toWriterFact } from "./facts";
import {
  generateStoryVersion,
  regenerateWithQualityFix,
  type PreviousVersionContent,
} from "./generation";
import { assessContentQuality } from "./quality-gate";
import { selfCheckContent } from "./self-check";
import type { AgentRunRecorder } from "../shared/with-agent-run";
import { withAgentRun } from "../shared/with-agent-run";

export * from "./facts";
export * from "./generation";
export * from "./quality-gate";
export * from "./self-check";

export const AGENT_VERSION = "hungarian-writer@0.3.0";

const FALLBACK_UPDATE_SUMMARY = "Frissítés az új információk alapján.";

export interface Emitter {
  emit(event: unknown): Promise<void>;
}

export interface HungarianWriterDeps {
  storyRepository: Pick<StoryRepository, "getById">;
  storyVersionRepository: Pick<StoryVersionRepository, "getLatest" | "createNextVersion">;
  factRepository: Pick<FactRepository, "listByStoryId">;
  editorialKnowledgeRepository: Pick<EditorialKnowledgeRepository, "findRelevant">;
  llm: LlmClient;
  agentRunRepository: AgentRunRecorder;
  dispatcher: Emitter;
  logger: Logger;
}

type Trigger = Extract<SportsNewsEvent, { type: "story/facts.verified" }>;

/**
 * Hungarian Writer Agent (docs/architecture/02-agents.md §2.5). Generates
 * from the Fact set only (never raw source text — see facts.ts), then
 * re-verifies its own output against the same Fact set (self-check.ts).
 * An inconsistent draft is persisted with its low score for auditability,
 * but is never blindly regenerated: the Publish Gate blocks it. This avoids
 * spending two more Cloudflare calls on a result that still requires review.
 */
export async function handleStoryFactsVerified(
  deps: HungarianWriterDeps,
  event: Trigger,
): Promise<void> {
  await withAgentRun(
    {
      agentRunRepository: deps.agentRunRepository,
      agentName: "hungarian-writer",
      correlationId: event.correlation_id,
      triggerEvent: event.type,
      storyId: event.payload.story_id,
    },
    async () => {
      const story = await deps.storyRepository.getById(event.payload.story_id);
      if (!story) {
        throw new Error(`Story "${event.payload.story_id}" not found`);
      }

      const facts = (await deps.factRepository.listByStoryId(story.id)).map(toWriterFact);
      const previousVersionRow = await deps.storyVersionRepository.getLatest(story.id);
      const previousVersion: PreviousVersionContent | null = previousVersionRow
        ? {
            titleHu: previousVersionRow.titleHu,
            leadHu: previousVersionRow.leadHu,
            bodyHu: previousVersionRow.bodyHu,
          }
        : null;
      const knowledgeContext = facts
        .flatMap((fact) => [fact.detailHu, fact.quoteOriginal])
        .filter((value): value is string => Boolean(value))
        .join("\n");
      const contexts = new Set(["sports_news", "article", "headline", "match_report"]);
      if (facts.some((fact) => fact.factType === "injury_status")) contexts.add("injury_update");
      if (facts.some((fact) => fact.factType === "transfer_status")) contexts.add("transfer_news");
      if (facts.some((fact) => fact.factType === "quote")) contexts.add("quote");
      const knowledge = await deps.editorialKnowledgeRepository.findRelevant({
        sport: "football",
        sourceLanguage: "en",
        targetLanguage: "hu",
        contexts: [...contexts],
        contextText: knowledgeContext,
        limit: 20,
      });

      let generated = await generateStoryVersion(deps.llm, {
        facts,
        previousVersion,
        knowledge,
      });
      let check = await selfCheckContent(deps.llm, { facts, ...generated });

      if (!check.consistent) {
        deps.logger.warn(
          { correlationId: event.correlation_id, storyId: story.id, issues: check.issues },
          "self-check flagged the draft as inconsistent; persisting it for fail-closed review",
        );
      }

      // Content Quality Gate (Content Quality & Reliability Hardening
      // sprint): catches empty/still-English/source-verbatim fields that a
      // schema-valid, non-fallback response can still have (e.g. Fact
      // Verification's own No-LLM fallback silently poisoning `detail_hu`
      // with English passthrough text — see no-llm-client.ts
      // `extractionFallback`). Only worth retrying when the draft is real —
      // a No-LLM passthrough has nothing to "fix".
      let quality = assessContentQuality({
        titleHu: generated.titleHu,
        leadHu: generated.leadHu,
        bodyHu: generated.bodyHu,
        facts,
      });
      if (!quality.passed && !generated.isFallback && !(deps.llm instanceof NoLlmClient)) {
        deps.logger.warn(
          { correlationId: event.correlation_id, storyId: story.id, issues: quality.issues },
          "content quality gate failed, attempting one targeted fix-up call",
        );
        generated = await regenerateWithQualityFix(deps.llm, {
          facts,
          previousVersion,
          knowledge,
          previousAttempt: {
            titleHu: generated.titleHu,
            leadHu: generated.leadHu,
            bodyHu: generated.bodyHu,
          },
          issues: quality.issues,
        });
        check = await selfCheckContent(deps.llm, { facts, ...generated });
        quality = assessContentQuality({
          titleHu: generated.titleHu,
          leadHu: generated.leadHu,
          bodyHu: generated.bodyHu,
          facts,
        });
      }

      const changeSummaryHu = previousVersion
        ? (generated.changeSummaryHu ?? FALLBACK_UPDATE_SUMMARY)
        : null;

      // Labeling check — NoLlmClient answers the exact same completeJson
      // calls above, so nothing upstream of this line branches on which
      // adapter is in play (see no-llm-client.ts's module comment). A plain
      // `instanceof NoLlmClient` check on `deps.llm` is not enough on its
      // own: a wrapping decorator (BudgetGuardedLlmClient,
      // ProviderFallbackLlmClient) is never itself a NoLlmClient instance
      // even when ITS OWN fallback branch served this exact content — so we
      // also check the per-call `isFallback` flag (client.ts's
      // `LlmUsage.isFallback`, threaded through generation.ts) on the call
      // that actually produced this version's title/lead/body. Deliberately
      // NOT gated on the self-check step's own fallback status — self-check
      // only validates the already-real generated content, it doesn't
      // produce it, so its fallback status must never flip real AI content
      // to "not AI-generated".
      const isAiGenerated = !(deps.llm instanceof NoLlmClient) && !generated.isFallback;

      // A production kliens a tényleges Cloudflare modellt jelzi; a logikai
      // writer tier csak teszt/local kliensekhez marad tartalék.
      const version = await deps.storyVersionRepository.createNextVersion(story.id, {
        titleHu: generated.titleHu,
        leadHu: generated.leadHu,
        bodyHu: generated.bodyHu,
        changeSummaryHu,
        generatedByModel: isAiGenerated
          ? (deps.llm.modelLabel ?? MODEL_TIERS.writing)
          : NO_LLM_MODEL_LABEL,
        isAiGenerated,
        promptVersion: AGENT_VERSION,
        factConsistencyScore: check.factConsistencyScore,
        selfCheckFallback: check.isFallback,
        qualityIssues: quality.issues,
      });

      await deps.dispatcher.emit({
        ...createEventEnvelope({ correlationId: event.correlation_id }),
        type: "story/content.drafted",
        payload: {
          story_id: story.id,
          story_version_id: version.id,
          fact_consistency_score: check.factConsistencyScore,
        },
      });

      deps.logger.info(
        { correlationId: event.correlation_id, storyId: story.id, versionId: version.id },
        "hungarian writer completed",
      );
    },
  );
}

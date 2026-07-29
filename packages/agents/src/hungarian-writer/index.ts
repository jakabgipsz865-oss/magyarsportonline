import type {
  EditorialCorrectionApplicationRepository,
  EditorialCorrectionRepository,
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
import { evaluateCorrectionApplication } from "../shared/correction-effectiveness";
import type { EditorialCorrection } from "../shared/editorial-corrections";
import type { AgentRunRecorder } from "../shared/with-agent-run";
import { withAgentRun } from "../shared/with-agent-run";

/** A modell hány legfrissebb szerkesztői javítást lásson híváskánt — lásd editorial-corrections.ts blokk-limitjeit (10), ennél bőven adunk neki keresési alapanyagot. */
const LEARNED_CORRECTIONS_LIMIT = 50;

export * from "./facts";
export * from "./generation";
export * from "./quality-gate";
export * from "./self-check";

export const AGENT_VERSION = "hungarian-writer@0.1.0";

/** One regenerate attempt if the self-check flags the first draft as inconsistent (docs/architecture/02-agents.md §2.5: "max 2 retry"). */
export const MAX_SELF_CHECK_ATTEMPTS = 2;

const FALLBACK_UPDATE_SUMMARY = "Frissítés az új információk alapján.";

export interface Emitter {
  emit(event: unknown): Promise<void>;
}

export interface HungarianWriterDeps {
  storyRepository: Pick<StoryRepository, "getById">;
  storyVersionRepository: Pick<StoryVersionRepository, "getLatest" | "createNextVersion">;
  factRepository: Pick<FactRepository, "listByStoryId">;
  editorialCorrectionRepository: Pick<EditorialCorrectionRepository, "listRecent">;
  editorialCorrectionApplicationRepository: Pick<
    EditorialCorrectionApplicationRepository,
    "create"
  >;
  llm: LlmClient;
  agentRunRepository: AgentRunRecorder;
  dispatcher: Emitter;
  logger: Logger;
}

type Trigger = Extract<SportsNewsEvent, { type: "story/facts.verified" }>;

/**
 * Hungarian Writer Agent (docs/architecture/02-agents.md §2.5). Generates
 * from the Fact set only (never raw source text — see facts.ts), then
 * re-verifies its own output against the same Fact set (self-check.ts),
 * regenerating once if the first draft is flagged inconsistent. Always
 * creates a `StoryVersion`, even after the retry budget is exhausted — the
 * confidence gate on whether that version auto-publishes is the Publish
 * Gate's job (docs/architecture/02-agents.md §2.7), not this agent's.
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
      const learnedCorrections: EditorialCorrection[] = await deps.editorialCorrectionRepository
        .listRecent(LEARNED_CORRECTIONS_LIMIT)
        .then((rows) =>
          rows.map((row) => ({
            id: row.id,
            category: row.category,
            termEn: row.termEn,
            originalSentenceEn: row.originalSentenceEn,
            currentSentenceHu: row.currentSentenceHu,
            correctedSentenceHu: row.correctedSentenceHu,
            note: row.note,
          })),
        );

      let generated = await generateStoryVersion(deps.llm, {
        facts,
        previousVersion,
        learnedCorrections,
      });
      let check = await selfCheckContent(deps.llm, { facts, ...generated });

      for (let attempt = 1; attempt < MAX_SELF_CHECK_ATTEMPTS && !check.consistent; attempt++) {
        deps.logger.warn(
          { correlationId: event.correlation_id, storyId: story.id, issues: check.issues },
          "self-check flagged the draft as inconsistent, regenerating",
        );
        generated = await generateStoryVersion(deps.llm, {
          facts,
          previousVersion,
          learnedCorrections,
        });
        check = await selfCheckContent(deps.llm, { facts, ...generated });
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
          learnedCorrections,
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

      // "Mérhető szerkesztői memória" (2026-07-28 sprint): csak valódi AI
      // generálás után mérünk — egy No-LLM/fallback passthrough nem tükrözi
      // a modell tanulását, mérése csak zajt vinne a naplóba.
      if (isAiGenerated && learnedCorrections.length > 0) {
        const generatedText = `${generated.titleHu}\n${generated.leadHu}\n${generated.bodyHu}`;
        const sourceText = facts
          .map((fact) => fact.quoteOriginal)
          .filter((quote): quote is string => Boolean(quote))
          .join("\n");
        for (const correction of learnedCorrections) {
          const result = evaluateCorrectionApplication(correction, generatedText, sourceText);
          if (result) {
            await deps.editorialCorrectionApplicationRepository.create({
              correctionId: correction.id,
              storyId: story.id,
              stage: "hungarian_writer",
              verdict: result.verdict,
              evidence: result.evidence,
            });
          }
        }
      }

      // `deps.llm.modelLabel` — ha a kliens (pl. GeminiLlmClient) a
      // ténylegesen hívott modellt jelzi, azt használjuk a DB-rekordban;
      // ennek hiányában (pl. AnthropicLlmClient) MODEL_TIERS.writing marad
      // a helyes érték, változatlan viselkedéssel.
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

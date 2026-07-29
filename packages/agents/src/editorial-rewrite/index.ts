import type {
  EditorialCorrectionApplicationRepository,
  EditorialCorrectionRepository,
  FactRepository,
  StoryRepository,
  StoryVersionRepository,
} from "@magyarsportonline/db";
import { createEventEnvelope, type SportsNewsEvent } from "@magyarsportonline/events";
import { NoLlmClient, type LlmClient } from "@magyarsportonline/llm";
import type { Logger } from "@magyarsportonline/observability";
import { toWriterFact } from "../hungarian-writer/facts";
import { assessContentQuality } from "../hungarian-writer/quality-gate";
import { selfCheckContent } from "../hungarian-writer/self-check";
import { evaluateCorrectionApplication } from "../shared/correction-effectiveness";
import type { EditorialCorrection } from "../shared/editorial-corrections";
import type { AgentRunRecorder } from "../shared/with-agent-run";
import { withAgentRun } from "../shared/with-agent-run";
import { rewriteForStyle } from "./rewrite";

/** A modell hány legfrissebb szerkesztői javítást lásson híváskánt — lásd editorial-corrections.ts blokk-limitjeit (10), ennél bőven adunk neki keresési alapanyagot. */
const LEARNED_CORRECTIONS_LIMIT = 50;

export * from "./ab-test";
export * from "./readability";
export * from "./rewrite";
export * from "./style-guide";

export const AGENT_VERSION = "editorial-rewrite@0.1.0";

export interface Emitter {
  emit(event: unknown): Promise<void>;
}

export interface EditorialRewriteDeps {
  storyRepository: Pick<StoryRepository, "getById">;
  storyVersionRepository: Pick<StoryVersionRepository, "getById" | "updateDraftContent">;
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

type Trigger = Extract<SportsNewsEvent, { type: "story/content.drafted" }>;

/**
 * Editorial Rewrite Agent (docs/editorial-style-guide.md): sits between the
 * Hungarian Writer and SEO agents. Takes the Writer's already fact-checked
 * title/lead/body and asks for a stylistic-only pass toward how a real
 * Hungarian sports portal actually writes — the Writer's own prompt already
 * asks for natural Hungarian, but has no concept of *this specific outlet's*
 * house style, and mixing "get the facts right" with "make it read like
 * Nemzeti Sport" in one call makes both harder to get right.
 *
 * Never trusts the rewrite blindly: it re-runs the Hungarian Writer's own
 * fact-consistency self-check against the *rewritten* text before accepting
 * it. Any doubt (inconsistent, or a fallback/no-LLM identity passthrough)
 * means the original Writer content ships unchanged — this agent can only
 * ever make wording better, never risk correctness for it.
 */
export async function handleStoryContentDrafted(
  deps: EditorialRewriteDeps,
  event: Trigger,
): Promise<void> {
  await withAgentRun(
    {
      agentRunRepository: deps.agentRunRepository,
      agentName: "editorial-rewrite",
      correlationId: event.correlation_id,
      triggerEvent: event.type,
      storyId: event.payload.story_id,
    },
    async () => {
      const story = await deps.storyRepository.getById(event.payload.story_id);
      if (!story) {
        throw new Error(`Story "${event.payload.story_id}" not found`);
      }

      const version = await deps.storyVersionRepository.getById(event.payload.story_version_id);
      if (!version) {
        throw new Error(`StoryVersion "${event.payload.story_version_id}" not found`);
      }

      let editorialRewriteApplied = false;

      if (version.isPublished) {
        // Shouldn't happen at this pipeline stage (Publish Gate runs after
        // SEO, which runs after this agent) — defensive guard only, so a
        // stray re-emission of content.drafted can never rewrite published
        // history (story-version-repository.ts updateDraftContent's own
        // WHERE guard would refuse it anyway; this just avoids the wasted
        // LLM call).
        deps.logger.warn(
          { correlationId: event.correlation_id, storyId: story.id, versionId: version.id },
          "editorial rewrite: version already published, skipping",
        );
      } else {
        const facts = (await deps.factRepository.listByStoryId(story.id)).map(toWriterFact);
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
        const rewritten = await rewriteForStyle(deps.llm, {
          facts,
          titleHu: version.titleHu,
          leadHu: version.leadHu,
          bodyHu: version.bodyHu,
          learnedCorrections,
        });

        if (rewritten.isFallback || deps.llm instanceof NoLlmClient) {
          deps.logger.info(
            { correlationId: event.correlation_id, storyId: story.id },
            "editorial rewrite: no LLM available, keeping original wording",
          );
        } else {
          const check = await selfCheckContent(deps.llm, { facts, ...rewritten });
          if (check.consistent) {
            const quality = assessContentQuality({
              titleHu: rewritten.titleHu,
              leadHu: rewritten.leadHu,
              bodyHu: rewritten.bodyHu,
              facts,
            });
            if (!quality.passed) {
              deps.logger.warn(
                {
                  correlationId: event.correlation_id,
                  storyId: story.id,
                  versionId: version.id,
                  issues: quality.issues,
                },
                "editorial rewrite: rewritten text failed the quality gate, keeping original wording",
              );
            } else {
              const updated = await deps.storyVersionRepository.updateDraftContent(version.id, {
                titleHu: rewritten.titleHu,
                leadHu: rewritten.leadHu,
                bodyHu: rewritten.bodyHu,
                editorialRewriteApplied: true,
                qualityIssues: quality.issues,
              });
              editorialRewriteApplied = updated;
              if (!updated) {
                deps.logger.warn(
                  {
                    correlationId: event.correlation_id,
                    storyId: story.id,
                    versionId: version.id,
                  },
                  "editorial rewrite: version was published before the rewrite could be saved, discarding it",
                );
              } else if (learnedCorrections.length > 0) {
                // "Mérhető szerkesztői memória" (2026-07-28 sprint): csak akkor
                // mérünk, ha az átírás ténylegesen megtörtént és el is mentődött
                // — egy elutasított vagy fallback-átírás nem tükrözi a modell
                // tanulását.
                const generatedText = `${rewritten.titleHu}\n${rewritten.leadHu}\n${rewritten.bodyHu}`;
                const englishQuotes = facts
                  .map((fact) => fact.quoteOriginal)
                  .filter((quote): quote is string => Boolean(quote))
                  .join("\n");
                const sourceText = `${englishQuotes}\n${version.titleHu}\n${version.leadHu}\n${version.bodyHu}`;
                for (const correction of learnedCorrections) {
                  const result = evaluateCorrectionApplication(
                    correction,
                    generatedText,
                    sourceText,
                  );
                  if (result) {
                    await deps.editorialCorrectionApplicationRepository.create({
                      correctionId: correction.id,
                      storyId: story.id,
                      stage: "editorial_rewrite",
                      verdict: result.verdict,
                      evidence: result.evidence,
                    });
                  }
                }
              }
            }
          } else {
            deps.logger.warn(
              {
                correlationId: event.correlation_id,
                storyId: story.id,
                versionId: version.id,
                issues: check.issues,
              },
              "editorial rewrite: rewritten text failed the fact-consistency check, keeping original wording",
            );
          }
        }
      }

      await deps.dispatcher.emit({
        ...createEventEnvelope({ correlationId: event.correlation_id }),
        type: "story/editorial.rewritten",
        payload: {
          story_id: story.id,
          story_version_id: version.id,
          editorial_rewrite_applied: editorialRewriteApplied,
        },
      });

      deps.logger.info(
        { correlationId: event.correlation_id, storyId: story.id, editorialRewriteApplied },
        "editorial rewrite agent completed",
      );
    },
  );
}

import { MODEL_TIERS, type LlmClient } from "@magyarsportonline/llm";
import { z } from "zod";
import type { WriterFact } from "../hungarian-writer/facts";
import { selfCheckContent } from "../hungarian-writer/self-check";
import { computeReadability, type ReadabilityMetrics } from "./readability";
import { rewriteForStyle } from "./rewrite";

const JUDGE_JSON_SCHEMA = {
  type: "object",
  properties: {
    winner: { type: "string", enum: ["1", "2", "tie"] },
    score_1: { type: "number" },
    score_2: { type: "number" },
    rationale_hu: { type: "string" },
  },
  required: ["winner", "score_1", "score_2", "rationale_hu"],
  additionalProperties: false,
} as const;

const judgeResponseSchema = z.object({
  winner: z.enum(["1", "2", "tie"]),
  score_1: z.number().min(0).max(10),
  score_2: z.number().min(0).max(10),
  rationale_hu: z.string(),
});

const JUDGE_SYSTEM_PROMPT = `Magyar sportújság szerkesztője vagy. Két, egymástól függetlenül megfogalmazott verziót kapsz UGYANARRÓL a hírről (azonos tények, más megfogalmazás: "verzió 1" és "verzió 2"). Kizárólag OLVASHATÓSÁG és MAGYAR SPORTÚJSÁGÍRÓI STÍLUS szempontjából értékeld őket, NE a tényeket — mindkettő ugyanazokra a tényekre épül. Adj 0-10 pontot mindkettőre, mondd meg melyik olvasmányosabb ("winner": "1", "2" vagy "tie", ha nincs érdemi különbség), és röviden indokold magyarul.`;

export interface AbTestArticleContent {
  titleHu: string;
  leadHu: string;
  bodyHu: string;
}

export interface AbTestArticleInput extends AbTestArticleContent {
  storyId: string;
  facts: WriterFact[];
}

export interface JudgeVerdict {
  winner: "A" | "B" | "tie";
  scoreA: number;
  scoreB: number;
  rationaleHu: string;
}

export interface AbTestArticleResult {
  storyId: string;
  pipelineA: AbTestArticleContent & { readability: ReadabilityMetrics };
  pipelineB: AbTestArticleContent & {
    readability: ReadabilityMetrics;
    rewriteAccepted: boolean;
    rejectionReason: string[] | null;
  };
  judge: JudgeVerdict | null;
}

function fullText(content: AbTestArticleContent): string {
  return `${content.titleHu}\n\n${content.leadHu}\n\n${content.bodyHu}`;
}

/**
 * Runs one article through both the current pipeline (Pipeline A: the
 * already-published Hungarian Writer output, untouched) and the Editorial
 * Rewrite pipeline (Pipeline B: the same fact-checked safety net the real
 * agent uses — see editorial-rewrite/index.ts) and asks the configured LLM
 * to blind-judge which reads better. Order (1/2 vs A/B) is randomized per
 * call to dampen position bias; this function un-shuffles it before
 * returning so callers always see stable "A"/"B" labels.
 *
 * Read-only: never writes to the database. Callers decide what to do with
 * the result (the A/B test report, apps/web/app/api/internal/editorial-ab-test).
 */
export async function runAbComparison(
  llm: LlmClient,
  input: AbTestArticleInput,
): Promise<AbTestArticleResult> {
  const pipelineA: AbTestArticleContent = {
    titleHu: input.titleHu,
    leadHu: input.leadHu,
    bodyHu: input.bodyHu,
  };

  const rewritten = await rewriteForStyle(llm, {
    facts: input.facts,
    titleHu: input.titleHu,
    leadHu: input.leadHu,
    bodyHu: input.bodyHu,
  });
  const check = await selfCheckContent(llm, { facts: input.facts, ...rewritten });
  const rewriteAccepted = check.consistent && !rewritten.isFallback;

  const pipelineB: AbTestArticleContent = rewriteAccepted
    ? { titleHu: rewritten.titleHu, leadHu: rewritten.leadHu, bodyHu: rewritten.bodyHu }
    : pipelineA;

  let judge: JudgeVerdict | null = null;
  // Only worth judging if the two pipelines actually produced different
  // text — a rejected/fallback rewrite means B === A, nothing to compare.
  if (rewriteAccepted) {
    const aIsFirst = Math.random() < 0.5;
    const first = aIsFirst ? pipelineA : pipelineB;
    const second = aIsFirst ? pipelineB : pipelineA;

    const result = await llm.completeJson({
      model: MODEL_TIERS.selfCheck,
      system: JUDGE_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: JSON.stringify({ verzio_1: fullText(first), verzio_2: fullText(second) }),
        },
      ],
      maxTokens: 512,
      jsonSchema: JUDGE_JSON_SCHEMA,
    });
    const parsed = judgeResponseSchema.parse(result.data);

    const winner: JudgeVerdict["winner"] =
      parsed.winner === "tie"
        ? "tie"
        : parsed.winner === "1"
          ? aIsFirst
            ? "A"
            : "B"
          : aIsFirst
            ? "B"
            : "A";
    judge = {
      winner,
      scoreA: aIsFirst ? parsed.score_1 : parsed.score_2,
      scoreB: aIsFirst ? parsed.score_2 : parsed.score_1,
      rationaleHu: parsed.rationale_hu,
    };
  }

  return {
    storyId: input.storyId,
    pipelineA: { ...pipelineA, readability: computeReadability(fullText(pipelineA)) },
    pipelineB: {
      ...pipelineB,
      readability: computeReadability(fullText(pipelineB)),
      rewriteAccepted,
      rejectionReason: rewriteAccepted ? null : check.issues,
    },
    judge,
  };
}

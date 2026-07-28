import type {
  JsonCompletionRequest,
  JsonCompletionResult,
  LlmClient,
  TextCompletionRequest,
  TextCompletionResult,
} from "@magyarsportonline/llm";
import { MODEL_TIERS } from "@magyarsportonline/llm";
import { z } from "zod";
import type { WriterFact } from "../hungarian-writer/facts";
import { selfCheckContent } from "../hungarian-writer/self-check";
import { assessContentQuality, type QualityAssessment } from "../hungarian-writer/quality-gate";
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

/**
 * Thin per-comparison usage meter: wraps the real `LlmClient` so
 * `runAbComparison` can report real Cloudflare token consumption without
 * touching `rewriteForStyle`/`selfCheckContent`'s return shapes (those are
 * shared with the production Editorial Rewrite Agent — widening their
 * result types purely to serve this diagnostic tool isn't worth the churn
 * on already-tested, live code). NOT a Neuron counter: Cloudflare Workers
 * AI's chat-completions response only ever includes `prompt_tokens`/
 * `completion_tokens` (see packages/llm/src/cloudflare-client.ts) — Neuron
 * usage is an account-level Cloudflare dashboard metric this app has no API
 * call for, so it cannot be reported here.
 */
class UsageMeteringLlmClient implements LlmClient {
  inputTokens = 0;
  outputTokens = 0;
  calls = 0;

  constructor(private readonly inner: LlmClient) {}

  get modelLabel(): string | undefined {
    return this.inner.modelLabel;
  }

  async completeText(request: TextCompletionRequest): Promise<TextCompletionResult> {
    const result = await this.inner.completeText(request);
    this.record(result);
    return result;
  }

  async completeJson(request: JsonCompletionRequest): Promise<JsonCompletionResult> {
    const result = await this.inner.completeJson(request);
    this.record(result);
    return result;
  }

  private record(result: { inputTokens: number; outputTokens: number }): void {
    this.inputTokens += result.inputTokens;
    this.outputTokens += result.outputTokens;
    this.calls += 1;
  }
}

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

/** Why Pipeline B ended up identical to Pipeline A (no rewrite applied). */
export type RejectionKind = "fact_check_failed" | "fallback" | null;

export interface AbTestArticleResult {
  storyId: string;
  pipelineA: AbTestArticleContent & { readability: ReadabilityMetrics; quality: QualityAssessment };
  pipelineB: AbTestArticleContent & {
    readability: ReadabilityMetrics;
    quality: QualityAssessment;
    rewriteAccepted: boolean;
    rejectionKind: RejectionKind;
    rejectionReason: string[] | null;
  };
  judge: JudgeVerdict | null;
  /** Real Cloudflare token usage across every LLM call this comparison made (rewrite + self-check + judge, when run). Neuron consumption is NOT included — see UsageMeteringLlmClient's comment. */
  llmUsage: { inputTokens: number; outputTokens: number; calls: number };
  durationMs: number;
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
 * "Hallucination"/factual-deviation counting in this experiment is
 * necessarily one-directional: Pipeline A is the already-published,
 * ground-truth baseline (its own facts came from Fact Verification, not
 * from this tool), so what's actually being measured is whether the
 * *rewrite step itself* introduced a deviation from A's facts — that's
 * exactly `rejectionKind === "fact_check_failed"`.
 *
 * Read-only: never writes to the database. Callers decide what to do with
 * the result (the A/B test report, apps/web/app/api/internal/editorial-ab-test).
 */
export async function runAbComparison(
  llm: LlmClient,
  input: AbTestArticleInput,
): Promise<AbTestArticleResult> {
  const startedAt = Date.now();
  const metered = new UsageMeteringLlmClient(llm);

  const pipelineA: AbTestArticleContent = {
    titleHu: input.titleHu,
    leadHu: input.leadHu,
    bodyHu: input.bodyHu,
  };

  const rewritten = await rewriteForStyle(metered, {
    facts: input.facts,
    titleHu: input.titleHu,
    leadHu: input.leadHu,
    bodyHu: input.bodyHu,
  });
  const check = await selfCheckContent(metered, { facts: input.facts, ...rewritten });
  const rewriteAccepted = check.consistent && !rewritten.isFallback;
  const rejectionKind: RejectionKind = rewriteAccepted
    ? null
    : rewritten.isFallback
      ? "fallback"
      : "fact_check_failed";

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

    const result = await metered.completeJson({
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
    pipelineA: {
      ...pipelineA,
      readability: computeReadability(fullText(pipelineA)),
      quality: assessContentQuality({ ...pipelineA, facts: input.facts }),
    },
    pipelineB: {
      ...pipelineB,
      readability: computeReadability(fullText(pipelineB)),
      quality: assessContentQuality({ ...pipelineB, facts: input.facts }),
      rewriteAccepted,
      rejectionKind,
      rejectionReason: rewriteAccepted ? null : check.issues,
    },
    judge,
    llmUsage: {
      inputTokens: metered.inputTokens,
      outputTokens: metered.outputTokens,
      calls: metered.calls,
    },
    durationMs: Date.now() - startedAt,
  };
}

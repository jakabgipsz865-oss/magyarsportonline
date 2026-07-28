import type {
  JsonCompletionRequest,
  JsonCompletionResult,
  LlmClient,
} from "@magyarsportonline/llm";
import {
  MODEL_TIERS,
  estimateCloudflareCostUsd,
  estimateNeuronsFromCostUsd,
} from "@magyarsportonline/llm";
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

export interface CallUsage {
  inputTokens: number;
  outputTokens: number;
  /** Derived from the real token counts via Cloudflare's published Neuron price — NOT a value the API returns directly. See packages/llm/src/pricing.ts estimateNeuronsFromCostUsd. */
  estimatedNeurons: number;
  isFallback: boolean;
  /** e.g. "quota_exceeded" for an HTTP 429 — see ProviderFallbackLlmClient. Null when the call succeeded or when no describeError was configured. */
  fallbackReason: string | null;
}

/**
 * Captures exactly the one `completeJson`/`completeText` call it's used
 * for — `rewriteForStyle` and `selfCheckContent` each make exactly one, so
 * a fresh instance per call gives a clean per-call-type usage breakdown
 * (the diagnostic sprint's explicit ask: "rewrite, self-check és judge
 * fogyasztása külön") instead of one aggregate number.
 */
class CapturingLlmClient implements LlmClient {
  private lastResult: {
    inputTokens: number;
    outputTokens: number;
    isFallback?: boolean | undefined;
    fallbackReason?: string | undefined;
  } | null = null;

  constructor(private readonly inner: LlmClient) {}

  get modelLabel(): string | undefined {
    return this.inner.modelLabel;
  }

  async completeText(request: Parameters<LlmClient["completeText"]>[0]) {
    const result = await this.inner.completeText(request);
    this.lastResult = result;
    return result;
  }

  async completeJson(request: JsonCompletionRequest): Promise<JsonCompletionResult> {
    const result = await this.inner.completeJson(request);
    this.lastResult = result;
    return result;
  }

  toCallUsage(model: string | undefined): CallUsage {
    const inputTokens = this.lastResult?.inputTokens ?? 0;
    const outputTokens = this.lastResult?.outputTokens ?? 0;
    const costUsd = model ? estimateCloudflareCostUsd(model, inputTokens, outputTokens) : 0;
    return {
      inputTokens,
      outputTokens,
      estimatedNeurons: estimateNeuronsFromCostUsd(costUsd),
      isFallback: this.lastResult?.isFallback ?? false,
      fallbackReason: this.lastResult?.fallbackReason ?? null,
    };
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
  /** Per-call-type usage — the rewrite/self-check calls always run; judge only when the rewrite was accepted (see runAbComparison's comment on why). */
  perCallUsage: {
    rewrite: CallUsage;
    selfCheck: CallUsage;
    judge: CallUsage | null;
  };
  /** Sum of rewrite + self-check + judge (when run) — convenience total matching perCallUsage. */
  totalUsage: { inputTokens: number; outputTokens: number; estimatedNeurons: number };
  durationMs: number;
}

function fullText(content: AbTestArticleContent): string {
  return `${content.titleHu}\n\n${content.leadHu}\n\n${content.bodyHu}`;
}

function sumUsage(calls: Array<CallUsage | null>): {
  inputTokens: number;
  outputTokens: number;
  estimatedNeurons: number;
} {
  return calls.reduce(
    (acc, call) => ({
      inputTokens: acc.inputTokens + (call?.inputTokens ?? 0),
      outputTokens: acc.outputTokens + (call?.outputTokens ?? 0),
      estimatedNeurons: acc.estimatedNeurons + (call?.estimatedNeurons ?? 0),
    }),
    { inputTokens: 0, outputTokens: 0, estimatedNeurons: 0 },
  );
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
  const model = llm.modelLabel;

  const pipelineA: AbTestArticleContent = {
    titleHu: input.titleHu,
    leadHu: input.leadHu,
    bodyHu: input.bodyHu,
  };

  const rewriteMeter = new CapturingLlmClient(llm);
  const rewritten = await rewriteForStyle(rewriteMeter, {
    facts: input.facts,
    titleHu: input.titleHu,
    leadHu: input.leadHu,
    bodyHu: input.bodyHu,
  });
  const rewriteCallUsage = rewriteMeter.toCallUsage(model);

  const selfCheckMeter = new CapturingLlmClient(llm);
  const check = await selfCheckContent(selfCheckMeter, { facts: input.facts, ...rewritten });
  const selfCheckCallUsage = selfCheckMeter.toCallUsage(model);

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
  let judgeCallUsage: CallUsage | null = null;
  // Only worth judging if the two pipelines actually produced different
  // text — a rejected/fallback rewrite means B === A, nothing to compare.
  if (rewriteAccepted) {
    const aIsFirst = Math.random() < 0.5;
    const first = aIsFirst ? pipelineA : pipelineB;
    const second = aIsFirst ? pipelineB : pipelineA;

    const judgeMeter = new CapturingLlmClient(llm);
    const result = await judgeMeter.completeJson({
      model: MODEL_TIERS.selfCheck,
      system: JUDGE_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: JSON.stringify({ verzio_1: fullText(first), verzio_2: fullText(second) }),
        },
      ],
      // 2048, matching rewriteForStyle's budget: comparing two full articles
      // is at least as reasoning-heavy as rewriting one, and Qwen3's hidden
      // reasoning tokens are drawn from this same budget. 512 was measured
      // (2026-07-28 A/B run) to fail with an empty/non-JSON response 100% of
      // the time — see cloudflare-client.ts's "parse_error" kind — while the
      // otherwise-identical self-check call (1024) and rewrite call (2048)
      // fail far less often, proportionally to their own budgets.
      maxTokens: 2048,
      jsonSchema: JUDGE_JSON_SCHEMA,
    });
    judgeCallUsage = judgeMeter.toCallUsage(model);
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
    perCallUsage: {
      rewrite: rewriteCallUsage,
      selfCheck: selfCheckCallUsage,
      judge: judgeCallUsage,
    },
    totalUsage: sumUsage([rewriteCallUsage, selfCheckCallUsage, judgeCallUsage]),
    durationMs: Date.now() - startedAt,
  };
}

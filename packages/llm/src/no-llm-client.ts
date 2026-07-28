import type {
  JsonCompletionRequest,
  JsonCompletionResult,
  LlmClient,
  TextCompletionRequest,
  TextCompletionResult,
} from "./client";

/** Recorded on `StoryVersion.generated_by_model` when this adapter answered, so it's visible in the DB without cross-referencing `LLM_PROVIDER`. */
export const NO_LLM_MODEL_LABEL = "no-llm-passthrough@1";

/** Exported so a one-off DB backfill (packages/db story-version-repository.ts `backfillMislabeledAiGenerated`) can tell a genuine No-LLM row apart from a mislabeled real-AI one without duplicating this string. */
export const NOT_AI_TRANSLATED_NOTICE =
  "Ez a tartalom még nem AI által lefordított vagy ellenőrzött szöveg — az eredeti, angol nyelvű forrásanyag jelenik meg változatlanul.";

const UPDATE_CHANGE_SUMMARY =
  "Új forrásadat érkezett — a tartalom továbbra sem AI-fordítás, az eredeti forrásszöveg frissült.";

function hasSchemaProperty(schema: Record<string, unknown>, key: string): boolean {
  const properties = schema["properties"];
  return typeof properties === "object" && properties !== null && key in properties;
}

function parseSourceArticle(userContent: string): { titleOriginal: string; bodyOriginal: string } {
  const match = /<source_article>\nCím: ([\s\S]*?)\n\n([\s\S]*?)\n<\/source_article>/.exec(
    userContent,
  );
  if (!match) {
    return { titleOriginal: "Cím nélküli forrásanyag", bodyOriginal: userContent };
  }
  return { titleOriginal: match[1] ?? "", bodyOriginal: match[2] ?? "" };
}

interface ParsedGenerationPayload {
  facts: Array<{ detailHu: string }>;
  hasPreviousVersion: boolean;
}

interface ParsedEditorialRewritePayload {
  titleHu: string;
  leadHu: string;
  bodyHu: string;
}

function parseEditorialRewritePayload(userContent: string): ParsedEditorialRewritePayload {
  try {
    const parsed = JSON.parse(userContent) as {
      title_hu?: unknown;
      lead_hu?: unknown;
      body_hu?: unknown;
    };
    return {
      titleHu: typeof parsed.title_hu === "string" ? parsed.title_hu : "",
      leadHu: typeof parsed.lead_hu === "string" ? parsed.lead_hu : "",
      bodyHu: typeof parsed.body_hu === "string" ? parsed.body_hu : "",
    };
  } catch {
    return { titleHu: "", leadHu: "", bodyHu: "" };
  }
}

function parseGenerationPayload(userContent: string): ParsedGenerationPayload {
  try {
    // Matches `WriterFact`'s camelCase shape (hungarian-writer/facts.ts) —
    // generation.ts JSON.stringifies `input.facts: WriterFact[]` directly,
    // it does not snake_case it first.
    const parsed = JSON.parse(userContent) as {
      facts?: Array<{ detailHu?: unknown }>;
      previousVersion?: unknown;
    };
    return {
      facts: (parsed.facts ?? []).map((fact) => ({
        detailHu: typeof fact.detailHu === "string" ? fact.detailHu : "",
      })),
      hasPreviousVersion: parsed.previousVersion !== null && parsed.previousVersion !== undefined,
    };
  } catch {
    return { facts: [], hasPreviousVersion: false };
  }
}

/**
 * Deterministic, no-network `LlmClient` adapter — the default when
 * `LLM_PROVIDER` is unset or `"none"` (apps/web/lib/llm.ts). Lets the full
 * pipeline run end to end against a real database with zero LLM cost:
 * instead of an AI-generated Hungarian summary it passes the original
 * RSS title/description straight through, explicitly labeled as
 * unprocessed rather than silently pretending to be a translation.
 * Switching to a real provider later is a one-variable config change
 * (`LLM_PROVIDER=anthropic`), never a code change here or in the agents.
 *
 * Responds by inspecting each call's own JSON Schema shape (which of the
 * three known agent call sites this is) instead of holding state across
 * calls — this is what lets the Fact Verification and Hungarian Writer
 * agents stay 100% unaware of which adapter answered; see hungarian-writer/index.ts
 * for the one place that *does* check `instanceof NoLlmClient`, purely to
 * label the resulting StoryVersion, never to change its own logic.
 */
export class NoLlmClient implements LlmClient {
  async completeText(request: TextCompletionRequest): Promise<TextCompletionResult> {
    const lastMessage = request.messages[request.messages.length - 1];
    return { text: lastMessage?.content ?? "", inputTokens: 0, outputTokens: 0 };
  }

  async completeJson(request: JsonCompletionRequest): Promise<JsonCompletionResult> {
    const userContent = request.messages[request.messages.length - 1]?.content ?? "";

    if (hasSchemaProperty(request.jsonSchema, "facts")) {
      return this.extractionFallback(userContent);
    }
    if (hasSchemaProperty(request.jsonSchema, "title_hu")) {
      return this.generationFallback(userContent);
    }
    if (hasSchemaProperty(request.jsonSchema, "consistent")) {
      return this.selfCheckFallback();
    }
    if (hasSchemaProperty(request.jsonSchema, "rewritten_title_hu")) {
      return this.editorialRewriteFallback(userContent);
    }
    if (hasSchemaProperty(request.jsonSchema, "winner")) {
      return this.judgeFallback();
    }
    throw new Error(
      "NoLlmClient: unrecognized JSON schema shape — no deterministic fallback defined for this call site",
    );
  }

  private extractionFallback(userContent: string): JsonCompletionResult {
    const article = parseSourceArticle(userContent);
    return {
      data: {
        facts: [
          {
            fact_type: "other",
            detail_hu: `${article.titleOriginal}\n\n${article.bodyOriginal}`,
            quote_original: null,
            quote_speaker: null,
          },
        ],
      },
      inputTokens: 0,
      outputTokens: 0,
    };
  }

  private generationFallback(userContent: string): JsonCompletionResult {
    const { facts, hasPreviousVersion } = parseGenerationPayload(userContent);
    const [primary, ...rest] = facts;
    const [titlePart, ...bodyParts] = (primary?.detailHu ?? "").split("\n\n");
    const title = titlePart?.trim() || "Cím nélküli forrásanyag";
    const primaryBody = bodyParts.join("\n\n").trim();
    const additionalBodies = rest
      .map((fact) => fact.detailHu.split("\n\n").slice(1).join("\n\n").trim())
      .filter((body) => body.length > 0);
    const body = [primaryBody, ...additionalBodies].filter((part) => part.length > 0).join("\n\n");

    return {
      data: {
        title_hu: title,
        lead_hu: NOT_AI_TRANSLATED_NOTICE,
        body_hu: body || NOT_AI_TRANSLATED_NOTICE,
        change_summary_hu: hasPreviousVersion ? UPDATE_CHANGE_SUMMARY : null,
      },
      inputTokens: 0,
      outputTokens: 0,
    };
  }

  private selfCheckFallback(): JsonCompletionResult {
    return {
      data: { consistent: true, fact_consistency_score: 1, issues: [] },
      inputTokens: 0,
      outputTokens: 0,
    };
  }

  /**
   * Editorial Rewrite Agent's fallback: an identity passthrough. With no
   * real LLM available there is no safe way to "polish" phrasing, so the
   * correct deterministic behaviour is to echo the Hungarian Writer Agent's
   * title/lead/body back unchanged rather than guessing — the agent reads
   * this as "no rewrite happened" (see editorialRewriteApplied labeling).
   */
  private editorialRewriteFallback(userContent: string): JsonCompletionResult {
    const { titleHu, leadHu, bodyHu } = parseEditorialRewritePayload(userContent);
    return {
      data: { rewritten_title_hu: titleHu, rewritten_lead_hu: leadHu, rewritten_body_hu: bodyHu },
      inputTokens: 0,
      outputTokens: 0,
    };
  }

  /**
   * The editorial A/B test tool's blind judge call (packages/agents/src/
   * editorial-rewrite/ab-test.ts) has no production call site — it only
   * ever runs through this same production `llm` client during the
   * experiment. Without this branch, a judge call that itself falls back
   * (a single transient Cloudflare hiccup, independent of the rewrite call
   * succeeding) crashed the whole per-article comparison instead of
   * degrading gracefully like the other four call sites. A neutral "tie"
   * is the only honest answer with no real model behind it.
   */
  private judgeFallback(): JsonCompletionResult {
    return {
      data: {
        winner: "tie",
        score_1: 5,
        score_2: 5,
        rationale_hu: "Nincs valódi LLM-válasz (fallback) — olvashatóság nem értékelhető.",
      },
      inputTokens: 0,
      outputTokens: 0,
    };
  }
}

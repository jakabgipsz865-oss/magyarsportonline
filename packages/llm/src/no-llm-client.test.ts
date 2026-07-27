import { describe, expect, it } from "vitest";
import { NO_LLM_MODEL_LABEL, NoLlmClient } from "./no-llm-client";

const EXTRACTION_SCHEMA = {
  type: "object",
  properties: { facts: { type: "array" } },
  required: ["facts"],
  additionalProperties: false,
};

const GENERATION_SCHEMA = {
  type: "object",
  properties: {
    title_hu: { type: "string" },
    lead_hu: { type: "string" },
    body_hu: { type: "string" },
    change_summary_hu: { type: ["string", "null"] },
  },
  required: ["title_hu", "lead_hu", "body_hu", "change_summary_hu"],
  additionalProperties: false,
};

const SELF_CHECK_SCHEMA = {
  type: "object",
  properties: {
    consistent: { type: "boolean" },
    fact_consistency_score: { type: "number" },
    issues: { type: "array" },
  },
  required: ["consistent", "fact_consistency_score", "issues"],
  additionalProperties: false,
};

describe("NoLlmClient", () => {
  it("exposes a stable model label for StoryVersion.generated_by_model", () => {
    expect(NO_LLM_MODEL_LABEL).toBe("no-llm-passthrough@1");
  });

  it("extracts a single passthrough fact from the raw source article, verbatim", async () => {
    const client = new NoLlmClient();
    const result = await client.completeJson({
      model: "m",
      system: "s",
      maxTokens: 10,
      jsonSchema: EXTRACTION_SCHEMA,
      messages: [
        {
          role: "user",
          content:
            "<source_article>\nCím: Liverpool wins 3-1\n\nA late goal sealed it.\n</source_article>",
        },
      ],
    });

    expect(result.data).toEqual({
      facts: [
        {
          fact_type: "other",
          detail_hu: "Liverpool wins 3-1\n\nA late goal sealed it.",
          quote_original: null,
          quote_speaker: null,
        },
      ],
    });
  });

  it("writes the original title/body straight through with an explicit not-yet-AI-translated lead", async () => {
    const client = new NoLlmClient();
    // generation.ts JSON.stringifies WriterFact[] as-is (facts.ts) — camelCase,
    // not the extraction step's snake_case wire format.
    const result = await client.completeJson({
      model: "m",
      system: "s",
      maxTokens: 10,
      jsonSchema: GENERATION_SCHEMA,
      messages: [
        {
          role: "user",
          content: JSON.stringify({
            facts: [
              {
                factType: "other",
                detailHu: "Liverpool wins 3-1\n\nA late goal sealed it.",
                quoteOriginal: null,
                quoteSpeaker: null,
              },
            ],
            previousVersion: null,
          }),
        },
      ],
    });

    expect(result.data).toMatchObject({
      title_hu: "Liverpool wins 3-1",
      body_hu: "A late goal sealed it.",
      change_summary_hu: null,
    });
    expect((result.data as { lead_hu: string }).lead_hu).toContain("nem AI által lefordított");
  });

  it("sets a fixed update change-summary when a previous version exists", async () => {
    const client = new NoLlmClient();
    const result = await client.completeJson({
      model: "m",
      system: "s",
      maxTokens: 10,
      jsonSchema: GENERATION_SCHEMA,
      messages: [
        {
          role: "user",
          content: JSON.stringify({
            facts: [
              {
                factType: "other",
                detailHu: "Title\n\nBody",
                quoteOriginal: null,
                quoteSpeaker: null,
              },
            ],
            previousVersion: { titleHu: "Old", leadHu: "Old lead", bodyHu: "Old body" },
          }),
        },
      ],
    });

    expect((result.data as { change_summary_hu: string | null }).change_summary_hu).not.toBeNull();
  });

  it("combines multiple source facts into one body", async () => {
    const client = new NoLlmClient();
    const result = await client.completeJson({
      model: "m",
      system: "s",
      maxTokens: 10,
      jsonSchema: GENERATION_SCHEMA,
      messages: [
        {
          role: "user",
          content: JSON.stringify({
            facts: [
              { factType: "other", detailHu: "First title\n\nFirst body" },
              { factType: "other", detailHu: "Second title\n\nSecond body" },
            ],
            previousVersion: null,
          }),
        },
      ],
    });

    const body = (result.data as { body_hu: string }).body_hu;
    expect(body).toContain("First body");
    expect(body).toContain("Second body");
  });

  it("always reports the passthrough content as fact-consistent", async () => {
    const client = new NoLlmClient();
    const result = await client.completeJson({
      model: "m",
      system: "s",
      maxTokens: 10,
      jsonSchema: SELF_CHECK_SCHEMA,
      messages: [{ role: "user", content: "{}" }],
    });

    expect(result.data).toEqual({ consistent: true, fact_consistency_score: 1, issues: [] });
  });

  it("throws on an unrecognized JSON schema shape", async () => {
    const client = new NoLlmClient();
    await expect(
      client.completeJson({
        model: "m",
        system: "s",
        maxTokens: 10,
        jsonSchema: { type: "object", properties: { something_else: { type: "string" } } },
        messages: [{ role: "user", content: "{}" }],
      }),
    ).rejects.toThrow("no deterministic fallback");
  });

  it("completeText echoes the last message back (no current caller depends on this)", async () => {
    const client = new NoLlmClient();
    const result = await client.completeText({
      model: "m",
      system: "s",
      maxTokens: 10,
      messages: [{ role: "user", content: "hello" }],
    });
    expect(result.text).toBe("hello");
  });
});

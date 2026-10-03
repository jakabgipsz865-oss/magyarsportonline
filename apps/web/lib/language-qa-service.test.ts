import { describe, expect, it, vi } from "vitest";
import { languageQa, tabloid } from "@magyarsportonline/agents";
import { CloudflareApiError, type LlmClient } from "@magyarsportonline/llm";
import { sqliteD1 } from "./testing/sqlite-d1";
import { enqueueLanguageQa, sweepLanguageQa } from "./language-qa-store";
import { processLanguageQa } from "./language-qa-service";
vi.hoisted(() => {
  process.env["CRON_SECRET"] ??= "isolated-test-secret";
});
const now = new Date("2026-09-30T00:00:00Z"),
  policy = { enabled: true, dailyCalls: 300, dailyBudgetUsd: 0.5, now };
function fixture(body = "A Bayern győzelmet hozott a mérkőzésen.") {
  const { db, d1 } = sqliteD1([
    "0001_initial",
    "0002_qualified_read_trending",
    "0003_draft_recovery",
    "0004_language_qa",
  ]);
  const source = crypto.randomUUID(),
    story = crypto.randomUUID(),
    version = crypto.randomUUID(),
    raw = crypto.randomUUID();
  db.exec("BEGIN");
  db.prepare(
    `INSERT INTO sources(id,name,base_url,type,language,license_type,reliability_tier,fetch_config) VALUES(?,'Fixture','https://example.com','rss','en','public_rss','C','{}')`,
  ).run(source);
  db.prepare(
    `INSERT INTO stories(id,canonical_title,status,current_version_id,version_count,slug,published_at) VALUES(?,'Test','published',?,1,'fixture','2026-09-29T18:00:00Z')`,
  ).run(story, version);
  db.prepare(
    `INSERT INTO story_versions(id,story_id,version_number,title_hu,lead_hu,body_hu,generated_by_model,prompt_version,is_published) VALUES(?,?,1,'Hír a csapatról','A klub beszámolt az eseményről.',?,'gemini-3.5-flash-lite',?,1)`,
  ).run(version, story, body, tabloid.TABLOID_PROMPT);
  db.prepare(
    `INSERT INTO raw_articles(id,source_id,source_url,title_original,body_original,language,content_origin,story_id) VALUES(?,?,'https://example.com/fixture','Bayern won the match','Bayern won the match. Kane scored 2 goals.','en','full_article',?)`,
  ).run(raw, source, story);
  db.prepare(
    `INSERT INTO story_sources(id,story_id,raw_article_id,contribution_type) VALUES(?,?,?,'initial')`,
  ).run(crypto.randomUUID(), story, raw);
  db.exec("COMMIT");
  const requestFields = {
    title_hu: "Hír a csapatról",
    lead_hu: "A klub beszámolt az eseményről.",
    body_hu: body,
  };
  const sentence = languageQa.qaSentences(requestFields).at(-1)!;
  const response = {
    status: "REPAIR",
    issues: [
      {
        sentence_id: sentence.sentence_id,
        type: "UNNATURAL_HUNGARIAN",
        confidence: 0.99,
        original: body,
        replacement: "A Bayern győzött a mérkőzésen.",
        meaning_change_risk: false,
      },
    ],
  };
  const completeJson = vi.fn(async (_request: ReturnType<typeof languageQa.qaRequest>) => ({
    data: response,
    inputTokens: 100,
    outputTokens: 100,
    modelLabel: languageQa.LANGUAGE_QA_MODEL,
  }));
  const client = { completeJson, completeText: vi.fn() } as unknown as LlmClient;
  return { db, d1, story, version, raw, completeJson, client, response };
}
describe("durable bounded Language QA", () => {
  it("disabled means zero database work and zero client creation", async () => {
    const factory = vi.fn();
    const db = { prepare: vi.fn() } as never;
    expect(await processLanguageQa(db, { ...policy, enabled: false }, factory)).toEqual({
      processed: 0,
      disabled: true,
    });
    expect(factory).not.toHaveBeenCalled();
    expect((db as { prepare: ReturnType<typeof vi.fn> }).prepare).not.toHaveBeenCalled();
  });
  it("retries a malformed model audit as a technical error without changing the story", async () => {
    const f = fixture();
    try {
      f.completeJson.mockResolvedValueOnce({
        data: { status: "PASS", issues: [{ replacement: "unbounded" }] },
        inputTokens: 100,
        outputTokens: 100,
        modelLabel: languageQa.LANGUAGE_QA_MODEL,
      });
      await enqueueLanguageQa(f.d1, f.story, f.version, now);
      expect((await processLanguageQa(f.d1, policy, () => f.client)).status).toBe(
        "technical_error",
      );
      expect(f.db.prepare("SELECT status,reason FROM language_qa_audits").get()).toEqual({
        status: "technical_error",
        reason:
          "invalid_model_schema:issues.0.sentence_id:invalid_type,issues.0.type:invalid_type,issues.0.confidence:invalid_type",
      });
      expect(f.db.prepare("SELECT current_version_id FROM stories").get()).toEqual({
        current_version_id: f.version,
      });
      expect(f.db.prepare("SELECT status FROM llm_usage").get()).toEqual({ status: "success" });
    } finally {
      f.db.close();
    }
  });
  it("publishes a guarded new version once, retains chronology, and audits the resulting version without another call", async () => {
    const f = fixture();
    try {
      await enqueueLanguageQa(f.d1, f.story, f.version, now);
      await enqueueLanguageQa(f.d1, f.story, f.version, now);
      f.db.prepare("UPDATE language_qa_audits SET model='@cf/openai/gpt-oss-120b'").run();
      const r = await processLanguageQa(f.d1, policy, () => f.client);
      expect(r.status).toBe("repaired");
      expect((await processLanguageQa(f.d1, policy, () => f.client)).processed).toBe(0);
      expect(await sweepLanguageQa(f.d1, now)).toBe(0);
      expect(f.completeJson).toHaveBeenCalledOnce();
      expect(JSON.parse(f.completeJson.mock.calls[0]![0].messages[0]!.content).source).toEqual({
        language: "en",
        title_original: "Bayern won the match",
        body_original: "Bayern won the match. Kane scored 2 goals.",
      });
      expect(f.db.prepare("SELECT count(*) n FROM story_versions").get()).toEqual({ n: 2 });
      expect(
        f.db.prepare("SELECT model FROM language_qa_audits WHERE version_id=?").get(f.version),
      ).toEqual({
        model: languageQa.LANGUAGE_QA_MODEL,
      });
      expect(f.db.prepare("SELECT published_at FROM stories").get()).toEqual({
        published_at: "2026-09-29T18:00:00Z",
      });
      expect(f.db.prepare("SELECT role,provider,status FROM llm_usage").get()).toEqual({
        role: "language_qa",
        provider: "cloudflare",
        status: "success",
      });
      expect(f.db.prepare("SELECT count(*) n FROM social_posts").get()).toEqual({ n: 0 });
      expect(f.db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      f.db.close();
    }
  });
  it("processes a new published story before the older backlog, one audit per invocation", async () => {
    const f = fixture();
    try {
      await enqueueLanguageQa(f.d1, f.story, f.version, new Date("2026-09-29T19:00:00Z"));
      const freshStory = crypto.randomUUID(),
        freshVersion = crypto.randomUUID();
      f.db.exec("BEGIN");
      f.db
        .prepare(
          `INSERT INTO stories(id,canonical_title,status,current_version_id,version_count,slug,published_at)
        VALUES(?,'Fresh','published',?,1,'fresh','2026-09-30T00:00:00Z')`,
        )
        .run(freshStory, freshVersion);
      f.db
        .prepare(
          `INSERT INTO story_versions(id,story_id,version_number,title_hu,lead_hu,body_hu,generated_by_model,prompt_version,is_published)
        SELECT ?,?,1,title_hu,lead_hu,body_hu,generated_by_model,prompt_version,1 FROM story_versions WHERE id=?`,
        )
        .run(freshVersion, freshStory, f.version);
      f.db
        .prepare(
          `INSERT INTO story_sources(id,story_id,raw_article_id,contribution_type)
        VALUES(?,?,?,'initial')`,
        )
        .run(crypto.randomUUID(), freshStory, f.raw);
      f.db.exec("COMMIT");
      await enqueueLanguageQa(f.d1, freshStory, freshVersion, now);
      const first = await processLanguageQa(
        f.d1,
        {
          ...policy,
          priorityAfter: new Date("2026-09-29T20:00:00Z"),
        },
        () => f.client,
      );
      expect(first.processed).toBe(1);
      expect(f.completeJson.mock.calls[0]![0].usageContext.storyId).toBe(freshStory);
      expect(
        f.db.prepare("SELECT status FROM language_qa_audits WHERE story_id=?").get(f.story),
      ).toEqual({ status: "queued" });
    } finally {
      f.db.close();
    }
  });
  it("daily call limit is reserved atomically before creating a client", async () => {
    const f = fixture();
    try {
      await enqueueLanguageQa(f.d1, f.story, f.version, now);
      f.db
        .prepare(
          `INSERT INTO llm_usage(id,model,input_tokens,output_tokens,cost_usd,role,status,occurred_at) VALUES(?,'test',0,0,'0','language_qa','reserved',?)`,
        )
        .run(crypto.randomUUID(), now.toISOString());
      const factory = vi.fn(() => f.client);
      expect((await processLanguageQa(f.d1, { ...policy, dailyCalls: 1 }, factory)).deferred).toBe(
        true,
      );
      expect(factory).not.toHaveBeenCalled();
    } finally {
      f.db.close();
    }
  });
  it("a daily cost cap denies the call including reserved worst-case cost", async () => {
    const f = fixture();
    try {
      await enqueueLanguageQa(f.d1, f.story, f.version, now);
      const factory = vi.fn(() => f.client);
      expect(
        (await processLanguageQa(f.d1, { ...policy, dailyBudgetUsd: 0.000001 }, factory)).deferred,
      ).toBe(true);
      expect(factory).not.toHaveBeenCalled();
    } finally {
      f.db.close();
    }
  });
  it("concurrent workers spend exactly one call per version", async () => {
    const f = fixture();
    try {
      await enqueueLanguageQa(f.d1, f.story, f.version, now);
      await Promise.all([
        processLanguageQa(f.d1, policy, () => f.client),
        processLanguageQa(f.d1, policy, () => f.client),
      ]);
      expect(f.completeJson).toHaveBeenCalledOnce();
    } finally {
      f.db.close();
    }
  });
  it("rejects a number change and retains the live version and read model", async () => {
    const f = fixture("Kane 2 gólt szerzett.");
    try {
      f.response.issues[0]!.replacement = "Kane 3 gólt szerzett.";
      await enqueueLanguageQa(f.d1, f.story, f.version, now);
      expect((await processLanguageQa(f.d1, policy, () => f.client)).status).toBe(
        "repair_rejected",
      );
      expect(f.db.prepare("SELECT current_version_id FROM stories").get()).toEqual({
        current_version_id: f.version,
      });
      expect(f.db.prepare("SELECT count(*) n FROM story_versions").get()).toEqual({ n: 1 });
    } finally {
      f.db.close();
    }
  });
  it("does not overwrite a version changed while the provider was running", async () => {
    const f = fixture();
    try {
      f.completeJson.mockImplementationOnce(async () => {
        f.db.prepare("UPDATE story_versions SET body_hu='Új szöveg.' WHERE id=?").run(f.version);
        return {
          data: f.response,
          inputTokens: 100,
          outputTokens: 100,
          modelLabel: languageQa.LANGUAGE_QA_MODEL,
        };
      });
      await enqueueLanguageQa(f.d1, f.story, f.version, now);
      expect((await processLanguageQa(f.d1, policy, () => f.client)).status).toBe(
        "repair_rejected",
      );
      expect(f.db.prepare("SELECT current_version_id FROM stories").get()).toEqual({
        current_version_id: f.version,
      });
    } finally {
      f.db.close();
    }
  });
  it("technical failure retains the public story and retries only after 30 minutes", async () => {
    const f = fixture();
    try {
      f.completeJson.mockRejectedValue(new Error("provider failure"));
      await enqueueLanguageQa(f.d1, f.story, f.version, now);
      expect((await processLanguageQa(f.d1, policy, () => f.client)).status).toBe(
        "technical_error",
      );
      expect((await processLanguageQa(f.d1, policy, () => f.client)).processed).toBe(0);
      expect(f.completeJson).toHaveBeenCalledOnce();
      expect(f.db.prepare("SELECT status,current_version_id FROM stories").get()).toEqual({
        status: "published",
        current_version_id: f.version,
      });
      expect(f.db.prepare("SELECT status FROM llm_usage").get()).toEqual({ status: "error" });
    } finally {
      f.db.close();
    }
  });
  it("records only a safe provider error code, never a credential-bearing error message", async () => {
    const f = fixture();
    try {
      f.completeJson.mockRejectedValue(
        new CloudflareApiError("http", 400, "secret must not persist"),
      );
      await enqueueLanguageQa(f.d1, f.story, f.version, now);
      await processLanguageQa(f.d1, policy, () => f.client);
      expect(f.db.prepare("SELECT reason FROM language_qa_audits").get()).toEqual({
        reason: "cloudflare_http_400",
      });
      expect(f.db.prepare("SELECT error_code FROM llm_usage").get()).toEqual({
        error_code: "cloudflare_http_400",
      });
    } finally {
      f.db.close();
    }
  });
  it("distinguishes a bounded provider timeout from another network failure", async () => {
    const f = fixture();
    try {
      f.completeJson.mockRejectedValue(
        new CloudflareApiError(
          "network",
          0,
          "Cloudflare Workers AI request timed out after 20000 ms",
        ),
      );
      await enqueueLanguageQa(f.d1, f.story, f.version, now);
      await processLanguageQa(f.d1, policy, () => f.client);
      expect(f.db.prepare("SELECT reason FROM language_qa_audits").get()).toEqual({
        reason: "cloudflare_timeout_20000",
      });
    } finally {
      f.db.close();
    }
  });
  it("records only the parse shape and never the model's article text", async () => {
    const f = fixture();
    try {
      f.completeJson.mockRejectedValue(
        new CloudflareApiError("parse_error", 0, "output_shape:reasoning"),
      );
      await enqueueLanguageQa(f.d1, f.story, f.version, now);
      await processLanguageQa(f.d1, policy, () => f.client);
      expect(f.db.prepare("SELECT reason FROM language_qa_audits").get()).toEqual({
        reason: "cloudflare_parse_reasoning",
      });
    } finally {
      f.db.close();
    }
  });
  it("detects modified content under an existing version ID during the safety sweep", async () => {
    const f = fixture();
    try {
      await enqueueLanguageQa(f.d1, f.story, f.version, now);
      f.db.prepare("UPDATE story_versions SET body_hu='Másik szöveg.' WHERE id=?").run(f.version);
      expect(await sweepLanguageQa(f.d1, now)).toBe(1);
      expect(f.db.prepare("SELECT count(*) n FROM language_qa_audits").get()).toEqual({ n: 2 });
    } finally {
      f.db.close();
    }
  });
});

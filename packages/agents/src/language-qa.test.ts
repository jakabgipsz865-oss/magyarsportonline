import { describe, expect, it } from "vitest";
import {
  applyLanguageQa,
  qaRequest,
  qaSentences,
  languageQaSchema,
  type ArticleFields,
} from "./language-qa";
const fields = (body_hu: string): ArticleFields => ({
  title_hu: "Hír a csapatról",
  lead_hu: "A klub beszámolt az eseményről.",
  body_hu,
});
function response(
  article: ArticleFields,
  replacement: string,
  extra: Record<string, unknown> = {},
) {
  const sentence = qaSentences(article).at(-1)!;
  return {
    status: "REPAIR",
    issues: [
      {
        sentence_id: sentence.sentence_id,
        type: "UNNATURAL_HUNGARIAN",
        confidence: 0.99,
        original: sentence.text,
        replacement,
        meaning_change_risk: false,
        ...extra,
      },
    ],
  };
}
describe("autonomous sentence Language QA guards", () => {
  it("passes the original source language and full source text to the QA request", () => {
    const source = {
      language: "de",
      title_original: "Ein Titel",
      body_original: "Der vollständige Quelltext.",
    };
    const request = qaRequest(fields("A csapat nyert."), "story-1", source);
    expect(JSON.parse(request.messages[0]!.content).source).toEqual(source);
    expect(request.system).toContain("forrásnyelvi mondatszerkezetet");
    expect(request.system).toContain("TELJES mondatát másold be betű szerint");
    expect(request.system).toContain("legalább 0.97 bizonyosságú");
    expect(request.system).toContain("grandiózus teljesítményt");
    expect(request.system).toContain("S1, S2");
    expect(request.jsonSchema.properties.issues.items.properties.sentence_id.pattern).toBe(
      "^S[0-9]{1,3}$",
    );
    expect(
      languageQaSchema.safeParse(
        response(fields("A csapat nyert."), "A csapat nyert.", { type: "AWKWARD_COMPOUND" }),
      ).success,
    ).toBe(true);
    expect(
      languageQaSchema.safeParse(
        response(fields("A csapat nyert."), "A csapat nyert.", {
          type: "SOURCE_LANGUAGE_STRUCTURE",
        }),
      ).success,
    ).toBe(true);
  });
  it("accepts bounded PASS only", () => {
    expect(
      applyLanguageQa(
        fields("A csapat nyert."),
        { status: "PASS", issues: [] },
        { text: "The team won.", language: "en" },
      ).status,
    ).toBe("pass");
    expect(languageQaSchema.safeParse({ status: "PASS", issues: [{}] }).success).toBe(false);
  });
  it.each([
    "Bayern won the match.",
    "Bayern gewann das Spiel.",
    "Bayern ganó el partido.",
    "Bayern vinto la partita.",
  ])("repairs a proven foreign sentence %s", (original) => {
    const a = fields(original);
    expect(
      applyLanguageQa(a, response(a, "A Bayern megnyerte a mérkőzést."), {
        text: original,
        language: "en",
      }).status,
    ).toBe("repaired");
  });
  it("repairs unnatural Hungarian without touching any other field", () => {
    const a = fields("A Bayern győzelmet hozott a mérkőzésen.");
    const r = applyLanguageQa(a, response(a, "A Bayern győzött a mérkőzésen."), {
      text: "Bayern won the match.",
      language: "en",
    });
    expect(r.status).toBe("repaired");
    expect(r.article.title_hu).toBe(a.title_hu);
    expect(r.article.lead_hu).toBe(a.lead_hu);
  });
  it("permits a bounded, meaning-preserving Hungarian word choice", () => {
    const a = fields("A kapus grandiózus teljesítményt nyújtott.");
    const result = applyLanguageQa(a, response(a, "A kapus remek teljesítményt nyújtott."), {
      text: "The goalkeeper produced a great performance.",
      language: "en",
    });
    expect(result.status).toBe("repaired");
  });
  it.each([
    ["Kane 2 gólt szerzett.", "Kane 3 gólt szerzett.", {}, "numbers_changed"],
    ["Kane nyert a mérkőzésen.", "Messi nyert a mérkőzésen.", {}, "proper_names_changed"],
    [
      "A Bayern győzött.",
      "A Bayern győzött.",
      { meaning_change_risk: true },
      "confidence_or_meaning_risk",
    ],
    ["A Bayern győzött.", "A Bayern győzött.", { confidence: 0.9 }, "confidence_or_meaning_risk"],
    ["A Bayern nem győzött.", "A Bayern győzött.", {}, "unproven_semantic_change"],
    ["A Bayern győzött.", "A Bayern csalással győzött.", {}, "unproven_semantic_change"],
    ["A Bayern győzött.", "A Bayern kikapott.", {}, "unproven_semantic_change"],
    ["A Bayern ma játszott.", "A Bayern tegnap játszott.", {}, "unproven_semantic_change"],
    ["A kapus megtartotta a labdát.", "A kapus eldobta a labdát.", {}, "unproven_semantic_change"],
    ["Kane azt mondta: „Nyertünk”.", "Kane azt mondta: „Vesztettünk”.", {}, "quote_changed"],
  ])("rejects unsafe replacement %s", (original, replacement, extra, reason) => {
    const a = fields(original as string);
    const result = applyLanguageQa(
      a,
      response(a, replacement as string, extra as Record<string, unknown>),
      { text: original as string, language: "hu" },
    );
    expect(result.status).toBe("repair_rejected");
    expect(result.reason).toBe(reason);
    expect(result.article).toEqual(a);
  });
  it("rejects stale/duplicate and multiple-sentence replacements", () => {
    const a = fields("A Bayern győzött.");
    expect(
      applyLanguageQa(a, response(a, "A Bayern győzött. A Bayern nyert."), {
        text: a.body_hu,
        language: "hu",
      }).status,
    ).toBe("repair_rejected");
    expect(
      applyLanguageQa({ ...a, lead_hu: a.body_hu }, response(a, a.body_hu), {
        text: a.body_hu,
        language: "hu",
      }).status,
    ).toBe("repair_rejected");
    expect(
      applyLanguageQa(a, response(a, a.body_hu, { original: "Old sentence" }), {
        text: a.body_hu,
        language: "hu",
      }).status,
    ).toBe("repair_rejected");
  });
  it("reruns the whole numeric gate even when the proposed sentence itself is safe", () => {
    const a = {
      ...fields("A Bayern győzelmet hozott a mérkőzésen."),
      lead_hu: "Kane 999 gólt szerzett.",
    };
    expect(
      applyLanguageQa(a, response(a, "A Bayern győzött a mérkőzésen."), {
        text: "Bayern won the match. Kane scored 2 goals.",
        language: "en",
      }).reason,
    ).toContain("deterministic_quality_gate:number_integrity");
  });
  it("bounds provider input before a model call", () => {
    expect(() => qaSentences(fields("x".repeat(24001)))).toThrow("too_large");
  });
});

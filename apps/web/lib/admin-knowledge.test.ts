import { beforeAll, describe, expect, it, vi } from "vitest";

type KnowledgeModule = typeof import("./admin-knowledge");
let knowledge: KnowledgeModule;

beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", "postgresql://user:password@localhost:5432/mso_test");
  vi.stubEnv("CRON_SECRET", "test-secret");
  vi.stubEnv("LLM_PROVIDER", "none");
  knowledge = await import("./admin-knowledge");
});

describe("admin knowledge package", () => {
  it("accepts an intact versioned package", () => {
    const knowledgePackage = makePackage();
    expect(knowledge.parseAdminKnowledgePackage(JSON.stringify(knowledgePackage))).toEqual(
      knowledgePackage,
    );
  });

  it("rejects content changed after export", () => {
    const knowledgePackage = makePackage();
    knowledgePackage.content.editorialCorrections[0]!.correctedSentenceHu = "Módosított érték";
    expect(() => knowledge.parseAdminKnowledgePackage(JSON.stringify(knowledgePackage))).toThrow(
      /tartalmi kulcsa hibás|integritás-ellenőrzése sikertelen/,
    );
  });

  it("rejects duplicate semantic keys", () => {
    const knowledgePackage = makePackage();
    knowledgePackage.content.editorialCorrections.push({
      ...knowledgePackage.content.editorialCorrections[0]!,
    });
    knowledgePackage.metadata.counts.editorialCorrections = 2;
    knowledgePackage.integrity.contentDigest = knowledge.digestValue(knowledgePackage.content);
    expect(() => knowledge.parseAdminKnowledgePackage(JSON.stringify(knowledgePackage))).toThrow(
      /Duplikált hordozható kulcs/,
    );
  });
});

function makePackage(): ReturnType<KnowledgeModule["parseAdminKnowledgePackage"]> {
  const staticWithoutDigest = {
    footballLexicon: [],
    editorialStyleGuide: "Teszt szerkesztői szabály",
    publicationRules: {
      confidenceThreshold: 0.65,
      factExtractionSourceLimit: 3,
      hardGates: ["Nincs fallback publikálás."],
    },
    credibilityRules: ["Ellentmondás esetén levonás."],
  };
  const correctionWithoutKey = {
    category: "fact" as const,
    termEn: "clean sheet",
    originalSentenceEn: "He kept a clean sheet.",
    currentSentenceHu: "Tiszta lapot tartott.",
    correctedSentenceHu: "Nem kapott gólt.",
    note: "Természetes magyar futballnyelv.",
  };
  const content = {
    staticKnowledge: {
      digest: knowledge.digestValue(staticWithoutDigest),
      ...staticWithoutDigest,
    },
    editorialCorrections: [
      {
        key: knowledge.digestValue(correctionWithoutKey),
        ...correctionWithoutKey,
        learnedAt: "2026-07-30T10:00:00.000Z",
      },
    ],
    derivedEditorialKnowledge: {
      learnedFootballLexicon: [],
      forbiddenLiteralTranslations: [],
      recommendedPhrasings: [],
    },
    sources: [],
    reviewLearningPatterns: [],
  };
  return {
    format: knowledge.KNOWLEDGE_FORMAT,
    schemaVersion: knowledge.KNOWLEDGE_SCHEMA_VERSION,
    metadata: {
      exportedAt: "2026-07-30T10:00:00.000Z",
      applicationCommit: "test-commit",
      environment: "test",
      counts: {
        staticLexiconEntries: 0,
        editorialCorrections: 1,
        learnedLexiconEntries: 0,
        forbiddenTranslations: 0,
        recommendedPhrasings: 0,
        sources: 0,
        reviewLearningPatterns: 0,
      },
    },
    content,
    security: {
      secretsIncluded: false,
      redactedPaths: [],
      importDeletesData: false,
    },
    integrity: {
      algorithm: "sha256",
      contentDigest: knowledge.digestValue(content),
    },
  };
}

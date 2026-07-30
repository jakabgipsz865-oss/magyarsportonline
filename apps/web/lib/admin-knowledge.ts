import { createHash } from "node:crypto";
import {
  editorialCorrections as editorialKnowledge,
  editorialRewrite,
  factVerification,
  footballLexicon,
  publishGate,
} from "@magyarsportonline/agents";
import {
  KNOWLEDGE_REDACTION_MARKER,
  normalizePortableSourceIdentity,
  type KnowledgeImportCounts,
  type KnowledgeImportInput,
  type PortableReviewPatternInput,
} from "@magyarsportonline/db";
import { z } from "zod";
import { createRepositories } from "./db";

export const KNOWLEDGE_FORMAT = "magyarsportonline.admin-knowledge";
export const KNOWLEDGE_SCHEMA_VERSION = 1;
export const MAX_KNOWLEDGE_IMPORT_BYTES = 10 * 1024 * 1024;

const hexDigestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const nullableShortText = z.string().max(20_000).nullable();
type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    z.string(),
    z.array(jsonValueSchema),
    z.record(jsonValueSchema),
  ]),
);

const correctionSchema = z.object({
  key: hexDigestSchema,
  category: z.enum(["slang", "terminology", "literal_translation", "style", "grammar", "fact"]),
  termEn: z.string().max(2_000).nullable(),
  originalSentenceEn: z.string().min(1).max(20_000),
  currentSentenceHu: z.string().min(1).max(20_000),
  correctedSentenceHu: z.string().min(1).max(20_000),
  note: nullableShortText,
  learnedAt: z.string().datetime(),
});

const sourceSchema = z.object({
  key: hexDigestSchema,
  name: z.string().min(1).max(1_000),
  baseUrl: z.string().url().max(4_000),
  type: z.enum(["rss", "api", "scraper", "html", "social_embed"]),
  language: z.string().min(1).max(40),
  licenseType: z.enum(["public_rss", "licensed_api", "scrape_allowed", "pending_review"]),
  reliabilityTier: z.enum(["A", "B", "C"]),
  fetchConfig: jsonValueSchema,
  isActive: z.boolean(),
  country: z.string().max(10).nullable(),
  leagueTags: jsonValueSchema,
  category: z
    .enum(["official", "league", "club", "trusted_media", "tabloid", "social", "data_api"])
    .nullable(),
  contentMode: z.enum(["full_text", "fact_only", "discovery_only"]).nullable(),
  trustBaseline: z.number().int().min(0).max(100).nullable(),
  robotsStatus: nullableShortText,
  termsStatus: nullableShortText,
  attributionRule: nullableShortText,
  imagePolicy: jsonValueSchema,
  pollingFrequencyMinutes: z.number().int().positive().max(525_600).nullable(),
  extractorName: z.string().max(1_000).nullable(),
});

const reviewPatternSchema = z.object({
  key: hexDigestSchema,
  kind: z.string().min(1).max(100),
  payload: jsonValueSchema,
  learnedAt: z.string().datetime(),
});

const lexiconEntrySchema = z.object({
  category: z.string(),
  en: z.string(),
  meaningHu: z.string(),
  naturalHu: z.string(),
  avoidLiteralHu: z.string(),
  exampleEn: z.string(),
  exampleHu: z.string(),
});

const staticKnowledgeSchema = z.object({
  digest: hexDigestSchema,
  footballLexicon: z.array(lexiconEntrySchema),
  editorialStyleGuide: z.string(),
  publicationRules: z.object({
    confidenceThreshold: z.number(),
    factExtractionSourceLimit: z.number().int(),
    hardGates: z.array(z.string()),
  }),
  credibilityRules: z.array(z.string()),
});

const knowledgeContentSchema = z.object({
  staticKnowledge: staticKnowledgeSchema,
  editorialCorrections: z.array(correctionSchema).max(100_000),
  derivedEditorialKnowledge: z.object({
    learnedFootballLexicon: z.array(lexiconEntrySchema).max(100_000),
    forbiddenLiteralTranslations: z
      .array(
        z.object({
          avoidHu: z.string(),
          useInsteadHu: z.string(),
          contextEn: z.string(),
        }),
      )
      .max(100_000),
    recommendedPhrasings: z
      .array(z.object({ beforeHu: z.string(), afterHu: z.string() }))
      .max(100_000),
  }),
  sources: z.array(sourceSchema).max(10_000),
  reviewLearningPatterns: z.array(reviewPatternSchema).max(100_000),
});

export const knowledgePackageSchema = z
  .object({
    format: z.literal(KNOWLEDGE_FORMAT),
    schemaVersion: z.literal(KNOWLEDGE_SCHEMA_VERSION),
    metadata: z.object({
      exportedAt: z.string().datetime(),
      applicationCommit: z.string().min(1).max(200),
      environment: z.string().min(1).max(100),
      counts: z.object({
        staticLexiconEntries: z.number().int().nonnegative(),
        editorialCorrections: z.number().int().nonnegative(),
        learnedLexiconEntries: z.number().int().nonnegative(),
        forbiddenTranslations: z.number().int().nonnegative(),
        recommendedPhrasings: z.number().int().nonnegative(),
        sources: z.number().int().nonnegative(),
        reviewLearningPatterns: z.number().int().nonnegative(),
      }),
    }),
    content: knowledgeContentSchema,
    security: z.object({
      secretsIncluded: z.literal(false),
      redactedPaths: z.array(z.string().max(2_000)).max(100_000),
      importDeletesData: z.literal(false),
    }),
    integrity: z.object({
      algorithm: z.literal("sha256"),
      contentDigest: hexDigestSchema,
    }),
  })
  .superRefine((value, context) => {
    for (const [label, items] of [
      ["editorialCorrections", value.content.editorialCorrections],
      ["sources", value.content.sources],
      ["reviewLearningPatterns", value.content.reviewLearningPatterns],
    ] as const) {
      const keys = new Set<string>();
      for (const item of items) {
        if (keys.has(item.key)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["content", label],
            message: `Duplikált hordozható kulcs: ${item.key}`,
          });
        }
        keys.add(item.key);
      }
    }
    for (const [index, item] of value.content.editorialCorrections.entries()) {
      const { key: _key, learnedAt: _learnedAt, ...portable } = item;
      if (item.key !== digestValue(portable)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["content", "editorialCorrections", index, "key"],
          message: "A korrekció tartalmi kulcsa hibás.",
        });
      }
    }
    for (const [index, item] of value.content.sources.entries()) {
      if (item.key !== sourcePortableKey(item.name, item.baseUrl)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["content", "sources", index, "key"],
          message: "A forrás tartalmi kulcsa hibás.",
        });
      }
    }
    for (const [index, item] of value.content.reviewLearningPatterns.entries()) {
      if (
        item.key !==
        digestValue({ kind: item.kind, payload: withoutVolatileCounters(item.payload) })
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["content", "reviewLearningPatterns", index, "key"],
          message: "A review-minta tartalmi kulcsa hibás.",
        });
      }
    }
    if (
      value.content.staticKnowledge.digest !== digestStaticKnowledge(value.content.staticKnowledge)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["content", "staticKnowledge", "digest"],
        message: "A statikus tudás lenyomata hibás.",
      });
    }
    const expectedDerived = deriveEditorialKnowledge(value.content.editorialCorrections);
    if (
      stableStringify(value.content.derivedEditorialKnowledge) !== stableStringify(expectedDerived)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["content", "derivedEditorialKnowledge"],
        message: "A levezetett lexikon/tiltólista nem egyezik a szerkesztői korrekciókkal.",
      });
    }
    const actualCounts = {
      staticLexiconEntries: value.content.staticKnowledge.footballLexicon.length,
      editorialCorrections: value.content.editorialCorrections.length,
      learnedLexiconEntries: value.content.derivedEditorialKnowledge.learnedFootballLexicon.length,
      forbiddenTranslations:
        value.content.derivedEditorialKnowledge.forbiddenLiteralTranslations.length,
      recommendedPhrasings: value.content.derivedEditorialKnowledge.recommendedPhrasings.length,
      sources: value.content.sources.length,
      reviewLearningPatterns: value.content.reviewLearningPatterns.length,
    };
    for (const [key, actual] of Object.entries(actualCounts)) {
      if (value.metadata.counts[key as keyof typeof actualCounts] !== actual) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["metadata", "counts", key],
          message: `A deklarált elemszám hibás; tényleges érték: ${actual}.`,
        });
      }
    }
  });

export type AdminKnowledgePackage = z.infer<typeof knowledgePackageSchema>;

export interface KnowledgeImportPreview {
  digest: string;
  exportedAt: string;
  applicationCommit: string;
  staticKnowledgeCompatible: boolean;
  counts: KnowledgeImportCounts;
  warnings: string[];
  sourceActivationRequested: boolean;
}

export async function buildAdminKnowledgePackage(): Promise<AdminKnowledgePackage> {
  const snapshot = await createRepositories().knowledgePortabilityRepository.loadSnapshot();
  const redactedPaths: string[] = [];
  const correctionKeyById = new Map<string, string>();
  const corrections = snapshot.corrections
    .map((row) => {
      const portable = {
        category: row.category,
        termEn: row.termEn,
        originalSentenceEn: row.originalSentenceEn,
        currentSentenceHu: row.currentSentenceHu,
        correctedSentenceHu: row.correctedSentenceHu,
        note: row.note,
      };
      const key = row.portableKey ?? digestValue(portable);
      correctionKeyById.set(row.id, key);
      return { key, ...portable, learnedAt: row.createdAt.toISOString() };
    })
    .sort((a, b) => a.key.localeCompare(b.key));

  const sourceRows = [...snapshot.sources]
    .sort((a, b) => normalizeUrl(a.baseUrl).localeCompare(normalizeUrl(b.baseUrl)))
    .map((row, index) => ({
      key: sourcePortableKey(row.name, row.baseUrl),
      name: row.name,
      baseUrl: row.baseUrl,
      type: row.type,
      language: row.language,
      licenseType: row.licenseType,
      reliabilityTier: row.reliabilityTier,
      fetchConfig: redactSecrets(
        row.fetchConfig,
        `content.sources[${index}].fetchConfig`,
        redactedPaths,
      ),
      isActive: row.isActive,
      country: row.country,
      leagueTags: toJsonValue(row.leagueTags),
      category: row.category,
      contentMode: row.contentMode,
      trustBaseline: row.trustBaseline,
      robotsStatus: row.robotsStatus,
      termsStatus: row.termsStatus,
      attributionRule: row.attributionRule,
      imagePolicy: redactSecrets(
        row.imagePolicy,
        `content.sources[${index}].imagePolicy`,
        redactedPaths,
      ),
      pollingFrequencyMinutes: row.pollingFrequencyMinutes,
      extractorName: row.extractorName,
    }));

  const reviewLearningPatterns = buildReviewPatterns(snapshot, correctionKeyById);
  const staticKnowledge = buildStaticKnowledge();
  const derivedEditorialKnowledge = deriveEditorialKnowledge(corrections);
  const content: AdminKnowledgePackage["content"] = {
    staticKnowledge,
    editorialCorrections: corrections,
    derivedEditorialKnowledge,
    sources: sourceRows,
    reviewLearningPatterns,
  };

  return {
    format: KNOWLEDGE_FORMAT,
    schemaVersion: KNOWLEDGE_SCHEMA_VERSION,
    metadata: {
      exportedAt: new Date().toISOString(),
      applicationCommit:
        process.env["VERCEL_GIT_COMMIT_SHA"] ?? process.env["GITHUB_SHA"] ?? "local-development",
      environment: process.env["VERCEL_ENV"] ?? process.env["NODE_ENV"] ?? "development",
      counts: {
        staticLexiconEntries: staticKnowledge.footballLexicon.length,
        editorialCorrections: corrections.length,
        learnedLexiconEntries: derivedEditorialKnowledge.learnedFootballLexicon.length,
        forbiddenTranslations: derivedEditorialKnowledge.forbiddenLiteralTranslations.length,
        recommendedPhrasings: derivedEditorialKnowledge.recommendedPhrasings.length,
        sources: sourceRows.length,
        reviewLearningPatterns: reviewLearningPatterns.length,
      },
    },
    content,
    security: {
      secretsIncluded: false,
      redactedPaths,
      importDeletesData: false,
    },
    integrity: { algorithm: "sha256", contentDigest: digestValue(content) },
  };
}

export function parseAdminKnowledgePackage(raw: string): AdminKnowledgePackage {
  if (Buffer.byteLength(raw, "utf8") > MAX_KNOWLEDGE_IMPORT_BYTES) {
    throw new Error("A tudáscsomag nagyobb a megengedett 10 MB-nál.");
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error("A fájl nem érvényes JSON.");
  }
  const parsed = knowledgePackageSchema.safeParse(json);
  if (!parsed.success) {
    const details = parsed.error.issues
      .slice(0, 8)
      .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Érvénytelen tudáscsomag: ${details}`);
  }
  const actualDigest = digestValue(parsed.data.content);
  if (actualDigest !== parsed.data.integrity.contentDigest) {
    throw new Error("A tudáscsomag integritás-ellenőrzése sikertelen: a tartalom módosult.");
  }
  return parsed.data;
}

export async function previewAdminKnowledgeImport(
  knowledgePackage: AdminKnowledgePackage,
  applySourceActivation: boolean,
): Promise<KnowledgeImportPreview> {
  const input = toImportInput(knowledgePackage, applySourceActivation);
  const counts = await createRepositories().knowledgePortabilityRepository.previewImport(input);
  const currentStaticDigest = buildStaticKnowledge().digest;
  const staticKnowledgeCompatible =
    currentStaticDigest === knowledgePackage.content.staticKnowledge.digest;
  const warnings: string[] = [];
  if (!staticKnowledgeCompatible) {
    warnings.push(
      "A csomag kódban verziózott lexikonja/szabályai eltérnek a célalkalmazástól. A DB-alapú tudás importálható, de a kódszabályokat csak azonos alkalmazásverzió állítja helyre.",
    );
  }
  if (knowledgePackage.security.redactedPaths.length > 0) {
    warnings.push(
      `${knowledgePackage.security.redactedPaths.length} titkos konfigurációs mező maszkolva van; meglévő célérték megmarad, hiányzó titok esetén a Source inaktív lesz.`,
    );
  }
  if (counts.sources.activationChanges > 0 && !applySourceActivation) {
    warnings.push(
      `${counts.sources.activationChanges} Source Registry aktiválási eltérés nem lesz alkalmazva külön megerősítés nélkül.`,
    );
  }
  warnings.push("Az import additív/frissítő művelet: sem Storyt, sem tudáselemet nem töröl.");
  return {
    digest: knowledgePackage.integrity.contentDigest,
    exportedAt: knowledgePackage.metadata.exportedAt,
    applicationCommit: knowledgePackage.metadata.applicationCommit,
    staticKnowledgeCompatible,
    counts,
    warnings,
    sourceActivationRequested: counts.sources.activationChanges > 0,
  };
}

export async function applyAdminKnowledgeImport(
  knowledgePackage: AdminKnowledgePackage,
  expectedDigest: string,
  applySourceActivation: boolean,
): Promise<KnowledgeImportPreview> {
  if (knowledgePackage.integrity.contentDigest !== expectedDigest) {
    throw new Error("A fájl nem egyezik az előnézetben ellenőrzött tartalommal.");
  }
  const input = toImportInput(knowledgePackage, applySourceActivation);
  const preview = await previewAdminKnowledgeImport(knowledgePackage, applySourceActivation);
  const appliedCounts =
    await createRepositories().knowledgePortabilityRepository.applyImport(input);
  return { ...preview, counts: appliedCounts };
}

function toImportInput(
  knowledgePackage: AdminKnowledgePackage,
  applySourceActivation: boolean,
): KnowledgeImportInput {
  return {
    corrections: knowledgePackage.content.editorialCorrections.map((item) => ({
      ...item,
      learnedAt: new Date(item.learnedAt),
    })),
    sources: knowledgePackage.content.sources,
    reviewPatterns: knowledgePackage.content.reviewLearningPatterns.map((item) => ({
      ...item,
      learnedAt: new Date(item.learnedAt),
    })),
    applySourceActivation,
  };
}

function buildStaticKnowledge(): AdminKnowledgePackage["content"]["staticKnowledge"] {
  const value = {
    footballLexicon: footballLexicon.FOOTBALL_LEXICON,
    editorialStyleGuide: editorialRewrite.EDITORIAL_STYLE_GUIDE,
    publicationRules: {
      confidenceThreshold: publishGate.CONFIDENCE_THRESHOLD,
      factExtractionSourceLimit: factVerification.EXTRACTION_LIMIT,
      hardGates: [
        "Sikertelen tartalmi quality gate esetén nincs automatikus publikálás.",
        "Magas kockázat vagy forrásellentmondás esetén emberi review szükséges.",
        "Fallback/No-LLM szöveg és sikertelen fact-consistency ellenőrzés nem publikálható.",
      ],
    },
    credibilityRules: [
      "Hivatalos forrás: +25 pont.",
      "Független megerősítések és forrásmegbízhatóság súlyozottan növelik a pontot.",
      "Közvetlen idézet vagy dokumentum: +10 pont.",
      "Ellentmondó forrás: -30 pont.",
      "A pontszám 0 és 100 közé van korlátozva, és emberileg indokolható.",
    ],
  };
  return { digest: digestValue(value), ...value };
}

function buildReviewPatterns(
  snapshot: Awaited<
    ReturnType<
      ReturnType<typeof createRepositories>["knowledgePortabilityRepository"]["loadSnapshot"]
    >
  >,
  correctionKeyById: Map<string, string>,
): AdminKnowledgePackage["content"]["reviewLearningPatterns"] {
  const byKey = new Map<
    string,
    Omit<PortableReviewPatternInput, "payload"> & { payload: JsonValue }
  >();
  const add = (kind: string, payload: unknown, learnedAt: Date): void => {
    const jsonPayload = toJsonValue(payload);
    const key = digestValue({ kind, payload: withoutVolatileCounters(jsonPayload) });
    const current = byKey.get(key);
    if (!current || current.learnedAt < learnedAt) {
      byKey.set(key, { key, kind, payload: jsonPayload, learnedAt });
    }
  };

  for (const row of snapshot.importedReviewPatterns) {
    byKey.set(row.patternKey, {
      key: row.patternKey,
      kind: row.kind,
      payload: toJsonValue(row.payload),
      learnedAt: row.learnedAt,
    });
  }

  const effectiveness = new Map<
    string,
    {
      correctionKey: string;
      stage: string;
      verdict: string;
      count: number;
      latestEvidence: string | null;
      latestAt: Date;
    }
  >();
  for (const row of snapshot.correctionApplications) {
    const correctionKey = correctionKeyById.get(row.correctionId);
    if (!correctionKey) continue;
    const groupKey = `${correctionKey}:${row.stage}:${row.verdict}`;
    const current = effectiveness.get(groupKey);
    if (current) {
      current.count += 1;
      if (row.detectedAt > current.latestAt) {
        current.latestAt = row.detectedAt;
        current.latestEvidence = row.evidence;
      }
    } else {
      effectiveness.set(groupKey, {
        correctionKey,
        stage: row.stage,
        verdict: row.verdict,
        count: 1,
        latestEvidence: row.evidence,
        latestAt: row.detectedAt,
      });
    }
  }
  for (const value of effectiveness.values()) {
    add(
      "correction_effectiveness",
      {
        correctionKey: value.correctionKey,
        stage: value.stage,
        verdict: value.verdict,
        observationCount: value.count,
        latestEvidence: value.latestEvidence,
      },
      value.latestAt,
    );
  }

  const queueGroups = new Map<
    string,
    { reason: string; status: string; reviewNote: string | null; count: number; latestAt: Date }
  >();
  for (const row of snapshot.reviewQueueDecisions) {
    const groupKey = stableStringify([row.reason, row.status, row.reviewNote]);
    const learnedAt = row.resolvedAt ?? row.createdAt;
    const current = queueGroups.get(groupKey);
    if (current) {
      current.count += 1;
      if (learnedAt > current.latestAt) current.latestAt = learnedAt;
    } else {
      queueGroups.set(groupKey, {
        reason: row.reason,
        status: row.status,
        reviewNote: row.reviewNote,
        count: 1,
        latestAt: learnedAt,
      });
    }
  }
  for (const value of queueGroups.values()) {
    add(
      "publish_review_decision",
      {
        reason: value.reason,
        status: value.status,
        reviewNote: value.reviewNote,
        observationCount: value.count,
      },
      value.latestAt,
    );
  }

  for (const row of snapshot.storyMatchReviewDecisions) {
    add(
      "story_match_review",
      {
        matchScore: row.matchScore,
        hasSpecificSharedEntity: row.hasSpecificSharedEntity,
        matchedEntities: row.matchedEntities,
        differingEntities: row.differingEntities,
        sportMismatch: row.sportMismatch,
        automaticDecision: row.decision,
        decisionReasonHu: row.decisionReasonHu,
        reviewStatus: row.reviewStatus,
        reviewNote: row.reviewNote,
      },
      row.resolvedAt ?? row.createdAt,
    );
  }

  for (const row of snapshot.missedMergeReviewDecisions) {
    add(
      "missed_merge_review",
      {
        candidateType: row.candidateType,
        matchScore: row.matchScore,
        matchedEntities: row.matchedEntities,
        differingEntities: row.differingEntities,
        decisionReasonHu: row.decisionReasonHu,
        decision: row.decision,
        decisionNoteHu: row.decisionNoteHu,
      },
      row.decidedAt ?? row.updatedAt,
    );
  }

  return [...byKey.values()]
    .map((item) => ({ ...item, learnedAt: item.learnedAt.toISOString() }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

function withoutVolatileCounters(payload: unknown): unknown {
  if (payload !== null && typeof payload === "object" && !Array.isArray(payload)) {
    const stable = { ...(payload as Record<string, unknown>) };
    delete stable["observationCount"];
    delete stable["latestEvidence"];
    return stable;
  }
  return payload;
}

function digestStaticKnowledge(value: AdminKnowledgePackage["content"]["staticKnowledge"]): string {
  const { digest: _digest, ...content } = value;
  return digestValue(content);
}

function deriveEditorialKnowledge(
  corrections: AdminKnowledgePackage["content"]["editorialCorrections"],
): AdminKnowledgePackage["content"]["derivedEditorialKnowledge"] {
  const source = corrections.map((correction) => ({
    id: correction.key,
    category: correction.category,
    termEn: correction.termEn,
    originalSentenceEn: correction.originalSentenceEn,
    currentSentenceHu: correction.currentSentenceHu,
    correctedSentenceHu: correction.correctedSentenceHu,
    note: correction.note,
  }));
  return {
    learnedFootballLexicon: editorialKnowledge.correctionsToLexiconEntries(source),
    forbiddenLiteralTranslations:
      editorialKnowledge.correctionsToForbiddenLiteralTranslations(source),
    recommendedPhrasings: editorialKnowledge.correctionsToRecommendedPhrasings(source),
  };
}

function redactSecrets(value: unknown, path: string, redactedPaths: string[]): JsonValue {
  if (Array.isArray(value)) {
    return value.map((item, index) => redactSecrets(item, `${path}[${index}]`, redactedPaths));
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => {
        const itemPath = `${path}.${key}`;
        if (isSecretKey(key)) {
          redactedPaths.push(itemPath);
          return [key, KNOWLEDGE_REDACTION_MARKER];
        }
        return [key, redactSecrets(item, itemPath, redactedPaths)];
      }),
    );
  }
  return toJsonValue(value);
}

function isSecretKey(key: string): boolean {
  const normalized = key
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .toLowerCase();
  return /(^|_)(token|secret|password|authorization|credential|api_key|private_key|client_secret|cookie)$/.test(
    normalized,
  );
}

function normalizeUrl(value: string): string {
  return value.trim().replace(/\/+$/, "").toLowerCase();
}

export function sourcePortableKey(name: string, baseUrl: string): string {
  return digestValue(normalizePortableSourceIdentity(name, baseUrl));
}

function toJsonValue(value: unknown): JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return value;
  }
  if (Array.isArray(value)) return value.map(toJsonValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, toJsonValue(item)]));
  }
  throw new Error("A tudáscsomag csak JSON-kompatibilis adatot tartalmazhat.");
}

export function digestValue(value: unknown): string {
  return createHash("sha256").update(stableStringify(value), "utf8").digest("hex");
}

export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

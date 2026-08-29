import { createHash } from "node:crypto";
import { z } from "zod";

export const EDITORIAL_KNOWLEDGE_FORMAT = "magyarsportonline.editorial-knowledge" as const;
export const EDITORIAL_KNOWLEDGE_SCHEMA_VERSION = "2.0.0" as const;

export const EDITORIAL_KNOWLEDGE_TYPES = [
  "terminology",
  "multi_word_expression",
  "idiom",
  "sports_journalism_phrase",
  "forbidden_literal_translation",
  "preferred_wording",
  "headline_rule",
  "grammar_style_rule",
  "entity_naming",
  "competition_naming",
  "learned_failure_pattern",
] as const;

export const EDITORIAL_KNOWLEDGE_STATUSES = ["draft", "active", "deprecated"] as const;
export const EDITORIAL_KNOWLEDGE_IMPORT_STATUSES = ["applied", "blocked", "duplicate"] as const;

const stableKeySchema = z
  .string()
  .trim()
  .min(5)
  .max(160)
  .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/);
const contextSchema = z
  .string()
  .trim()
  .min(1)
  .regex(/^[a-z0-9_-]+$/);
const languageCodeSchema = z
  .string()
  .trim()
  .regex(/^[a-z]{2,3}(?:-[A-Z]{2})?$/);

const positiveExampleSchema = z
  .object({
    source_text: z.string().trim().min(1),
    output_hu: z.string().trim().min(1),
  })
  .strict();

const negativeExampleSchema = z
  .object({
    source_text: z.string().trim().min(1),
    output_hu: z.string().trim().min(1),
    reason_hu: z.string().trim().min(1),
  })
  .strict();

const phraseKnowledgeTypes = new Set<string>([
  "terminology",
  "multi_word_expression",
  "idiom",
  "sports_journalism_phrase",
  "forbidden_literal_translation",
  "preferred_wording",
  "entity_naming",
  "competition_naming",
]);

const ruleKnowledgeTypes = new Set<string>(["headline_rule", "grammar_style_rule"]);

export const editorialKnowledgeRecordSchema = z
  .object({
    schema_version: z.literal(EDITORIAL_KNOWLEDGE_SCHEMA_VERSION),
    stable_key: stableKeySchema,
    revision: z.number().int().min(1),
    knowledge_type: z.enum(EDITORIAL_KNOWLEDGE_TYPES),
    language: z
      .object({
        source: languageCodeSchema,
        target: z.literal("hu"),
      })
      .strict(),
    sport: contextSchema,
    contexts: z
      .array(contextSchema)
      .min(1)
      .refine((items) => new Set(items).size === items.length, {
        message: "contexts must be unique",
      }),
    source_phrase: z.string().trim().min(1).max(500).nullable(),
    canonical_hu: z.string().trim().min(1).max(1_000).nullable(),
    alternative_hu: z
      .array(z.string().trim().min(1).max(1_000))
      .refine((items) => new Set(items).size === items.length, {
        message: "alternative_hu must be unique",
      }),
    avoid_hu: z
      .array(z.string().trim().min(1).max(1_000))
      .refine((items) => new Set(items).size === items.length, {
        message: "avoid_hu must be unique",
      }),
    instruction_hu: z.string().trim().min(1).max(2_000).nullable(),
    match_terms: z
      .array(z.string().trim().min(2).max(200))
      .max(30)
      .refine((items) => new Set(items).size === items.length, {
        message: "match_terms must be unique",
      }),
    confidence: z.number().min(0).max(1),
    status: z.enum(EDITORIAL_KNOWLEDGE_STATUSES),
    provenance: z
      .object({
        source: z.string().trim().min(1).max(500),
        source_url: z.string().url().nullable(),
        license: z.string().trim().min(1).max(100),
      })
      .strict(),
    editorial_note: z.string().trim().min(1).max(2_000).nullable(),
    positive_examples: z.array(positiveExampleSchema).max(10),
    negative_examples: z.array(negativeExampleSchema).max(10),
    replaced_by: stableKeySchema.nullable(),
  })
  .strict()
  .superRefine((record, context) => {
    if (
      phraseKnowledgeTypes.has(record.knowledge_type) &&
      (record.source_phrase === null || record.canonical_hu === null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "phrase knowledge requires source_phrase and canonical_hu",
      });
    }
    if (record.knowledge_type === "forbidden_literal_translation" && record.avoid_hu.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["avoid_hu"],
        message: "forbidden literal translations require avoid_hu",
      });
    }
    if (ruleKnowledgeTypes.has(record.knowledge_type) && record.instruction_hu === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["instruction_hu"],
        message: "rule knowledge requires instruction_hu",
      });
    }
    if (record.replaced_by === record.stable_key) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["replaced_by"],
        message: "a record cannot replace itself",
      });
    }
  });

export type EditorialKnowledgeRecord = z.infer<typeof editorialKnowledgeRecordSchema>;

const editorialKnowledgePackageEnvelopeSchema = z
  .object({
    format: z.literal(EDITORIAL_KNOWLEDGE_FORMAT),
    schema_version: z.literal(EDITORIAL_KNOWLEDGE_SCHEMA_VERSION),
    package_id: z
      .string()
      .trim()
      .min(3)
      .max(160)
      .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/),
    package_version: z
      .string()
      .trim()
      .regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/),
    package_mode: z.enum(["full", "delta"]),
    base_package_version: z.string().trim().min(1).nullable(),
    created_at: z.string().datetime({ offset: true }),
    record_count: z.number().int().min(0),
    records: z.array(z.unknown()),
    integrity: z
      .object({
        algorithm: z.literal("sha256"),
        content_digest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
      })
      .strict(),
    security: z
      .object({
        secrets_included: z.literal(false),
      })
      .strict(),
  })
  .strict();

export interface EditorialKnowledgePackageMetadata {
  format: typeof EDITORIAL_KNOWLEDGE_FORMAT;
  schemaVersion: typeof EDITORIAL_KNOWLEDGE_SCHEMA_VERSION;
  packageId: string;
  packageVersion: string;
  packageMode: "full" | "delta";
  basePackageVersion: string | null;
  createdAt: string;
  recordCount: number;
  contentDigest: string;
}

export interface InvalidEditorialKnowledgeRecord {
  index: number | null;
  stableKey: string | null;
  reasons: string[];
}

export interface ValidatedEditorialKnowledgePackage {
  metadata: EditorialKnowledgePackageMetadata | null;
  records: EditorialKnowledgeRecord[];
  invalid: InvalidEditorialKnowledgeRecord[];
  rawDigest: string;
}

export function validateEditorialKnowledgePackage(
  input: unknown,
): ValidatedEditorialKnowledgePackage {
  const rawDigest = computeEditorialKnowledgePackageDigest(input);
  const envelopeResult = editorialKnowledgePackageEnvelopeSchema.safeParse(input);
  if (!envelopeResult.success) {
    return {
      metadata: null,
      records: [],
      invalid: [
        {
          index: null,
          stableKey: null,
          reasons: envelopeResult.error.issues.map(formatValidationIssue),
        },
      ],
      rawDigest,
    };
  }

  const envelope = envelopeResult.data;
  const invalid: InvalidEditorialKnowledgeRecord[] = [];
  const records: EditorialKnowledgeRecord[] = [];

  if (envelope.record_count !== envelope.records.length) {
    invalid.push({
      index: null,
      stableKey: null,
      reasons: [
        `record_count (${envelope.record_count}) does not match records.length (${envelope.records.length})`,
      ],
    });
  }
  if (envelope.integrity.content_digest !== rawDigest) {
    invalid.push({
      index: null,
      stableKey: null,
      reasons: ["integrity.content_digest does not match the package content"],
    });
  }

  envelope.records.forEach((value, index) => {
    const result = editorialKnowledgeRecordSchema.safeParse(value);
    if (result.success) {
      records.push(result.data);
      return;
    }
    invalid.push({
      index,
      stableKey: readStableKey(value),
      reasons: result.error.issues.map(formatValidationIssue),
    });
  });

  return {
    metadata: {
      format: envelope.format,
      schemaVersion: envelope.schema_version,
      packageId: envelope.package_id,
      packageVersion: envelope.package_version,
      packageMode: envelope.package_mode,
      basePackageVersion: envelope.base_package_version,
      createdAt: envelope.created_at,
      recordCount: envelope.record_count,
      contentDigest: envelope.integrity.content_digest,
    },
    records,
    invalid,
    rawDigest,
  };
}

export type EditorialKnowledgePackageInput = Omit<
  z.input<typeof editorialKnowledgePackageEnvelopeSchema>,
  "integrity"
>;

export function createEditorialKnowledgePackage(input: EditorialKnowledgePackageInput) {
  return {
    ...input,
    integrity: {
      algorithm: "sha256" as const,
      content_digest: computeEditorialKnowledgePackageDigest(input),
    },
  };
}

export function hashEditorialKnowledgeRecord(record: EditorialKnowledgeRecord): string {
  return sha256(stableStringify(record));
}

export function computeEditorialKnowledgePackageDigest(input: unknown): string {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return `sha256:${sha256(stableStringify(input))}`;
  }
  const { integrity: _integrity, ...content } = input as Record<string, unknown>;
  return `sha256:${sha256(stableStringify(content))}`;
}

export function stableEditorialKnowledgeStringify(value: unknown): string {
  return stableStringify(value);
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

function formatValidationIssue(issue: z.ZodIssue): string {
  const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
  return `${path}${issue.message}`;
}

function readStableKey(value: unknown): string | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const stableKey = (value as Record<string, unknown>)["stable_key"];
  return typeof stableKey === "string" ? stableKey : null;
}

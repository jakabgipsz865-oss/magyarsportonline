import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  EDITORIAL_KNOWLEDGE_IMPORT_STATUSES,
  EDITORIAL_KNOWLEDGE_STATUSES,
  EDITORIAL_KNOWLEDGE_TYPES,
  type EditorialKnowledgeRecord,
} from "../editorial-knowledge-contract";

export const editorialKnowledgeTypeEnum = pgEnum(
  "editorial_knowledge_type",
  EDITORIAL_KNOWLEDGE_TYPES,
);
export const editorialKnowledgeStatusEnum = pgEnum(
  "editorial_knowledge_status",
  EDITORIAL_KNOWLEDGE_STATUSES,
);
export const editorialKnowledgeImportStatusEnum = pgEnum(
  "editorial_knowledge_import_status",
  EDITORIAL_KNOWLEDGE_IMPORT_STATUSES,
);

export interface EditorialKnowledgeImportCountsJson {
  new: number;
  update: number;
  duplicate: number;
  conflict: number;
  invalid: number;
}

/**
 * Editorial Knowledge V2. Ez a tábla szándékosan független a legacy
 * editorial_corrections és knowledge_review_patterns tábláktól: azokból
 * nincs automatikus migráció vagy seed.
 */
export const editorialKnowledgeEntries = pgTable(
  "editorial_knowledge_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    stableKey: text("stable_key").notNull(),
    revision: integer("revision").notNull(),
    schemaVersion: text("schema_version").notNull(),
    knowledgeType: editorialKnowledgeTypeEnum("knowledge_type").notNull(),
    sourceLanguage: text("source_language").notNull(),
    targetLanguage: text("target_language").notNull(),
    sport: text("sport").notNull(),
    contexts: text("contexts").array().notNull(),
    sourcePhrase: text("source_phrase"),
    canonicalHu: text("canonical_hu"),
    alternativeHu: text("alternative_hu").array().notNull(),
    avoidHu: text("avoid_hu").array().notNull(),
    instructionHu: text("instruction_hu"),
    matchTerms: text("match_terms").array().notNull(),
    confidence: real("confidence").notNull(),
    status: editorialKnowledgeStatusEnum("status").notNull(),
    provenance: jsonb("provenance").$type<EditorialKnowledgeRecord["provenance"]>().notNull(),
    editorialNote: text("editorial_note"),
    positiveExamples: jsonb("positive_examples")
      .$type<EditorialKnowledgeRecord["positive_examples"]>()
      .notNull(),
    negativeExamples: jsonb("negative_examples")
      .$type<EditorialKnowledgeRecord["negative_examples"]>()
      .notNull(),
    replacedBy: text("replaced_by"),
    contentHash: text("content_hash").notNull(),
    packageId: text("package_id").notNull(),
    packageVersion: text("package_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("editorial_knowledge_entries_stable_key_idx").on(table.stableKey),
    index("editorial_knowledge_entries_retrieval_idx").on(
      table.status,
      table.sport,
      table.sourceLanguage,
      table.targetLanguage,
      table.knowledgeType,
    ),
    index("editorial_knowledge_entries_contexts_gin_idx").using("gin", table.contexts),
    index("editorial_knowledge_entries_match_terms_gin_idx").using("gin", table.matchTerms),
  ],
);

/** Egy apply-kísérlet minimális, titokmentes audit sora. */
export const editorialKnowledgeImportRuns = pgTable(
  "editorial_knowledge_import_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    packageId: text("package_id").notNull(),
    packageVersion: text("package_version").notNull(),
    schemaVersion: text("schema_version").notNull(),
    packageDigest: text("package_digest").notNull(),
    status: editorialKnowledgeImportStatusEnum("status").notNull(),
    counts: jsonb("counts").$type<EditorialKnowledgeImportCountsJson>().notNull(),
    errorSummary: text("error_summary"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("editorial_knowledge_import_runs_package_idx").on(table.packageId, table.packageVersion),
    index("editorial_knowledge_import_runs_digest_idx").on(table.packageDigest),
  ],
);

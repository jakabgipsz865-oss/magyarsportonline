import { and, count, desc, eq, sql } from "drizzle-orm";
import type { Database } from "../client";
import {
  EDITORIAL_KNOWLEDGE_SCHEMA_VERSION,
  hashEditorialKnowledgeRecord,
  validateEditorialKnowledgePackage,
  type EditorialKnowledgePackageMetadata,
  type EditorialKnowledgeRecord,
} from "../editorial-knowledge-contract";
import {
  editorialKnowledgeEntries,
  editorialKnowledgeImportRuns,
  type EditorialKnowledgeImportCountsJson,
} from "../schema/index";

export type EditorialKnowledgeImportClassification =
  | "new"
  | "update"
  | "duplicate"
  | "conflict"
  | "invalid";

export interface EditorialKnowledgeImportDecision {
  index: number | null;
  stableKey: string | null;
  classification: EditorialKnowledgeImportClassification;
  reason: string | null;
  record: EditorialKnowledgeRecord | null;
}

export type EditorialKnowledgeImportCounts = EditorialKnowledgeImportCountsJson;

export interface EditorialKnowledgeImportPreview {
  metadata: EditorialKnowledgePackageMetadata | null;
  digest: string;
  counts: EditorialKnowledgeImportCounts;
  decisions: EditorialKnowledgeImportDecision[];
}

export interface EditorialKnowledgeApplyResult extends EditorialKnowledgeImportPreview {
  applied: boolean;
  importStatus: "applied" | "blocked" | "duplicate";
}

export interface EditorialKnowledgeRetrievalInput {
  sport: string;
  sourceLanguage: string;
  targetLanguage: "hu";
  contexts: string[];
  contextText: string;
  limit?: number;
}

type EditorialKnowledgeEntryRow = typeof editorialKnowledgeEntries.$inferSelect;
type EditorialKnowledgeExecutor = Pick<Database, "select" | "insert" | "execute">;

const EDITORIAL_KNOWLEDGE_IMPORT_LOCK = 1297304144;

export function postgresTextArray(values: string[]) {
  return sql`ARRAY[${sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  )}]::text[]`;
}

/**
 * Editorial Knowledge V2 kizárólagos DB-határa. Sem legacy correctiont,
 * sem review patternt, sem Source Registry rekordot nem olvas vagy ír.
 */
export class EditorialKnowledgeRepository {
  constructor(private readonly db: Database) {}

  async previewImport(input: unknown): Promise<EditorialKnowledgeImportPreview> {
    return previewWithExecutor(this.db, input);
  }

  async countByStatus(): Promise<Record<"active" | "draft" | "deprecated", number>> {
    const rows = await this.db
      .select({ status: editorialKnowledgeEntries.status, value: count() })
      .from(editorialKnowledgeEntries)
      .groupBy(editorialKnowledgeEntries.status);
    const result = { active: 0, draft: 0, deprecated: 0 };
    for (const row of rows) result[row.status] = Number(row.value);
    return result;
  }

  async listRecords(limit = 100): Promise<EditorialKnowledgeRecord[]> {
    const rows = await this.db
      .select()
      .from(editorialKnowledgeEntries)
      .orderBy(desc(editorialKnowledgeEntries.updatedAt))
      .limit(Math.max(1, Math.min(limit, 500)));
    return rows.map(entryRowToRecord);
  }

  async listAllRecords(): Promise<EditorialKnowledgeRecord[]> {
    const rows = await this.db
      .select()
      .from(editorialKnowledgeEntries)
      .orderBy(editorialKnowledgeEntries.stableKey);
    return rows.map(entryRowToRecord);
  }

  async findRelevant(input: EditorialKnowledgeRetrievalInput): Promise<EditorialKnowledgeRecord[]> {
    const limit = Math.max(1, Math.min(input.limit ?? 20, 20));
    const contextText = input.contextText.slice(0, 30_000);
    if (contextText.trim().length === 0 && input.contexts.length === 0) return [];
    const contexts = postgresTextArray(input.contexts);

    const phraseMatch = sql<boolean>`(
      (${editorialKnowledgeEntries.knowledgeType} in ('headline_rule', 'grammar_style_rule', 'learned_failure_pattern') AND ${editorialKnowledgeEntries.contexts} && ${contexts})
      OR (coalesce(${editorialKnowledgeEntries.sourcePhrase}, '') <> '' AND position(lower(${editorialKnowledgeEntries.sourcePhrase}) in lower(${contextText})) > 0)
      OR (coalesce(${editorialKnowledgeEntries.canonicalHu}, '') <> '' AND position(lower(${editorialKnowledgeEntries.canonicalHu}) in lower(${contextText})) > 0)
      OR EXISTS (SELECT 1 FROM unnest(${editorialKnowledgeEntries.matchTerms}) AS term WHERE length(term) > 1 AND position(lower(term) in lower(${contextText})) > 0)
      OR EXISTS (SELECT 1 FROM unnest(${editorialKnowledgeEntries.avoidHu}) AS term WHERE length(term) > 1 AND position(lower(term) in lower(${contextText})) > 0)
    )`;
    const score = sql<number>`(
      CASE WHEN coalesce(${editorialKnowledgeEntries.sourcePhrase}, '') <> '' AND position(lower(${editorialKnowledgeEntries.sourcePhrase}) in lower(${contextText})) > 0 THEN 100 ELSE 0 END
      + CASE WHEN EXISTS (SELECT 1 FROM unnest(${editorialKnowledgeEntries.matchTerms}) AS term WHERE length(term) > 1 AND position(lower(term) in lower(${contextText})) > 0) THEN 80 ELSE 0 END
      + CASE WHEN EXISTS (SELECT 1 FROM unnest(${editorialKnowledgeEntries.avoidHu}) AS term WHERE length(term) > 1 AND position(lower(term) in lower(${contextText})) > 0) THEN 60 ELSE 0 END
      + CASE WHEN ${editorialKnowledgeEntries.contexts} && ${contexts} THEN 20 ELSE 0 END
    )`;
    const rows = await this.db
      .select()
      .from(editorialKnowledgeEntries)
      .where(
        and(
          eq(editorialKnowledgeEntries.status, "active"),
          eq(editorialKnowledgeEntries.sport, input.sport),
          eq(editorialKnowledgeEntries.sourceLanguage, input.sourceLanguage),
          eq(editorialKnowledgeEntries.targetLanguage, input.targetLanguage),
          phraseMatch,
        ),
      )
      .orderBy(sql`${score} desc`, desc(editorialKnowledgeEntries.updatedAt))
      .limit(limit);
    return rows
      .map(entryRowToRecord)
      .filter((record) => editorialKnowledgeRelevanceScore(record, input) > 0)
      .slice(0, limit);
  }

  async applyImport(
    input: unknown,
    expectedPreviewDigest: string,
  ): Promise<EditorialKnowledgeApplyResult> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${EDITORIAL_KNOWLEDGE_IMPORT_LOCK})`);
      let preview = await previewWithExecutor(tx, input);

      if (preview.digest !== expectedPreviewDigest) {
        preview = addInvalidDecision(preview, "package changed after preview");
      }

      if (preview.counts.invalid > 0 || preview.counts.conflict > 0) {
        await insertImportRun(tx, preview, "blocked");
        return { ...preview, applied: false, importStatus: "blocked" };
      }

      for (const decision of preview.decisions) {
        if (
          (decision.classification !== "new" && decision.classification !== "update") ||
          decision.record === null ||
          preview.metadata === null
        ) {
          continue;
        }
        const values = recordToValues(decision.record, preview.metadata);
        await tx
          .insert(editorialKnowledgeEntries)
          .values(values)
          .onConflictDoUpdate({
            target: editorialKnowledgeEntries.stableKey,
            set: { ...values, updatedAt: new Date() },
          });
      }

      const importStatus =
        preview.counts.new === 0 && preview.counts.update === 0 ? "duplicate" : "applied";
      await insertImportRun(tx, preview, importStatus);
      return { ...preview, applied: true, importStatus };
    });
  }
}

export function editorialKnowledgeRelevanceScore(
  record: EditorialKnowledgeRecord,
  input: EditorialKnowledgeRetrievalInput,
): number {
  if (
    record.status !== "active" ||
    record.sport !== input.sport ||
    record.language.source !== input.sourceLanguage ||
    record.language.target !== input.targetLanguage
  ) {
    return 0;
  }
  const text = input.contextText.toLocaleLowerCase("hu-HU");
  const includes = (value: string | null): boolean =>
    Boolean(value && value.length > 1 && text.includes(value.toLocaleLowerCase("hu-HU")));
  let score = includes(record.source_phrase) ? 100 : 0;
  if (record.match_terms.some(includes)) score += 80;
  if (record.avoid_hu.some(includes)) score += 60;
  if (includes(record.canonical_hu)) score += 40;
  const contextMatches = record.contexts.some((context) => input.contexts.includes(context));
  const isContextualRule = [
    "headline_rule",
    "grammar_style_rule",
    "learned_failure_pattern",
  ].includes(record.knowledge_type);
  if (contextMatches && (score > 0 || isContextualRule)) score += 20;
  return score;
}

export function classifyEditorialKnowledgeRecords(
  existingRows: EditorialKnowledgeEntryRow[],
  records: EditorialKnowledgeRecord[],
): EditorialKnowledgeImportDecision[] {
  const existingByKey = new Map(existingRows.map((row) => [row.stableKey, row]));
  const packageKeys = new Set<string>();

  return records.map((record, index) => {
    if (packageKeys.has(record.stable_key)) {
      return decision(index, record, "conflict", "stable_key occurs more than once in the package");
    }
    packageKeys.add(record.stable_key);

    const existing = existingByKey.get(record.stable_key);
    if (!existing) return decision(index, record, "new", null);
    if (record.revision < existing.revision) {
      return decision(index, record, "conflict", "incoming revision is stale");
    }

    const contentHash = hashEditorialKnowledgeRecord(record);
    if (record.revision === existing.revision) {
      return contentHash === existing.contentHash
        ? decision(index, record, "duplicate", null)
        : decision(index, record, "conflict", "same revision has different content");
    }

    if (!immutableIdentityMatches(existing, record)) {
      return decision(index, record, "conflict", "immutable identity fields changed");
    }
    return decision(index, record, "update", null);
  });
}

async function previewWithExecutor(
  db: EditorialKnowledgeExecutor,
  input: unknown,
): Promise<EditorialKnowledgeImportPreview> {
  const validated = validateEditorialKnowledgePackage(input);
  const existingRows =
    validated.records.length > 0
      ? await db.select().from(editorialKnowledgeEntries)
      : ([] as EditorialKnowledgeEntryRow[]);
  const decisions: EditorialKnowledgeImportDecision[] = [
    ...validated.invalid.map((item) => ({
      index: item.index,
      stableKey: item.stableKey,
      classification: "invalid" as const,
      reason: item.reasons.join("; "),
      record: null,
    })),
    ...classifyEditorialKnowledgeRecords(existingRows, validated.records),
  ];
  return {
    metadata: validated.metadata,
    digest: validated.rawDigest,
    counts: countDecisions(decisions),
    decisions,
  };
}

function recordToValues(
  record: EditorialKnowledgeRecord,
  metadata: EditorialKnowledgePackageMetadata,
) {
  return {
    stableKey: record.stable_key,
    revision: record.revision,
    schemaVersion: record.schema_version,
    knowledgeType: record.knowledge_type,
    sourceLanguage: record.language.source,
    targetLanguage: record.language.target,
    sport: record.sport,
    contexts: record.contexts,
    sourcePhrase: record.source_phrase,
    canonicalHu: record.canonical_hu,
    alternativeHu: record.alternative_hu,
    avoidHu: record.avoid_hu,
    instructionHu: record.instruction_hu,
    matchTerms: record.match_terms,
    confidence: record.confidence,
    status: record.status,
    provenance: record.provenance,
    editorialNote: record.editorial_note,
    positiveExamples: record.positive_examples,
    negativeExamples: record.negative_examples,
    replacedBy: record.replaced_by,
    contentHash: hashEditorialKnowledgeRecord(record),
    packageId: metadata.packageId,
    packageVersion: metadata.packageVersion,
  };
}

function entryRowToRecord(row: EditorialKnowledgeEntryRow): EditorialKnowledgeRecord {
  return {
    schema_version: EDITORIAL_KNOWLEDGE_SCHEMA_VERSION,
    stable_key: row.stableKey,
    revision: row.revision,
    knowledge_type: row.knowledgeType,
    language: { source: row.sourceLanguage, target: "hu" },
    sport: row.sport,
    contexts: row.contexts,
    source_phrase: row.sourcePhrase,
    canonical_hu: row.canonicalHu,
    alternative_hu: row.alternativeHu,
    avoid_hu: row.avoidHu,
    instruction_hu: row.instructionHu,
    match_terms: row.matchTerms,
    confidence: row.confidence,
    status: row.status,
    provenance: row.provenance,
    editorial_note: row.editorialNote,
    positive_examples: row.positiveExamples,
    negative_examples: row.negativeExamples,
    replaced_by: row.replacedBy,
  };
}

async function insertImportRun(
  db: EditorialKnowledgeExecutor,
  preview: EditorialKnowledgeImportPreview,
  status: "applied" | "blocked" | "duplicate",
): Promise<void> {
  const metadata = preview.metadata;
  await db.insert(editorialKnowledgeImportRuns).values({
    packageId: metadata?.packageId ?? "invalid-package",
    packageVersion: metadata?.packageVersion ?? "0.0.0",
    schemaVersion: metadata?.schemaVersion ?? EDITORIAL_KNOWLEDGE_SCHEMA_VERSION,
    packageDigest: preview.digest,
    status,
    counts: preview.counts,
    errorSummary:
      status === "blocked"
        ? `invalid=${preview.counts.invalid}; conflict=${preview.counts.conflict}`
        : null,
  });
}

function immutableIdentityMatches(
  existing: EditorialKnowledgeEntryRow,
  record: EditorialKnowledgeRecord,
): boolean {
  return (
    existing.knowledgeType === record.knowledge_type &&
    existing.sourceLanguage === record.language.source &&
    existing.targetLanguage === record.language.target &&
    existing.sport === record.sport
  );
}

function decision(
  index: number,
  record: EditorialKnowledgeRecord,
  classification: EditorialKnowledgeImportClassification,
  reason: string | null,
): EditorialKnowledgeImportDecision {
  return {
    index,
    stableKey: record.stable_key,
    classification,
    reason,
    record,
  };
}

function countDecisions(
  decisions: EditorialKnowledgeImportDecision[],
): EditorialKnowledgeImportCounts {
  const counts: EditorialKnowledgeImportCounts = {
    new: 0,
    update: 0,
    duplicate: 0,
    conflict: 0,
    invalid: 0,
  };
  for (const item of decisions) counts[item.classification] += 1;
  return counts;
}

function addInvalidDecision(
  preview: EditorialKnowledgeImportPreview,
  reason: string,
): EditorialKnowledgeImportPreview {
  const decisions = [
    ...preview.decisions,
    {
      index: null,
      stableKey: null,
      classification: "invalid" as const,
      reason,
      record: null,
    },
  ];
  return { ...preview, decisions, counts: countDecisions(decisions) };
}

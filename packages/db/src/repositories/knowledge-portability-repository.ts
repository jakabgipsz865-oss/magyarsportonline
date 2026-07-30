import { eq, isNotNull, ne, sql } from "drizzle-orm";
import type { Database } from "../client";
import {
  editorialCorrectionApplications,
  editorialCorrections,
  knowledgeReviewPatterns,
  missedMergeReviews,
  reviewQueueItems,
  sources,
  storyMatchDecisions,
} from "../schema/index";

export type PortableCorrectionCategory = typeof editorialCorrections.$inferSelect.category;
export type PortableSourceType = typeof sources.$inferSelect.type;
export type PortableSourceLicenseType = typeof sources.$inferSelect.licenseType;
export type PortableSourceReliabilityTier = typeof sources.$inferSelect.reliabilityTier;
export type PortableSourceCategory = NonNullable<typeof sources.$inferSelect.category>;
export type PortableSourceContentMode = NonNullable<typeof sources.$inferSelect.contentMode>;

export interface PortableCorrectionInput {
  key: string;
  category: PortableCorrectionCategory;
  termEn: string | null;
  originalSentenceEn: string;
  currentSentenceHu: string;
  correctedSentenceHu: string;
  note: string | null;
  learnedAt: Date;
}

export interface PortableSourceInput {
  key: string;
  name: string;
  baseUrl: string;
  type: PortableSourceType;
  language: string;
  licenseType: PortableSourceLicenseType;
  reliabilityTier: PortableSourceReliabilityTier;
  fetchConfig: unknown;
  isActive: boolean;
  country: string | null;
  leagueTags: unknown;
  category: PortableSourceCategory | null;
  contentMode: PortableSourceContentMode | null;
  trustBaseline: number | null;
  robotsStatus: string | null;
  termsStatus: string | null;
  attributionRule: string | null;
  imagePolicy: unknown;
  pollingFrequencyMinutes: number | null;
  extractorName: string | null;
}

export interface PortableReviewPatternInput {
  key: string;
  kind: string;
  payload: unknown;
  learnedAt: Date;
}

export interface KnowledgeImportInput {
  corrections: PortableCorrectionInput[];
  sources: PortableSourceInput[];
  reviewPatterns: PortableReviewPatternInput[];
  applySourceActivation: boolean;
}

export interface KnowledgeImportCounts {
  corrections: { create: number; unchanged: number };
  sources: { create: number; update: number; unchanged: number; activationChanges: number };
  reviewPatterns: { create: number; update: number; unchanged: number };
}

export interface KnowledgeDatabaseSnapshot {
  corrections: Array<typeof editorialCorrections.$inferSelect>;
  correctionApplications: Array<typeof editorialCorrectionApplications.$inferSelect>;
  sources: Array<typeof sources.$inferSelect>;
  reviewQueueDecisions: Array<typeof reviewQueueItems.$inferSelect>;
  storyMatchReviewDecisions: Array<typeof storyMatchDecisions.$inferSelect>;
  missedMergeReviewDecisions: Array<typeof missedMergeReviews.$inferSelect>;
  importedReviewPatterns: Array<typeof knowledgeReviewPatterns.$inferSelect>;
}

type KnowledgeExecutor = Pick<Database, "select" | "insert" | "update" | "execute">;

export const KNOWLEDGE_REDACTION_MARKER = "__MSO_REDACTED__";

/**
 * Az admin tudásexport/import egyetlen DB-határa. A repository csak
 * hordozható, Story-független adatot ír vissza; nyers review auditot sosem
 * próbál idegen UUID-khoz kötni.
 */
export class KnowledgePortabilityRepository {
  constructor(private readonly db: Database) {}

  async loadSnapshot(): Promise<KnowledgeDatabaseSnapshot> {
    const [
      corrections,
      correctionApplications,
      sourceRows,
      reviewQueueDecisions,
      storyMatchReviewDecisions,
      missedMergeReviewDecisions,
      importedReviewPatterns,
    ] = await Promise.all([
      this.db.select().from(editorialCorrections),
      this.db.select().from(editorialCorrectionApplications),
      this.db.select().from(sources),
      this.db.select().from(reviewQueueItems).where(ne(reviewQueueItems.status, "pending")),
      this.db.select().from(storyMatchDecisions).where(isNotNull(storyMatchDecisions.reviewStatus)),
      this.db.select().from(missedMergeReviews).where(isNotNull(missedMergeReviews.decision)),
      this.db.select().from(knowledgeReviewPatterns),
    ]);
    return {
      corrections,
      correctionApplications,
      sources: sourceRows,
      reviewQueueDecisions,
      storyMatchReviewDecisions,
      missedMergeReviewDecisions,
      importedReviewPatterns,
    };
  }

  async previewImport(input: KnowledgeImportInput): Promise<KnowledgeImportCounts> {
    return calculateImportCounts(this.db, input);
  }

  /**
   * Egy tranzakció + advisory lock: nincs részleges restore, és két párhuzamos
   * admin import sem tud az ellenőrzés és beszúrás között duplikálni.
   */
  async applyImport(input: KnowledgeImportInput): Promise<KnowledgeImportCounts> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(1297304143)`);
      const counts = await calculateImportCounts(tx, input);
      const existing = await loadMutableRows(tx);

      for (const correction of input.corrections) {
        const byKey = existing.corrections.find((row) => row.portableKey === correction.key);
        const byContent = existing.corrections.find((row) =>
          correctionContentEquals(row, correction),
        );
        if (byKey || byContent) {
          if (byContent && byContent.portableKey === null) {
            await tx
              .update(editorialCorrections)
              .set({ portableKey: correction.key })
              .where(eq(editorialCorrections.id, byContent.id));
          }
          continue;
        }
        await tx.insert(editorialCorrections).values({
          storyId: null,
          portableKey: correction.key,
          category: correction.category,
          termEn: correction.termEn,
          originalSentenceEn: correction.originalSentenceEn,
          currentSentenceHu: correction.currentSentenceHu,
          correctedSentenceHu: correction.correctedSentenceHu,
          note: correction.note,
          createdAt: correction.learnedAt,
        });
      }

      for (const source of input.sources) {
        const current = existing.sources.find(
          (row) =>
            normalizePortableSourceIdentity(row.name, row.baseUrl) ===
            normalizePortableSourceIdentity(source.name, source.baseUrl),
        );
        const values = sourceValues(source, current ?? null, input.applySourceActivation);
        if (current) {
          if (!sourceEquals(current, values)) {
            await tx.update(sources).set(values).where(eq(sources.id, current.id));
          }
        } else {
          await tx.insert(sources).values(values);
        }
      }

      for (const pattern of input.reviewPatterns) {
        const current = existing.reviewPatterns.find((row) => row.patternKey === pattern.key);
        if (!current) {
          await tx.insert(knowledgeReviewPatterns).values({
            patternKey: pattern.key,
            kind: pattern.kind,
            payload: pattern.payload,
            learnedAt: pattern.learnedAt,
          });
        } else if (
          current.kind !== pattern.kind ||
          stableStringify(current.payload) !== stableStringify(pattern.payload) ||
          current.learnedAt.getTime() !== pattern.learnedAt.getTime()
        ) {
          await tx
            .update(knowledgeReviewPatterns)
            .set({
              kind: pattern.kind,
              payload: pattern.payload,
              learnedAt: pattern.learnedAt,
              updatedAt: new Date(),
            })
            .where(eq(knowledgeReviewPatterns.id, current.id));
        }
      }

      return counts;
    });
  }
}

async function calculateImportCounts(
  db: KnowledgeExecutor,
  input: KnowledgeImportInput,
): Promise<KnowledgeImportCounts> {
  const existing = await loadMutableRows(db);
  const counts: KnowledgeImportCounts = {
    corrections: { create: 0, unchanged: 0 },
    sources: { create: 0, update: 0, unchanged: 0, activationChanges: 0 },
    reviewPatterns: { create: 0, update: 0, unchanged: 0 },
  };

  for (const correction of input.corrections) {
    const found = existing.corrections.some(
      (row) => row.portableKey === correction.key || correctionContentEquals(row, correction),
    );
    counts.corrections[found ? "unchanged" : "create"] += 1;
  }

  for (const source of input.sources) {
    const current = existing.sources.find(
      (row) =>
        normalizePortableSourceIdentity(row.name, row.baseUrl) ===
        normalizePortableSourceIdentity(source.name, source.baseUrl),
    );
    if (!current) {
      counts.sources.create += 1;
      if (source.isActive) counts.sources.activationChanges += 1;
      continue;
    }
    const values = sourceValues(source, current, input.applySourceActivation);
    if (current.isActive !== source.isActive || current.isActive !== values.isActive) {
      counts.sources.activationChanges += 1;
    }
    counts.sources[sourceEquals(current, values) ? "unchanged" : "update"] += 1;
  }

  for (const pattern of input.reviewPatterns) {
    const current = existing.reviewPatterns.find((row) => row.patternKey === pattern.key);
    if (!current) {
      counts.reviewPatterns.create += 1;
    } else if (
      current.kind === pattern.kind &&
      stableStringify(current.payload) === stableStringify(pattern.payload) &&
      current.learnedAt.getTime() === pattern.learnedAt.getTime()
    ) {
      counts.reviewPatterns.unchanged += 1;
    } else {
      counts.reviewPatterns.update += 1;
    }
  }
  return counts;
}

async function loadMutableRows(db: KnowledgeExecutor) {
  const [corrections, sourceRows, reviewPatterns] = await Promise.all([
    db.select().from(editorialCorrections),
    db.select().from(sources),
    db.select().from(knowledgeReviewPatterns),
  ]);
  return { corrections, sources: sourceRows, reviewPatterns };
}

function correctionContentEquals(
  row: typeof editorialCorrections.$inferSelect,
  input: PortableCorrectionInput,
): boolean {
  return (
    row.category === input.category &&
    row.termEn === input.termEn &&
    row.originalSentenceEn === input.originalSentenceEn &&
    row.currentSentenceHu === input.currentSentenceHu &&
    row.correctedSentenceHu === input.correctedSentenceHu &&
    row.note === input.note
  );
}

function sourceValues(
  source: PortableSourceInput,
  current: typeof sources.$inferSelect | null,
  applySourceActivation: boolean,
) {
  const fetchConfig = restoreKnowledgeRedactions(source.fetchConfig, current?.fetchConfig);
  const hasUnrestorableSecret = containsKnowledgeRedaction(fetchConfig);
  return {
    name: source.name,
    baseUrl: source.baseUrl,
    type: source.type,
    language: source.language,
    licenseType: source.licenseType,
    reliabilityTier: source.reliabilityTier,
    fetchConfig,
    isActive: hasUnrestorableSecret
      ? false
      : applySourceActivation
        ? source.isActive
        : (current?.isActive ?? false),
    country: source.country,
    leagueTags: source.leagueTags,
    category: source.category,
    contentMode: source.contentMode,
    trustBaseline: source.trustBaseline,
    robotsStatus: source.robotsStatus,
    termsStatus: source.termsStatus,
    attributionRule: source.attributionRule,
    imagePolicy: source.imagePolicy,
    pollingFrequencyMinutes: source.pollingFrequencyMinutes,
    extractorName: source.extractorName,
  };
}

function sourceEquals(
  current: typeof sources.$inferSelect,
  wanted: ReturnType<typeof sourceValues>,
): boolean {
  return (
    current.name === wanted.name &&
    current.baseUrl === wanted.baseUrl &&
    current.type === wanted.type &&
    current.language === wanted.language &&
    current.licenseType === wanted.licenseType &&
    current.reliabilityTier === wanted.reliabilityTier &&
    stableStringify(current.fetchConfig) === stableStringify(wanted.fetchConfig) &&
    current.isActive === wanted.isActive &&
    current.country === wanted.country &&
    stableStringify(current.leagueTags) === stableStringify(wanted.leagueTags) &&
    current.category === wanted.category &&
    current.contentMode === wanted.contentMode &&
    current.trustBaseline === wanted.trustBaseline &&
    current.robotsStatus === wanted.robotsStatus &&
    current.termsStatus === wanted.termsStatus &&
    current.attributionRule === wanted.attributionRule &&
    stableStringify(current.imagePolicy) === stableStringify(wanted.imagePolicy) &&
    current.pollingFrequencyMinutes === wanted.pollingFrequencyMinutes &&
    current.extractorName === wanted.extractorName
  );
}

function normalizeUrl(value: string): string {
  return value.trim().replace(/\/+$/, "").toLowerCase();
}

export function normalizePortableSourceIdentity(name: string, baseUrl: string): string {
  return `${name.trim().toLowerCase()}\n${normalizeUrl(baseUrl)}`;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function containsKnowledgeRedaction(value: unknown): boolean {
  if (value === KNOWLEDGE_REDACTION_MARKER) return true;
  if (Array.isArray(value)) return value.some(containsKnowledgeRedaction);
  if (value !== null && typeof value === "object") {
    return Object.values(value).some(containsKnowledgeRedaction);
  }
  return false;
}

/** Exportált titok helyén a célkörnyezet meglévő értéke marad meg. */
export function restoreKnowledgeRedactions(imported: unknown, current: unknown): unknown {
  if (imported === KNOWLEDGE_REDACTION_MARKER) return current ?? KNOWLEDGE_REDACTION_MARKER;
  if (Array.isArray(imported)) {
    const currentItems = Array.isArray(current) ? current : [];
    return imported.map((item, index) => restoreKnowledgeRedactions(item, currentItems[index]));
  }
  if (imported !== null && typeof imported === "object") {
    const currentObject =
      current !== null && typeof current === "object" && !Array.isArray(current)
        ? (current as Record<string, unknown>)
        : {};
    return Object.fromEntries(
      Object.entries(imported).map(([key, value]) => [
        key,
        restoreKnowledgeRedactions(value, currentObject[key]),
      ]),
    );
  }
  return imported;
}

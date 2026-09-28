import {
  EDITORIAL_KNOWLEDGE_SCHEMA_VERSION,
  hashEditorialKnowledgeRecord,
  validateEditorialKnowledgePackage,
  type EditorialKnowledgeRecord,
  type EditorialKnowledgeImportPreview,
  type EditorialKnowledgeApplyResult,
} from "@magyarsportonline/db";
import type { D1Client } from "@magyarsportonline/db/d1";

interface KnowledgeRow {
  stable_key: string;
  revision: number;
  schema_version: string;
  knowledge_type: string;
  source_language: string;
  target_language: string;
  sport: string;
  contexts: string;
  source_phrase: string | null;
  canonical_hu: string | null;
  alternative_hu: string;
  avoid_hu: string;
  instruction_hu: string | null;
  match_terms: string;
  confidence: number;
  status: "active" | "draft" | "deprecated";
  provenance: string;
  editorial_note: string | null;
  positive_examples: string;
  negative_examples: string;
  replaced_by: string | null;
  content_hash: string;
}

function rowToRecord(row: KnowledgeRow): EditorialKnowledgeRecord {
  return {
    schema_version: EDITORIAL_KNOWLEDGE_SCHEMA_VERSION,
    stable_key: row.stable_key,
    revision: row.revision,
    knowledge_type: row.knowledge_type as EditorialKnowledgeRecord["knowledge_type"],
    language: { source: row.source_language, target: "hu" },
    sport: row.sport,
    contexts: JSON.parse(row.contexts),
    source_phrase: row.source_phrase,
    canonical_hu: row.canonical_hu,
    alternative_hu: JSON.parse(row.alternative_hu),
    avoid_hu: JSON.parse(row.avoid_hu),
    instruction_hu: row.instruction_hu,
    match_terms: JSON.parse(row.match_terms),
    confidence: row.confidence,
    status: row.status,
    provenance: JSON.parse(row.provenance),
    editorial_note: row.editorial_note,
    positive_examples: JSON.parse(row.positive_examples),
    negative_examples: JSON.parse(row.negative_examples),
    replaced_by: row.replaced_by,
  };
}

export async function listD1Knowledge(
  db: D1Client,
  limit?: number,
): Promise<EditorialKnowledgeRecord[]> {
  const query = `SELECT * FROM editorial_knowledge_entries ORDER BY updated_at DESC${limit ? " LIMIT ?" : ""}`;
  const statement = db.prepare(query);
  const rows = await (
    limit ? statement.bind(Math.min(500, Math.max(1, limit))) : statement
  ).all<KnowledgeRow>();
  return rows.results.map(rowToRecord);
}

export async function countD1Knowledge(db: D1Client) {
  const rows = await db
    .prepare("SELECT status,COUNT(*) n FROM editorial_knowledge_entries GROUP BY status")
    .all<{ status: "active" | "draft" | "deprecated"; n: number }>();
  const counts = { active: 0, draft: 0, deprecated: 0 };
  for (const row of rows.results) counts[row.status] = row.n;
  return counts;
}

export async function previewD1KnowledgeImport(
  db: D1Client,
  input: unknown,
): Promise<EditorialKnowledgeImportPreview> {
  const validated = validateEditorialKnowledgePackage(input);
  const rows = validated.records.length
    ? (
        await db
          .prepare(
            `SELECT stable_key,revision,knowledge_type,source_language,
        target_language,sport,content_hash FROM editorial_knowledge_entries`,
          )
          .all<
            Pick<
              KnowledgeRow,
              | "stable_key"
              | "revision"
              | "knowledge_type"
              | "source_language"
              | "target_language"
              | "sport"
              | "content_hash"
            >
          >()
      ).results
    : [];
  const existing = new Map(rows.map((row) => [row.stable_key, row]));
  const seen = new Set<string>();
  const decisions: EditorialKnowledgeImportPreview["decisions"] = validated.invalid.map((item) => ({
    index: item.index,
    stableKey: item.stableKey,
    classification: "invalid",
    reason: item.reasons.join("; "),
    record: null,
  }));
  validated.records.forEach((record, index) => {
    let classification: "new" | "update" | "duplicate" | "conflict" = "new";
    let reason: string | null = null;
    const prior = existing.get(record.stable_key);
    if (seen.has(record.stable_key)) {
      classification = "conflict";
      reason = "stable_key occurs more than once in the package";
    } else if (prior) {
      if (record.revision < prior.revision) {
        classification = "conflict";
        reason = "incoming revision is stale";
      } else if (record.revision === prior.revision) {
        classification =
          hashEditorialKnowledgeRecord(record) === prior.content_hash ? "duplicate" : "conflict";
        if (classification === "conflict") reason = "same revision has different content";
      } else if (
        record.knowledge_type !== prior.knowledge_type ||
        record.language.source !== prior.source_language ||
        record.language.target !== prior.target_language ||
        record.sport !== prior.sport
      ) {
        classification = "conflict";
        reason = "immutable identity fields changed";
      } else classification = "update";
    }
    seen.add(record.stable_key);
    decisions.push({ index, stableKey: record.stable_key, classification, reason, record });
  });
  const counts = { new: 0, update: 0, duplicate: 0, conflict: 0, invalid: 0 };
  for (const item of decisions) counts[item.classification] += 1;
  return { metadata: validated.metadata, digest: validated.rawDigest, counts, decisions };
}

export async function applyD1KnowledgeImport(
  db: D1Client,
  input: unknown,
  expectedDigest: string,
): Promise<EditorialKnowledgeApplyResult> {
  if (!db.batch) throw new Error("D1 batch binding is required for knowledge import");
  const preview = await previewD1KnowledgeImport(db, input);
  if (preview.digest !== expectedDigest) throw new Error("Knowledge package changed after preview");
  if (preview.counts.invalid || preview.counts.conflict || !preview.metadata)
    return { ...preview, applied: false, importStatus: "blocked" };
  const statements = preview.decisions
    .filter(
      (item) => (item.classification === "new" || item.classification === "update") && item.record,
    )
    .map((item) => {
      const record = item.record!;
      return db
        .prepare(
          `INSERT INTO editorial_knowledge_entries
        (id,stable_key,revision,schema_version,knowledge_type,source_language,target_language,
        sport,contexts,source_phrase,canonical_hu,alternative_hu,avoid_hu,instruction_hu,
        match_terms,confidence,status,provenance,editorial_note,positive_examples,
        negative_examples,replaced_by,content_hash,package_id,package_version)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(stable_key) DO UPDATE SET revision=excluded.revision,
          contexts=excluded.contexts,source_phrase=excluded.source_phrase,
          canonical_hu=excluded.canonical_hu,alternative_hu=excluded.alternative_hu,
          avoid_hu=excluded.avoid_hu,instruction_hu=excluded.instruction_hu,
          match_terms=excluded.match_terms,confidence=excluded.confidence,status=excluded.status,
          provenance=excluded.provenance,editorial_note=excluded.editorial_note,
          positive_examples=excluded.positive_examples,negative_examples=excluded.negative_examples,
          replaced_by=excluded.replaced_by,content_hash=excluded.content_hash,
          package_id=excluded.package_id,package_version=excluded.package_version,
          updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE excluded.revision>editorial_knowledge_entries.revision`,
        )
        .bind(
          crypto.randomUUID(),
          record.stable_key,
          record.revision,
          record.schema_version,
          record.knowledge_type,
          record.language.source,
          record.language.target,
          record.sport,
          JSON.stringify(record.contexts),
          record.source_phrase,
          record.canonical_hu,
          JSON.stringify(record.alternative_hu),
          JSON.stringify(record.avoid_hu),
          record.instruction_hu,
          JSON.stringify(record.match_terms),
          record.confidence,
          record.status,
          JSON.stringify(record.provenance),
          record.editorial_note,
          JSON.stringify(record.positive_examples),
          JSON.stringify(record.negative_examples),
          record.replaced_by,
          hashEditorialKnowledgeRecord(record),
          preview.metadata!.packageId,
          preview.metadata!.packageVersion,
        );
    });
  const status = statements.length ? ("applied" as const) : ("duplicate" as const);
  statements.push(
    db
      .prepare(
        `INSERT INTO editorial_knowledge_import_runs
    (id,package_id,package_version,schema_version,package_digest,status,counts)
    VALUES (?,?,?,?,?,?,?)`,
      )
      .bind(
        crypto.randomUUID(),
        preview.metadata.packageId,
        preview.metadata.packageVersion,
        preview.metadata.schemaVersion,
        preview.digest,
        status,
        JSON.stringify(preview.counts),
      ),
  );
  const results = await db.batch(statements);
  if (results.some((result) => result.meta.changes !== 1))
    throw new Error(
      "D1 knowledge import changed concurrently; inspect the applied rows before retrying",
    );
  return { ...preview, applied: true, importStatus: status };
}

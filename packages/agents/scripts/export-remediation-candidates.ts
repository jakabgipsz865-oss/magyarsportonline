/** Offline, read-only reassessment of the September audit snapshot. Never publishes. */
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { assessTabloidQuality, type TabloidForbiddenRule } from "../src/tabloid";

type Row = Record<string, unknown>;

async function* jsonl(path: string): AsyncGenerator<Row> {
  for await (const line of createInterface({ input: createReadStream(path), crlfDelay: Infinity })) {
    if (line.trim()) yield JSON.parse(line) as Row;
  }
}

function object(value: unknown): Row | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : null;
}

function array(value: unknown): Row[] {
  return Array.isArray(value) ? value.map(object).filter((row): row is Row => row !== null) : [];
}

function string(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function parsed(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value) as unknown; } catch { return value; }
}

/** PostgreSQL text[] export, including quoted commas and escaped quotes. */
function pgArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  const input = string(value);
  if (!input.startsWith("{") || !input.endsWith("}")) return [];
  const result: string[] = [];
  let current = "";
  let quoted = false;
  let escaped = false;
  for (const char of input.slice(1, -1)) {
    if (escaped) { current += char; escaped = false; continue; }
    if (char === "\\") { escaped = true; continue; }
    if (char === '"') { quoted = !quoted; continue; }
    if (char === "," && !quoted) { result.push(current); current = ""; continue; }
    current += char;
  }
  if (current || input.length > 2) result.push(current);
  return result;
}

function qualityCodes(value: unknown): string[] {
  const flags = parsed(value);
  return [...new Set(array(flags).map((flag) => string(flag.code)).filter(Boolean))].sort();
}

function unresolvedCodes(value: unknown): string[] {
  return [...new Set(array(parsed(value)).filter((flag) => flag.repaired !== true).map((flag) => string(flag.code)).filter(Boolean))].sort();
}

function errorCategory(error: unknown): string {
  const text = string(error).toLowerCase();
  if (!text) return "none_recorded";
  for (const code of ["number_integrity", "forbidden_terminology", "incomplete_coverage", "foreign_language", "malformed_hungarian", "writer_lease_active", "daily_ai_quota", "timeout", "http_403", "extractor_empty_or_insufficient_text"]) {
    if (text.includes(code)) return code;
  }
  if (text.includes("quality")) return "quality_unresolved";
  if (text.includes("writer")) return "writer_error";
  return "other_recorded_error";
}

function relevantRules(rows: Row[], sourceLanguage: string, contextText: string): TabloidForbiddenRule[] {
  const text = contextText.slice(0, 30_000).toLocaleLowerCase("hu-HU");
  const contexts = ["headline", "lead", "body", "tabloid"];
  const includes = (value: unknown): boolean => {
    const term = string(value).toLocaleLowerCase("hu-HU");
    return term.length > 1 && text.includes(term);
  };
  return rows.flatMap((row) => {
    if (row.status !== "active" || row.sport !== "football" || row.source_language !== sourceLanguage || row.target_language !== "hu") return [];
    const terms = pgArray(row.match_terms);
    const avoid = pgArray(row.avoid_hu);
    const ruleContexts = pgArray(row.contexts);
    const contextMatch = ruleContexts.some((context) => contexts.includes(context));
    const contextual = ["headline_rule", "grammar_style_rule", "learned_failure_pattern"].includes(string(row.knowledge_type));
    const phraseMatch = includes(row.source_phrase) || includes(row.canonical_hu) || terms.some(includes) || avoid.some(includes);
    if (!phraseMatch && !(contextual && contextMatch)) return [];
    const score = (includes(row.source_phrase) ? 100 : 0) + (terms.some(includes) ? 80 : 0) + (avoid.some(includes) ? 60 : 0) + (contextMatch ? 20 : 0);
    const relevance = score + (includes(row.canonical_hu) ? 40 : 0);
    if (!relevance) return [];
    return [{ score, updated: string(row.updated_at), rule: { avoid_hu: avoid, source_phrase: string(row.source_phrase), match_terms: terms, contexts: ruleContexts } }];
  }).sort((a, b) => b.score - a.score || b.updated.localeCompare(a.updated)).slice(0, 20).map((row) => row.rule);
}

function csvCell(value: unknown): string {
  const text = value == null ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

async function main(): Promise<void> {
  const [auditDir, outputDir] = process.argv.slice(2);
  if (!auditDir || !outputDir) throw new Error("usage: export-remediation-candidates.ts AUDIT_EXPORTS_DIR OUTPUT_DIR");
  await mkdir(outputDir, { recursive: true });
  const knowledge: Row[] = [];
  for await (const row of jsonl(join(auditDir, "TABLES", "editorial_knowledge_entries.jsonl"))) knowledge.push(row);
  const output = createWriteStream(join(outputDir, "RECOVERY_CANDIDATES.jsonl"));
  const summary = createWriteStream(join(outputDir, "RECOVERY_CANDIDATES_SUMMARY.csv"));
  summary.write("raw_id,story_id,source_id,source_name,published_story,has_draft,old_quality_codes,new_quality_codes,changed_by,old_job_reason_categories,reassessment_status\n");
  const counts = { candidates: 0, publishedSeparated: 0, withDraft: 0, deterministicClear: 0, uncertainty: 0, noDraft: 0 };
  const seen = new Set<string>();
  for await (const item of jsonl(join(auditDir, "ALL_ITEMS.jsonl"))) {
    const raw = object(item.raw_article);
    if (!raw) continue;
    const rawId = string(raw.id);
    if (!rawId || seen.has(rawId)) continue;
    seen.add(rawId);
    const story = object(item.story);
    const source = object(item.source);
    const jobs = array(item.pipeline_jobs);
    const versions = array(item.story_versions).sort((a, b) => Number(b.version_number) - Number(a.version_number));
    const latest = versions[0];
    const unresolved = latest ? unresolvedCodes(latest.quality_issues) : [];
    const jobStates = jobs.map((job) => string(job.status));
    const candidateReasons = [
      ...(jobs.length === 0 ? ["no_job"] : []),
      ...(jobStates.some((status) => ["dead_letter", "pending", "in_progress"].includes(status)) ? ["unfinished_job"] : []),
      ...(unresolved.length ? ["unresolved_saved_draft"] : []),
      ...(array(item.review_queue_items).length ? ["review_record"] : []),
    ];
    if (candidateReasons.length === 0) continue;
    const publishedStory = story?.status === "published";
    const oldCodes = latest ? qualityCodes(latest.quality_issues) : [];
    let newCodes: string[] | null = null;
    let status = "NOT_VERIFIED_NO_SAVED_DRAFT";
    if (latest && raw.content_origin === "full_article") {
      const sourceContent = `${string(raw.title_original)}\n${string(raw.body_original)}`;
      const flags = assessTabloidQuality({
        sourceContent,
        output: {
          title_hu: string(latest.title_hu),
          lead_hu: string(latest.lead_hu),
          body_hu: string(latest.body_hu),
          language_warnings: [],
        },
        forbiddenRules: relevantRules(knowledge, string(source?.language), sourceContent),
      });
      newCodes = [...new Set(flags.map((flag) => flag.code))].sort();
      status = newCodes.length ? "REVIEW_QUALITY_FLAGS" : "REVIEW_DETERMINISTIC_CLEAR";
      counts.withDraft++;
      if (newCodes.length) counts.uncertainty++; else counts.deterministicClear++;
    } else {
      counts.noDraft++;
    }
    const changedBy = unresolved.filter((code) => newCodes !== null && !newCodes.includes(code))
      .filter((code) => ["number_integrity", "forbidden_terminology", "incomplete_coverage"].includes(code));
    const remainingUncertainty = [
      ...unresolved.filter((code) => !newCodes?.includes(code) && !changedBy.includes(code)),
      ...(latest && string(latest.prompt_version) !== "" ? ["semantic_fidelity_not_proven"] : []),
      "historical_freshness_requires_editorial_review",
    ];
    const jobReasons = [...new Set(jobs.map((job) => errorCategory(job.last_error)))].sort();
    const record = {
      raw_id: rawId, story_id: string(story?.id) || null, source_id: string(raw.source_id),
      source_name: string(source?.name), source_published_at: raw.published_at_source,
      historical_ingested_at: raw.ingested_at, published_story: publishedStory,
      candidate_reasons: [...new Set(candidateReasons)].sort(),
      job_ids: [...new Set(jobs.map((job) => string(job.id)))].sort(),
      latest_version_id: latest ? string(latest.id) : null,
      old_quality_codes: oldCodes, old_unresolved_codes: unresolved,
      old_job_reason_categories: jobReasons,
      new_quality_codes: newCodes, changed_by: changedBy,
      remaining_uncertainty: [...new Set(remainingUncertainty)].sort(),
      reassessment_status: status,
      historical_review_only: true, social_send_allowed: false,
    };
    output.write(`${JSON.stringify(record)}\n`);
    summary.write([rawId, record.story_id, record.source_id, record.source_name, publishedStory, Boolean(latest), oldCodes.join("|"), (newCodes ?? []).join("|"), changedBy.join("|"), jobReasons.join("|"), status].map(csvCell).join(",") + "\n");
    counts.candidates++;
    if (publishedStory) counts.publishedSeparated++;
  }
  await Promise.all([new Promise<void>((resolve) => output.end(resolve)), new Promise<void>((resolve) => summary.end(resolve))]);
  console.log(JSON.stringify(counts));
}

await main();

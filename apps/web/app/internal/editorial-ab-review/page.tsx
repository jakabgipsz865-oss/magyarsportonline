import type { Metadata } from "next";
import type {
  CorrectionApplicationVerdict,
  EditorialCorrectionRow,
  OriginalSourceContent,
} from "@magyarsportonline/db";
import {
  correctionEffectiveness,
  editorialCorrections,
  type footballLexicon,
} from "@magyarsportonline/agents";
import { revalidatePath } from "next/cache";
import type { ReactNode } from "react";
import { createRepositories } from "../../../lib/db";
import {
  isEditorialCorrectionCategory,
  submitEditorialCorrection,
} from "../../../lib/editorial-corrections";

const CORRECTION_CATEGORY_LABELS_HU = editorialCorrections.CORRECTION_CATEGORY_LABELS_HU;
const EDITORIAL_CORRECTION_CATEGORIES = Object.keys(
  CORRECTION_CATEGORY_LABELS_HU,
) as editorialCorrections.CorrectionCategory[];

const VERDICT_BADGE: Record<
  CorrectionApplicationVerdict,
  { icon: string; label: string; bg: string; color: string }
> = {
  applied: { icon: "✔", label: "Alkalmazva", bg: "#e6f4ea", color: "#1e7e34" },
  partial: { icon: "⚠", label: "Részben alkalmazva", bg: "#fff8e1", color: "#a15c00" },
  not_applied: { icon: "✖", label: "Nem alkalmazta", bg: "#fdecea", color: "#b3261e" },
};

const TREND_LABELS_HU: Record<NonNullable<correctionEffectiveness.ApplicationTrend>, string> = {
  improved: "javult ↑",
  worsened: "romlott ↓",
  unchanged: "változatlan",
};

// Sosem indexelhető — belső, ADMIN_SECRET-tel védett review felület
// (docs/editorial-style-guide.md, 2026-07-28 sprint). Lásd még
// app/robots.ts (/internal/ disallow) és middleware.ts (HTTP Basic auth).
export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
};

// DB-driven admin nézet — sosem prerendelt, mindig friss (ugyanaz a minta,
// mint app/admin/review/page.tsx).
export const dynamic = "force-dynamic";

type LexiconEntry = footballLexicon.LexiconEntry;

interface QualityIssue {
  field: "title" | "lead" | "body";
  kind:
    | "empty"
    | "looks_english"
    | "matches_source_verbatim"
    | "repeated_paragraph"
    | "duplicates_body";
}
interface QualityAssessment {
  passed: boolean;
  issues: QualityIssue[];
}
interface JudgeVerdict {
  winner: "A" | "B" | "tie";
  scoreA: number;
  scoreB: number;
  rationaleHu: string;
}
interface CallUsage {
  inputTokens: number;
  outputTokens: number;
  estimatedNeurons: number;
  isFallback: boolean;
  fallbackReason: string | null;
}
interface PerCallUsage {
  rewrite: CallUsage;
  selfCheck: CallUsage;
  judge: CallUsage | null;
}

const QUALITY_LABELS_HU: Record<QualityIssue["kind"], string> = {
  empty: "üres mező",
  looks_english: "angolul maradt szöveg",
  matches_source_verbatim: "szó szerint megegyezik egy ténnyel",
  repeated_paragraph: "ismétlődő bekezdés",
  duplicates_body: "lead megismétlődik a törzsben",
};

/**
 * Nagyon egyszerű, szándékosan átlátható mondat-szintű diff: a B szöveg
 * minden mondatát megjelöli "változott"-ként, ha az (normalizálva) NEM
 * fordul elő szó szerint az A szövegben. Nem valódi szó-szintű diff —
 * egy review-eszköznek ennyi elég, és sokkal könnyebb ellenőrizni a
 * helyességét, mint egy teljes diff-algoritmusét.
 */
function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

function QualityBadges({
  quality,
  label,
}: {
  quality: QualityAssessment;
  label: string;
}): ReactNode {
  if (quality.issues.length === 0) {
    return null;
  }
  return (
    <p style={{ fontSize: "0.82em", color: "#a15c00" }}>
      {label} minőségi jelzések:{" "}
      {quality.issues.map((issue) => `${issue.field}: ${QUALITY_LABELS_HU[issue.kind]}`).join(", ")}
    </p>
  );
}

function UsageChip({ label, usage }: { label: string; usage: CallUsage | null }): ReactNode {
  if (!usage) {
    return <span style={chipStyle("#eee", "#777")}>{label}: n/a (nem futott)</span>;
  }
  if (usage.isFallback) {
    return (
      <span style={chipStyle("#fdecea", "#b3261e")}>
        {label}: fallback ({usage.fallbackReason ?? "?"})
      </span>
    );
  }
  return (
    <span style={chipStyle("#e6f4ea", "#1e7e34")}>
      {label}: {usage.inputTokens}→{usage.outputTokens} tok · {usage.estimatedNeurons.toFixed(1)} N
    </span>
  );
}

function chipStyle(bg: string, color: string): React.CSSProperties {
  return {
    background: bg,
    color,
    fontSize: "0.75em",
    padding: "2px 8px",
    borderRadius: 999,
    marginRight: 6,
    display: "inline-block",
  };
}

function LexiconMatches({ matches }: { matches: LexiconEntry[] }): ReactNode {
  if (matches.length === 0) {
    return (
      <p style={{ fontSize: "0.85em", color: "#777" }}>
        Nincs felismert lexikon-kifejezés ebben a cikkben.
      </p>
    );
  }
  return (
    <ul style={{ fontSize: "0.85em", margin: "4px 0" }}>
      {matches.map((entry) => (
        <li key={entry.en}>
          <strong>&quot;{entry.en}&quot;</strong> → {entry.naturalHu}{" "}
          <span style={{ color: "#999" }}>(kerülendő: &quot;{entry.avoidLiteralHu}&quot;)</span>
        </li>
      ))}
    </ul>
  );
}

function OriginalSources({ sources }: { sources: OriginalSourceContent[] }): ReactNode {
  if (sources.length === 0) {
    return <p style={{ fontSize: "0.85em", color: "#777" }}>Nincs kapcsolt eredeti forráscikk.</p>;
  }
  return (
    <>
      {sources.map((source) => (
        <details key={source.sourceUrl} style={{ marginBottom: 8 }}>
          <summary style={{ cursor: "pointer", fontSize: "0.85em", color: "#0645ad" }}>
            Eredeti forrás: {source.sourceName} — {source.titleOriginal}
          </summary>
          <p style={{ fontSize: "0.85em", color: "#555" }}>
            <a href={source.sourceUrl} target="_blank" rel="noopener noreferrer">
              {source.sourceUrl}
            </a>
          </p>
          <p style={{ fontSize: "0.9em", whiteSpace: "pre-wrap" }}>{source.bodyOriginal}</p>
        </details>
      ))}
    </>
  );
}

/**
 * "Tanítható szerkesztői felület" (2026-07-28 sprint) — a szerkesztő itt
 * fogad el egy mondatszintű javítást. A `lib/editorial-corrections.ts`
 * függvénye validál és ment; ez a wrapper csak a FormData-t alakítja
 * struktúrált inputtá és frissíti az oldalt (ugyanaz a minta, mint
 * app/admin/review/page.tsx approveAction/rejectAction párja).
 */
async function submitCorrectionAction(formData: FormData): Promise<void> {
  "use server";
  const storyId = formData.get("storyId");
  const currentSentenceHu = formData.get("currentSentenceHu");
  const originalSentenceEn = formData.get("originalSentenceEn");
  const correctedSentenceHu = formData.get("correctedSentenceHu");
  const category = formData.get("category");
  const termEn = formData.get("termEn");
  const note = formData.get("note");

  if (
    typeof storyId === "string" &&
    typeof currentSentenceHu === "string" &&
    typeof originalSentenceEn === "string" &&
    typeof correctedSentenceHu === "string" &&
    typeof category === "string" &&
    isEditorialCorrectionCategory(category) &&
    storyId.length > 0 &&
    currentSentenceHu.length > 0 &&
    originalSentenceEn.trim().length > 0 &&
    correctedSentenceHu.trim().length > 0
  ) {
    await submitEditorialCorrection({
      storyId,
      category,
      termEn: typeof termEn === "string" && termEn.trim().length > 0 ? termEn.trim() : null,
      originalSentenceEn: originalSentenceEn.trim(),
      currentSentenceHu,
      correctedSentenceHu: correctedSentenceHu.trim(),
      note: typeof note === "string" && note.trim().length > 0 ? note.trim() : null,
    });
  }
  revalidatePath("/internal/editorial-ab-review");
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  fontSize: "0.85em",
  padding: "4px 6px",
  marginTop: 2,
  boxSizing: "border-box",
};

function TeachableSentence({
  storyId,
  sentenceHu,
}: {
  storyId: string;
  sentenceHu: string;
}): ReactNode {
  return (
    <details style={{ marginBottom: 2 }}>
      <summary style={{ cursor: "pointer", fontSize: "0.72em", color: "#0645ad" }}>
        ✎ Tanítás erre a mondatra
      </summary>
      <form
        action={submitCorrectionAction}
        style={{
          display: "grid",
          gap: 6,
          marginTop: 6,
          marginBottom: 10,
          padding: 8,
          background: "#fffbe6",
          borderRadius: 6,
        }}
      >
        <input type="hidden" name="storyId" value={storyId} />
        <input type="hidden" name="currentSentenceHu" value={sentenceHu} />
        <label style={{ fontSize: "0.72em", color: "#666" }}>
          Eredeti angol mondat (illeszd be az eredeti forrásból):
          <textarea name="originalSentenceEn" rows={2} required style={inputStyle} />
        </label>
        <label style={{ fontSize: "0.72em", color: "#666" }}>
          Javított magyar megfogalmazás:
          <textarea
            name="correctedSentenceHu"
            rows={2}
            required
            defaultValue={sentenceHu}
            style={inputStyle}
          />
        </label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <label style={{ fontSize: "0.72em", color: "#666", flex: "1 1 160px" }}>
            Hiba kategóriája:
            <select name="category" required defaultValue="terminology" style={inputStyle}>
              {EDITORIAL_CORRECTION_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {CORRECTION_CATEGORY_LABELS_HU[cat]}
                </option>
              ))}
            </select>
          </label>
          <label style={{ fontSize: "0.72em", color: "#666", flex: "1 1 160px" }}>
            Angol kifejezés (opcionális, szleng/terminológia esetén):
            <input type="text" name="termEn" style={inputStyle} />
          </label>
        </div>
        <label style={{ fontSize: "0.72em", color: "#666" }}>
          Megjegyzés (opcionális):
          <input type="text" name="note" style={inputStyle} />
        </label>
        <button type="submit" style={{ justifySelf: "start", fontSize: "0.8em" }}>
          ✅ Javítás elfogadása és tanítása
        </button>
      </form>
    </details>
  );
}

/**
 * Egyetlen javítás összesített "tanult-e" jelzése (2026-07-28-i "mérhető
 * szerkesztői memória" sprint) — a legutóbbi mérési esemény adja a fő
 * ikont (✔/⚠/✖), mellette a teljes eseménysor bontása és a trend
 * (javult/romlott az előző méréshez képest), lásd
 * packages/agents/src/shared/correction-effectiveness.ts.
 */
function VerdictBadge({
  summary,
}: {
  summary: correctionEffectiveness.CorrectionApplicationSummary;
}): ReactNode {
  if (summary.totalCount === 0) {
    return <span style={chipStyle("#eee", "#777")}>– még nincs mérési adat</span>;
  }
  const meta = summary.latestVerdict ? VERDICT_BADGE[summary.latestVerdict] : null;
  return (
    <>
      {meta && (
        <span style={chipStyle(meta.bg, meta.color)}>
          {meta.icon} {meta.label}
        </span>
      )}
      <span style={{ fontSize: "0.75em", color: "#999" }}>
        ({summary.totalCount} mérésből: ✔{summary.appliedCount} ⚠{summary.partialCount} ✖
        {summary.notAppliedCount}
        {summary.trend ? ` · ${TREND_LABELS_HU[summary.trend]}` : ""})
      </span>
    </>
  );
}

function CorrectionHistory({
  corrections,
  applicationsByCorrectionId,
  sequenceByCorrectionId,
}: {
  corrections: EditorialCorrectionRow[];
  applicationsByCorrectionId: Map<string, correctionEffectiveness.CorrectionApplicationEvent[]>;
  sequenceByCorrectionId: Map<string, number>;
}): ReactNode {
  if (corrections.length === 0) {
    return null;
  }
  return (
    <details style={{ marginTop: 10 }}>
      <summary style={{ cursor: "pointer", fontSize: "0.8em", color: "#0645ad" }}>
        Eddig elfogadott javítások ehhez a cikkhez ({corrections.length})
      </summary>
      <ul style={{ fontSize: "0.82em", margin: "6px 0" }}>
        {corrections.map((correction) => {
          const summary = correctionEffectiveness.summarizeCorrectionApplications(
            applicationsByCorrectionId.get(correction.id) ?? [],
          );
          return (
            <li key={correction.id} style={{ marginBottom: 8 }}>
              <code style={{ color: "#999" }}>
                #{sequenceByCorrectionId.get(correction.id) ?? "?"}
              </code>{" "}
              <span style={{ color: "#999" }}>
                [{CORRECTION_CATEGORY_LABELS_HU[correction.category]}]
              </span>{" "}
              &quot;{correction.currentSentenceHu}&quot; → &quot;{correction.correctedSentenceHu}
              &quot;
              <div style={{ marginTop: 3 }}>
                <VerdictBadge summary={summary} />
              </div>
            </li>
          );
        })}
      </ul>
    </details>
  );
}

const STATUS_LABELS: Record<string, { label: string; bg: string; color: string }> = {
  accepted: { label: "Elfogadva — valódi stílusjavítás", bg: "#e6f4ea", color: "#1e7e34" },
  fact_check_failed: {
    label: "Elutasítva — tényellenőrzés hibát talált",
    bg: "#fdecea",
    color: "#b3261e",
  },
  fallback: { label: "Kihagyva — LLM fallback (nincs átírás)", bg: "#f1f1f1", color: "#666" },
};

export default async function EditorialAbReviewPage(): Promise<ReactNode> {
  const {
    editorialAbSnapshotRepository,
    editorialCorrectionRepository,
    editorialCorrectionApplicationRepository,
  } = createRepositories();
  const [rows, allCorrections] = await Promise.all([
    editorialAbSnapshotRepository.listAll(),
    editorialCorrectionRepository.listAll(),
  ]);
  const allApplications = await editorialCorrectionApplicationRepository.listByCorrectionIds(
    allCorrections.map((correction) => correction.id),
  );

  const correctionsByStoryId = new Map<string, EditorialCorrectionRow[]>();
  for (const correction of allCorrections) {
    const existing = correctionsByStoryId.get(correction.storyId) ?? [];
    existing.push(correction);
    correctionsByStoryId.set(correction.storyId, existing);
  }

  const applicationsByCorrectionId = new Map<
    string,
    correctionEffectiveness.CorrectionApplicationEvent[]
  >();
  for (const application of allApplications) {
    const existing = applicationsByCorrectionId.get(application.correctionId) ?? [];
    existing.push({ verdict: application.verdict, detectedAt: application.detectedAt });
    applicationsByCorrectionId.set(application.correctionId, existing);
  }

  // Sorszám (#1, #2, ...) a legelső elfogadott javítástól kezdve — csak
  // megjelenítési célra, hogy a szerkesztő egyszerűen hivatkozhasson egy
  // adott javításra ("a 14-es javítás").
  const sequenceByCorrectionId = new Map<string, number>();
  const correctionsOldestFirst = [...allCorrections].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  );
  correctionsOldestFirst.forEach((correction, index) => {
    sequenceByCorrectionId.set(correction.id, index + 1);
  });

  return (
    <main
      style={{ maxWidth: 1000, margin: "0 auto", padding: "24px 16px", fontFamily: "sans-serif" }}
    >
      <h1>Editorial Rewrite A/B review</h1>
      <p style={{ color: "#555" }}>
        Csak olvasható belső ellenőrző felület — <strong>semmit nem publikál</strong> az élő
        oldalon, és nincs hatással a <code>story_versions</code> táblára. A judge-oszlop
        <strong> kizárólag kiegészítő információ</strong>, nem tekintendő önmagában bizonyítéknak.
      </p>
      <p style={{ fontSize: "0.85em", color: "#777" }}>
        {rows.length === 0
          ? "Még nincs elmentett A/B eredmény — futtasd a editorial-ab-test.yml workflow-t (ami mostantól ide is ment)."
          : `${rows.length} cikk legutóbbi A/B eredménye, legfrissebb elöl.`}
      </p>

      {rows.map((row) => {
        const status = row.rewriteAccepted ? "accepted" : (row.rejectionKind ?? "fallback");
        const statusMeta = STATUS_LABELS[status] ?? STATUS_LABELS["fallback"];
        const qualityA = row.qualityA as unknown as QualityAssessment;
        const qualityB = row.qualityB as unknown as QualityAssessment;
        const judge = row.judge as unknown as JudgeVerdict | null;
        const perCallUsage = row.perCallUsage as unknown as PerCallUsage;
        const lexiconMatches = row.lexiconMatches as unknown as LexiconEntry[];
        const originalSources = row.originalSources as unknown as OriginalSourceContent[];
        const rejectionReason = row.rejectionReason as unknown as string[] | null;

        return (
          <article
            key={row.storyId}
            style={{ border: "1px solid #ddd", borderRadius: 8, padding: 16, marginBottom: 20 }}
          >
            <header style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span
                style={{
                  background: statusMeta?.bg,
                  color: statusMeta?.color,
                  fontSize: "0.78em",
                  fontWeight: 600,
                  padding: "3px 10px",
                  borderRadius: 999,
                }}
              >
                {statusMeta?.label}
              </span>
              <code style={{ fontSize: "0.75em", color: "#999" }}>{row.storyId}</code>
              <span style={{ fontSize: "0.75em", color: "#999" }}>
                {row.updatedAt.toISOString()} · {(row.durationMs / 1000).toFixed(1)}s
              </span>
            </header>

            <div style={{ margin: "8px 0" }}>
              <UsageChip label="Rewrite" usage={perCallUsage.rewrite} />
              <UsageChip label="Self-check" usage={perCallUsage.selfCheck} />
              <UsageChip label="Judge" usage={perCallUsage.judge} />
            </div>

            <details style={{ marginBottom: 10 }}>
              <summary style={{ cursor: "pointer", fontSize: "0.85em", color: "#0645ad" }}>
                Eredeti angol forrás(ok)
              </summary>
              <OriginalSources sources={originalSources} />
            </details>

            <details style={{ marginBottom: 10 }} open={lexiconMatches.length > 0}>
              <summary style={{ cursor: "pointer", fontSize: "0.85em", color: "#0645ad" }}>
                Futballnyelvi lexikon — felismert kifejezések ({lexiconMatches.length})
              </summary>
              <LexiconMatches matches={lexiconMatches} />
            </details>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div style={{ background: "#fafafa", borderRadius: 6, padding: 10 }}>
                <p
                  style={{
                    fontSize: "0.72em",
                    textTransform: "uppercase",
                    color: "#999",
                    margin: 0,
                  }}
                >
                  A · Hungarian Writer (eredeti magyar draft)
                </p>
                <h3 style={{ margin: "4px 0" }}>{row.titleA}</h3>
                <p style={{ color: "#555" }}>{row.leadA}</p>
                <p style={{ fontSize: "0.92em", whiteSpace: "pre-wrap" }}>{row.bodyA}</p>
                <QualityBadges quality={qualityA} label="A" />
              </div>
              <div style={{ background: "#f0f6ff", borderRadius: 6, padding: 10 }}>
                <p
                  style={{
                    fontSize: "0.72em",
                    textTransform: "uppercase",
                    color: "#999",
                    margin: 0,
                  }}
                >
                  B · Editorial Rewrite + lexikon (a sárgával kiemelt mondatok változtak A-hoz
                  képest — mondatonként itt taníthatod is a rendszert)
                </p>
                <h3 style={{ margin: "4px 0" }}>{row.titleB}</h3>
                <TeachableSentence storyId={row.storyId} sentenceHu={row.titleB} />
                <p style={{ color: "#555" }}>{row.leadB}</p>
                <TeachableSentence storyId={row.storyId} sentenceHu={row.leadB} />
                <div style={{ fontSize: "0.92em" }}>
                  {(() => {
                    const normalizedA = new Set(
                      splitSentences(row.bodyA).map((sentence) => sentence.toLowerCase()),
                    );
                    return splitSentences(row.bodyB).map((sentence, index) => {
                      const changed = !normalizedA.has(sentence.toLowerCase());
                      return (
                        <div key={index} style={{ marginBottom: 4 }}>
                          {changed ? (
                            <mark style={{ background: "#fff3a3", padding: "0 2px" }}>
                              {sentence}
                            </mark>
                          ) : (
                            <span>{sentence}</span>
                          )}
                          <TeachableSentence storyId={row.storyId} sentenceHu={sentence} />
                        </div>
                      );
                    });
                  })()}
                </div>
                <QualityBadges quality={qualityB} label="B" />
              </div>
            </div>

            <CorrectionHistory
              corrections={correctionsByStoryId.get(row.storyId) ?? []}
              applicationsByCorrectionId={applicationsByCorrectionId}
              sequenceByCorrectionId={sequenceByCorrectionId}
            />

            {rejectionReason && rejectionReason.length > 0 && (
              <div style={{ marginTop: 10, background: "#fdecea", borderRadius: 6, padding: 10 }}>
                <strong style={{ fontSize: "0.85em", color: "#b3261e" }}>
                  Tényellenőrzés talált eltérést:
                </strong>
                <ul style={{ fontSize: "0.85em", margin: "4px 0 0" }}>
                  {rejectionReason.map((reason, index) => (
                    <li key={index}>{reason}</li>
                  ))}
                </ul>
              </div>
            )}

            <div style={{ marginTop: 10, background: "#f5f5f5", borderRadius: 6, padding: 10 }}>
              <strong style={{ fontSize: "0.8em", color: "#666" }}>
                LLM-judge (KIEGÉSZÍTŐ információ, nem döntő bizonyíték):
              </strong>{" "}
              {judge ? (
                <span style={{ fontSize: "0.85em" }}>
                  {judge.winner === "tie"
                    ? "döntetlen"
                    : judge.winner === "A"
                      ? "A (eredeti) jobb"
                      : "B (átírt) jobb"}{" "}
                  (A={judge.scoreA.toFixed(1)}, B={judge.scoreB.toFixed(1)}) — {judge.rationaleHu}
                </span>
              ) : (
                <span style={{ fontSize: "0.85em", color: "#999" }}>
                  nem futott (rewrite nem lett elfogadva)
                </span>
              )}
            </div>
          </article>
        );
      })}
    </main>
  );
}

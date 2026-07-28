import type { Metadata } from "next";
import type { OriginalSourceContent } from "@magyarsportonline/db";
import type { footballLexicon } from "@magyarsportonline/agents";
import type { ReactNode } from "react";
import { createRepositories } from "../../../lib/db";

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

function renderChangedSentences(textA: string, textB: string): ReactNode {
  const normalizedA = new Set(splitSentences(textA).map((sentence) => sentence.toLowerCase()));
  return splitSentences(textB).map((sentence, index) => {
    const changed = !normalizedA.has(sentence.toLowerCase());
    return changed ? (
      <mark key={index} style={{ background: "#fff3a3", padding: "0 2px" }}>
        {sentence}{" "}
      </mark>
    ) : (
      <span key={index}>{sentence} </span>
    );
  });
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
  const { editorialAbSnapshotRepository } = createRepositories();
  const rows = await editorialAbSnapshotRepository.listAll();

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
                  képest)
                </p>
                <h3 style={{ margin: "4px 0" }}>{row.titleB}</h3>
                <p style={{ color: "#555" }}>{row.leadB}</p>
                <p style={{ fontSize: "0.92em" }}>{renderChangedSentences(row.bodyA, row.bodyB)}</p>
                <QualityBadges quality={qualityB} label="B" />
              </div>
            </div>

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

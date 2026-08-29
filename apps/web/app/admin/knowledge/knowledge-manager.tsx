"use client";

import type { EditorialKnowledgeRecord } from "@magyarsportonline/db";
import { useRouter } from "next/navigation";
import { useMemo, useState, type ChangeEvent, type ReactNode } from "react";

interface ImportPreview {
  digest: string;
  counts: { new: number; update: number; duplicate: number; conflict: number; invalid: number };
  decisions: Array<{
    index: number | null;
    stableKey: string | null;
    classification: "new" | "update" | "duplicate" | "conflict" | "invalid";
    reason: string | null;
  }>;
  applied?: boolean;
  importStatus?: "applied" | "blocked" | "duplicate";
}

interface ApiResponse {
  ok: boolean;
  error?: string;
  result?: ImportPreview;
}

const MAX_BYTES = 10 * 1024 * 1024;
const resultLabels = {
  new: "Új",
  update: "Frissül",
  duplicate: "Duplikált",
  conflict: "Konfliktus",
  invalid: "Hibás",
} as const;

export function KnowledgeManager({
  initialCounts,
  initialRecords,
}: {
  initialCounts: Record<"active" | "draft" | "deprecated", number>;
  initialRecords: EditorialKnowledgeRecord[];
}): ReactNode {
  const router = useRouter();
  const [rawPackage, setRawPackage] = useState("");
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [status, setStatus] = useState<"idle" | "previewing" | "applying" | "applied">("idle");
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const visibleRecords = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("hu-HU");
    if (!needle) return initialRecords;
    return initialRecords.filter((record) =>
      [record.stable_key, record.source_phrase, record.canonical_hu, record.knowledge_type]
        .filter(Boolean)
        .some((value) => value!.toLocaleLowerCase("hu-HU").includes(needle)),
    );
  }, [initialRecords, query]);

  async function onFileChange(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    setError("");
    setPreview(null);
    setStatus("idle");
    const file = event.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    if (file.size > MAX_BYTES) {
      setRawPackage("");
      setError("A fájl mérete legfeljebb 10 MB lehet.");
      return;
    }
    setRawPackage(await file.text());
  }

  async function requestImport(mode: "preview" | "apply"): Promise<void> {
    if (!rawPackage) return setError("Előbb válassz ki egy JSON tudáscsomagot.");
    if (mode === "apply" && !preview) return setError("Előbb készíts ellenőrzést.");
    setError("");
    setStatus(mode === "preview" ? "previewing" : "applying");
    const params = new URLSearchParams({ mode });
    if (mode === "apply") params.set("expectedDigest", preview!.digest);
    try {
      const response = await fetch(`/api/admin/knowledge/import?${params}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "X-MSO-Knowledge-Import": "1",
        },
        body: rawPackage,
        cache: "no-store",
      });
      const payload = (await response.json()) as ApiResponse;
      if (!response.ok || !payload.ok || !payload.result) {
        throw new Error(payload.error ?? "Az import ellenőrzése sikertelen.");
      }
      setPreview(payload.result);
      setStatus(mode === "apply" && payload.result.applied ? "applied" : "idle");
      if (mode === "apply" && payload.result.applied) router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Ismeretlen import hiba.");
      setStatus("idle");
    }
  }

  const blocked = Boolean(preview && (preview.counts.conflict > 0 || preview.counts.invalid > 0));

  return (
    <div>
      <section style={cardStyle}>
        <h2 style={{ marginTop: 0 }}>Tudásbázis</h2>
        <div className="admin-metric-grid">
          <StatusCard label="Aktív" value={initialCounts.active} />
          <StatusCard label="Tervezet" value={initialCounts.draft} />
          <StatusCard label="Kivezetett" value={initialCounts.deprecated} />
        </div>
        <label>
          <strong>Keresés az utolsó 100 rekordban</strong>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Kulcs, angol kifejezés vagy magyar alak"
            style={searchStyle}
          />
        </label>
        <ul style={{ paddingLeft: 20 }}>
          {visibleRecords.slice(0, 30).map((record) => (
            <li key={record.stable_key} style={{ marginBottom: 8 }}>
              <code>{record.stable_key}</code> · {record.status} ·{" "}
              {record.source_phrase ?? "szabály"}
              {record.canonical_hu ? ` → ${record.canonical_hu}` : ""}
            </li>
          ))}
        </ul>
        {initialRecords.length === 0 ? <p style={mutedStyle}>A V2 tudásbázis még üres.</p> : null}
      </section>

      <section style={cardStyle}>
        <h2 style={{ marginTop: 0 }}>Tudás importálása</h2>
        <p>JSON kiválasztása → ellenőrzés → eredmények áttekintése → alkalmazás.</p>
        <input type="file" accept="application/json,.json" onChange={onFileChange} />
        {fileName ? <p style={mutedStyle}>Kiválasztva: {fileName}</p> : null}
        <button
          type="button"
          onClick={() => void requestImport("preview")}
          disabled={!rawPackage || status === "previewing" || status === "applying"}
          style={buttonStyle}
        >
          {status === "previewing" ? "Ellenőrzés…" : "Ellenőrzés / dry-run"}
        </button>
      </section>

      {error ? <p style={errorStyle}>Hiba: {error}</p> : null}
      {preview ? (
        <section style={cardStyle}>
          <h2 style={{ marginTop: 0 }}>{status === "applied" ? "Import kész" : "Eredmény"}</h2>
          <div className="admin-metric-grid">
            {Object.entries(resultLabels).map(([key, label]) => (
              <StatusCard
                key={key}
                label={label}
                value={preview.counts[key as keyof ImportPreview["counts"]]}
              />
            ))}
          </div>
          {preview.decisions.some(
            (item) => item.classification === "conflict" || item.classification === "invalid",
          ) ? (
            <ul style={{ color: "#9a1c1c" }}>
              {preview.decisions
                .filter(
                  (item) => item.classification === "conflict" || item.classification === "invalid",
                )
                .map((item, index) => (
                  <li key={`${item.stableKey ?? "package"}-${index}`}>
                    <strong>{resultLabels[item.classification]}</strong>:{" "}
                    {item.stableKey ?? "csomag"}
                    {item.reason ? ` — ${item.reason}` : ""}
                  </li>
                ))}
            </ul>
          ) : null}
          {status === "applied" ? (
            <p style={successStyle}>
              {preview.importStatus === "duplicate"
                ? "A csomag már teljesen megtalálható; nem jött létre duplikáció."
                : "A V2 tudáscsomag tranzakciósan alkalmazva."}
            </p>
          ) : (
            <button
              type="button"
              onClick={() => void requestImport("apply")}
              disabled={blocked || status === "applying"}
              style={{ ...buttonStyle, background: blocked ? "#777" : "#1a7f37" }}
            >
              {status === "applying" ? "Importálás…" : "Import alkalmazása"}
            </button>
          )}
          {blocked ? (
            <p style={errorStyle}>Konfliktus vagy hibás rekord miatt az import blokkolva van.</p>
          ) : null}
        </section>
      ) : null}

      <section style={cardStyle}>
        <h2 style={{ marginTop: 0 }}>Export / backup</h2>
        <p>Csak az Editorial Knowledge V2 rekordjai kerülnek a verziózott JSON-csomagba.</p>
        <a
          href="/api/admin/knowledge/export"
          download
          style={{ ...buttonStyle, textDecoration: "none" }}
        >
          V2 tudáscsomag letöltése
        </a>
      </section>
    </div>
  );
}

function StatusCard({ label, value }: { label: string; value: number }): ReactNode {
  return (
    <div className="admin-metric-card">
      <span className="admin-metric-card__count mono">{value}</span>
      <strong className="admin-metric-card__label">{label}</strong>
    </div>
  );
}

const cardStyle = { border: "1px solid #ccc", borderRadius: 8, padding: 16, marginBottom: 16 };
const buttonStyle = {
  border: 0,
  borderRadius: 6,
  padding: "9px 14px",
  background: "#333",
  color: "white",
  cursor: "pointer",
  fontWeight: 600,
} as const;
const searchStyle = { display: "block", width: "100%", margin: "8px 0 16px", padding: 10 };
const mutedStyle = { color: "#666", fontSize: "0.9em" };
const errorStyle = { border: "1px solid #cf222e", background: "#fff0f0", padding: 12 };
const successStyle = { border: "1px solid #1a7f37", background: "#effbef", padding: 12 };

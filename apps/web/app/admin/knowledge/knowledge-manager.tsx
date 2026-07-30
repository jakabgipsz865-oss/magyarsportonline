"use client";

import { useState, type ChangeEvent, type ReactNode } from "react";

interface ImportCounts {
  corrections: { create: number; unchanged: number };
  sources: { create: number; update: number; unchanged: number; activationChanges: number };
  reviewPatterns: { create: number; update: number; unchanged: number };
}

interface ImportPreview {
  digest: string;
  exportedAt: string;
  applicationCommit: string;
  staticKnowledgeCompatible: boolean;
  counts: ImportCounts;
  warnings: string[];
  sourceActivationRequested: boolean;
}

interface ApiResponse {
  ok: boolean;
  error?: string;
  mode?: "preview" | "apply";
  result?: ImportPreview;
}

const MAX_BYTES = 10 * 1024 * 1024;

export function KnowledgeManager(): ReactNode {
  const [rawPackage, setRawPackage] = useState("");
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [previewActivation, setPreviewActivation] = useState(false);
  const [applySourceActivation, setApplySourceActivation] = useState(false);
  const [status, setStatus] = useState<"idle" | "previewing" | "applying" | "applied">("idle");
  const [error, setError] = useState("");

  async function onFileChange(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    setError("");
    setPreview(null);
    setStatus("idle");
    const file = event.target.files?.[0];
    if (!file) {
      setRawPackage("");
      setFileName("");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("A fájl mérete legfeljebb 10 MB lehet.");
      setRawPackage("");
      setFileName(file.name);
      return;
    }
    setRawPackage(await file.text());
    setFileName(file.name);
  }

  async function requestImport(mode: "preview" | "apply"): Promise<void> {
    if (!rawPackage) {
      setError("Előbb válassz ki egy JSON tudáscsomagot.");
      return;
    }
    setError("");
    setStatus(mode === "preview" ? "previewing" : "applying");
    const params = new URLSearchParams({
      mode,
      applySourceActivation: String(applySourceActivation),
    });
    if (mode === "apply") {
      if (!preview || previewActivation !== applySourceActivation) {
        setError("Az aktuális aktiválási beállítással előbb új előnézetet kell készíteni.");
        setStatus("idle");
        return;
      }
      params.set("expectedDigest", preview.digest);
    }
    try {
      const response = await fetch(`/api/admin/knowledge/import?${params.toString()}`, {
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
      setPreviewActivation(applySourceActivation);
      setStatus(mode === "apply" ? "applied" : "idle");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Ismeretlen import hiba.");
      setStatus("idle");
    }
  }

  return (
    <div>
      <section style={cardStyle}>
        <h2 style={{ marginTop: 0 }}>Export</h2>
        <p>
          Egyetlen, verziózott és ember által olvasható JSON-fájlba menti a futballlexikont,
          szerkesztői szabályokat, tanult korrekciókat, Source Registryt, hitelességi/publikálási
          szabályokat és review-mintákat.
        </p>
        <a
          href="/api/admin/knowledge/export"
          download
          style={{ ...buttonStyle, display: "inline-block", textDecoration: "none" }}
        >
          Tudáscsomag letöltése
        </a>
        <p style={mutedStyle}>
          Biztonság: API-kulcs, token, jelszó és más titok nem kerül az exportba.
        </p>
      </section>

      <section style={cardStyle}>
        <h2 style={{ marginTop: 0 }}>Import</h2>
        <p>
          Az előnézet nem ír adatot. Az alkalmazás tranzakciós és idempotens; meglévő tudást nem
          töröl.
        </p>
        <label style={{ display: "block", marginBottom: 12 }}>
          <strong>JSON tudáscsomag</strong>
          <br />
          <input type="file" accept="application/json,.json" onChange={onFileChange} />
        </label>
        {fileName ? <p style={mutedStyle}>Kiválasztva: {fileName}</p> : null}
        <label
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 8,
            padding: 10,
            border: "1px solid #d8b25c",
            background: "#fffbe6",
            borderRadius: 6,
            marginBottom: 12,
          }}
        >
          <input
            type="checkbox"
            checked={applySourceActivation}
            onChange={(event) => setApplySourceActivation(event.target.checked)}
          />
          <span>
            <strong>Source Registry aktív/inaktív állapotainak alkalmazása</strong>
            <br />
            <small>
              Bekapcsolva egy importált forrás production ingestet indíthat. Maszkolt titkot
              tartalmazó új forrás ettől függetlenül inaktív marad.
            </small>
          </span>
        </label>
        <button
          type="button"
          onClick={() => void requestImport("preview")}
          disabled={!rawPackage || status === "previewing" || status === "applying"}
          style={buttonStyle}
        >
          {status === "previewing" ? "Ellenőrzés…" : "Import előnézet"}
        </button>
      </section>

      {error ? (
        <p role="alert" style={{ ...messageStyle, borderColor: "#cf222e", background: "#fff0f0" }}>
          <strong>Hiba:</strong> {error}
        </p>
      ) : null}

      {preview ? (
        <section style={cardStyle}>
          <h2 style={{ marginTop: 0 }}>{status === "applied" ? "Import kész" : "Előnézet"}</h2>
          <p>
            Export: {new Date(preview.exportedAt).toLocaleString("hu-HU")} · commit:{" "}
            <code>{preview.applicationCommit.slice(0, 12)}</code>
          </p>
          <p>
            Kódszabály-kompatibilitás:{" "}
            <strong style={{ color: preview.staticKnowledgeCompatible ? "#1a7f37" : "#9a6700" }}>
              {preview.staticKnowledgeCompatible ? "azonos" : "eltérő verzió"}
            </strong>
          </p>
          <table style={{ borderCollapse: "collapse", width: "100%", marginBottom: 16 }}>
            <thead>
              <tr>
                <th style={cellStyle}>Adatkör</th>
                <th style={cellStyle}>Új</th>
                <th style={cellStyle}>Frissül</th>
                <th style={cellStyle}>Változatlan</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={cellStyle}>Szerkesztői korrekciók</td>
                <td style={cellStyle}>{preview.counts.corrections.create}</td>
                <td style={cellStyle}>0</td>
                <td style={cellStyle}>{preview.counts.corrections.unchanged}</td>
              </tr>
              <tr>
                <td style={cellStyle}>Source Registry</td>
                <td style={cellStyle}>{preview.counts.sources.create}</td>
                <td style={cellStyle}>{preview.counts.sources.update}</td>
                <td style={cellStyle}>{preview.counts.sources.unchanged}</td>
              </tr>
              <tr>
                <td style={cellStyle}>Review tanulási minták</td>
                <td style={cellStyle}>{preview.counts.reviewPatterns.create}</td>
                <td style={cellStyle}>{preview.counts.reviewPatterns.update}</td>
                <td style={cellStyle}>{preview.counts.reviewPatterns.unchanged}</td>
              </tr>
            </tbody>
          </table>
          <ul>
            {preview.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
          {status !== "applied" ? (
            <button
              type="button"
              onClick={() => void requestImport("apply")}
              disabled={status === "applying" || previewActivation !== applySourceActivation}
              style={{ ...buttonStyle, background: "#1a7f37" }}
            >
              {status === "applying" ? "Importálás…" : "Ellenőrzött import alkalmazása"}
            </button>
          ) : (
            <p
              role="status"
              style={{ ...messageStyle, borderColor: "#1a7f37", background: "#effbef" }}
            >
              A tudáscsomag tranzakciósan importálva. Ugyanez a fájl újra alkalmazható duplikáció
              nélkül.
            </p>
          )}
        </section>
      ) : null}
    </div>
  );
}

const cardStyle = {
  border: "1px solid #ccc",
  borderRadius: 8,
  padding: 16,
  marginBottom: 16,
} as const;

const buttonStyle = {
  border: 0,
  borderRadius: 6,
  padding: "9px 14px",
  background: "#333",
  color: "white",
  cursor: "pointer",
  fontWeight: 600,
} as const;

const mutedStyle = { color: "#666", fontSize: "0.9em" } as const;
const messageStyle = { border: "1px solid", borderRadius: 6, padding: 12 } as const;
const cellStyle = { border: "1px solid #ccc", padding: 8, textAlign: "left" } as const;

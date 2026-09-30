import Link from "next/link";
import { d1Binding } from "../../../lib/db";
import { loadControlTower, qaIssueCounts } from "../../../lib/control-tower";
import { TowerShell, Metrics } from "../_components/tower-shell";
import { languageQa } from "@magyarsportonline/agents";
export const dynamic = "force-dynamic";
interface AuditRow {
  id: string;
  status: string;
  reason: string | null;
  model: string;
  audited_at: string | null;
  title_hu: string;
  issues: string;
  new_version_id: string | null;
}
export default async function QualityPage() {
  const db = d1Binding();
  if (!db)
    return (
      <TowerShell path="/admin/quality" title="Minőség">
        <p>Nincs D1-adatforrás.</p>
      </TowerShell>
    );
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const [data, audits, types, drafts] = await Promise.all([
    loadControlTower(db),
    db
      .prepare(
        `SELECT q.id,q.status,q.reason,q.model,q.audited_at,q.issues,q.new_version_id,v.title_hu FROM language_qa_audits q JOIN story_versions v ON v.id=q.version_id ORDER BY q.queued_at DESC LIMIT 30`,
      )
      .all<AuditRow>(),
    qaIssueCounts(db, new Date(since)),
    db
      .prepare(
        `SELECT s.id,v.title_hu,v.quality_issues FROM stories s JOIN story_versions v ON v.story_id=s.id WHERE s.status IN ('draft','pending_review','written','seo_ready') AND v.created_at>=? AND v.version_number=(SELECT max(version_number) FROM story_versions WHERE story_id=s.id) ORDER BY v.created_at DESC LIMIT 30`,
      )
      .bind(since)
      .all<{ id: string; title_hu: string; quality_issues: string | null }>(),
  ]);
  const q = (status: string) => data.qa.find((r) => r.status === status)?.count ?? 0;
  return (
    <TowerShell path="/admin/quality" title="Minőség és autonóm lektorálás">
      <Metrics
        items={[
          { label: "Ellenőrzött Writer Story · 24h", value: data.stats?.checked ?? "—" },
          { label: "Quality PASS · 24h", value: data.stats?.qualityPass ?? "—" },
          { label: "Draft · 24h", value: data.stats?.draft ?? "—" },
          {
            label: "number_integrity · 24h",
            value: data.flags.find((f) => f.code === "number_integrity")?.stories ?? 0,
          },
          { label: "Language QA PASS", value: q("pass") },
          { label: "Automatikus repair", value: q("repaired") },
          { label: "Repair rejected", value: q("repair_rejected") },
          { label: "Technikai QA-hiba", value: q("technical_error") },
          ...languageQa.QA_ISSUE_TYPES.map((type) => ({
            label: type,
            value: types.find((t) => t.issue_type === type)?.count ?? 0,
          })),
        ]}
      />
      <p>
        A QA-számlálók verzió / tartalmi hash állapotokat mutatnak; a sikeres javítás utáni
        determinisztikus PASS-validációt is tartalmazzák.
      </p>
      <h2>Tárolt quality flag-ek · 24h</h2>
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Story</th>
              <th>Előfordulás</th>
            </tr>
          </thead>
          <tbody>
            {data.flags.map((f) => (
              <tr key={f.code}>
                <td>{f.code}</td>
                <td>{f.stories}</td>
                <td>{f.occurrences}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h2>Language QA audit · legutóbbi 30</h2>
      {audits.results.length ? (
        audits.results.map((row) => (
          <details className="admin-audit" key={row.id}>
            <summary>
              {row.title_hu} · {row.status}
            </summary>
            <p>
              OK: {row.reason ?? "Sorban áll"} · MODELL: {row.model} · IDŐPONT:{" "}
              {row.audited_at ?? "Még nem auditált"}
            </p>
            {(JSON.parse(row.issues) as languageQa.LanguageQaResponse["issues"]).map((issue) => (
              <div className="admin-audit-diff" key={issue.sentence_id}>
                <p>
                  {issue.type} · {issue.sentence_id}
                </p>
                <strong>EREDETI</strong>
                <p>{issue.original}</p>
                <strong>JAVÍTOTT / JAVASLAT</strong>
                <p>{issue.replacement}</p>
              </div>
            ))}
            {row.new_version_id ? <p>Új verzió: {row.new_version_id}</p> : null}
          </details>
        ))
      ) : (
        <p>Még nincs Language QA audit.</p>
      )}
      <h2>Visszatartott draftok · legutóbbi 30</h2>
      {drafts.results.map((row) => (
        <details className="admin-audit" key={row.id}>
          <summary>{row.title_hu}</summary>
          <p>
            {(
              JSON.parse(row.quality_issues ?? "[]") as Array<{
                code: string;
                detail?: string;
                repaired?: boolean;
              }>
            )
              .filter((f) => !f.repaired)
              .map((f) => `${f.code}${f.detail ? ": " + f.detail.slice(0, 180) : ""}`)
              .join(" · ") || "Nincs tárolt quality flag"}
          </p>
        </details>
      ))}
      <p className="admin-diagnostic-links">
        Ritka manuális diagnosztika: <Link href="/admin/review">Review queue</Link> ·{" "}
        <Link href="/admin/missed-merge-review">Missed merge ellenőrzés</Link>
      </p>
    </TowerShell>
  );
}

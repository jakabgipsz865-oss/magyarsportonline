import Link from "next/link";
import { d1Binding } from "../../../lib/db";
import { env } from "../../../lib/env";
import { loadControlTower, schedulerHealth } from "../../../lib/control-tower";
import { D1PipelineJobRepository } from "@magyarsportonline/db/d1";
import { tabloid, languageQa } from "@magyarsportonline/agents";
import { TowerShell, Metrics } from "./tower-shell";
import { runtimeEnvironment } from "../../../lib/runtime-environment";
import { currentMonthExternalSpendUsd } from "@magyarsportonline/llm";
import { loadWriterHealth } from "../../../lib/writer-health";
import { WriterHealthPanel } from "./writer-health";
export async function TowerSystem() {
  const db = d1Binding();
  if (!db || !env.D1_PIPELINE_START_AT)
    return (
      <TowerShell path="/admin/system" title="Rendszer">
        <p>Nincs aktív D1 pipeline-kötés.</p>
      </TowerShell>
    );
  const [data, queue, health] = await Promise.all([
    loadControlTower(db),
    new D1PipelineJobRepository(db).getStatusCounts(new Date(), env.D1_PIPELINE_START_AT),
    loadWriterHealth(db, env.D1_PIPELINE_START_AT),
  ]);
  return (
    <TowerShell path="/admin/system" title="Cloudflare · tényleges runtime">
      <WriterHealthPanel health={health} />
      <Metrics
        items={[
          { label: "Környezet", value: runtimeEnvironment() },
          {
            label: "Primary Writer",
            value: env.GEMINI_MODEL,
            note: `${env.LLM_PROVIDER === "none" ? "Teszt / provider OFF" : "Gemini · aktív"} · napi cap: ${env.GEMINI_DAILY_REQUEST_CAP}`,
          },
          {
            label: "Gemini havi alkalmazásoldali hard cap",
            value: `$${env.GEMINI_MONTHLY_BUDGET_USD.toFixed(2)}`,
            note: `UTC hónap · igazolt ledgeren kívüli költés: $${currentMonthExternalSpendUsd({ externalSpentUsd: env.GEMINI_MONTHLY_EXTERNAL_SPEND_USD ?? 0, externalSpentMonth: env.GEMINI_MONTHLY_EXTERNAL_SPEND_MONTH }).toFixed(2)} · Language QA külön napi keret`,
          },
          {
            label: "AI-költség · aktuális UTC hónap",
            value: `$${data.usageMonth.reduce((sum, row) => sum + row.cost, 0).toFixed(6)}`,
            note: "D1 llm_usage · tokenalapú becslés · nem Cloudflare credit-egyenleg",
          },
          {
            label: "Targeted repair",
            value: tabloid.TABLOID_REPAIR_MODEL,
            note: "Csak tisztán repairable quality ág",
          },
          {
            label: "Language QA",
            value: languageQa.LANGUAGE_QA_MODEL,
            note: `${env.LANGUAGE_QA_ENABLED ? "ON" : "OFF"} · ${env.LANGUAGE_QA_MOCK_MODE !== "false" ? "Preview mock" : "Workers AI"} · ${env.LANGUAGE_QA_DAILY_CALL_CAP} hívás / $${env.LANGUAGE_QA_DAILY_BUDGET_USD} napi cap`,
          },
          {
            label: "Determinista quality gate",
            value: "AKTÍV",
            note: "Multilingual number integrity és nyelvi szabályok",
          },
          { label: "Fact extraction", value: "NEM AKTÍV", note: "Jelenlegi tabloid D1 ág" },
          { label: "Self-check", value: "NEM AKTÍV", note: "Jelenlegi tabloid D1 ág" },
          {
            label: "Automatikus publikálás",
            value: env.TABLOID_AUTO_PUBLISH && !env.FORCE_REVIEW_MODE ? "ON" : "OFF",
          },
          {
            label: "Draft recovery végrehajtás",
            value: env.DRAFT_RECOVERY_ENABLED
              ? "ON · külön megerősítés szükséges"
              : "OFF · csak dry-run",
          },
          {
            label: "Scheduler",
            value: schedulerHealth(data.scheduler),
            note: data.scheduler?.updated_at ?? "Nincs heartbeat",
          },
          {
            label: "Utolsó scheduler-hiba",
            value: data.scheduler?.last_error_at ?? "Nincs tárolt hiba",
          },
          { label: "RSS ingest", value: data.lastIngest ?? "Nincs sikeres fetch" },
          {
            label: "Pipeline queue",
            value: `${queue.pending} várakozó · ${queue.inProgress} futó · ${queue.deadLetter} dead-letter`,
            note: `Utolsó lezárás: ${queue.lastCompletedAt?.toISOString() ?? "Nincs"}`,
          },
          {
            label: "Facebook",
            value: env.FACEBOOK_AUTO_PUBLISH ? "ON" : "OFF",
            note: "Recovery és Language QA nem hoz létre social intentet",
          },
        ]}
      />
      <h2>AI szerepkör / státusz · utolsó 24h</h2>
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Role</th>
              <th>Státusz</th>
              <th>Hívás / foglalás</th>
              <th>Becsült USD</th>
            </tr>
          </thead>
          <tbody>
            {data.usage24h.map((row) => (
              <tr key={`${row.role}:${row.status}`}>
                <td>{row.role}</td>
                <td>{row.status}</td>
                <td>{row.calls}</td>
                <td>${row.cost.toFixed(6)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h2>RSS-források</h2>
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Forrás</th>
              <th>Aktív</th>
              <th>Utolsó fetch</th>
              <th>Státusz</th>
            </tr>
          </thead>
          <tbody>
            {data.sources.map((row) => (
              <tr key={row.name}>
                <td>{row.name}</td>
                <td>{row.is_active ? "Igen" : "Nem"}</td>
                <td>{row.last_fetched_at ?? "Nincs"}</td>
                <td>{row.last_fetch_status ?? "Nincs"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="admin-diagnostic-links">
        <Link href="/admin/review">Review diagnosztika</Link> ·{" "}
        <Link href="/admin/missed-merge-review">Missed merge diagnosztika</Link>
      </p>
    </TowerShell>
  );
}

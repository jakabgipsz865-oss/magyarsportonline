import type { ReactNode } from "react";
import { createRepositories } from "../../../lib/db";
import { env } from "../../../lib/env";
import { AdminHeader } from "../_components/admin-header";

export const dynamic = "force-dynamic";

function iso(value: Date | null | undefined): string {
  return value?.toISOString() ?? "—";
}

export default async function AdminSystemPage(): Promise<ReactNode> {
  const repos = createRepositories();
  const now = new Date();
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [sources, queue, lastPublication, quality, usage] = await Promise.all([
    repos.sourceRepository.listAll(),
    repos.pipelineJobRepository.getStatusCounts(),
    repos.storyRepository.getLastPublicationAt(),
    repos.storyVersionRepository.getTabloidQualityMetricsSince(since),
    repos.llmUsageRepository.getMonthlyRoleMetrics(monthStart),
  ]);
  const lastIngest =
    sources
      .filter((source) => source.lastFetchStatus === "ok" && source.lastFetchedAt)
      .map((source) => source.lastFetchedAt!)
      .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
  const lastCron =
    sources
      .map((source) => source.lastFetchedAt)
      .filter((value): value is Date => value instanceof Date)
      .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
  const metric = (role: string, status?: string) =>
    usage
      .filter((row) => row.role === role && (!status || row.status === status))
      .reduce(
        (total, row) => ({ calls: total.calls + row.calls, costUsd: total.costUsd + row.costUsd }),
        { calls: 0, costUsd: 0 },
      );
  const primary = metric("primary");
  const primarySuccess = metric("primary", "success");
  const primaryFailed = metric("primary", "failed");
  const repair = metric("targeted_repair");
  const repairSuccess = metric("targeted_repair", "success");
  const repairFailed = metric("targeted_repair", "failed");
  const fallback = metric("technical_fallback");
  const totalCost = usage.reduce((sum, row) => sum + row.costUsd, 0);
  const flagRate = quality.checked ? Math.round((quality.flagged / quality.checked) * 100) : 0;
  const repairRate = quality.checked ? Math.round((repair.calls / quality.checked) * 100) : 0;

  return (
    <main className="admin-page">
      <AdminHeader activePath="/admin/system" />
      <section className="admin-dashboard__intro">
        <p className="admin-eyebrow">Rendszer</p>
        <h1>Production pipeline állapot</h1>
        <p>Az aktív RSS → tabloid Writer → quality/repair → publish útvonal állapota.</p>
      </section>

      <section className="admin-dashboard__section">
        <h2>Pipeline · utolsó 24 óra</h2>
        <div className="admin-metric-grid">
          <div className="admin-metric-card">
            <strong>Utolsó cron</strong>
            <span>{iso(lastCron)}</span>
            <span>* * * * * · percenként</span>
          </div>
          <div className="admin-metric-card">
            <strong>Utolsó sikeres RSS ingest</strong>
            <span>{iso(lastIngest)}</span>
          </div>
          <div className="admin-metric-card">
            <strong>Utolsó sikeres queue process</strong>
            <span>{iso(queue.lastCompletedAt)}</span>
          </div>
          <div className="admin-metric-card">
            <strong>Utolsó publikálás</strong>
            <span>{iso(lastPublication)}</span>
          </div>
          <div className="admin-metric-card">
            <strong>Queue</strong>
            <span>
              pending {queue.pending} · in_progress {queue.inProgress}
            </span>
            <span>
              stale {queue.stale} · dead-letter {queue.deadLetter}
            </span>
          </div>
        </div>
      </section>

      <section className="admin-dashboard__section">
        <h2>Writer és quality</h2>
        <div className="admin-metric-grid">
          <div className="admin-metric-card">
            <strong>Primary Writer</strong>
            <span>Gemini · {env.GEMINI_MODEL}</span>
            <span>
              {primary.calls} hívás · {primarySuccess.calls} siker · {primaryFailed.calls} technikai
              hiba
            </span>
          </div>
          <div className="admin-metric-card">
            <strong>Quality</strong>
            <span>
              {quality.checked} ellenőrzött · {quality.flagged} flaggelt
            </span>
            <span>
              HARD {quality.hard} · LANGUAGE {quality.language} · {flagRate}%
            </span>
            <span>
              {quality.reasons.map((reason) => `${reason.code}: ${reason.count}`).join(" · ") ||
                "nincs flag reason"}
            </span>
          </div>
          <div className="admin-metric-card">
            <strong>Targeted repair</strong>
            <span>Gemini · gemini-3.5-flash</span>
            <span>
              {repair.calls} kísérlet · {repairSuccess.calls} siker · {repairFailed.calls} hiba ·{" "}
              {repairRate}%
            </span>
          </div>
          <div className="admin-metric-card">
            <strong>Technical fallback</strong>
            <span>{fallback.calls} teljes Flash Writer-hívás</span>
          </div>
        </div>
      </section>

      <section className="admin-dashboard__section">
        <h2>Aktuális havi AI-költség</h2>
        <div className="admin-metric-grid">
          <div className="admin-metric-card">
            <strong>Primary</strong>
            <span>${primary.costUsd.toFixed(4)}</span>
          </div>
          <div className="admin-metric-card">
            <strong>Repair</strong>
            <span>${repair.costUsd.toFixed(4)}</span>
          </div>
          <div className="admin-metric-card">
            <strong>Fallback</strong>
            <span>${fallback.costUsd.toFixed(4)}</span>
          </div>
          <div className="admin-metric-card">
            <strong>Összesen</strong>
            <span>${totalCost.toFixed(4)} / $10 külső plafon</span>
            <span>App-oldali tartalék: ${env.GEMINI_MONTHLY_BUDGET_USD.toFixed(2)}</span>
          </div>
        </div>
      </section>

      <section className="admin-dashboard__section">
        <h2>Források</h2>
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
              {sources.map((source) => (
                <tr key={source.id}>
                  <td>{source.name}</td>
                  <td>{source.isActive ? "igen" : "nem"}</td>
                  <td>{iso(source.lastFetchedAt)}</td>
                  <td>{source.lastFetchStatus ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

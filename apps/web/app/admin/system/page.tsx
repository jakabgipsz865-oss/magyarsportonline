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
  const [sources, queue, lastPublication, quality, usage24h, usageMonth, facebook] =
    await Promise.all([
      repos.sourceRepository.listAll(),
      repos.pipelineJobRepository.getStatusCounts(),
      repos.storyRepository.getLastPublicationAt(),
      repos.storyVersionRepository.getTabloidQualityMetricsSince(since),
      repos.llmUsageRepository.getMonthlyRoleMetrics(since),
      repos.llmUsageRepository.getMonthlyRoleMetrics(monthStart),
      repos.socialPostRepository.getFacebookMetricsSince(since),
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
  const metric = (
    rows: Array<{ role: string; status: string; calls: number; costUsd: number }>,
    role: string,
    status?: string,
  ) =>
    rows
      .filter((row) => row.role === role && (!status || row.status === status))
      .reduce(
        (total, row) => ({ calls: total.calls + row.calls, costUsd: total.costUsd + row.costUsd }),
        { calls: 0, costUsd: 0 },
      );
  const primary = metric(usage24h, "primary");
  const repair = metric(usage24h, "targeted_repair");
  const fallback = metric(usage24h, "technical_fallback");
  const primaryCost = metric(usageMonth, "primary");
  const repairCost = metric(usageMonth, "targeted_repair");
  const fallbackCost = metric(usageMonth, "technical_fallback");
  const totalCost = usageMonth.reduce((sum, row) => sum + row.costUsd, 0);
  const flagRate = quality.checked ? Math.round((quality.flagged / quality.checked) * 100) : 0;
  const repairRate = quality.checked ? Math.round((repair.calls / quality.checked) * 100) : 0;
  const primaryUsable = Math.max(0, primary.calls - fallback.calls);

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
              {primary.calls} hívás · {primaryUsable} siker · {fallback.calls} technikai hiba
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
              {repair.calls} kísérlet · {quality.repairSucceeded} elfogadva · {quality.repairFailed}{" "}
              sikertelen · {repairRate}%
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
            <span>${primaryCost.costUsd.toFixed(4)}</span>
          </div>
          <div className="admin-metric-card">
            <strong>Repair</strong>
            <span>${repairCost.costUsd.toFixed(4)}</span>
          </div>
          <div className="admin-metric-card">
            <strong>Fallback</strong>
            <span>${fallbackCost.costUsd.toFixed(4)}</span>
          </div>
          <div className="admin-metric-card">
            <strong>Összesen</strong>
            <span>${totalCost.toFixed(4)} / $10 külső plafon</span>
            <span>App-oldali tartalék: ${env.GEMINI_MONTHLY_BUDGET_USD.toFixed(2)}</span>
          </div>
        </div>
      </section>

      <section className="admin-dashboard__section">
        <h2>Facebook</h2>
        <div className="admin-metric-grid">
          <div className="admin-metric-card">
            <strong>Facebook auto publish</strong>
            <span>{env.FACEBOOK_AUTO_PUBLISH ? "ON" : "OFF"}</span>
            <span>Meta Graph API {env.META_GRAPH_API_VERSION}</span>
          </div>
          <div className="admin-metric-card">
            <strong>Queue</strong>
            <span>
              queued {facebook.queued} · posting {facebook.posting}
            </span>
            <span>
              posted 24h {facebook.posted24h} · failed 24h {facebook.failed24h}
            </span>
          </div>
          <div className="admin-metric-card">
            <strong>Utolsó Facebook-poszt</strong>
            <span>{iso(facebook.lastPostedAt)}</span>
            <span>External ID: {facebook.lastExternalPostId ?? "—"}</span>
          </div>
          <div className="admin-metric-card">
            <strong>Utolsó Facebook-hiba</strong>
            <span>{facebook.lastErrorCode ?? "—"}</span>
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

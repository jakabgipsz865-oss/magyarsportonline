import type { ReactNode } from "react";
import { geminiQuotaDayStart, MODEL_TIERS } from "@magyarsportonline/llm";
import { createRepositories } from "../../../lib/db";
import { env } from "../../../lib/env";
import { AdminHeader } from "../_components/admin-header";

export const dynamic = "force-dynamic";

function rate(ok: number, failed: number): string {
  const total = ok + failed;
  return total ? `${Math.round((ok / total) * 100)}% (${ok}/${total})` : "nincs adat";
}

export default async function AdminSystemPage(): Promise<ReactNode> {
  const repos = createRepositories();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [
    sources,
    content,
    agents,
    queue,
    storyStatuses,
    usage,
    geminiCalls,
    extractionFailure,
    aiDeferral,
  ] = await Promise.all([
    repos.sourceRepository.listAll(),
    repos.rawArticleRepository.getContentHealth(),
    repos.agentRunRepository.getRecentHealth(since),
    repos.pipelineJobRepository.getStatusCounts(),
    repos.storyRepository.getStatusCounts(since),
    repos.llmUsageRepository.listRecent(1_000),
    repos.llmUsageRepository.countSince("gemini", geminiQuotaDayStart()),
    repos.agentRunRepository.getLatestFailure("fact-verification"),
    repos.pipelineJobRepository.findActiveDeferral("[daily_ai_quota]"),
  ]);
  const recentUsage = usage.filter((row) => row.occurredAt >= since);
  const writer = agents.find((agent) => agent.agentName === "hungarian-writer");
  const extraction = agents.find((agent) => agent.agentName === "fact-verification");

  return (
    <main className="admin-page">
      <AdminHeader activePath="/admin/system" />
      <section className="admin-dashboard__intro">
        <p className="admin-eyebrow">Rendszer</p>
        <h1>Production pipeline állapot</h1>
        <p>Valós adatbázis- és providerhasználat az elmúlt 24 órából. Titkok nem jelennek meg.</p>
      </section>

      <section className="admin-dashboard__section">
        <h2>AI szerepek és kvóta</h2>
        <div className="admin-metric-grid">
          <div className="admin-metric-card">
            <strong>Fact Extraction</strong>
            <span>Cloudflare · {MODEL_TIERS.extraction}</span>
            <span>Siker: {rate(extraction?.completed ?? 0, extraction?.failed ?? 0)}</span>
          </div>
          <div className="admin-metric-card">
            <strong>Hungarian Writer</strong>
            <span>Gemini · {env.GEMINI_MODEL}</span>
            <span>Siker: {rate(writer?.completed ?? 0, writer?.failed ?? 0)}</span>
          </div>
          <div className="admin-metric-card">
            <strong>Self-check</strong>
            <span>Cloudflare · {MODEL_TIERS.selfCheck}</span>
            <span>Writer-futásonként külön ellenőrzés</span>
          </div>
          <div className="admin-metric-card">
            <strong>Gemini napi hard cap</strong>
            <span>
              {geminiCalls} / {env.GEMINI_DAILY_REQUEST_CAP ?? "nincs konfigurálva"}
            </span>
            <span>Free-only: {env.GEMINI_FREE_ONLY}</span>
          </div>
          <div className="admin-metric-card">
            <strong>AI defer</strong>
            <span>
              {aiDeferral ? `aktív ${aiDeferral.toISOString()}-ig` : "nincs aktív kvótahalasztás"}
            </span>
            <span>Paid fallback: OFF</span>
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
                <th>Watermark</th>
              </tr>
            </thead>
            <tbody>
              {sources.map((source) => (
                <tr key={source.id}>
                  <td>{source.name}</td>
                  <td>{source.isActive ? "igen" : "nem"}</td>
                  <td>{source.lastFetchedAt?.toISOString() ?? "—"}</td>
                  <td>{source.lastFetchStatus ?? "—"}</td>
                  <td>{source.ingestWatermarkAt?.toISOString() ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="admin-dashboard__section">
        <h2>Article Fetcher és pipeline</h2>
        <div className="admin-metric-grid">
          <div className="admin-metric-card">
            <strong>Full article</strong>
            <span>
              {content.fullArticle} / {content.total}
            </span>
            <span>RSS fallback: {content.rssSnippet}</span>
          </div>
          <div className="admin-metric-card">
            <strong>Átlagos source body</strong>
            <span>{content.averageBodyLength} karakter</span>
          </div>
          <div className="admin-metric-card">
            <strong>Legutóbbi extraction hiba</strong>
            <span>{extractionFailure?.errorMessage ?? "nincs rögzített hiba"}</span>
            <span>{extractionFailure?.occurredAt.toISOString() ?? "—"}</span>
          </div>
          <div className="admin-metric-card">
            <strong>Queue</strong>
            <span>
              pending {queue.pending} · running {queue.inProgress}
            </span>
            <span>dead-letter {queue.deadLetter}</span>
          </div>
          <div className="admin-metric-card">
            <strong>LLM-hívás / writer run</strong>
            <span>
              {writer?.completed
                ? (recentUsage.length / writer.completed).toFixed(1)
                : "nincs adat"}
            </span>
            <span>24 órás közelítés</span>
          </div>
        </div>
        <p>
          Story státuszok (24 óra):{" "}
          {storyStatuses.map((item) => `${item.status}: ${item.count}`).join(" · ") ||
            "nincs Story"}
        </p>
      </section>
    </main>
  );
}

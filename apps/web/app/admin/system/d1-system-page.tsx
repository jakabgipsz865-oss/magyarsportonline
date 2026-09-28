import type { ReactNode } from "react";
import { D1PipelineJobRepository } from "@magyarsportonline/db/d1";
import { d1Binding } from "../../../lib/db";
import { env } from "../../../lib/env";
import { AdminHeader } from "../_components/admin-header";

export async function D1SystemPage(): Promise<ReactNode> {
  const db = d1Binding();
  if (!db) throw new Error("D1 admin binding is missing");
  const activation = env.D1_PIPELINE_START_AT;
  if (!activation) throw new Error("D1 pipeline activation boundary is missing");
  const since = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
  const [queue, sources, article, usage, social] = await Promise.all([
    new D1PipelineJobRepository(db).getStatusCounts(new Date(), activation),
    db.prepare(`SELECT name,is_active,last_fetched_at,last_fetch_status FROM sources
      ORDER BY name`).all<{ name: string; is_active: number; last_fetched_at: string | null;
        last_fetch_status: string | null }>(),
    db.prepare(`SELECT MAX(published_at) AS last_publication FROM stories
      WHERE status='published'`).first<{ last_publication: string | null }>(),
    db.prepare(`SELECT role,COUNT(*) AS calls,SUM(CAST(cost_usd AS REAL)) AS cost_usd
      FROM llm_usage WHERE occurred_at>=? GROUP BY role`).bind(since)
      .all<{ role: string; calls: number; cost_usd: number }>(),
    db.prepare(`SELECT status,COUNT(*) AS count FROM social_posts WHERE platform='facebook'
      GROUP BY status`).all<{ status: string; count: number }>(),
  ]);
  return <main className="admin-page">
    <AdminHeader activePath="/admin/system" />
    <h1>Cloudflare D1 rendszerállapot</h1>
    <p>Az új feldolgozás kezdete: {activation.toISOString()}</p>
    <p>Automatikus publikálás: {env.TABLOID_AUTO_PUBLISH ? "ON" : "OFF"} ·
      Kényszerített review: {env.FORCE_REVIEW_MODE ? "ON" : "OFF"} ·
      Facebook: {env.FACEBOOK_AUTO_PUBLISH ? "ON" : "OFF"}</p>
    <h2>Feldolgozási sor</h2>
    <p>Várakozik: {queue.pending} · Folyamatban: {queue.inProgress} ·
      Befejezett: {queue.completed} · Hibás: {queue.deadLetter}</p>
    <p>Utolsó lezárás: {queue.lastCompletedAt?.toISOString() ?? "nincs"}</p>
    <p>Utolsó publikáció: {article?.last_publication ?? "nincs"}</p>
    <h2>AI-használat az elmúlt 24 órában</h2>
    <ul>{usage.results.map(row => <li key={row.role}>{row.role}: {row.calls} hívás,
      ${Number(row.cost_usd ?? 0).toFixed(4)}</li>)}</ul>
    <h2>Facebook-átadások</h2>
    <ul>{social.results.map(row => <li key={row.status}>{row.status}: {row.count}</li>)}</ul>
    <h2>RSS-források</h2>
    <table className="admin-table"><thead><tr><th>Forrás</th><th>Aktív</th><th>Utolsó fetch</th><th>Státusz</th></tr></thead>
      <tbody>{sources.results.map(row => <tr key={row.name}><td>{row.name}</td>
        <td>{row.is_active ? "igen" : "nem"}</td><td>{row.last_fetched_at ?? "—"}</td>
        <td>{row.last_fetch_status ?? "—"}</td></tr>)}</tbody></table>
  </main>;
}

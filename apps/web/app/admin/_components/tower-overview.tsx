import { d1Binding } from "../../../lib/db";
import { env } from "../../../lib/env";
import { loadControlTower, schedulerHealth } from "../../../lib/control-tower";
import { readTrendingSnapshot } from "../../../lib/trending-store";
import { TowerShell, Metrics } from "./tower-shell";
export async function TowerOverview() {
  const db = d1Binding();
  if (!db)
    return (
      <TowerShell path="/admin" title="Áttekintés">
        <p>Nincs jelenleg megbízható D1-adatforrás.</p>
      </TowerShell>
    );
  const [data, snapshot] = await Promise.all([loadControlTower(db), readTrendingSnapshot(db)]);
  const q = (s: string) => data.qa.find((r) => r.status === s)?.count ?? 0;
  const total = (rows: typeof data.usage24h) => rows.reduce((s, r) => s + r.cost, 0);
  const fresh = snapshot && Date.now() - new Date(snapshot.refreshedAt).getTime() < 12 * 60_000;
  return (
    <TowerShell path="/admin" title="Mit csinál most a szerkesztőség?">
      <Metrics
        items={[
          {
            label: "Publikált cikk ma",
            value: data.stats?.publishedToday ?? "—",
            note: "UTC nap · eredeti publikációs időrend",
          },
          { label: "Publikált cikk · 24h", value: data.stats?.published24h ?? "—" },
          {
            label: "Writer Story · 24h",
            value: data.stats?.writerStories ?? "—",
            note: "Meglévő Primary Writer-verzióval",
          },
          { label: "Draft · 24h", value: data.stats?.draft ?? "—" },
          { label: "Quality blocked · 24h", value: data.stats?.qualityBlocked ?? "—" },
          {
            label: "Language QA",
            value: env.LANGUAGE_QA_ENABLED ? "ON" : "OFF",
            note:
              env.LANGUAGE_QA_MOCK_MODE !== "false"
                ? "Kizárólag Preview mock"
                : "Külön engedéllyel aktiválható",
          },
          { label: "Language QA PASS · 24h", value: q("pass") },
          {
            label: "Automatikus javítás ma",
            value: data.qa.find((r) => r.status === "repaired")?.todayCount ?? 0,
            note: "UTC nap",
          },
          { label: "Rejected QA repair · 24h", value: q("repair_rejected") },
          { label: "Utolsó sikeres RSS ingest", value: data.lastIngest ?? "Nincs mérés" },
          { label: "Scheduler", value: schedulerHealth(data.scheduler) },
          { label: "Utolsó publikálás", value: data.stats?.lastPublication ?? "Nincs" },
          {
            label: "Trending snapshot",
            value: fresh ? "FRISS" : "STALE / fallback",
            note: snapshot?.refreshedAt ?? "Még nincs snapshot",
          },
          {
            label: "Facebook · 24h",
            value: env.FACEBOOK_AUTO_PUBLISH ? "ON" : "OFF",
            note: data.social.map((r) => `${r.status}: ${r.count}`).join(" · ") || "Nincs átadás",
          },
          {
            label: "AI-költség · 24h",
            value: `$${total(data.usage24h).toFixed(6)}`,
            note: "llm_usage · tokenalapú becsült költség",
          },
          { label: "AI-költség · hónap", value: `$${total(data.usageMonth).toFixed(6)}` },
        ]}
      />
    </TowerShell>
  );
}

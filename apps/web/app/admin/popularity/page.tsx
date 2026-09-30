import Link from "next/link";
import { d1Binding } from "../../../lib/db";
import { readTrendingSnapshot } from "../../../lib/trending-store";
import { pickTrending, HERO_CHALLENGER_RATIO, heroEligible } from "../../../lib/trending";
import { schedulerHealth, type SchedulerState } from "../../../lib/control-tower";
import { TowerShell, Metrics } from "../_components/tower-shell";
export const dynamic = "force-dynamic";
export default async function PopularityPage() {
  const db = d1Binding();
  if (!db)
    return (
      <TowerShell path="/admin/popularity" title="Népszerűség">
        <p>Nincs D1-adatforrás.</p>
      </TowerShell>
    );
  const [snapshot, scheduler] = await Promise.all([
    readTrendingSnapshot(db),
    db
      .prepare("SELECT * FROM operational_state WHERE component='scheduler'")
      .first<SchedulerState>(),
  ]);
  const selected = pickTrending(snapshot, new Date()),
    hero = snapshot?.ranking.find((r) => r.storyId === selected.heroId),
    challenger = snapshot?.ranking.find(
      (r) =>
        r.storyId !== selected.heroId &&
        heroEligible(r, new Date()) &&
        r.normal24h + r.promoted24h >= 5,
    );
  const ids = snapshot?.ranking.map((r) => r.storyId) ?? [];
  const titles = ids.length
    ? (
        await db
          .prepare(
            `SELECT story_id,title_hu FROM story_read_model WHERE story_id IN (${ids.map(() => "?").join(",")})`,
          )
          .bind(...ids)
          .all<{ story_id: string; title_hu: string }>()
      ).results
    : [];
  const title = (id: string) => titles.find((r) => r.story_id === id)?.title_hu ?? id;
  const read = (rank: typeof hero, key: "1h" | "6h" | "24h") =>
    rank
      ? key === "1h"
        ? rank.normal1h + rank.promoted1h
        : key === "6h"
          ? rank.normal6h + rank.promoted6h
          : rank.normal24h + rank.promoted24h
      : "—";
  return (
    <TowerShell path="/admin/popularity" title="Népszerűség · qualified reads">
      <Metrics
        items={[
          {
            label: "NÉPSZERŰ MOST hero",
            value: hero ? title(hero.storyId) : "Legfrissebb főhír · fallback",
          },
          {
            label: "Hero kiválasztva",
            value: snapshot?.hero?.selectedAt ?? "—",
            note: "30 perc minimum, amíg érvényes",
          },
          { label: "Hero score", value: hero?.score.toFixed(2) ?? "—" },
          { label: "Hero qualified reads · 1h", value: read(hero, "1h") },
          { label: "Hero qualified reads · 6h", value: read(hero, "6h") },
          { label: "Hero qualified reads · 24h", value: read(hero, "24h") },
          { label: "Challenger", value: challenger ? title(challenger.storyId) : "Nincs" },
          { label: "Challenger score", value: challenger?.score.toFixed(2) ?? "—" },
          {
            label: "Szükséges +25% küszöb",
            value: hero ? (hero.score * HERO_CHALLENGER_RATIO).toFixed(2) : "—",
          },
          {
            label: "Snapshot refresh",
            value: snapshot?.refreshedAt ?? "Nincs",
            note:
              !snapshot || Date.now() - new Date(snapshot.refreshedAt).getTime() >= 12 * 60_000
                ? "STALE · kronológiai fallback"
                : "FRISS · 5 perces frissítés",
          },
          { label: "Scheduler health", value: schedulerHealth(scheduler) },
        ]}
      />
      <p>
        A score súlyozott rangsorolási érték. A számlálók érdemi cikkolvasást jelentenek; nem UV, PV
        vagy session. Órás bucketekből számolt időablakok.
      </p>
      <h2>MOST PÖRÖG</h2>
      <ol>
        {selected.sideIds.map((id) => (
          <li key={id}>{title(id)}</li>
        ))}
      </ol>
      <h2>MOST EZT OLVASSÁK · TOP5</h2>
      <ol>
        {selected.topFiveIds.map((id) => (
          <li key={id}>{title(id)}</li>
        ))}
      </ol>
      <h2>Aktuális rangsor</h2>
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Cikk</th>
              <th>Score</th>
              <th>1h</th>
              <th>6h</th>
              <th>24h</th>
            </tr>
          </thead>
          <tbody>
            {snapshot?.ranking.map((row) => (
              <tr key={row.storyId}>
                <td>
                  <Link href={`/hir/${row.slug}`}>{title(row.storyId)}</Link>
                </td>
                <td>{row.score.toFixed(2)}</td>
                <td>{read(row, "1h")}</td>
                <td>{read(row, "6h")}</td>
                <td>{read(row, "24h")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </TowerShell>
  );
}

import Link from "next/link";
import type { ReactNode } from "react";
import { AdminHeader } from "./_components/admin-header";
import { createRepositories } from "../../lib/db";

export const dynamic = "force-dynamic";

function DashboardMetricCard({
  href,
  count,
  labelHu,
  descriptionHu,
}: {
  href: string;
  count: number;
  labelHu: string;
  descriptionHu: string;
}): ReactNode {
  return (
    <Link href={href} className="admin-metric-card" data-tone="attention">
      <span className="admin-metric-card__count mono">{count}</span>
      <strong className="admin-metric-card__label">{labelHu}</strong>
      <span className="admin-metric-card__description">{descriptionHu}</span>
    </Link>
  );
}

/**
 * Admin dashboard (2026-07-29, "kézzelfogható admin dashboard" sprint) —
 * a `/admin` korábban 404-et adott, mert csak alsóbb útvonalak léteztek
 * (`/admin/review`, `/admin/missed-merge-review`). Ez az áttekintő oldal a
 * belépési pont. A számlálók szándékosan csak a két meglévő queue olcsó,
 * közvetlen lekérdezését használják; a teljes triage- és merge-újraszámítás
 * a részletes adminoldalak feladata marad.
 */
export default async function AdminDashboardPage(): Promise<ReactNode> {
  const repos = createRepositories();
  const [pendingReviewCount, pendingMergeReviewCount] = await Promise.all([
    repos.reviewQueueRepository.countPending(),
    repos.missedMergeReviewRepository.countPending(),
  ]);

  return (
    <main className="admin-page">
      <AdminHeader activePath="/admin" />
      <section className="admin-dashboard__intro" aria-labelledby="admin-dashboard-title">
        <p className="admin-eyebrow">Áttekintés</p>
        <h1 id="admin-dashboard-title">Mi igényel figyelmet?</h1>
        <p>Az elsődleges szerkesztői feladatok és a feldolgozás aktuális állapota egy helyen.</p>
      </section>

      <section className="admin-dashboard__section" aria-labelledby="news-status-title">
        <div className="admin-section-heading">
          <div>
            <p className="admin-eyebrow">Hírek</p>
            <h2 id="news-status-title">Feldolgozási állapot</h2>
          </div>
          <Link href="/admin/review" className="admin-text-link">
            Összes hír megnyitása
          </Link>
        </div>
        <div className="admin-metric-grid">
          <DashboardMetricCard
            href="/admin/review"
            count={pendingReviewCount}
            labelHu="Ellenőrzésre vár"
            descriptionHu="Még nyitott szerkesztői feladatok."
          />
          <DashboardMetricCard
            href="/admin/missed-merge-review"
            count={pendingMergeReviewCount}
            labelHu="Összevonási döntésre vár"
            descriptionHu="Hírpárok, amelyeknél emberi döntés szükséges."
          />
        </div>
      </section>

      <section className="admin-dashboard__section" aria-labelledby="admin-tasks-title">
        <div className="admin-section-heading">
          <div>
            <p className="admin-eyebrow">Admin feladatok</p>
            <h2 id="admin-tasks-title">Ellenőrzés és szerkesztői tudás</h2>
          </div>
        </div>
        <div className="admin-action-grid">
          <Link href="/admin/missed-merge-review" className="admin-action-card">
            <span className="admin-action-card__value mono">{pendingMergeReviewCount}</span>
            <strong>Összevonási döntésre vár</strong>
            <span>Ellenőrizd, hogy két hír ugyanarról az eseményről szól-e.</span>
          </Link>
          <Link href="/admin/knowledge" className="admin-action-card">
            <span className="admin-action-card__icon" aria-hidden="true">
              ↕
            </span>
            <strong>Szerkesztői tudás</strong>
            <span>Keresd, exportáld vagy validáltan importáld a V2 tudásbázist.</span>
          </Link>
        </div>
      </section>
    </main>
  );
}

import Link from "next/link";
import type { ReactNode } from "react";
import { publishGate } from "@magyarsportonline/agents";
import { AdminHeader } from "./_components/admin-header";
import { listTriagedReviewItems } from "../../lib/review-triage";
import { refreshAndListMissedMergeReviews } from "../../lib/missed-merge-review";

type StoryTriageCategory = publishGate.StoryTriageCategory;

export const dynamic = "force-dynamic";

const TILE_ORDER: StoryTriageCategory[] = [
  "human_decision_required",
  "ready_for_review",
  "auto_repair_required",
  "reject_or_archive",
];

const TILE_CONTENT: Record<
  StoryTriageCategory,
  { labelHu: string; descriptionHu: string; tone: string }
> = {
  human_decision_required: {
    labelHu: "Döntésre vár",
    descriptionHu: "Hírek, amelyekhez szerkesztői döntés szükséges.",
    tone: "attention",
  },
  ready_for_review: {
    labelHu: "Kész ellenőrzésre",
    descriptionHu: "Feldolgozott hírek, amelyek átnézhetők.",
    tone: "success",
  },
  auto_repair_required: {
    labelHu: "Automatikus javítás alatt",
    descriptionHu: "A rendszer által kezelt, még nem kész hírek.",
    tone: "neutral",
  },
  reject_or_archive: {
    labelHu: "Archiválandó",
    descriptionHu: "Nem publikálható vagy már lezárt tételek.",
    tone: "danger",
  },
};

const TILE_HREF: Record<StoryTriageCategory, string> = {
  human_decision_required: "/admin/review?category=human_decision_required",
  ready_for_review: "/admin/review?category=ready_for_review",
  auto_repair_required: "/admin/review?category=auto_repair_required",
  reject_or_archive: "/admin/review?category=reject_or_archive",
};

function CategoryTile({
  category,
  count,
}: {
  category: StoryTriageCategory;
  count: number;
}): ReactNode {
  const content = TILE_CONTENT[category];

  return (
    <Link href={TILE_HREF[category]} className="admin-metric-card" data-tone={content.tone}>
      <span className="admin-metric-card__count mono">{count}</span>
      <strong className="admin-metric-card__label">{content.labelHu}</strong>
      <span className="admin-metric-card__description">{content.descriptionHu}</span>
    </Link>
  );
}

/**
 * Admin dashboard (2026-07-29, "kézzelfogható admin dashboard" sprint) —
 * a `/admin` korábban 404-et adott, mert csak alsóbb útvonalak léteztek
 * (`/admin/review`, `/admin/missed-merge-review`). Ez az áttekintő oldal a
 * belépési pont: kategóriánkénti számlálók (a triage rétegből,
 * lib/review-triage.ts) + a Story-merge review pending száma, mindkettő
 * linkkel a részletes nézetre.
 */
export default async function AdminDashboardPage(): Promise<ReactNode> {
  const [{ countsByCategory }, missedMerge] = await Promise.all([
    listTriagedReviewItems(),
    refreshAndListMissedMergeReviews(),
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
          {TILE_ORDER.map((category) => (
            <CategoryTile key={category} category={category} count={countsByCategory[category]} />
          ))}
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
            <span className="admin-action-card__value mono">{missedMerge.pending.length}</span>
            <strong>Összevonási döntésre vár</strong>
            <span>Ellenőrizd, hogy két hír ugyanarról az eseményről szól-e.</span>
          </Link>
          <Link href="/internal/editorial-ab-review" className="admin-action-card">
            <span className="admin-action-card__icon" aria-hidden="true">
              Aa
            </span>
            <strong>Nyelvi tanítás</strong>
            <span>Javítások, futballkifejezések és szerkesztői minták kezelése.</span>
          </Link>
          <Link href="/admin/knowledge" className="admin-action-card">
            <span className="admin-action-card__icon" aria-hidden="true">
              ↕
            </span>
            <strong>Tudás mentése és visszaállítása</strong>
            <span>Exportáld vagy validáltan importáld a szerkesztői tudást.</span>
          </Link>
        </div>
      </section>
    </main>
  );
}

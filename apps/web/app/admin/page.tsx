import Link from "next/link";
import type { ReactNode } from "react";
import { publishGate } from "@magyarsportonline/agents";
import { AdminHeader } from "./_components/admin-header";
import { listTriagedReviewItems } from "../../lib/review-triage";
import { refreshAndListMissedMergeReviews } from "../../lib/missed-merge-review";

const { STORY_TRIAGE_CATEGORY_LABELS_HU } = publishGate;
type StoryTriageCategory = publishGate.StoryTriageCategory;

export const dynamic = "force-dynamic";

const TILE_ORDER: StoryTriageCategory[] = [
  "human_decision_required",
  "ready_for_review",
  "auto_repair_required",
  "reject_or_archive",
];

const TILE_COLOR: Record<StoryTriageCategory, string> = {
  human_decision_required: "#9a6700",
  ready_for_review: "#1a7f37",
  auto_repair_required: "#57606a",
  reject_or_archive: "#cf222e",
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
  return (
    <Link
      href={TILE_HREF[category]}
      style={{
        display: "block",
        flex: "1 1 200px",
        minWidth: 200,
        border: `1px solid ${TILE_COLOR[category]}`,
        borderRadius: 8,
        padding: 16,
        textDecoration: "none",
        color: "inherit",
      }}
    >
      <p style={{ margin: 0, fontSize: "2.2em", fontWeight: 700, color: TILE_COLOR[category] }}>
        {count}
      </p>
      <p style={{ margin: "4px 0 0", fontWeight: 600 }}>
        {STORY_TRIAGE_CATEGORY_LABELS_HU[category]}
      </p>
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
    <main style={{ maxWidth: 900, margin: "0 auto", padding: "0 12px" }}>
      <AdminHeader activePath="/admin" />
      <h1>Áttekintés</h1>
      <p style={{ color: "#555" }}>
        A review queue automatikusan négy kategóriába van sorolva — csak az{" "}
        <strong>Emberi döntés szükséges</strong> kategória igényel kézi átnézést, a többit a
        rendszer automatikusan javítja vagy archiválja.
      </p>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 24 }}>
        {TILE_ORDER.map((category) => (
          <CategoryTile key={category} category={category} count={countsByCategory[category]} />
        ))}
      </div>

      <Link
        href="/admin/missed-merge-review"
        style={{
          display: "block",
          border: "1px solid #999",
          borderRadius: 8,
          padding: 16,
          textDecoration: "none",
          color: "inherit",
          maxWidth: 320,
        }}
      >
        <p style={{ margin: 0, fontSize: "2.2em", fontWeight: 700 }}>
          {missedMerge.pending.length}
        </p>
        <p style={{ margin: "4px 0 0", fontWeight: 600 }}>Story merge review — döntésre vár</p>
      </Link>

      <Link
        href="/internal/editorial-ab-review"
        style={{
          display: "block",
          border: "1px solid #1e7e34",
          borderRadius: 8,
          padding: 16,
          textDecoration: "none",
          color: "inherit",
          maxWidth: 320,
          marginTop: 12,
        }}
      >
        <p style={{ margin: 0, fontSize: "1.25em", fontWeight: 700 }}>Magyar nyelvi tanítás</p>
        <p style={{ margin: "4px 0 0" }}>
          Rossz→jó mondatpárok, futballszleng és szerkesztői memória
        </p>
      </Link>

      <Link
        href="/admin/knowledge"
        style={{
          display: "block",
          border: "1px solid #476582",
          borderRadius: 8,
          padding: 16,
          textDecoration: "none",
          color: "inherit",
          maxWidth: 320,
          marginTop: 12,
        }}
      >
        <p style={{ margin: 0, fontSize: "1.25em", fontWeight: 700 }}>Tudás export / import</p>
        <p style={{ margin: "4px 0 0" }}>Verziózott backup, migráció és validált visszaállítás</p>
      </Link>
    </main>
  );
}

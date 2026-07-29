import { revalidatePath } from "next/cache";
import Link from "next/link";
import type { ReactNode } from "react";
import { AdminHeader } from "../_components/admin-header";
import {
  decideMissedMergeReview,
  refreshAndListMissedMergeReviews,
  type MissedMergeReviewItem,
  type MissedMergeReviewStorySide,
} from "../../../lib/missed-merge-review";

// DB-driven admin nézet — sosem prerendelt, mindig friss (a betöltéskor
// újraszámolja a jelölt-listát is, lásd refreshAndListMissedMergeReviews).
export const dynamic = "force-dynamic";

const CANDIDATE_TYPE_LABELS_HU: Record<MissedMergeReviewItem["candidateType"], string> = {
  exact: "pontos egyezés (ugyanaz a nap)",
  adjacent: "jelölt (szomszédos napok)",
};

const DECISION_LABELS_HU: Record<NonNullable<MissedMergeReviewItem["decision"]>, string> = {
  merge: "✅ Merge",
  keep_separate: "🚫 Maradjon külön",
  uncertain: "❓ Bizonytalan",
};

const PRECISION_RECALL_THRESHOLD = 20;

async function decideAction(formData: FormData): Promise<void> {
  "use server";
  const id = formData.get("id");
  const decision = formData.get("decision");
  const note = formData.get("note");
  if (
    typeof id === "string" &&
    id.length > 0 &&
    (decision === "merge" || decision === "keep_separate" || decision === "uncertain")
  ) {
    await decideMissedMergeReview(
      id,
      decision,
      typeof note === "string" && note.trim().length > 0 ? note.trim() : undefined,
    );
  }
  revalidatePath("/admin/missed-merge-review");
}

function StorySideCard({
  side,
  label,
}: {
  side: MissedMergeReviewStorySide;
  label: string;
}): ReactNode {
  return (
    <div style={{ flex: 1, minWidth: 280, border: "1px solid #ddd", borderRadius: 6, padding: 12 }}>
      <p style={{ margin: 0, fontSize: "0.75em", color: "#888", textTransform: "uppercase" }}>
        {label}
      </p>
      <h3 style={{ marginTop: 4, marginBottom: 4 }}>{side.titleHu}</h3>
      <p style={{ color: "#444" }}>{side.leadHu}</p>
      <p style={{ fontSize: "0.85em", color: "#666" }}>
        Státusz: <strong>{side.status}</strong>
        {" · "}Utolsó frissítés: {new Date(side.lastUpdatedAt).toLocaleString("hu-HU")}
        {side.slug ? (
          <>
            {" · "}
            <Link href={`/hir/${side.slug}`} target="_blank">
              Publikus oldal ↗
            </Link>
          </>
        ) : null}
      </p>
      <p style={{ fontSize: "0.85em", color: "#666" }}>
        Források:{" "}
        {side.sources.length === 0
          ? "n/a"
          : side.sources.map((source, index) => (
              <span key={source.url}>
                {index > 0 ? ", " : ""}
                <a href={source.url} target="_blank" rel="noreferrer">
                  {source.name}
                </a>
              </span>
            ))}
      </p>
    </div>
  );
}

function ReviewCard({
  item,
  decidable,
}: {
  item: MissedMergeReviewItem;
  decidable: boolean;
}): ReactNode {
  return (
    <article
      style={{
        border: "1px solid #ccc",
        borderRadius: 8,
        padding: 16,
        marginBottom: 16,
        background: item.decision ? "#fafafa" : "white",
      }}
    >
      <p style={{ margin: 0, fontSize: "0.85em" }}>
        <strong>{CANDIDATE_TYPE_LABELS_HU[item.candidateType]}</strong>
        {" · "}Match score: <strong>{item.matchScore}/100</strong>
        {item.decision ? (
          <>
            {" · "}Döntés: <strong>{DECISION_LABELS_HU[item.decision]}</strong>
            {item.decidedAt ? ` (${new Date(item.decidedAt).toLocaleString("hu-HU")})` : ""}
          </>
        ) : null}
      </p>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 8 }}>
        <StorySideCard side={item.storyA} label="A Story" />
        <StorySideCard side={item.storyB} label="B Story" />
      </div>
      <p style={{ fontSize: "0.85em", marginTop: 8 }}>
        <strong>Egyező specifikus entitások:</strong>{" "}
        {item.matchedEntities.map((e) => `${e.nameCanonical} (${e.type})`).join(", ") || "nincs"}
      </p>
      {item.differingEntities.length > 0 ? (
        <p style={{ fontSize: "0.85em" }}>
          <strong>Eltérő specifikus entitások:</strong>{" "}
          {item.differingEntities.map((e) => `${e.nameCanonical} (${e.type})`).join(", ")}
        </p>
      ) : null}
      <p style={{ fontSize: "0.85em", color: "#555" }}>
        <strong>Rendszer indoklása:</strong> {item.decisionReasonHu}
      </p>
      {item.decisionNoteHu ? (
        <p style={{ fontSize: "0.85em", color: "#555" }}>
          <strong>Megjegyzés:</strong> {item.decisionNoteHu}
        </p>
      ) : null}
      {decidable ? (
        <form
          action={decideAction}
          style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}
        >
          <input type="hidden" name="id" value={item.id} />
          <input
            type="text"
            name="note"
            placeholder="Megjegyzés (opcionális)"
            style={{ flex: 1, minWidth: 160 }}
          />
          <button type="submit" name="decision" value="merge">
            ✅ Merge
          </button>
          <button type="submit" name="decision" value="keep_separate">
            🚫 Maradjon külön
          </button>
          <button type="submit" name="decision" value="uncertain">
            ❓ Bizonytalan
          </button>
        </form>
      ) : null}
    </article>
  );
}

/**
 * Kézi felülvizsgálati felület az "elmulasztott merge" jelöltekhez
 * (2026-07-29, docs/open-decisions.md #14 follow-up): a Story-párokat a
 * `computeMissedMergeCandidatePairs` fedezi fel — két MÁR LÉTEZŐ Story,
 * ami specifikus (csapat/játékos/edző) entitást oszt meg ugyanazon vagy
 * szomszédos napon —, a rendszer sosem vonja össze automatikusan (csak egy
 * friss cikket egy meglévő Story-val hasonlít össze, sosem két meglévő
 * Storyt egymással), ezért ez kizárólag emberi döntéssel dönthető el.
 *
 * A "Merge" gomb NEM hajt végre tényleges összevonást — kizárólag egy
 * címkét rögzít a regressziós tesztkészlet és a (legalább 20 kézi döntést
 * megkövetelő) precision/recall riport számára.
 *
 * Hozzáférés: HTTP Basic auth a middleware-ben (ADMIN_SECRET).
 */
export default async function MissedMergeReviewPage(): Promise<ReactNode> {
  const { pending, decided, decidedCount } = await refreshAndListMissedMergeReviews();

  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: "0 12px" }}>
      <AdminHeader activePath="/admin/missed-merge-review" />
      <h1>Elmulasztott merge — kézi felülvizsgálat</h1>
      <p>
        {pending.length === 0
          ? "Nincs kézi döntésre váró jelölt. 🎉"
          : `${pending.length} Story-pár vár kézi döntésre.`}
      </p>
      <p style={{ fontSize: "0.9em", color: "#555" }}>
        Kézzel ellenőrzött döntés eddig: <strong>{decidedCount}</strong> /{" "}
        {PRECISION_RECALL_THRESHOLD}
        {" — "}
        {decidedCount >= PRECISION_RECALL_THRESHOLD
          ? "elég adat áll rendelkezésre egy új precision/recall riporthoz."
          : "új precision/recall riport csak ennek elérése után készül, mesterséges szám nélkül."}
      </p>

      <h2>Döntésre váró jelöltek</h2>
      {pending.map((item) => (
        <ReviewCard key={item.id} item={item} decidable />
      ))}

      {decided.length > 0 ? (
        <>
          <h2>Már eldöntött párok ({decided.length})</h2>
          {decided.map((item) => (
            <ReviewCard key={item.id} item={item} decidable={false} />
          ))}
        </>
      ) : null}
    </main>
  );
}

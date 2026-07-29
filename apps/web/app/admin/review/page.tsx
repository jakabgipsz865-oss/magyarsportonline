import { revalidatePath } from "next/cache";
import Link from "next/link";
import type { ReactNode } from "react";
import { approveReviewItem, rejectReviewItem } from "../../../lib/review";
import { listPendingReviewDetails, type PendingReviewDetail } from "../../../lib/review-detail";

// DB-driven admin nézet — sosem prerendelt, mindig friss.
export const dynamic = "force-dynamic";

const REASON_LABELS_HU: Record<string, string> = {
  high_risk: "magas kockázat",
  contradiction: "ellentmondó tények",
  low_confidence: "alacsony confidence",
  manual_flag: "kézi jelölés",
  single_source_sensitive_category: "egyforrásos érzékeny téma",
  prompt_injection_suspected: "prompt injection gyanú",
  content_quality_failed: "minőségi ellenőrzés elbukott",
  force_review_mode: "kézi review kikényszerítve",
};

const LICENSE_TYPE_LABELS_HU: Record<string, string> = {
  public_rss: "nyilvános RSS",
  licensed_api: "licencelt API",
  scrape_allowed: "scraping engedélyezett",
  pending_review: "jogi ellenőrzés folyamatban",
};

async function approveAction(formData: FormData): Promise<void> {
  "use server";
  const itemId = formData.get("itemId");
  if (typeof itemId === "string" && itemId.length > 0) {
    await approveReviewItem(itemId);
  }
  revalidatePath("/admin/review");
}

async function rejectAction(formData: FormData): Promise<void> {
  "use server";
  const itemId = formData.get("itemId");
  if (typeof itemId === "string" && itemId.length > 0) {
    await rejectReviewItem(itemId);
  }
  revalidatePath("/admin/review");
}

function ReviewCard({ item }: { item: PendingReviewDetail }): ReactNode {
  return (
    <article style={{ border: "1px solid #ccc", borderRadius: 8, padding: 16, marginBottom: 16 }}>
      <h2 style={{ marginTop: 0 }}>{item.titleHu}</h2>
      <p style={{ fontWeight: 600 }}>{item.leadHu}</p>

      {item.image ? (
        <div style={{ marginBottom: 12 }}>
          {/* Plain <img>, not next/image: source images come from arbitrary RSS/CDN domains, matching components/media-thumb.tsx's convention. */}
          <img
            src={item.image.url}
            alt=""
            style={{ maxWidth: "100%", maxHeight: 320, borderRadius: 6 }}
          />
          <p style={{ fontSize: "0.8em", color: "#666" }}>
            Kép forrása: <strong>{item.image.sourceName ?? "ismeretlen"}</strong>
            {" · "}Licenc:{" "}
            <strong>
              {item.image.licenseType
                ? (LICENSE_TYPE_LABELS_HU[item.image.licenseType] ?? item.image.licenseType)
                : "n/a"}
            </strong>
            {item.image.attributionRule ? (
              <>
                {" · "}Attribution: {item.image.attributionRule}
              </>
            ) : null}
          </p>
        </div>
      ) : null}

      <details open style={{ marginBottom: 12 }}>
        <summary style={{ cursor: "pointer", fontWeight: 600 }}>Teljes magyar cikk</summary>
        <div style={{ whiteSpace: "pre-wrap", marginTop: 8 }}>{item.bodyHu}</div>
      </details>

      <div
        style={{
          border: "1px solid #e0c060",
          background: "#fffbe6",
          borderRadius: 6,
          padding: 10,
          marginBottom: 12,
        }}
      >
        <p style={{ margin: 0, fontWeight: 600 }}>
          Hitelességi pont:{" "}
          {item.credibilityScore === null ? "n/a" : `${item.credibilityScore}/100`}
          {item.credibilityLabelHu ? ` — ${item.credibilityLabelHu}` : ""}
        </p>
        {item.credibilityJustificationHu ? (
          <p style={{ margin: "4px 0 0", fontSize: "0.9em" }}>{item.credibilityJustificationHu}</p>
        ) : null}
      </div>

      {item.contradictions.length > 0 ? (
        <div
          style={{
            border: "1px solid #e08080",
            background: "#fff0f0",
            borderRadius: 6,
            padding: 10,
            marginBottom: 12,
          }}
        >
          <p style={{ margin: 0, fontWeight: 600 }}>
            ⚠ {item.contradictions.length} ellentmondó állítás
          </p>
          {item.contradictions.map((contradiction) => (
            <div key={contradiction.factType} style={{ marginTop: 6, fontSize: "0.9em" }}>
              <strong>{contradiction.factTypeLabelHu}:</strong>
              <ul style={{ margin: "4px 0" }}>
                {contradiction.claims.map((claim) => (
                  <li key={`${claim.sourceName}-${claim.detailHu}`}>
                    <strong>{claim.sourceName}:</strong> {claim.detailHu}
                  </li>
                ))}
              </ul>
              <p style={{ margin: 0, fontStyle: "italic" }}>{contradiction.statusHu}</p>
            </div>
          ))}
        </div>
      ) : null}

      <p style={{ fontSize: "0.9em" }}>
        <strong>Eredeti források és linkek:</strong>
      </p>
      <ul style={{ marginTop: 0 }}>
        {item.sources.length === 0 ? (
          <li>n/a</li>
        ) : (
          item.sources.map((source) => (
            <li key={source.url}>
              {source.name} ({source.reliabilityTier} megbízhatóság) —{" "}
              <a href={source.url} target="_blank" rel="noreferrer">
                forráscikk ↗
              </a>
            </li>
          ))
        )}
      </ul>

      <p style={{ fontSize: "0.9em", color: "#555" }}>
        Ok: <strong>{REASON_LABELS_HU[item.reason] ?? item.reason}</strong>
        {" · "}Confidence:{" "}
        <strong>{item.confidenceScore === null ? "n/a" : item.confidenceScore}</strong>
        {" · "}Kockázat: <strong>{item.riskLevel ?? "n/a"}</strong>
        {" · "}Bekerült: {item.createdAt.toISOString()}
      </p>
      <div style={{ display: "flex", gap: 8 }}>
        <form action={approveAction}>
          <input type="hidden" name="itemId" value={item.id} />
          <button type="submit">✅ Jóváhagyás és publikálás</button>
        </form>
        <form action={rejectAction}>
          <input type="hidden" name="itemId" value={item.id} />
          <button type="submit">❌ Elutasítás</button>
        </form>
      </div>
    </article>
  );
}

/**
 * Review felület (docs/architecture/08-roadmap.md Fázis 10, kibővítve
 * 2026-07-29-én "admin review — teljes bizonyíték jóváhagyás előtt"
 * sprintben): a Publish Gate által visszatartott Story-k kézi
 * jóváhagyása/elutasítása — jóváhagyás ELŐTT a teljes magyar cikk, az
 * eredeti források és linkjeik, a hitelességi pont és indoklása, az
 * esetleges ellentmondások, és a kép forrása/licence mind láthatók, hogy a
 * jóváhagyás sosem vak kattintás. Jóváhagyáskor a Story azonnal
 * publikálódik és megjelenik a publikus oldalon (`approveReviewItem`
 * szinkron frissíti a `story_read_model`-t, a `/hir/[slug]` oldal pedig
 * `force-dynamic`, tehát nincs cache-késleltetés).
 *
 * Hozzáférés: HTTP Basic auth a middleware-ben (ADMIN_SECRET).
 */
export default async function ReviewQueuePage(): Promise<ReactNode> {
  const items = await listPendingReviewDetails();

  return (
    <main>
      <p>
        <Link href="/">← Vissza a főoldalra</Link>
      </p>
      <h1>Review queue</h1>
      <p>
        {items.length === 0
          ? "Nincs jóváhagyásra váró Story. 🎉"
          : `${items.length} Story vár kézi döntésre.`}
      </p>
      {items.map((item) => (
        <ReviewCard key={item.id} item={item} />
      ))}
    </main>
  );
}

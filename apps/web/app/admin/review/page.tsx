import { revalidatePath } from "next/cache";
import Link from "next/link";
import type { ReactNode } from "react";
import { createRepositories } from "../../../lib/db";
import { approveReviewItem, rejectReviewItem } from "../../../lib/review";

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

/**
 * Minimális review felület (docs/architecture/08-roadmap.md Fázis 10):
 * a Publish Gate által visszatartott Story-k kézi jóváhagyása/elutasítása.
 * Hozzáférés: HTTP Basic auth a middleware-ben (ADMIN_SECRET).
 */
export default async function ReviewQueuePage(): Promise<ReactNode> {
  const { reviewQueueRepository } = createRepositories();
  const items = await reviewQueueRepository.listPending();

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
        <article
          key={item.id}
          style={{ border: "1px solid #ccc", borderRadius: 8, padding: 16, marginBottom: 16 }}
        >
          <h2 style={{ marginTop: 0 }}>{item.titleHu}</h2>
          <p>{item.leadHu}</p>
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
      ))}
    </main>
  );
}

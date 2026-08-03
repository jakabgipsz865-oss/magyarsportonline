import { revalidatePath } from "next/cache";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AdminHeader } from "../_components/admin-header";
import {
  approveReviewItem,
  editReviewItemContent,
  rejectReviewItem,
  snoozeReviewItem,
} from "../../../lib/review";
import { listTriagedReviewItems, type TriagedReviewItem } from "../../../lib/review-triage";
import { isEditorialCorrectionCategory } from "../../../lib/editorial-corrections";

// DB-driven admin nézet — sosem prerendelt, mindig friss (a betöltéskor
// újrafuttatja a triage-osztályozást is, lásd listTriagedReviewItems).
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

type TriageCategory = TriagedReviewItem["triageCategory"];

const CATEGORY_TABS: Array<{ category: TriageCategory; labelHu: string }> = [
  { category: "human_decision_required", labelHu: "Emberi döntés szükséges" },
  { category: "ready_for_review", labelHu: "Kész review-ra" },
  { category: "auto_repair_required", labelHu: "Automatikus javítás alatt" },
  { category: "reject_or_archive", labelHu: "Elutasítva / archiválva" },
];

const DEFAULT_CATEGORY: TriageCategory = "human_decision_required";
const PAGE_SIZE = 10;

async function approveAction(formData: FormData): Promise<void> {
  "use server";
  const itemId = formData.get("itemId");
  if (typeof itemId === "string" && itemId.length > 0) {
    const result = await approveReviewItem(itemId);
    if (!result.ok && result.error === "publication_blocked") {
      redirect("/admin/review?approval=blocked");
    }
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

async function laterAction(formData: FormData): Promise<void> {
  "use server";
  const itemId = formData.get("itemId");
  if (typeof itemId === "string" && itemId.length > 0) {
    await snoozeReviewItem(itemId);
  }
  revalidatePath("/admin/review");
}

async function editAction(formData: FormData): Promise<void> {
  "use server";
  const itemId = formData.get("itemId");
  const titleHu = formData.get("titleHu");
  const leadHu = formData.get("leadHu");
  const bodyHu = formData.get("bodyHu");
  const teachChanges = formData.get("teachChanges") === "on";
  const correctionCategory = formData.get("correctionCategory");
  const originalContextEn = formData.get("originalContextEn");
  if (
    typeof itemId === "string" &&
    itemId.length > 0 &&
    typeof titleHu === "string" &&
    typeof leadHu === "string" &&
    typeof bodyHu === "string" &&
    typeof correctionCategory === "string" &&
    isEditorialCorrectionCategory(correctionCategory) &&
    typeof originalContextEn === "string"
  ) {
    await editReviewItemContent(itemId, { titleHu, leadHu, bodyHu }, undefined, {
      enabled: teachChanges,
      category: correctionCategory,
      originalContextEn,
    });
  }
  revalidatePath("/admin/review");
}

/** Groups a Story's sources by name so the same outlet contributing several articles shows once, with a count, instead of repeating. */
function dedupedSources(sources: TriagedReviewItem["sources"]): Array<{
  name: string;
  reliabilityTier: string;
  url: string;
  count: number;
}> {
  const byName = new Map<
    string,
    { name: string; reliabilityTier: string; url: string; count: number }
  >();
  for (const source of sources) {
    const existing = byName.get(source.name);
    if (existing) {
      existing.count += 1;
    } else {
      byName.set(source.name, { ...source, count: 1 });
    }
  }
  return [...byName.values()];
}

function ReviewCard({
  item,
  decidable,
}: {
  item: TriagedReviewItem;
  decidable: boolean;
}): ReactNode {
  const sources = dedupedSources(item.sources);
  const isConfirmedHungarian =
    item.triageCategory === "human_decision_required" || item.triageCategory === "ready_for_review";

  return (
    <article style={{ border: "1px solid #ccc", borderRadius: 8, padding: 16, marginBottom: 16 }}>
      <h2 style={{ marginTop: 0 }}>{item.titleHu}</h2>
      <p style={{ fontWeight: 600 }}>{item.leadHu}</p>

      <div
        style={{
          border: "1px solid #9db8d8",
          background: "#eef3fb",
          borderRadius: 6,
          padding: 10,
          marginBottom: 12,
          fontSize: "0.9em",
        }}
      >
        <strong>Triage indoklás:</strong>
        <ul style={{ margin: "4px 0 0" }}>
          {item.triageReasonsHu.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      </div>

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
        <summary style={{ cursor: "pointer", fontWeight: 600 }}>
          {isConfirmedHungarian
            ? "Teljes magyar cikk"
            : "Cikk szövege (automatikus javításra/ellenőrzésre vár)"}
        </summary>
        <div style={{ whiteSpace: "pre-wrap", marginTop: 8 }}>{item.bodyHu}</div>
      </details>

      {decidable ? (
        <details style={{ marginBottom: 12 }}>
          <summary style={{ cursor: "pointer", fontWeight: 600 }}>✏️ Szerkesztés</summary>
          <form
            action={editAction}
            style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}
          >
            <input type="hidden" name="itemId" value={item.id} />
            <label>
              Cím
              <input
                type="text"
                name="titleHu"
                defaultValue={item.titleHu}
                style={{ width: "100%", padding: 6 }}
              />
            </label>
            <label>
              Lead
              <textarea
                name="leadHu"
                defaultValue={item.leadHu}
                rows={2}
                style={{ width: "100%", padding: 6 }}
              />
            </label>
            <label>
              Cikk törzse
              <textarea
                name="bodyHu"
                defaultValue={item.bodyHu}
                rows={10}
                style={{ width: "100%", padding: 6, fontFamily: "inherit" }}
              />
            </label>
            <fieldset style={{ border: "1px solid #7aa37a", borderRadius: 6, padding: 10 }}>
              <legend style={{ fontWeight: 600 }}>🧠 Tanítás ebből a szerkesztésből</legend>
              <label style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                <input type="checkbox" name="teachChanges" defaultChecked />
                <span>
                  A megváltoztatott mondatok mentése hordozható tanítóanyagként. Azonos javítás
                  újramentése nem készít duplikációt.
                </span>
              </label>
              <label style={{ display: "block", marginTop: 8 }}>
                Javítás típusa
                <select name="correctionCategory" defaultValue="style" style={{ marginLeft: 8 }}>
                  <option value="slang">Szleng</option>
                  <option value="terminology">Terminológia</option>
                  <option value="literal_translation">Tükörfordítás</option>
                  <option value="style">Stílus</option>
                  <option value="grammar">Nyelvhelyesség</option>
                  <option value="fact">Tény</option>
                </select>
              </label>
              <details style={{ marginTop: 8 }}>
                <summary style={{ cursor: "pointer" }}>Angol forráskontextus ellenőrzése</summary>
                <textarea
                  name="originalContextEn"
                  defaultValue={item.trainingContextEn}
                  rows={5}
                  placeholder="Ha nincs automatikusan betöltött forrásszöveg, a cikk menthető, de ebből a szerkesztésből nem készül tanítóanyag."
                  style={{ width: "100%", padding: 6, fontFamily: "inherit", marginTop: 6 }}
                />
              </details>
            </fieldset>
            <button type="submit" style={{ alignSelf: "flex-start" }}>
              💾 Mentés és tanítás
            </button>
          </form>
        </details>
      ) : null}

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
          {item.credibilityScore === null ? "n/a (javítás alatt)" : `${item.credibilityScore}/100`}
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
        {sources.length === 0 ? (
          <li>n/a</li>
        ) : (
          sources.map((source) => (
            <li key={source.name}>
              {source.name} ({source.reliabilityTier} megbízhatóság
              {source.count > 1 ? `, ${source.count} cikk` : ""}) —{" "}
              <a href={source.url} target="_blank" rel="noreferrer">
                forráscikk ↗
              </a>
            </li>
          ))
        )}
      </ul>

      <p style={{ fontSize: "0.9em", color: "#555" }}>
        Ok: <strong>{REASON_LABELS_HU[item.reason] ?? item.reason}</strong>
        {" · "}Kockázat: <strong>{item.riskLevel ?? "n/a"}</strong>
        {" · "}Bekerült: {item.createdAt.toLocaleString("hu-HU")}
      </p>
      {decidable ? (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <form action={approveAction}>
            <input type="hidden" name="itemId" value={item.id} />
            <button type="submit">✅ Jóváhagyás és publikálás</button>
          </form>
          <form action={rejectAction}>
            <input type="hidden" name="itemId" value={item.id} />
            <button type="submit">❌ Elutasítás</button>
          </form>
          <form action={laterAction}>
            <input type="hidden" name="itemId" value={item.id} />
            <button type="submit">⏳ Később</button>
          </form>
        </div>
      ) : (
        <p style={{ fontSize: "0.85em", fontStyle: "italic", color: "#777" }}>
          {item.triageCategory === "auto_repair_required"
            ? "Ezt a tételt a triage-sweep automatikusan újrafeldolgozza — nem igényel kézi döntést, amíg javítás alatt van."
            : "Ezt a tételt a triage-sweep automatikusan archiválja — nem igényel kézi döntést."}
        </p>
      )}
    </article>
  );
}

interface PageProps {
  searchParams: Promise<{ category?: string; page?: string; q?: string; approval?: string }>;
}

function buildHref(category: TriageCategory, page: number, query: string): string {
  const params = new URLSearchParams();
  params.set("category", category);
  if (page > 1) params.set("page", String(page));
  if (query) params.set("q", query);
  return `/admin/review?${params.toString()}`;
}

/**
 * Review felület (docs/architecture/08-roadmap.md Fázis 10, kibővítve
 * 2026-07-29-én "queue-tisztító és triage réteg" sprintben): a review queue
 * minden tétele automatikusan 4 kategóriába sorolódik
 * (packages/agents/src/publish-gate/triage.ts) — alapértelmezetten CSAK a
 * "Emberi döntés szükséges" kategória jelenik meg, hogy a szerkesztőnek ne
 * kelljen minden Storyt kézzel átnéznie. A másik 3 kategóriát (Kész
 * review-ra, Automatikus javítás alatt, Elutasítva/archiválva) a fülekkel
 * lehet megnézni, auditálás céljából — ott nincs jóváhagyás/elutasítás gomb,
 * mert azokat vagy a triage-sweep intézi automatikusan, vagy már el vannak
 * döntve.
 *
 * Hozzáférés: HTTP Basic auth a middleware-ben (ADMIN_SECRET).
 */
export default async function ReviewQueuePage({ searchParams }: PageProps): Promise<ReactNode> {
  const params = await searchParams;
  const category: TriageCategory = CATEGORY_TABS.some((tab) => tab.category === params.category)
    ? (params.category as TriageCategory)
    : DEFAULT_CATEGORY;
  const page = Math.max(1, Number(params.page) || 1);
  const query = (params.q ?? "").trim().toLowerCase();

  const { items, countsByCategory } = await listTriagedReviewItems();

  const filtered = items
    .filter((item) => item.triageCategory === category)
    .filter((item) => !query || item.titleHu.toLowerCase().includes(query));

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const decidable = category === "human_decision_required" || category === "ready_for_review";

  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: "0 12px" }}>
      <AdminHeader activePath="/admin/review" />
      <h1>Review queue</h1>

      {params.approval === "blocked" ? (
        <div
          role="alert"
          style={{
            border: "1px solid #b42318",
            background: "#fff1f0",
            color: "#7a271a",
            borderRadius: 6,
            padding: 12,
            marginBottom: 16,
          }}
        >
          <strong>A publikálás blokkolva.</strong> A rendszer a jelenlegi szövegen újra lefuttatta a
          nyelvi, tény-, hitelességi és forrásellenőrzést. Javítsd a tételt, majd próbáld újra.
        </div>
      ) : null}

      <nav style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        {CATEGORY_TABS.map((tab) => (
          <Link
            key={tab.category}
            href={buildHref(tab.category, 1, "")}
            style={{
              padding: "6px 12px",
              borderRadius: 6,
              border: "1px solid #999",
              textDecoration: "none",
              background: tab.category === category ? "#333" : "white",
              color: tab.category === category ? "white" : "#333",
            }}
          >
            {tab.labelHu} ({countsByCategory[tab.category]})
          </Link>
        ))}
      </nav>

      <form method="get" style={{ marginBottom: 16 }}>
        <input type="hidden" name="category" value={category} />
        <input type="text" name="q" placeholder="Keresés cím szerint…" defaultValue={query} />
        <button type="submit">Keresés</button>
      </form>

      <p>
        {filtered.length === 0
          ? "Nincs tétel ebben a kategóriában. 🎉"
          : `${filtered.length} tétel — ${page}. oldal / ${totalPages}`}
      </p>

      {pageItems.map((item) => (
        <ReviewCard key={item.id} item={item} decidable={decidable} />
      ))}

      {totalPages > 1 ? (
        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          {page > 1 ? <Link href={buildHref(category, page - 1, query)}>← Előző</Link> : null}
          {page < totalPages ? (
            <Link href={buildHref(category, page + 1, query)}>Következő →</Link>
          ) : null}
        </div>
      ) : null}
    </main>
  );
}

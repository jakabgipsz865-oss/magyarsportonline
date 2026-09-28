import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { d1Binding } from "../../../lib/db";
import { decideD1Review, editD1Review, listD1ReviewItems } from "../../../lib/d1-review";
import { AdminHeader } from "../_components/admin-header";

async function decisionAction(form: FormData): Promise<void> {
  "use server";
  const db = d1Binding();
  if (!db) throw new Error("D1 admin binding is missing");
  const itemId = form.get("itemId");
  const action = form.get("action");
  if (
    typeof itemId !== "string" ||
    (action !== "approve" && action !== "reject" && action !== "snooze")
  )
    return;
  const result = await decideD1Review(db, itemId, action);
  revalidatePath("/admin/review");
  if (!result.ok && result.error === "quality_blocked")
    redirect("/admin/review?result=quality_blocked");
}

async function editAction(form: FormData): Promise<void> {
  "use server";
  const db = d1Binding();
  if (!db) throw new Error("D1 admin binding is missing");
  const itemId = form.get("itemId");
  const titleHu = form.get("titleHu");
  const leadHu = form.get("leadHu");
  const bodyHu = form.get("bodyHu");
  if ([itemId, titleHu, leadHu, bodyHu].some((value) => typeof value !== "string")) return;
  const result = await editD1Review(db, itemId as string, {
    titleHu: titleHu as string,
    leadHu: leadHu as string,
    bodyHu: bodyHu as string,
  });
  revalidatePath("/admin/review");
  if (!result.ok) redirect(`/admin/review?result=${result.error}`);
}

export async function D1ReviewPage({
  result,
}: {
  result?: string | undefined;
}): Promise<ReactNode> {
  const db = d1Binding();
  if (!db) throw new Error("D1 admin binding is missing");
  const items = await listD1ReviewItems(db);
  return (
    <main className="admin-page">
      <AdminHeader activePath="/admin/review" />
      <h1>Szerkesztői ellenőrzés</h1>
      <p>
        Az itt látható tételek a Cloudflare D1 adatbázisból származnak. A minőségi hibás cikket a
        rendszer szerkesztés után is újraellenőrzi.
      </p>
      {result && <p role="alert">A művelet nem fejezhető be: {result}</p>}
      {items.length === 0 && <p>Nincs nyitott szerkesztői tétel.</p>}
      {items.map((item) => (
        <article key={item.id} className="admin-metric-card" style={{ marginBlock: 16 }}>
          <p>
            {item.reason} · {new Date(item.created_at).toLocaleString("hu-HU")}
          </p>
          <h2>{item.title_hu}</h2>
          <p>{item.lead_hu}</p>
          <p>{item.body_hu}</p>
          {item.source_url && (
            <p>
              <a href={item.source_url} target="_blank" rel="noreferrer">
                Eredeti forrás ↗
              </a>
            </p>
          )}
          {item.quality_issues && (
            <pre style={{ whiteSpace: "pre-wrap" }}>{item.quality_issues}</pre>
          )}
          <form action={editAction} style={{ display: "grid", gap: 8 }}>
            <input type="hidden" name="itemId" value={item.id} />
            <label>
              Cím <input name="titleHu" defaultValue={item.title_hu} required />
            </label>
            <label>
              Bevezető <textarea name="leadHu" defaultValue={item.lead_hu} required />
            </label>
            <label>
              Szöveg <textarea name="bodyHu" defaultValue={item.body_hu} rows={10} required />
            </label>
            <button type="submit">Szerkesztés mentése és minőségellenőrzés</button>
          </form>
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            {(["approve", "reject", "snooze"] as const).map((action) => (
              <form action={decisionAction} key={action}>
                <input type="hidden" name="itemId" value={item.id} />
                <input type="hidden" name="action" value={action} />
                <button type="submit">
                  {{ approve: "Jóváhagyás", reject: "Elutasítás", snooze: "Később" }[action]}
                </button>
              </form>
            ))}
          </div>
        </article>
      ))}
      <p>
        <Link href="/admin/system">Rendszerállapot</Link>
      </p>
    </main>
  );
}

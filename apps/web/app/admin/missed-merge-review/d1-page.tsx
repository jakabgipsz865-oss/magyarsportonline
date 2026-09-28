import { revalidatePath } from "next/cache";
import Link from "next/link";
import type { ReactNode } from "react";
import { d1Binding } from "../../../lib/db";
import { AdminHeader } from "../_components/admin-header";

interface Pair {
  id: string;
  candidate_type: string;
  match_score: number;
  decision_reason_hu: string;
  decision: string | null;
  decision_note_hu: string | null;
  a_title: string;
  a_slug: string | null;
  b_title: string;
  b_slug: string | null;
}

async function decide(form: FormData): Promise<void> {
  "use server";
  const db = d1Binding();
  if (!db) throw new Error("D1 admin binding is missing");
  const id = form.get("id");
  const decision = form.get("decision");
  const note = form.get("note");
  if (
    typeof id !== "string" ||
    (decision !== "merge" && decision !== "keep_separate" && decision !== "uncertain")
  )
    return;
  await db
    .prepare(
      `UPDATE missed_merge_reviews SET decision=?,decision_note_hu=?,
    decided_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE id=? AND decision IS NULL`,
    )
    .bind(decision, typeof note === "string" && note.trim() ? note.trim().slice(0, 2000) : null, id)
    .run();
  revalidatePath("/admin/missed-merge-review");
}

export async function D1MissedMergePage(): Promise<ReactNode> {
  const db = d1Binding();
  if (!db) throw new Error("D1 admin binding is missing");
  const rows = await db
    .prepare(
      `SELECT m.id,m.candidate_type,m.match_score,
    m.decision_reason_hu,m.decision,m.decision_note_hu,
    a.canonical_title a_title,a.slug a_slug,b.canonical_title b_title,b.slug b_slug
    FROM missed_merge_reviews m JOIN stories a ON a.id=m.story_a_id
      JOIN stories b ON b.id=m.story_b_id
    ORDER BY (m.decision IS NOT NULL),m.created_at DESC LIMIT 100`,
    )
    .all<Pair>();
  const pending = rows.results.filter((item) => item.decision === null);
  return (
    <main className="admin-page">
      <AdminHeader activePath="/admin/missed-merge-review" />
      <h1>Elmulasztott merge — kézi felülvizsgálat</h1>
      <p>
        {pending.length} D1-ben tárolt Story-pár vár döntésre. A „merge” döntés csak címkét rögzít,
        cikkeket nem von össze.
      </p>
      {rows.results.map((item) => (
        <article key={item.id} className="admin-metric-card" style={{ marginBlock: 16 }}>
          <p>
            {item.candidate_type} · pontszám: {item.match_score} · {item.decision_reason_hu}
          </p>
          <p>
            {item.a_slug ? <Link href={`/hir/${item.a_slug}`}>{item.a_title}</Link> : item.a_title}
          </p>
          <p>
            {item.b_slug ? <Link href={`/hir/${item.b_slug}`}>{item.b_title}</Link> : item.b_title}
          </p>
          {item.decision ? (
            <p>
              Döntés: {item.decision} · {item.decision_note_hu}
            </p>
          ) : (
            <form action={decide}>
              <input type="hidden" name="id" value={item.id} />
              <label>
                Megjegyzés <input name="note" maxLength={2000} />
              </label>
              <button name="decision" value="merge">
                Merge-jelölt
              </button>
              <button name="decision" value="keep_separate">
                Maradjon külön
              </button>
              <button name="decision" value="uncertain">
                Bizonytalan
              </button>
            </form>
          )}
        </article>
      ))}
    </main>
  );
}

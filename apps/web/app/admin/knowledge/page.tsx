import type { ReactNode } from "react";
import { createRepositories, d1Binding } from "../../../lib/db";
import { countD1Knowledge, listD1Knowledge } from "../../../lib/d1-knowledge";
import { AdminHeader } from "../_components/admin-header";
import { KnowledgeManager } from "./knowledge-manager";

export const dynamic = "force-dynamic";

export default async function AdminKnowledgePage(): Promise<ReactNode> {
  const d1 = d1Binding();
  const [counts, records] = d1
    ? await Promise.all([countD1Knowledge(d1), listD1Knowledge(d1, 100)])
    : await Promise.all([
        createRepositories().editorialKnowledgeRepository.countByStatus(),
        createRepositories().editorialKnowledgeRepository.listRecords(100),
      ]);
  return (
    <main className="admin-page">
      <AdminHeader activePath="/admin/knowledge" />
      <h1>Szerkesztői tudás</h1>
      <p style={{ color: "#555" }}>
        Ellenőrzött futballnyelvi és szerkesztői tudás kezelése, importja és biztonsági mentése.
      </p>
      <KnowledgeManager initialCounts={counts} initialRecords={records} />
    </main>
  );
}

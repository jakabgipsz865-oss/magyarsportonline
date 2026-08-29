import type { ReactNode } from "react";
import { createRepositories } from "../../../lib/db";
import { AdminHeader } from "../_components/admin-header";
import { KnowledgeManager } from "./knowledge-manager";

export const dynamic = "force-dynamic";

export default async function AdminKnowledgePage(): Promise<ReactNode> {
  const repository = createRepositories().editorialKnowledgeRepository;
  const [counts, records] = await Promise.all([
    repository.countByStatus(),
    repository.listRecords(100),
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

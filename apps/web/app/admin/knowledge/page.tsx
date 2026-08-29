import type { ReactNode } from "react";
import { AdminHeader } from "../_components/admin-header";
import { KnowledgeManager } from "./knowledge-manager";

export const dynamic = "force-dynamic";

export default function AdminKnowledgePage(): ReactNode {
  return (
    <main className="admin-page">
      <AdminHeader activePath="/admin/knowledge" />
      <h1>Admin tudás export / import</h1>
      <p style={{ color: "#555" }}>
        A rendszer szerkesztői memóriájának hordozható biztonsági mentése, környezetek közötti
        migrációja és validált visszaállítása.
      </p>
      <KnowledgeManager />
    </main>
  );
}

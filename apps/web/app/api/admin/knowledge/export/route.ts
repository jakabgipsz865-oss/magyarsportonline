import { NextResponse } from "next/server";
import { buildAdminKnowledgePackage } from "../../../../../lib/admin-knowledge";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<NextResponse> {
  const knowledgePackage = await buildAdminKnowledgePackage();
  const date = knowledgePackage.metadata.exportedAt.slice(0, 10);
  return new NextResponse(`${JSON.stringify(knowledgePackage, null, 2)}\n`, {
    status: 200,
    headers: {
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="magyarsportonline-knowledge-v${knowledgePackage.schemaVersion}-${date}.json"`,
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

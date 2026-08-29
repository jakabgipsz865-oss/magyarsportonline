import { NextResponse } from "next/server";
import { buildAdminKnowledgePackage } from "../../../../../lib/admin-knowledge";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<NextResponse> {
  const knowledgePackage = await buildAdminKnowledgePackage();
  const date = knowledgePackage.created_at.slice(0, 10);
  return new NextResponse(`${JSON.stringify(knowledgePackage, null, 2)}\n`, {
    status: 200,
    headers: {
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="mso-editorial-knowledge-v2-${date}.json"`,
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

import { NextResponse, type NextRequest } from "next/server";
import {
  applyAdminKnowledgeImport,
  MAX_KNOWLEDGE_IMPORT_BYTES,
  parseAdminKnowledgePackage,
  previewAdminKnowledgeImport,
} from "../../../../../lib/admin-knowledge";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (
    request.headers.get("x-mso-knowledge-import") !== "1" ||
    !request.headers.get("content-type")?.startsWith("application/json")
  ) {
    return NextResponse.json(
      { ok: false, error: "Az import csak az adminfelületről indítható." },
      { status: 403 },
    );
  }
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > MAX_KNOWLEDGE_IMPORT_BYTES) {
    return NextResponse.json(
      { ok: false, error: "A fájl mérete legfeljebb 10 MB lehet." },
      { status: 413 },
    );
  }

  try {
    const mode = request.nextUrl.searchParams.get("mode");
    if (mode !== "preview" && mode !== "apply") {
      return NextResponse.json({ ok: false, error: "Ismeretlen import mód." }, { status: 400 });
    }
    const raw = await request.text();
    const knowledgePackage = parseAdminKnowledgePackage(raw);
    const result =
      mode === "preview"
        ? await previewAdminKnowledgeImport(knowledgePackage)
        : await applyAdminKnowledgeImport(
            knowledgePackage,
            request.nextUrl.searchParams.get("expectedDigest") ?? "",
          );
    return NextResponse.json(
      { ok: true, mode, result },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ismeretlen import hiba.";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}

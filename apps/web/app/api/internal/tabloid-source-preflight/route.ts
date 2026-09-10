import { NextResponse, type NextRequest } from "next/server";
import { env } from "../../../../lib/env";
import { tabloidSourcePreflight } from "../../../../lib/tabloid-preflight";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/** Fixed publisher catalog only. No DB, queue, LLM, or image file requests. */
export async function GET(request: NextRequest) {
  if (request.headers.get("authorization") !== `Bearer ${env.CRON_SECRET}`)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const language = request.nextUrl.searchParams.get("language") ?? undefined;
  if (language && !["en", "es", "it", "de"].includes(language))
    return NextResponse.json({ error: "invalid language" }, { status: 400 });
  return NextResponse.json(
    await tabloidSourcePreflight(language, request.nextUrl.searchParams.get("images") === "1"),
  );
}

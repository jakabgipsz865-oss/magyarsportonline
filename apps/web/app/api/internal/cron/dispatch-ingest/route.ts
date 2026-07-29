import { NextResponse, type NextRequest } from "next/server";
import { env } from "../../../../../lib/env";
import { getLogger } from "../../../../../lib/logger";
import { runIngestPipeline } from "../../../../../lib/pipeline";

/**
 * Cron entry point (docs/architecture/04-api-spec.md §4.3,
 * docs/architecture/06-deployment.md §6.5: `/api/internal/cron/dispatch-ingest`).
 * Service-token auth via Vercel Cron's `Authorization: Bearer $CRON_SECRET`
 * convention — never session-based, never publicly callable.
 *
 * GET és POST ugyanazt csinálja: a Vercel Cron GET-tel hív, a kézi/CI
 * indítás (GitHub Actions ütemezett workflow, curl) POST-tal.
 *
 * maxDuration = 300 (2026-07-29, ideiglenes rövid távú stabilizálás — lásd
 * docs/open-decisions.md): két valódi 504-es incidens (2026-07-28/29,
 * `FUNCTION_INVOCATION_TIMEOUT`) bizonyította, hogy egyetlen cikk teljes,
 * szinkron pipeline-lánca (fact-verification + writer + editorial-rewrite,
 * mind valódi LLM-hívásokkal) is túllépheti a korábbi 60mp-es korlátot. Ez a
 * projekt 2026-07-27-én jött létre — a Vercel "Fluid Compute" 2025 áprilisa
 * óta minden ÚJ projekten alapértelmezetten aktív, ami Hobby csomagon 300mp-ig
 * engedélyezi a maxDuration-t (a korábbi 60mp helyett). Ez CSAK ideiglenes
 * intézkedés: a végleges megoldás a pipeline job-alapú, aszinkron
 * átalakítása (docs/open-decisions.md), hogy egyetlen HTTP-timeout se tudjon
 * egy teljes Story-feldolgozást megszakítani — az architekturális munka ettől
 * függetlenül folytatódik.
 */
export const maxDuration = 300;

async function handleDispatch(request: NextRequest): Promise<NextResponse> {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const results = await runIngestPipeline();
    return NextResponse.json({ results });
  } catch (error) {
    getLogger().error(
      { error: error instanceof Error ? error.message : String(error) },
      "dispatch-ingest failed",
    );
    return NextResponse.json({ error: "ingest pipeline failed" }, { status: 500 });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return handleDispatch(request);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  return handleDispatch(request);
}

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
 * maxDuration = 300 (2026-07-29): a `dispatch-ingest` már NEM futtatja
 * szinkron a teljes LLM-láncot (lásd `runIngestPipeline`/`buildQueueingEmitter`
 * az `apps/web/lib/pipeline.ts`-ben, aszinkron pipeline sprint,
 * docs/open-decisions.md #12) — csak az RSS-poll + új cikk beszúrás + job
 * enqueue történik itt, ami gyors és nem LLM-igényes, tehát a gyakorlatban
 * sosem közelíti meg ezt a korlátot. A 300 érték ŐSZINTÉN NEM bizonyítottan
 * érvényesül: egy valós production teszt (2026-07-29 05:29 UTC) pontosan
 * ~60,18mp-nél kapott HTTP 504-et a KORÁBBI, még teljes-szinkron pipeline-lánc
 * ellen, ami azt jelzi, hogy a Vercel Fluid Compute NINCS ténylegesen
 * aktiválva ezen a projekten (a platform csendben 60mp-re vágja vissza a
 * kódban beállított értéket) — ez most már lényegtelen, mert ez a route
 * többé nem végez semmilyen munkát, ami 60mp közelébe kerülne.
 */
export const maxDuration = 300;

async function handleDispatch(request: NextRequest): Promise<NextResponse> {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await runIngestPipeline();
    return NextResponse.json(result);
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

import { NextResponse, type NextRequest } from "next/server";
import { env } from "../../../../lib/env";
import { getLogger } from "../../../../lib/logger";
import { listTriagedReviewItems, runTriageSweep } from "../../../../lib/review-triage";

/**
 * Review-queue triage sweep (2026-07-29, "queue-tisztító és triage réteg"
 * sprint): classifies every pending review-queue item into
 * ready_for_review/auto_repair_required/human_decision_required/
 * reject_or_archive (see packages/agents/src/publish-gate/triage.ts), then
 * — unless `dryRun: true` — automatically reprocesses/recomputes a bounded
 * batch of `auto_repair_required` items and archives every
 * `reject_or_archive` item. Never touches `ready_for_review`/
 * `human_decision_required` — those stay for a human via `/admin/review`.
 *
 * `dryRun: true` returns only the category counts with no side effects —
 * used for a before/after report without re-running the (LLM-calling)
 * repair actions.
 *
 * Auth: same `Bearer CRON_SECRET` convention as the other `/api/internal/*` routes.
 */
export const maxDuration = 120;

export async function POST(request: NextRequest): Promise<NextResponse> {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let dryRun = false;
  try {
    const body: unknown = await request.json();
    if (typeof body === "object" && body !== null && "dryRun" in body) {
      dryRun = (body as { dryRun: unknown }).dryRun === true;
    }
  } catch {
    // no/malformed body -> dryRun stays false (execute)
  }

  try {
    if (dryRun) {
      const { countsByCategory } = await listTriagedReviewItems();
      return NextResponse.json({ dryRun: true, countsByCategory });
    }
    const result = await runTriageSweep();
    return NextResponse.json({ dryRun: false, ...result });
  } catch (error) {
    getLogger().error(
      { error: error instanceof Error ? error.message : String(error) },
      "triage-sweep failed",
    );
    return NextResponse.json({ error: "triage sweep failed" }, { status: 500 });
  }
}

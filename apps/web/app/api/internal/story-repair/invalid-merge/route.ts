import { NextResponse, type NextRequest } from "next/server";
import { env } from "../../../../../lib/env";
import { getLogger } from "../../../../../lib/logger";
import { repairInvalidMerge } from "../../../../../lib/pipeline";

/**
 * One-off data-repair endpoint (2026-07-29, docs/open-decisions.md #14):
 * archives a Story proven to be a false-positive merge from the OLD
 * single-entity fingerprint matcher, detaches its contributing RawArticles,
 * and re-enqueues them through the fixed pipeline. See
 * `apps/web/lib/pipeline.ts` `repairInvalidMerge` for the full behaviour.
 *
 * Auth: same `Bearer CRON_SECRET` convention as every other `/api/internal/*` route.
 */
export const maxDuration = 60;

export async function POST(request: NextRequest): Promise<NextResponse> {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let storyId: string | undefined;
  let reasonHu: string | undefined;
  try {
    const body: unknown = await request.json();
    if (typeof body === "object" && body !== null) {
      const parsed = body as { storyId?: unknown; reasonHu?: unknown };
      if (typeof parsed.storyId === "string" && parsed.storyId.length > 0) {
        storyId = parsed.storyId;
      }
      if (typeof parsed.reasonHu === "string" && parsed.reasonHu.length > 0) {
        reasonHu = parsed.reasonHu;
      }
    }
  } catch {
    // malformed JSON body -> both stay undefined, handled below
  }
  if (!storyId || !reasonHu) {
    return NextResponse.json({ error: "missing storyId or reasonHu" }, { status: 400 });
  }

  try {
    const result = await repairInvalidMerge(storyId, reasonHu);
    return NextResponse.json(result);
  } catch (error) {
    getLogger().error(
      { error: error instanceof Error ? error.message : String(error), storyId },
      "story-repair/invalid-merge failed",
    );
    return NextResponse.json({ error: "repair failed" }, { status: 500 });
  }
}

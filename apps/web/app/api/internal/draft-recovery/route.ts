import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { d1Binding } from "../../../../lib/db";
import { env } from "../../../../lib/env";
import { recoverSavedDrafts } from "../../../../lib/draft-recovery";
const schema = z
  .object({
    storyIds: z.array(z.string().uuid()).min(1).max(124),
    execute: z.boolean().default(false),
    confirmation: z.literal("publish_saved_drafts_without_ai").optional(),
  })
  .strict();
export async function POST(request: NextRequest) {
  if (request.headers.get("authorization") !== `Bearer ${env.CRON_SECRET}`)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (Number(request.headers.get("content-length") ?? 0) > 8000)
    return NextResponse.json({ error: "too large" }, { status: 413 });
  const input = schema.safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: "invalid cohort" }, { status: 400 });
  if (
    input.data.execute &&
    (!env.DRAFT_RECOVERY_ENABLED || input.data.confirmation !== "publish_saved_drafts_without_ai")
  )
    return NextResponse.json({ error: "execution disabled; dry run first" }, { status: 403 });
  if (input.data.execute && input.data.storyIds.length > 20)
    return NextResponse.json(
      { error: "Execute in explicit batches of at most 20 Stories; dry run supports all 124" },
      { status: 400 },
    );
  const db = d1Binding();
  if (!db || !env.D1_PIPELINE_START_AT)
    return NextResponse.json({ error: "D1 unavailable" }, { status: 503 });
  const results = await recoverSavedDrafts(db, input.data.storyIds, {
    activationAt: env.D1_PIPELINE_START_AT,
    forceReviewMode: env.FORCE_REVIEW_MODE,
    execute: input.data.execute,
    executionEnabled: env.DRAFT_RECOVERY_ENABLED,
  });
  return NextResponse.json(
    {
      dryRun: !input.data.execute,
      writerCalls: 0,
      facebookEnqueued: 0,
      publishable: results.filter((r) => r.publishable).length,
      blocked: results.filter((r) => !r.publishable).length,
      results,
    },
    { headers: { "cache-control": "no-store" } },
  );
}

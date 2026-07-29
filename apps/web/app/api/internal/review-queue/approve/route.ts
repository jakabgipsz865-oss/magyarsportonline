import { NextResponse, type NextRequest } from "next/server";
import { env } from "../../../../../lib/env";
import { getLogger } from "../../../../../lib/logger";
import { approveReviewItem } from "../../../../../lib/review";

/**
 * Non-interactive equivalent of `/admin/review`'s "✅ Jóváhagyás és
 * publikálás" button — calls the exact same `lib/review.ts`
 * `approveReviewItem` (markPublished → publish → read-model re-projection),
 * just behind the `Bearer CRON_SECRET` convention instead of an interactive
 * `ADMIN_SECRET` session, so a reviewed-good item can be published from a
 * script/workflow run. Never bypasses review — only ever resolves an item
 * that already exists in the queue.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let itemId: string | undefined;
  try {
    const body: unknown = await request.json();
    if (typeof body === "object" && body !== null && "itemId" in body) {
      const rawItemId = (body as { itemId: unknown }).itemId;
      if (typeof rawItemId === "string" && rawItemId.length > 0) {
        itemId = rawItemId;
      }
    }
  } catch {
    // malformed JSON body -> itemId stays undefined, handled below
  }
  if (!itemId) {
    return NextResponse.json({ error: "missing itemId" }, { status: 400 });
  }

  try {
    const result = await approveReviewItem(itemId);
    if (!result.ok) {
      if (result.error === "publication_blocked") {
        return NextResponse.json(
          { error: result.error, blockers: result.blockers },
          { status: 422 },
        );
      }
      return NextResponse.json(
        { error: result.error },
        { status: result.error === "already_resolved" ? 409 : 404 },
      );
    }
    return NextResponse.json({ approved: true, itemId });
  } catch (error) {
    getLogger().error(
      { error: error instanceof Error ? error.message : String(error), itemId },
      "review-queue approve failed",
    );
    return NextResponse.json({ error: "approve failed" }, { status: 500 });
  }
}

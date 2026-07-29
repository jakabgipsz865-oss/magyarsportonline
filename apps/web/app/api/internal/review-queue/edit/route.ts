import { NextResponse, type NextRequest } from "next/server";
import { env } from "../../../../../lib/env";
import { getLogger } from "../../../../../lib/logger";
import { editReviewItemContent } from "../../../../../lib/review";

interface EditRequestBody {
  itemId: string;
  titleHu: string;
  leadHu: string;
  bodyHu: string;
}

function parseEditBody(value: unknown): EditRequestBody | null {
  if (typeof value !== "object" || value === null) return null;
  const body = value as Record<string, unknown>;
  if (
    typeof body["itemId"] !== "string" ||
    typeof body["titleHu"] !== "string" ||
    typeof body["leadHu"] !== "string" ||
    typeof body["bodyHu"] !== "string"
  ) {
    return null;
  }

  const parsed = {
    itemId: body["itemId"].trim(),
    titleHu: body["titleHu"].trim(),
    leadHu: body["leadHu"].trim(),
    bodyHu: body["bodyHu"].trim(),
  };
  if (
    parsed.itemId.length === 0 ||
    parsed.titleHu.length < 5 ||
    parsed.leadHu.length < 20 ||
    parsed.bodyHu.length < 60
  ) {
    return null;
  }
  return parsed;
}

/**
 * Authenticated, non-interactive counterpart of the admin review editor.
 * It updates only an unpublished pending draft through the same
 * `editReviewItemContent` path as the UI. Publication remains a separate
 * action and always re-runs the fail-closed readiness assessment.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (request.headers.get("authorization") !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: EditRequestBody | null = null;
  try {
    body = parseEditBody(await request.json());
  } catch {
    // Invalid JSON is handled by the validation response below.
  }
  if (!body) {
    return NextResponse.json({ error: "invalid editorial content" }, { status: 400 });
  }

  try {
    const result = await editReviewItemContent(body.itemId, {
      titleHu: body.titleHu,
      leadHu: body.leadHu,
      bodyHu: body.bodyHu,
    });
    if (!result.ok) {
      const status =
        result.error === "already_resolved"
          ? 409
          : result.error === "already_published"
            ? 422
            : 404;
      return NextResponse.json({ error: result.error }, { status });
    }
    return NextResponse.json({ edited: true, itemId: body.itemId });
  } catch (error) {
    getLogger().error(
      { error: error instanceof Error ? error.message : String(error), itemId: body.itemId },
      "review-queue editorial edit failed",
    );
    return NextResponse.json({ error: "edit failed" }, { status: 500 });
  }
}

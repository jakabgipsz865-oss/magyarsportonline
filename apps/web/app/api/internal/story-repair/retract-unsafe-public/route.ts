import { NextResponse, type NextRequest } from "next/server";
import { createRepositories } from "../../../../../lib/db";
import { env } from "../../../../../lib/env";
import { getLogger } from "../../../../../lib/logger";
import { recoverUnsafePublicContent } from "../../../../../lib/public-content-recovery";

export const maxDuration = 60;

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (request.headers.get("authorization") !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let apply = false;
  let limit = 100;
  try {
    const body = (await request.json()) as { apply?: unknown; limit?: unknown };
    apply = body.apply === true;
    if (typeof body.limit === "number" && Number.isFinite(body.limit)) {
      limit = body.limit;
    }
  } catch {
    // An empty body is a safe dry-run.
  }

  try {
    const result = await recoverUnsafePublicContent(createRepositories(), { apply, limit });
    return NextResponse.json(result);
  } catch (error) {
    getLogger().error(
      { error: error instanceof Error ? error.message : String(error), apply, limit },
      "unsafe public content recovery failed",
    );
    return NextResponse.json({ error: "recovery failed" }, { status: 500 });
  }
}

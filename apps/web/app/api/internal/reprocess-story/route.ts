import { NextResponse, type NextRequest } from "next/server";
import { env } from "../../../../lib/env";
import { getLogger } from "../../../../lib/logger";
import { reprocessStoryById } from "../../../../lib/pipeline";

/**
 * Targeted variant of `/api/internal/reprocess-no-llm`: re-runs Hungarian
 * Writer → SEO → Publish Gate for exactly one, caller-specified Story ID,
 * unconditionally — for the case where a specific Story is already known to
 * need a rewrite (e.g. reported by a user) but wasn't reached by the general
 * candidate scan within its per-call batch cap.
 *
 * Auth: same `Bearer CRON_SECRET` convention as the other `/api/internal/*` routes.
 */
export const maxDuration = 60;

export async function POST(request: NextRequest): Promise<NextResponse> {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let storyId: string | undefined;
  try {
    const body: unknown = await request.json();
    if (typeof body === "object" && body !== null && "storyId" in body) {
      const rawStoryId = (body as { storyId: unknown }).storyId;
      if (typeof rawStoryId === "string" && rawStoryId.length > 0) {
        storyId = rawStoryId;
      }
    }
  } catch {
    // malformed JSON body -> storyId stays undefined, handled below
  }
  if (!storyId) {
    return NextResponse.json({ error: "missing storyId" }, { status: 400 });
  }

  try {
    const result = await reprocessStoryById(storyId);
    return NextResponse.json(result);
  } catch (error) {
    getLogger().error(
      { error: error instanceof Error ? error.message : String(error), storyId },
      "reprocess-story failed",
    );
    return NextResponse.json({ error: "reprocess failed" }, { status: 500 });
  }
}

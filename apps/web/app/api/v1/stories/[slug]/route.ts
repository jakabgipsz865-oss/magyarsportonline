import { NextResponse } from "next/server";
import { createRepositories } from "../../../../../lib/db";
import { allowPublicApiRequest } from "../../../../../lib/rate-limit";
import { toStoryDetailView } from "../../../../../lib/story-view";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ slug: string }>;
}

/** `GET /api/v1/stories/{slug}` (docs/architecture/04-api-spec.md §4.1) — 404 if there is no published version for this slug. */
export async function GET(request: Request, context: RouteContext): Promise<NextResponse> {
  if (!allowPublicApiRequest(request.headers)) {
    return NextResponse.json({ error: "rate limit exceeded" }, { status: 429 });
  }
  const { slug } = await context.params;
  const { storyReadModelRepository } = createRepositories();
  const row = await storyReadModelRepository.getBySlug(slug);
  if (!row) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json(toStoryDetailView(row));
}

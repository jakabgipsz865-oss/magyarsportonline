import { NextResponse, type NextRequest } from "next/server";
import { createRepositories } from "../../../../lib/db";
import { toStorySummaryView } from "../../../../lib/story-view";

export const dynamic = "force-dynamic";

const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;

/**
 * Publikus API (docs/architecture/04-api-spec.md §4.1) — kizárólag a
 * `story_read_model` CQRS-projekciót olvassa, sosem a write-oldali
 * táblákat közvetlenül (docs/architecture/01-data-model.md §1.5.2).
 * Rate limiting (Upstash Ratelimit) Fázis 13-kiegészítés, MVP-ben nincs.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Number(url.searchParams.get("limit")) || DEFAULT_LIMIT),
  );

  const { storyReadModelRepository } = createRepositories();
  const rows = await storyReadModelRepository.listPublished({
    limit,
    offset: (page - 1) * limit,
  });

  return NextResponse.json({
    data: rows.map(toStorySummaryView),
    meta: { page, limit },
  });
}

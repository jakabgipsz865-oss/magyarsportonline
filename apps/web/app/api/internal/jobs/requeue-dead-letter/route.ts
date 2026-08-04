import { NextResponse, type NextRequest } from "next/server";
import { createRepositories } from "../../../../../lib/db";
import { env } from "../../../../../lib/env";

export const maxDuration = 60;

const CONFIRMATION_HEADER = "x-mso-requeue-dead-letter";

function isAuthorized(request: NextRequest): boolean {
  return request.headers.get("authorization") === `Bearer ${env.CRON_SECRET}`;
}

function parseLimit(request: NextRequest): number {
  const raw = Number(request.nextUrl.searchParams.get("limit") ?? "100");
  return Number.isFinite(raw) ? Math.max(1, Math.min(Math.trunc(raw), 500)) : 100;
}

/** Read-only queue diagnostics. Article/event payloads are never returned. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const repos = createRepositories();
  const [queue, deadLetters] = await Promise.all([
    repos.pipelineJobRepository.getStatusCounts(),
    repos.pipelineJobRepository.getDeadLetterSummary(),
  ]);
  return NextResponse.json({ queue, deadLetters });
}

/**
 * Controlled recovery after a code/provider fix. The confirmation header
 * prevents an accidental browser or generic HTTP client request from
 * mutating the durable queue.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (request.headers.get(CONFIRMATION_HEADER) !== "1") {
    return NextResponse.json(
      { error: "confirmation_required", requiredHeader: "X-MSO-Requeue-Dead-Letter: 1" },
      { status: 409 },
    );
  }

  const repos = createRepositories();
  const limit = parseLimit(request);
  const before = await repos.pipelineJobRepository.getStatusCounts();
  const requeued = await repos.pipelineJobRepository.requeueDeadLetters(limit);
  const after = await repos.pipelineJobRepository.getStatusCounts();

  return NextResponse.json({ ok: true, limit, requeued, before, after });
}

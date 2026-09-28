import { NextResponse, type NextRequest } from "next/server";
import { D1PipelineJobRepository } from "@magyarsportonline/db/d1";
import { createRepositories, d1Binding } from "../../../../../lib/db";
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

function queueRepository() {
  const d1 = d1Binding();
  if (d1) {
    if (!env.D1_PIPELINE_START_AT) throw new Error("D1_PIPELINE_START_AT is required");
    return { repository: new D1PipelineJobRepository(d1), since: env.D1_PIPELINE_START_AT };
  }
  return { repository: createRepositories().pipelineJobRepository, since: new Date(0) };
}

/** Read-only queue diagnostics. Article/event payloads are never returned. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { repository, since } = queueRepository();
  const [queue, deadLetters] = await Promise.all([
    repository.getStatusCounts(new Date(), since),
    repository.getDeadLetterSummary(20, since),
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

  const { repository, since } = queueRepository();
  const limit = parseLimit(request);
  const before = await repository.getStatusCounts(new Date(), since);
  const requeued = await repository.requeueDeadLetters(limit, since);
  const after = await repository.getStatusCounts(new Date(), since);

  return NextResponse.json({ ok: true, limit, requeued, before, after });
}

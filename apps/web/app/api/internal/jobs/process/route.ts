import { parseEvent } from "@magyarsportonline/events";
import { isCloudflareDailyNeuronQuotaError } from "@magyarsportonline/llm";
import { NextResponse, type NextRequest } from "next/server";
import { createRepositories } from "../../../../../lib/db";
import { delayUntilNextCloudflareQuotaReset } from "../../../../../lib/cloudflare-quota";
import { env } from "../../../../../lib/env";
import { getLogger } from "../../../../../lib/logger";
import { buildQueueingEmitter, dispatchJobToHandler } from "../../../../../lib/pipeline";

/**
 * The worker half of the async pipeline sprint (2026-07-29,
 * docs/open-decisions.md #12) — drains `pipeline_jobs` one job at a time,
 * running EXACTLY one pipeline stage's handler per job via
 * `dispatchJobToHandler` (`apps/web/lib/pipeline.ts`). Because each job now
 * does one stage's LLM calls instead of the whole chain, no single job
 * should approach the function's time budget the way the old fully-
 * synchronous `dispatch-ingest` request did — this loop's own budget check
 * exists so the WORKER always returns cleanly before Vercel would kill it,
 * not because any individual job is expected to need it.
 *
 * `maxDuration = 300` is set optimistically, but a real production test
 * (docs/open-decisions.md #12) confirmed this project's actual enforced
 * ceiling is ~60s regardless (Vercel Fluid Compute not actually active) —
 * `BUDGET_MS` is deliberately set well under that CONFIRMED real limit, not
 * the aspirational one, so this route behaves correctly today; it drains
 * the queue faster per invocation for free if Fluid Compute is enabled
 * later, no code change needed.
 *
 * The deadline is only checked BETWEEN jobs (not during one), so worst-case
 * wall time is BUDGET_MS plus however long the single job claimed right
 * before the deadline tripped takes to finish. A real production run
 * (docs/open-decisions.md #12, 2026-07-29) processed 34 jobs successfully
 * with BUDGET_MS=50_000 but the response itself took ~52s -- close enough
 * to the confirmed ~60.18s real ceiling that a slightly slower job could
 * have pushed the request past it. Lowered to leave a wider real margin.
 *
 * Auth: same `Bearer CRON_SECRET` convention as every other `/api/internal/*`
 * route.
 */
export const maxDuration = 300;

const BUDGET_MS = 35_000; // wide margin under the CONFIRMED real ~60.18s ceiling
const STALE_LOCK_MS = 10 * 60_000; // an in_progress job locked longer than this is presumed abandoned
const BASE_BACKOFF_MS = 30_000;
const MAX_BACKOFF_MS = 30 * 60_000;
const CLOUDFLARE_QUOTA_ERROR_PREFIX = "[cloudflare_daily_neuron_quota]";

/** Exponential backoff, capped — `attempts` is already post-increment (claimBatch increments it), so attempt 1 -> 30s, 2 -> 1min, 3 -> 2min, ... */
function backoffFor(attempts: number): number {
  return Math.min(BASE_BACKOFF_MS * 2 ** Math.max(0, attempts - 1), MAX_BACKOFF_MS);
}

async function handleProcess(request: NextRequest): Promise<NextResponse> {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const repos = createRepositories();
  const emitter = buildQueueingEmitter(repos.pipelineJobRepository);
  const logger = getLogger();
  const deadline = Date.now() + BUDGET_MS;
  const activeQuotaDeferral = await repos.pipelineJobRepository.findActiveDeferral(
    CLOUDFLARE_QUOTA_ERROR_PREFIX,
  );
  if (activeQuotaDeferral) {
    return NextResponse.json({
      processed: 0,
      succeeded: 0,
      failed: 0,
      deadLettered: 0,
      quotaDeferred: true,
      retryAt: activeQuotaDeferral.toISOString(),
      errors: [],
    });
  }

  let processed = 0;
  let succeeded = 0;
  let failed = 0;
  let deadLettered = 0;
  let quotaDeferred = false;
  let quotaRetryAt: string | null = null;
  const errors: Array<{
    jobId: string;
    eventType: string;
    attempts: number;
    message: string;
  }> = [];

  while (Date.now() < deadline) {
    const [job] = await repos.pipelineJobRepository.claimBatch(1, STALE_LOCK_MS);
    if (!job) {
      break;
    }
    processed += 1;

    try {
      const event = parseEvent(job.event);
      await dispatchJobToHandler(event, repos, emitter);
      await repos.pipelineJobRepository.complete(job.id);
      succeeded += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isCloudflareDailyNeuronQuotaError(error)) {
        const now = new Date();
        const delayMs = delayUntilNextCloudflareQuotaReset(now);
        quotaRetryAt = new Date(now.getTime() + delayMs).toISOString();
        await repos.pipelineJobRepository.deferWithoutAttempt(
          job.id,
          `${CLOUDFLARE_QUOTA_ERROR_PREFIX} ${message}`,
          delayMs,
        );
        quotaDeferred = true;
        logger.warn(
          { jobId: job.id, retryAt: quotaRetryAt },
          "Cloudflare daily neuron quota exhausted; pipeline deferred without consuming an attempt",
        );
        break;
      }
      const exhausted = job.attempts >= job.maxAttempts;
      await repos.pipelineJobRepository.fail(job.id, message, backoffFor(job.attempts));
      if (exhausted) {
        deadLettered += 1;
      } else {
        failed += 1;
      }
      const eventType =
        typeof job.event === "object" &&
        job.event !== null &&
        "type" in job.event &&
        typeof job.event.type === "string"
          ? job.event.type
          : "unknown";
      errors.push({ jobId: job.id, eventType, attempts: job.attempts, message });
      logger.error(
        { jobId: job.id, attempts: job.attempts, maxAttempts: job.maxAttempts, error: message },
        "pipeline job failed",
      );
    }
  }

  return NextResponse.json({
    processed,
    succeeded,
    failed,
    deadLettered,
    quotaDeferred,
    retryAt: quotaRetryAt,
    errors,
  });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return handleProcess(request);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  return handleProcess(request);
}

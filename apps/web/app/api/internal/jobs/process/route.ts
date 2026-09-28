import { parseEvent } from "@magyarsportonline/events";
import {
  isCloudflareDailyNeuronQuotaError,
  GeminiApiError,
  isDailyLlmQuotaError,
  isGeminiDailyQuotaError,
  delayUntilNextGeminiQuotaReset,
} from "@magyarsportonline/llm";
import { NextResponse, type NextRequest } from "next/server";
import { createRepositories, d1Binding } from "../../../../../lib/db";
import { processOneD1Job } from "../../../../../lib/d1-job-process";
import { getD1StagingWriter } from "../../../../../lib/d1-staging-writer";
import { getWriterLlmClient, getWriterRepairLlmClient } from "../../../../../lib/llm";
import { delayUntilNextCloudflareQuotaReset } from "../../../../../lib/cloudflare-quota";
import { env } from "../../../../../lib/env";
import { getLogger } from "../../../../../lib/logger";
import { buildQueueingEmitter, dispatchJobToHandler } from "../../../../../lib/pipeline";
import { TabloidWriterBusyError } from "../../../../../lib/tabloid";
import { timedPipelineStage } from "../../../../../lib/pipeline-timing";

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
 * `maxDuration = 300` is the production request ceiling. The worker admits
 * new jobs only during a short window, so an invocation normally executes
 * one LLM-heavy stage and then returns. Individual Cloudflare calls are
 * independently bounded by the provider client; even the Writer's longest
 * generate/check/fix/check path remains below the route ceiling.
 *
 * The deadline is checked BETWEEN jobs. It deliberately limits admission,
 * not an already-running durable stage: a timeout becomes an explicit job
 * failure/retry, never a green workflow with an unobserved result.
 *
 * Auth: same `Bearer CRON_SECRET` convention as every other `/api/internal/*`
 * route.
 */
export const maxDuration = 300;

const BUDGET_MS = 35_000; // short admission window: one slow LLM stage per worker request
const STALE_LOCK_MS = 10 * 60_000; // an in_progress job locked longer than this is presumed abandoned
const BASE_BACKOFF_MS = 30_000;
const MAX_BACKOFF_MS = 30 * 60_000;
const CLOUDFLARE_DAILY_QUOTA_ERROR_PREFIX = "[daily_ai_quota:cloudflare]";
const GEMINI_DAILY_QUOTA_ERROR_PREFIX = "[daily_ai_quota:gemini]";

/** Exponential backoff, capped — `attempts` is already post-increment (claimBatch increments it), so attempt 1 -> 30s, 2 -> 1min, 3 -> 2min, ... */
function backoffFor(attempts: number): number {
  return Math.min(BASE_BACKOFF_MS * 2 ** Math.max(0, attempts - 1), MAX_BACKOFF_MS);
}

function retryAfterFromError(error: unknown): number {
  let current = error;
  for (let depth = 0; depth < 3; depth++) {
    if (current instanceof GeminiApiError) return current.retryAfterMs ?? 0;
    current = current instanceof Error ? current.cause : null;
  }
  return 0;
}

async function handleProcess(request: NextRequest): Promise<NextResponse> {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!env.TABLOID_AUTO_PUBLISH)
    return NextResponse.json({ paused: true, processed: 0, llmCalls: 0 });

  const d1 = d1Binding();
  if (d1) {
    if (!env.D1_PIPELINE_START_AT) {
      return NextResponse.json({ error: "D1_PIPELINE_START_AT is required" }, { status: 503 });
    }
    const mockWriter = getD1StagingWriter();
    const result = await processOneD1Job(
      d1,
      {
        activationAt: env.D1_PIPELINE_START_AT,
        siteUrl: env.SITE_URL,
        forceReviewMode: env.FORCE_REVIEW_MODE,
        facebookEnabled: env.FACEBOOK_AUTO_PUBLISH,
        facebookStartAt: env.FACEBOOK_AUTO_PUBLISH_START_AT,
      },
      mockWriter ?? getWriterLlmClient(),
      mockWriter ?? getWriterRepairLlmClient(),
    );
    return NextResponse.json(result);
  }

  const repos = createRepositories();
  const emitter = buildQueueingEmitter(repos.pipelineJobRepository);
  const logger = getLogger();
  const deadline = Date.now() + BUDGET_MS;
  const activeQuotaDeferral = await timedPipelineStage("quota_deferral_lookup", {}, () =>
    repos.pipelineJobRepository.findActiveDeferral(CLOUDFLARE_DAILY_QUOTA_ERROR_PREFIX),
  );
  if (activeQuotaDeferral) {
    const queue = await repos.pipelineJobRepository.getStatusCounts();
    return NextResponse.json({
      processed: 0,
      succeeded: 0,
      failed: 0,
      deadLettered: 0,
      quotaDeferred: true,
      retryAt: activeQuotaDeferral.toISOString(),
      errors: [],
      queue,
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
    const [job] = await timedPipelineStage("job_claim", {}, () =>
      repos.pipelineJobRepository.claimBatch(1, STALE_LOCK_MS),
    );
    if (!job) {
      break;
    }
    processed += 1;
    const owner = job.claimOwner;
    if (!owner) throw new Error(`Claimed job ${job.id} has no owner`);

    try {
      const event = parseEvent(job.event);
      await timedPipelineStage(
        "job_dispatch",
        { jobId: job.id, attempt: job.attempts, leaseOwner: owner },
        () => dispatchJobToHandler(event, repos, emitter, job.id, owner),
      );
      if (
        !(await timedPipelineStage(
          "job_complete",
          { jobId: job.id, attempt: job.attempts, leaseOwner: owner },
          () => repos.pipelineJobRepository.complete(job.id, owner),
        ))
      )
        throw new Error("Job claim expired before completion");
      succeeded += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof TabloidWriterBusyError) {
        await repos.pipelineJobRepository.deferWithoutAttempt(
          job.id,
          owner,
          `[writer_lease_active] ${message}`,
          error.retryAfterMs,
        );
        logger.info({ jobId: job.id }, "Writer lease active; job deferred without an attempt");
        continue;
      }
      if (
        isCloudflareDailyNeuronQuotaError(error) ||
        isGeminiDailyQuotaError(error) ||
        isDailyLlmQuotaError(error)
      ) {
        const now = new Date();
        const isGeminiQuota = isGeminiDailyQuotaError(error) || isDailyLlmQuotaError(error);
        const delayMs = isGeminiQuota
          ? delayUntilNextGeminiQuotaReset(now)
          : delayUntilNextCloudflareQuotaReset(now);
        quotaRetryAt = new Date(now.getTime() + delayMs).toISOString();
        await repos.pipelineJobRepository.deferWithoutAttempt(
          job.id,
          owner,
          `${isGeminiQuota ? GEMINI_DAILY_QUOTA_ERROR_PREFIX : CLOUDFLARE_DAILY_QUOTA_ERROR_PREFIX} ${message}`,
          delayMs,
        );
        quotaDeferred = true;
        logger.warn(
          { jobId: job.id, retryAt: quotaRetryAt },
          "Daily AI quota exhausted; pipeline deferred without consuming an attempt",
        );
        break;
      }
      const exhausted = job.attempts >= job.maxAttempts;
      const backoffMs = Math.min(
        MAX_BACKOFF_MS,
        Math.max(backoffFor(job.attempts), retryAfterFromError(error)),
      );
      if (!(await repos.pipelineJobRepository.fail(job.id, owner, message, backoffMs))) continue;
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

  const queue = await repos.pipelineJobRepository.getStatusCounts();
  return NextResponse.json({
    processed,
    succeeded,
    failed,
    deadLettered,
    quotaDeferred,
    retryAt: quotaRetryAt,
    errors,
    queue,
  });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return handleProcess(request);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  return handleProcess(request);
}

import { parseEvent } from "@magyarsportonline/events";
import { D1PipelineJobRepository, type D1Client } from "@magyarsportonline/db/d1";
import {
  delayUntilNextGeminiQuotaReset,
  isDailyLlmQuotaError,
  isGeminiDailyQuotaError,
  type LlmClient,
  MonthlyLlmBudgetError,
} from "@magyarsportonline/llm";
import { publishD1Tabloid, type D1PublicationOptions } from "./d1-tabloid";

const STALE_LOCK_MS = 10 * 60_000;
const GEMINI_DAILY_QUOTA_ERROR_PREFIX = "[daily_ai_quota:gemini]";
const GEMINI_MONTHLY_BUDGET_ERROR_PREFIX = "[monthly_ai_budget:gemini]";

function delayUntilNextUtcMonth(now = new Date()): number {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 5) - now.getTime();
}

/** Claims one post-cutover job; imported historical jobs remain untouched. */
export async function processOneD1Job(
  db: D1Client,
  options: D1PublicationOptions,
  writer: LlmClient,
  repairWriter: LlmClient,
) {
  const jobs = new D1PipelineJobRepository(db);
  const activeQuotaDeferral = await jobs.findActiveDeferral(
    GEMINI_DAILY_QUOTA_ERROR_PREFIX,
    options.activationAt,
  );
  if (activeQuotaDeferral) {
    return {
      processed: 0,
      quotaDeferred: true,
      retryAt: activeQuotaDeferral.toISOString(),
      queue: await jobs.getStatusCounts(new Date(), options.activationAt),
    };
  }
  const monthlyDeferral = await jobs.findActiveDeferral(
    GEMINI_MONTHLY_BUDGET_ERROR_PREFIX,
    options.activationAt,
  );
  if (monthlyDeferral) {
    return {
      processed: 0,
      budgetDeferred: true,
      retryAt: monthlyDeferral.toISOString(),
      queue: await jobs.getStatusCounts(new Date(), options.activationAt),
    };
  }
  const [job] = await jobs.claimBatch(1, STALE_LOCK_MS, new Date(), options.activationAt);
  if (!job) {
    return { processed: 0, queue: await jobs.getStatusCounts(new Date(), options.activationAt) };
  }
  const owner = job.claimOwner;
  if (!owner) throw new Error(`D1 job ${job.id} was claimed without an owner`);
  try {
    const event = parseEvent(job.event);
    const outcome =
      event.type === "source/article.ingested"
        ? await publishD1Tabloid(
            db,
            event.payload.raw_article_id,
            { jobId: job.id, owner },
            writer,
            repairWriter,
            options,
          )
        : { status: "skipped" as const };
    if (!(await jobs.complete(job.id, owner)))
      throw new Error("D1 job claim expired before completion");
    return {
      processed: 1,
      succeeded: 1,
      outcome,
      queue: await jobs.getStatusCounts(new Date(), options.activationAt),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof MonthlyLlmBudgetError) {
      const delayMs = delayUntilNextUtcMonth();
      await jobs.deferWithoutAttempt(
        job.id,
        owner,
        `${GEMINI_MONTHLY_BUDGET_ERROR_PREFIX} ${message}`,
        delayMs,
      );
      return {
        processed: 1,
        budgetDeferred: true,
        retryAt: new Date(Date.now() + delayMs).toISOString(),
        queue: await jobs.getStatusCounts(new Date(), options.activationAt),
      };
    }
    if (message === "D1 Writer lease is active") {
      await jobs.deferWithoutAttempt(job.id, owner, `[writer_lease_active] ${message}`, 60_000);
      return {
        processed: 1,
        deferred: true,
        queue: await jobs.getStatusCounts(new Date(), options.activationAt),
      };
    }
    if (isGeminiDailyQuotaError(error) || isDailyLlmQuotaError(error)) {
      const delayMs = delayUntilNextGeminiQuotaReset();
      await jobs.deferWithoutAttempt(
        job.id,
        owner,
        `${GEMINI_DAILY_QUOTA_ERROR_PREFIX} ${message}`,
        delayMs,
      );
      return {
        processed: 1,
        quotaDeferred: true,
        retryAt: new Date(Date.now() + delayMs).toISOString(),
        queue: await jobs.getStatusCounts(new Date(), options.activationAt),
      };
    }
    const backoffMs = Math.min(30 * 60_000, 30_000 * 2 ** Math.max(0, job.attempts - 1));
    const recorded = await jobs.fail(job.id, owner, message, backoffMs);
    return {
      processed: 1,
      failed: Number(recorded),
      deadLettered: Number(recorded && job.attempts >= job.maxAttempts),
      error: { jobId: job.id, message },
      queue: await jobs.getStatusCounts(new Date(), options.activationAt),
    };
  }
}

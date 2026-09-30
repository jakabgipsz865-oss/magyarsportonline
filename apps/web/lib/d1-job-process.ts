import { parseEvent } from "@magyarsportonline/events";
import { D1PipelineJobRepository, type D1Client } from "@magyarsportonline/db/d1";
import {
  delayUntilNextGeminiQuotaReset,
  isDailyLlmQuotaError,
  isGeminiDailyQuotaError,
  type LlmClient,
  MonthlyLlmBudgetError,
  isGeminiAvailabilityError,
  describeGeminiError,
} from "@magyarsportonline/llm";
import { publishD1Tabloid, type D1PublicationOptions } from "./d1-tabloid";
import { recordWriterFailure } from "./writer-health";

const STALE_LOCK_MS = 10 * 60_000;
const GEMINI_DAILY_QUOTA_ERROR_PREFIX = "[daily_ai_quota:gemini]";
const GEMINI_MONTHLY_BUDGET_ERROR_PREFIX = "[monthly_ai_budget:gemini]";
const GEMINI_PROVIDER_ERROR_PREFIX = "[provider_ai_unavailable:gemini]";

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
  const providerDeferral = await jobs.findActiveDeferral(
    GEMINI_PROVIDER_ERROR_PREFIX,
    options.activationAt,
  );
  if (providerDeferral)
    return {
      processed: 0,
      providerDeferred: true,
      retryAt: providerDeferral.toISOString(),
      queue: await jobs.getStatusCounts(new Date(), options.activationAt),
    };
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
    // Reset the outage backoff only after evidence of a real, successful primary call.
    await db
      .prepare(
        `UPDATE operational_state SET status='OK',detail=json_object('failures',0)
      WHERE component='writer_health' AND EXISTS (SELECT 1 FROM llm_usage
        WHERE role='primary' AND provider='gemini' AND status='success' AND occurred_at>last_error_at)`,
      )
      .run();
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
      await recordWriterFailure(db, "monthly_budget", new Date(Date.now() + delayMs), "BLOCKED");
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
        `${GEMINI_DAILY_QUOTA_ERROR_PREFIX} daily_quota_exceeded`,
        delayMs,
      );
      await recordWriterFailure(db, "daily_quota", new Date(Date.now() + delayMs), "BLOCKED");
      return {
        processed: 1,
        quotaDeferred: true,
        retryAt: new Date(Date.now() + delayMs).toISOString(),
        queue: await jobs.getStatusCounts(new Date(), options.activationAt),
      };
    }
    if (isGeminiAvailabilityError(error)) {
      const reason = describeGeminiError(error);
      // The persisted counter backs off across invocations/restarts to 6 hours.
      const previous = await db
        .prepare("SELECT detail FROM operational_state WHERE component='writer_health'")
        .first<{ detail: string }>();
      let failures = 0;
      try {
        failures = Math.max(
          0,
          Math.min(10, Number(JSON.parse(previous?.detail ?? "{}").failures) || 0),
        );
      } catch {
        /* fail-safe base delay */
      }
      const base = ["billing_unavailable", "forbidden", "http_401"].includes(reason)
        ? 30 * 60_000
        : 5 * 60_000;
      const delayMs = Math.min(
        6 * 3600_000,
        Math.max(base * 2 ** failures, error.retryAfterMs ?? 0),
      );
      const retryAt = new Date(Date.now() + delayMs);
      const recorded = await jobs.deferWithoutAttempt(
        job.id,
        owner,
        `${GEMINI_PROVIDER_ERROR_PREFIX} ${reason}`,
        delayMs,
      );
      await recordWriterFailure(db, reason, retryAt, "BLOCKED", failures + 1);
      return {
        processed: 1,
        providerDeferred: recorded,
        retryAt: retryAt.toISOString(),
        error: { jobId: job.id, message: "Primary Writer unavailable; deferred safely" },
        queue: await jobs.getStatusCounts(new Date(), options.activationAt),
      };
    }
    const backoffMs = Math.min(30 * 60_000, 30_000 * 2 ** Math.max(0, job.attempts - 1));
    const recorded = await jobs.fail(job.id, owner, message, backoffMs);
    if (message.startsWith("Tabloid writer ") || message.startsWith("[writer_paid_result_missing]"))
      await recordWriterFailure(
        db,
        message.startsWith("[writer_paid_result_missing]")
          ? "paid_result_missing"
          : "writer_technical_error",
        new Date(Date.now() + backoffMs),
        "WARNING",
      );
    return {
      processed: 1,
      failed: Number(recorded),
      deadLettered: Number(recorded && job.attempts >= job.maxAttempts),
      error: { jobId: job.id, message },
      queue: await jobs.getStatusCounts(new Date(), options.activationAt),
    };
  }
}

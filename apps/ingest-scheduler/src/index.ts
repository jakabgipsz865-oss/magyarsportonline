const INGEST_TIMEOUT_MS = 50_000;
const JOBS_TIMEOUT_MS = 45_000;
const SOCIAL_TIMEOUT_MS = 15_000;
const TRENDING_TIMEOUT_MS = 15_000;

export interface Env {
  APP_ORIGIN: string;
  CRON_SECRET: string;
}

interface WorkerExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

let activeScheduledRun: Promise<void> | null = null;

function endpoint(origin: string, path: string): string {
  const base = new URL(origin);
  base.pathname = path;
  base.search = "";
  base.hash = "";
  return base.toString();
}

async function post(
  url: string,
  label: string,
  env: Env,
  timeoutMs: number,
  payload?: unknown,
): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.CRON_SECRET}`,
        ...(payload ? { "content-type": "application/json" } : {}),
      },
      ...(payload ? { body: JSON.stringify(payload) } : {}),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`${label} returned HTTP ${response.status}`);
    let outcome: Record<string, unknown> = {};
    if (response.headers.get("content-type")?.includes("application/json")) {
      const body = (await response.json()) as Record<string, unknown>;
      outcome = {
        ...(typeof body["processed"] === "number" ? { processed: body["processed"] } : {}),
        ...(typeof body["succeeded"] === "number" ? { succeeded: body["succeeded"] } : {}),
        ...(typeof body["failed"] === "number" ? { failed: body["failed"] } : {}),
        ...(typeof body["queuedCount"] === "number" ? { queuedCount: body["queuedCount"] } : {}),
        ...(typeof body["deferredWithoutFullArticle"] === "number"
          ? { deferredWithoutFullArticle: body["deferredWithoutFullArticle"] }
          : {}),
        ...(Array.isArray(body["results"])
          ? {
              failedSources: body["results"].filter(
                (item: unknown) =>
                  typeof item === "object" &&
                  item !== null &&
                  (item as { status?: unknown }).status === "error",
              ).length,
              seenCount: body["results"].reduce(
                (total: number, item: unknown) =>
                  total +
                  (typeof item === "object" &&
                  item !== null &&
                  typeof (item as { seenCount?: unknown }).seenCount === "number"
                    ? (item as { seenCount: number }).seenCount
                    : 0),
                0,
              ),
            }
          : {}),
      };
    }
    console.log(`${label} completed`, { status: response.status, ...outcome });
  } catch (error) {
    console.error(`${label} failed`, {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function runCron(env: Env, now = new Date()): Promise<void> {
  const results = await Promise.allSettled([
    post(
      endpoint(env.APP_ORIGIN, "/api/internal/language-qa") +
        (now.getUTCMinutes() % 30 === 0 ? "?sweep=true" : ""),
      "language-qa",
      env,
      25_000,
    ),
    post(
      endpoint(env.APP_ORIGIN, "/api/internal/cron/dispatch-ingest"),
      "dispatch-ingest",
      env,
      INGEST_TIMEOUT_MS,
    ),
    post(
      endpoint(env.APP_ORIGIN, "/api/internal/jobs/process"),
      "jobs/process",
      env,
      JOBS_TIMEOUT_MS,
    ),
    post(
      endpoint(env.APP_ORIGIN, "/api/internal/facebook/enqueue-pending"),
      "facebook/enqueue-pending",
      env,
      SOCIAL_TIMEOUT_MS,
    ),
    ...(now.getUTCMinutes() % 5 === 0
      ? [
          post(
            endpoint(env.APP_ORIGIN, "/api/internal/trending"),
            "trending",
            env,
            TRENDING_TIMEOUT_MS,
          ),
        ]
      : []),
  ]);
  const failures = results.filter((result) => result.status === "rejected");
  try {
    await post(
      endpoint(env.APP_ORIGIN, "/api/internal/scheduler-status"),
      "scheduler-status",
      env,
      5000,
      {
        scheduledAt: now.toISOString(),
        status: failures.length ? "error" : "ok",
        branches: results.map((r) => ({ status: r.status })),
      },
    );
  } catch (error) {
    failures.push({ status: "rejected", reason: error });
  }
  if (failures.length > 0) throw new AggregateError(failures, "scheduled work failed");
}

export default {
  scheduled(event: { scheduledTime?: number }, env: Env, ctx: WorkerExecutionContext): void {
    // Prevent a hanging request from stacking further cron runs in this Worker
    // isolate. Cross-isolate overlap remains bounded by endpoint claim fencing.
    if (activeScheduledRun) {
      console.warn("scheduled invocation skipped while previous invocation is still active");
      return;
    }
    activeScheduledRun = runCron(env, new Date(event.scheduledTime ?? Date.now())).finally(() => {
      activeScheduledRun = null;
    });
    ctx.waitUntil(activeScheduledRun);
  },
};

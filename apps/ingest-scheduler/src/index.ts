const TIMEOUT_MS = 50_000;

export interface Env {
  APP_ORIGIN: string;
  CRON_SECRET: string;
}

interface WorkerExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

function endpoint(origin: string, path: string): string {
  const base = new URL(origin);
  base.pathname = path;
  base.search = "";
  base.hash = "";
  return base.toString();
}

async function post(url: string, label: string, env: Env, signal?: AbortSignal): Promise<void> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${env.CRON_SECRET}` },
      ...(signal ? { signal } : {}),
    });
    if (!response.ok) throw new Error(`${label} returned HTTP ${response.status}`);
    console.log(`${label} completed`, { status: response.status });
  } catch (error) {
    console.error(`${label} failed`, {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export async function runCron(env: Env): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const results = await Promise.allSettled([
    post(
      endpoint(env.APP_ORIGIN, "/api/internal/cron/dispatch-ingest"),
      "dispatch-ingest",
      env,
      controller.signal,
    ),
    post(endpoint(env.APP_ORIGIN, "/api/internal/jobs/process"), "jobs/process", env),
    post(
      endpoint(env.APP_ORIGIN, "/api/internal/facebook/enqueue-pending"),
      "facebook/enqueue-pending",
      env,
    ),
  ]);
  clearTimeout(timeout);
  const failures = results.filter((result) => result.status === "rejected");
  if (failures.length > 0) throw new AggregateError(failures, "scheduled work failed");
}

export default {
  scheduled(_event: unknown, env: Env, ctx: WorkerExecutionContext): void {
    ctx.waitUntil(runCron(env));
  },
};

const TIMEOUT_MS = 50_000;

interface Env {
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
      signal,
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

async function runCron(env: Env): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    await post(
      endpoint(env.APP_ORIGIN, "/api/internal/cron/dispatch-ingest"),
      "dispatch-ingest",
      env,
      controller.signal,
    );
  } finally {
    clearTimeout(timeout);
  }
  await post(endpoint(env.APP_ORIGIN, "/api/internal/jobs/process"), "jobs/process", env);
}

export default {
  scheduled(_event: unknown, env: Env, ctx: WorkerExecutionContext): void {
    ctx.waitUntil(runCron(env));
  },
};

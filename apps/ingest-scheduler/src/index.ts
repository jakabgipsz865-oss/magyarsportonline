const INGEST_URL = "https://magyarsportonline-web.vercel.app/api/internal/cron/dispatch-ingest";
const PROCESS_URL = "https://magyarsportonline-web.vercel.app/api/internal/jobs/process";
const TIMEOUT_MS = 50_000;

interface Env {
  CRON_SECRET: string;
}

interface WorkerExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
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
    await post(INGEST_URL, "dispatch-ingest", env, controller.signal);
  } finally {
    clearTimeout(timeout);
  }
  await post(PROCESS_URL, "jobs/process", env);
}

export default {
  scheduled(_event: unknown, env: Env, ctx: WorkerExecutionContext): void {
    ctx.waitUntil(runCron(env));
  },
};

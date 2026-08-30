const INGEST_URL = "https://magyarsportonline-web.vercel.app/api/internal/cron/dispatch-ingest";
const TIMEOUT_MS = 50_000;

interface Env {
  CRON_SECRET: string;
}

interface WorkerExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

async function dispatchIngest(env: Env): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(INGEST_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${env.CRON_SECRET}` },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`dispatch-ingest returned HTTP ${response.status}`);
    console.log("dispatch-ingest completed", { status: response.status });
  } catch (error) {
    console.error("dispatch-ingest failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export default {
  scheduled(_event: unknown, env: Env, ctx: WorkerExecutionContext): void {
    ctx.waitUntil(dispatchIngest(env));
  },
};

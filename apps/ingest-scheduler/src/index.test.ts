import { afterEach, describe, expect, it, vi } from "vitest";
import scheduler, { runCron } from "./index";

describe("scheduler branch isolation", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  it("provides a cancellation signal to every endpoint", async () => {
    const signals = new Map<string, AbortSignal | null>();
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      signals.set(String(url), init?.signal ?? null);
      return new Response("", { status: 200 });
    }));
    await runCron({ APP_ORIGIN: "https://example.com", CRON_SECRET: "secret" });
    expect(signals.size).toBe(3);
    expect([...signals.values()].every(Boolean)).toBe(true);
  });

  it("starts queue processing even when ingest fails", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request) => {
        const value = String(url);
        calls.push(value);
        return new Response("", { status: value.includes("dispatch-ingest") ? 500 : 200 });
      }),
    );
    await expect(
      runCron({ APP_ORIGIN: "https://example.com", CRON_SECRET: "secret" }),
    ).rejects.toBeInstanceOf(AggregateError);
    expect(calls.some((url) => url.includes("dispatch-ingest"))).toBe(true);
    expect(calls.some((url) => url.includes("jobs/process"))).toBe(true);
    expect(calls.some((url) => url.includes("facebook/enqueue-pending"))).toBe(true);
  });

  it("starts ingest even when queue processing fails", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request) => {
        const value = String(url);
        calls.push(value);
        return new Response("", { status: value.includes("jobs/process") ? 500 : 200 });
      }),
    );
    await expect(
      runCron({ APP_ORIGIN: "https://example.com", CRON_SECRET: "secret" }),
    ).rejects.toBeInstanceOf(AggregateError);
    expect(calls).toHaveLength(3);
  });

  it("does not start an overlapping scheduled run in the same isolate", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const fetchMock = vi.fn(async () => {
      await held;
      return new Response("", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const runs: Promise<unknown>[] = [];
    const context = { waitUntil: (promise: Promise<unknown>) => { runs.push(promise); } };
    const env = { APP_ORIGIN: "https://example.com", CRON_SECRET: "secret" };
    scheduler.scheduled({}, env, context);
    scheduler.scheduled({}, env, context);
    expect(runs).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    release();
    await runs[0];
  });

  it("aborts a dependency that never sends response headers", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((url: string | URL | Request, init?: RequestInit) => {
      if (!String(url).includes("jobs/process")) return Promise.resolve(new Response("", { status: 200 }));
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
      });
    }));
    const run = runCron({ APP_ORIGIN: "https://example.com", CRON_SECRET: "secret" });
    const assertion = expect(run).rejects.toBeInstanceOf(AggregateError);
    await vi.advanceTimersByTimeAsync(45_001);
    await assertion;
  });

  it("keeps the deadline active while reading a stalled JSON response", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((url: string | URL | Request, init?: RequestInit) => {
      if (!String(url).includes("jobs/process")) return Promise.resolve(new Response("", { status: 200 }));
      const stream = new ReadableStream({
        start(controller) {
          init?.signal?.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")), { once: true });
        },
      });
      return Promise.resolve(new Response(stream, { status: 200, headers: { "content-type": "application/json" } }));
    }));
    const run = runCron({ APP_ORIGIN: "https://example.com", CRON_SECRET: "secret" });
    const assertion = expect(run).rejects.toBeInstanceOf(AggregateError);
    await vi.advanceTimersByTimeAsync(45_001);
    await assertion;
  });
});

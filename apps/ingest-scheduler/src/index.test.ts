import { afterEach, describe, expect, it, vi } from "vitest";
import { runCron } from "./index";

describe("scheduler branch isolation", () => {
  afterEach(() => vi.unstubAllGlobals());

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
});

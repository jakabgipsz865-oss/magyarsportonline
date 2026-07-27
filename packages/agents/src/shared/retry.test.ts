import { describe, expect, it } from "vitest";
import { withRetry } from "./retry";

const noSleep = (): Promise<void> => Promise.resolve();

describe("withRetry", () => {
  it("returns the first successful result without retrying", async () => {
    let calls = 0;
    const result = await withRetry(
      () => {
        calls += 1;
        return Promise.resolve("ok");
      },
      { sleep: noSleep },
    );
    expect(result).toBe("ok");
    expect(calls).toBe(1);
  });

  it("retries transient failures and succeeds", async () => {
    let calls = 0;
    const result = await withRetry(
      () => {
        calls += 1;
        return calls < 3 ? Promise.reject(new Error("transient")) : Promise.resolve("recovered");
      },
      { retries: 2, sleep: noSleep },
    );
    expect(result).toBe("recovered");
    expect(calls).toBe(3);
  });

  it("throws the last error once retries are exhausted", async () => {
    let calls = 0;
    await expect(
      withRetry(
        () => {
          calls += 1;
          return Promise.reject(new Error(`fail-${calls}`));
        },
        { retries: 2, sleep: noSleep },
      ),
    ).rejects.toThrow("fail-3");
    expect(calls).toBe(3);
  });

  it("backs off exponentially between attempts", async () => {
    const delays: number[] = [];
    await expect(
      withRetry(() => Promise.reject(new Error("always")), {
        retries: 2,
        baseDelayMs: 100,
        sleep: (ms) => {
          delays.push(ms);
          return Promise.resolve();
        },
      }),
    ).rejects.toThrow("always");
    expect(delays).toEqual([100, 200]);
  });
});

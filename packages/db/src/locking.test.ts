import { describe, expect, it, vi } from "vitest";
import { withFingerprintLock, type SqlExecutor } from "./locking";

describe("withFingerprintLock", () => {
  it("acquires the advisory lock before running the callback", async () => {
    const calls: string[] = [];
    const tx: SqlExecutor = {
      execute: vi.fn(async () => {
        calls.push("lock");
        return undefined;
      }),
    };

    const result = await withFingerprintLock(tx, "abc123", async () => {
      calls.push("callback");
      return "created";
    });

    expect(result).toBe("created");
    expect(calls).toEqual(["lock", "callback"]);
    expect(tx.execute).toHaveBeenCalledTimes(1);
  });

  it("propagates the callback's return value", async () => {
    const tx: SqlExecutor = { execute: vi.fn(async () => undefined) };
    const value = await withFingerprintLock(tx, "fp", async () => 42);
    expect(value).toBe(42);
  });

  it("propagates a callback error without swallowing it", async () => {
    const tx: SqlExecutor = { execute: vi.fn(async () => undefined) };
    await expect(
      withFingerprintLock(tx, "fp", async () => {
        throw new Error("story merge failed");
      }),
    ).rejects.toThrow("story merge failed");
  });

  it("does NOT run the callback if acquiring the lock throws", async () => {
    let callbackRan = false;
    const tx: SqlExecutor = {
      execute: vi.fn(async () => {
        throw new Error("connection lost");
      }),
    };

    await expect(
      withFingerprintLock(tx, "fp", async () => {
        callbackRan = true;
      }),
    ).rejects.toThrow("connection lost");
    expect(callbackRan).toBe(false);
  });
});

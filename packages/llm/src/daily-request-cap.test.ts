import { describe, expect, it, vi } from "vitest";
import { FakeLlmClient } from "./fake-client";
import {
  DailyLlmRequestCapError,
  DailyRequestCappedLlmClient,
  delayUntilNextGeminiQuotaReset,
  geminiQuotaDayStart,
} from "./daily-request-cap";

const request = {
  model: "gemini-2.5-flash",
  system: "system",
  messages: [{ role: "user" as const, content: "content" }],
  maxTokens: 32,
};

describe("DailyRequestCappedLlmClient", () => {
  it("does not call Gemini after the application cap is reached", async () => {
    const inner = new FakeLlmClient();
    const reserveRequest = vi.fn(async () => null);
    const finalizeRequest = vi.fn(async () => undefined);
    const releaseRequest = vi.fn(async () => undefined);
    const client = new DailyRequestCappedLlmClient(inner, "gemini", 20, {
      reserveRequest,
      finalizeRequest,
      releaseRequest,
    });

    await expect(client.completeText(request)).rejects.toBeInstanceOf(DailyLlmRequestCapError);
    expect(inner.textRequests).toHaveLength(0);
    expect(reserveRequest).toHaveBeenCalledWith("gemini", "unknown", expect.any(Date), 20);
    expect(finalizeRequest).not.toHaveBeenCalled();
  });

  it("allows a request while usage remains below the cap", async () => {
    const inner = new FakeLlmClient();
    inner.queueText({ text: "ok", inputTokens: 1, outputTokens: 1 });
    const finalizeRequest = vi.fn(async () => undefined);
    const client = new DailyRequestCappedLlmClient(inner, "gemini", 20, {
      reserveRequest: async () => "reservation-id",
      finalizeRequest,
      releaseRequest: async () => undefined,
    });

    await expect(client.completeText(request)).resolves.toMatchObject({ text: "ok" });
    expect(inner.textRequests).toHaveLength(1);
    expect(finalizeRequest).toHaveBeenCalledWith("reservation-id", 1, 1);
  });

  it("releases only a failure proven not to consume provider quota", async () => {
    const failure = new Error("model not found");
    const inner = {
      completeText: vi.fn(async () => {
        throw failure;
      }),
      completeJson: vi.fn(),
    };
    const releaseRequest = vi.fn(async () => undefined);
    const client = new DailyRequestCappedLlmClient(
      inner,
      "gemini",
      20,
      {
        reserveRequest: async () => "reservation-id",
        finalizeRequest: async () => undefined,
        releaseRequest,
      },
      (error) => error === failure,
    );

    await expect(client.completeText(request)).rejects.toBe(failure);
    expect(releaseRequest).toHaveBeenCalledWith("reservation-id");
  });

  it("keeps uncertain provider failures counted", async () => {
    const inner = {
      completeText: vi.fn(async () => {
        throw new Error("network failure");
      }),
      completeJson: vi.fn(),
    };
    const releaseRequest = vi.fn(async () => undefined);
    const client = new DailyRequestCappedLlmClient(inner, "gemini", 20, {
      reserveRequest: async () => "reservation-id",
      finalizeRequest: async () => undefined,
      releaseRequest,
    });

    await expect(client.completeText(request)).rejects.toThrow("network failure");
    expect(releaseRequest).not.toHaveBeenCalled();
  });

  it("finalizes token usage when a completed provider response later fails parsing", async () => {
    const failure = Object.assign(new Error("malformed JSON"), {
      meteredUsage: { inputTokens: 120, outputTokens: 2048 },
    });
    const inner = {
      completeText: vi.fn(),
      completeJson: vi.fn(async () => {
        throw failure;
      }),
    };
    const finalizeRequest = vi.fn(async () => undefined);
    const releaseRequest = vi.fn(async () => undefined);
    const client = new DailyRequestCappedLlmClient(inner, "gemini", 20, {
      reserveRequest: async () => "reservation-id",
      finalizeRequest,
      releaseRequest,
    });

    await expect(client.completeJson({ ...request, jsonSchema: { type: "object" } })).rejects.toBe(
      failure,
    );
    expect(finalizeRequest).toHaveBeenCalledWith("reservation-id", 120, 2048);
    expect(releaseRequest).not.toHaveBeenCalled();
  });

  it("uses the Pacific quota day and defers until the next Pacific midnight", () => {
    const now = new Date("2026-08-31T10:30:00.000Z");
    expect(geminiQuotaDayStart(now).toISOString()).toBe("2026-08-31T07:00:00.000Z");
    expect(new Date(now.getTime() + delayUntilNextGeminiQuotaReset(now)).toISOString()).toBe(
      "2026-09-01T07:05:00.000Z",
    );
  });
});

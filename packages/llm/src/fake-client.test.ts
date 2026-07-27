import { describe, expect, it } from "vitest";
import { FakeLlmClient } from "./fake-client";

describe("FakeLlmClient", () => {
  it("returns queued text responses in FIFO order and records requests", async () => {
    const client = new FakeLlmClient();
    client.queueText({ text: "first", inputTokens: 1, outputTokens: 1 });
    client.queueText({ text: "second", inputTokens: 2, outputTokens: 2 });

    const request = { model: "m", system: "s", messages: [], maxTokens: 10 };
    const first = await client.completeText(request);
    const second = await client.completeText(request);

    expect(first.text).toBe("first");
    expect(second.text).toBe("second");
    expect(client.textRequests).toHaveLength(2);
  });

  it("returns queued JSON responses and records requests", async () => {
    const client = new FakeLlmClient();
    client.queueJson({ data: { ok: true }, inputTokens: 1, outputTokens: 1 });

    const request = {
      model: "m",
      system: "s",
      messages: [],
      maxTokens: 10,
      jsonSchema: {},
    };
    const result = await client.completeJson(request);

    expect(result.data).toEqual({ ok: true });
    expect(client.jsonRequests).toEqual([request]);
  });

  it("throws when called with no queued response", async () => {
    const client = new FakeLlmClient();
    await expect(
      client.completeText({ model: "m", system: "s", messages: [], maxTokens: 10 }),
    ).rejects.toThrow("no queued response");
  });
});

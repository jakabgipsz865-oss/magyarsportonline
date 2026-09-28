import { afterEach, expect, it, vi } from "vitest";
import { processFacebookMessage } from "./facebook";
import worker from "./index";

vi.mock("./facebook", () => ({ processFacebookMessage: vi.fn() }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it("keeps the Cloudflare global fetch receiver when passed to the publisher", async () => {
  const runtimeFetch = vi.fn(function (this: unknown) {
    if (this !== globalThis) throw new TypeError("Illegal invocation");
    return Promise.resolve(new Response("{}"));
  });
  vi.stubGlobal("fetch", runtimeFetch);
  vi.mocked(processFacebookMessage).mockImplementation(async (_message, _env, deps) => {
    const detached = deps.fetch;
    await detached("https://graph.facebook.com/v26.0/me");
  });

  await worker.queue(
    {
      messages: [
        {
          body: {
            socialPostId: "post-1",
            storyId: "story-1",
            storyVersionId: "version-1",
            canonicalUrl: "https://mso24.hu/hir/example",
          },
          attempts: 1,
          ack() {},
          retry() {},
        },
      ],
    },
    {
      DB: {} as NonNullable<Parameters<typeof worker.queue>[1]["DB"]>,
      META_GRAPH_API_VERSION: "v26.0",
    },
  );

  expect(runtimeFetch).toHaveBeenCalledOnce();
});

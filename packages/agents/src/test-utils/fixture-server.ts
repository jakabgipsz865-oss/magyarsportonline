import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";

export interface FixtureServer {
  /** Base URL, e.g. http://127.0.0.1:54231 */
  baseUrl: string;
  close(): Promise<void>;
}

/**
 * Serves the demo/test RSS fixtures (scripts/fixtures/*.xml at the repo
 * root) over real HTTP on an ephemeral local port, so the Source Ingest
 * Agent's normal HTTP-fetch code path is exercised exactly as it would be
 * against a real internet RSS feed — the only difference for a live source
 * is the URL configured on the `Source` row
 * (docs/architecture/08-roadmap.md, Fázis 0 demo scope). Used both by
 * packages/agents integration tests and by scripts/demo.ts.
 */
export async function startFixtureServer(fixturesDir: string): Promise<FixtureServer> {
  const server: Server = createServer((req, res) => {
    void (async () => {
      const requestedPath = (req.url ?? "/").split("?")[0] ?? "/";
      const fileName = path.basename(requestedPath);
      if (!fileName.endsWith(".xml")) {
        res.writeHead(404).end("not found");
        return;
      }
      try {
        const content = await readFile(path.join(fixturesDir, fileName));
        res.writeHead(200, { "content-type": "application/rss+xml; charset=utf-8" });
        res.end(content);
      } catch {
        res.writeHead(404).end("not found");
      }
    })();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("failed to determine fixture server port");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

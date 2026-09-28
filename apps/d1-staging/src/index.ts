import {
  D1PipelineJobRepository,
  D1StoryReadModelRepository,
  type D1Client,
} from "../../../packages/db/src/d1/index";

interface Env {
  DB: D1Client;
}

const jsonHeaders = { "cache-control": "no-store", "content-type": "application/json; charset=utf-8" };

/**
 * Read-only D1-only test Worker. No cron, Queues, Hyperdrive, AI, or Facebook
 * binding. It cannot run historical jobs or publish old stories.
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== "GET") return new Response(null, { status: 405 });
    if (url.pathname === "/health") {
      const row = await env.DB.prepare("SELECT count(*) AS total FROM story_read_model")
        .first<{ total: number }>();
      const queue = await new D1PipelineJobRepository(env.DB).getStatusCounts();
      return new Response(JSON.stringify({ database: "d1", storyReadModelRows: row?.total ?? 0,
        queue }), { headers: jsonHeaders });
    }
    const stories = new D1StoryReadModelRepository(env.DB);
    if (url.pathname === "/api/v1/stories") {
      const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
      const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit")) || 20));
      const rows = await stories.listPublished({ limit, offset: (page - 1) * limit });
      return new Response(JSON.stringify({ data: rows, meta: { page, limit, database: "d1" } }),
        { headers: jsonHeaders });
    }
    if (url.pathname.startsWith("/api/v1/stories/")) {
      const slug = decodeURIComponent(url.pathname.slice("/api/v1/stories/".length));
      const row = await stories.getBySlug(slug);
      return new Response(JSON.stringify(row ? { data: row, database: "d1" } : { error: "not found" }),
        { status: row ? 200 : 404, headers: jsonHeaders });
    }
    return new Response(null, { status: 404 });
  },
};

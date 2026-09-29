import { NextResponse, type NextRequest } from "next/server";
import { d1Binding } from "../../../../lib/db";
import { READ_SOURCES, type ReadSource } from "../../../../lib/trending";
import { recordQualifiedRead } from "../../../../lib/trending-store";
import { allowPublicApiRequest } from "../../../../lib/rate-limit";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest): Promise<NextResponse> {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  let sameOrigin = !origin;
  try {
    if (origin) sameOrigin = new URL(origin).origin === request.nextUrl.origin;
  } catch {
    sameOrigin = false;
  }
  if (!sameOrigin || (fetchSite && fetchSite !== "same-origin")) {
    return NextResponse.json({ error: "same origin required" }, { status: 403 });
  }
  if (!allowPublicApiRequest(request.headers)) {
    return NextResponse.json(
      { error: "rate limited" },
      { status: 429, headers: { "retry-after": "60" } },
    );
  }
  if (
    !request.headers.get("content-type")?.startsWith("application/json") ||
    Number(request.headers.get("content-length") ?? "0") > 512
  ) {
    return NextResponse.json({ error: "invalid content" }, { status: 400 });
  }
  let body: unknown;
  try {
    const reader = request.body?.getReader();
    if (!reader) throw new Error("missing body");
    let length = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 512) {
        await reader.cancel();
        throw new Error("oversized body");
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "invalid event" }, { status: 400 });
  }
  const { eventId, storyId, source } = body as Record<string, unknown>;
  if (
    typeof eventId !== "string" ||
    !uuid.test(eventId) ||
    typeof storyId !== "string" ||
    storyId.length > 100 ||
    !READ_SOURCES.includes(source as ReadSource)
  ) {
    return NextResponse.json({ error: "invalid event" }, { status: 400 });
  }
  const db = d1Binding();
  if (!db) return NextResponse.json({ error: "unavailable" }, { status: 503 });
  try {
    const recorded = await recordQualifiedRead(db, {
      eventId,
      storyId,
      source: source as ReadSource,
      now: new Date(),
    });
    return NextResponse.json(
      { recorded },
      {
        headers: { "cache-control": "no-store" },
      },
    );
  } catch (error) {
    console.error("qualified read storage failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
}

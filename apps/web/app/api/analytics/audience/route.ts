import { NextResponse, type NextRequest } from "next/server";
import { d1Binding } from "../../../../lib/db";
import { parseAudienceEvent, readConsent } from "../../../../lib/audience";
import { recordAudienceEvent } from "../../../../lib/audience-store";
import { allowPublicApiRequest } from "../../../../lib/rate-limit";
export async function POST(request: NextRequest): Promise<NextResponse> {
  const origin = request.headers.get("origin"),
    site = request.headers.get("sec-fetch-site");
  if (origin !== request.nextUrl.origin || (site && site !== "same-origin"))
    return NextResponse.json({ error: "same origin required" }, { status: 403 });
  if (readConsent(request.headers.get("cookie") ?? "") !== "allow")
    return NextResponse.json({ error: "consent required" }, { status: 403 });
  if (!allowPublicApiRequest(request.headers))
    return NextResponse.json(
      { error: "rate limited" },
      { status: 429, headers: { "retry-after": "60" } },
    );
  if (
    !request.headers.get("content-type")?.startsWith("application/json") ||
    Number(request.headers.get("content-length") ?? 0) > 768
  )
    return NextResponse.json({ error: "invalid content" }, { status: 400 });
  let body: unknown;
  try {
    const reader = request.body?.getReader();
    if (!reader) throw Error("missing body");
    let length = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 768) {
        await reader.cancel();
        throw Error("oversized");
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const c of chunks) {
      bytes.set(c, offset);
      offset += c.length;
    }
    body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const event = parseAudienceEvent(body);
  if (!event) return NextResponse.json({ error: "invalid event" }, { status: 400 });
  const db = d1Binding();
  if (!db) return NextResponse.json({ error: "unavailable" }, { status: 503 });
  try {
    return NextResponse.json(
      { recorded: await recordAudienceEvent(db, event) },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
}

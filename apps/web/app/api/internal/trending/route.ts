import { NextResponse, type NextRequest } from "next/server";
import { d1Binding } from "../../../../lib/db";
import { env } from "../../../../lib/env";
import { readTrendingSnapshot, refreshTrending } from "../../../../lib/trending-store";

function authorized(request: NextRequest): boolean {
  return request.headers.get("authorization") === `Bearer ${env.CRON_SECRET}`;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!authorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const db = d1Binding();
  if (!db) return NextResponse.json({ error: "D1 unavailable" }, { status: 503 });
  try {
    const snapshot = await refreshTrending(db, new Date());
    return NextResponse.json({
      refreshedAt: snapshot.refreshedAt,
      ranked: snapshot.ranking.length,
    });
  } catch (error) {
    console.error("trending refresh failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "refresh failed" }, { status: 503 });
  }
}

/** Protected, read-only diagnostics; no visitor identifiers leave the database. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!authorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const db = d1Binding();
  if (!db) return NextResponse.json({ error: "D1 unavailable" }, { status: 503 });
  try {
    const snapshot = await readTrendingSnapshot(db);
    return NextResponse.json(snapshot, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "ranking unavailable" }, { status: 503 });
  }
}

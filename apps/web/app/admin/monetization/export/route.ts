import { NextResponse } from "next/server";
import { d1Binding } from "../../../../lib/db";
import { audienceReport, audienceCsv } from "../../../../lib/audience-store";
export const dynamic = "force-dynamic";
// /admin/* middleware requires the existing signed admin session cookie.
export async function GET() {
  const db = d1Binding();
  if (!db) return NextResponse.json({ error: "unavailable" }, { status: 503 });
  return new Response(audienceCsv(await audienceReport(db)), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="mso-audience.csv"',
      "cache-control": "private, no-store",
    },
  });
}

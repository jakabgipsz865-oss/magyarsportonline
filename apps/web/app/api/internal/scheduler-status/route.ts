import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { d1Binding } from "../../../../lib/db";
import { env } from "../../../../lib/env";
import { d1Timestamp } from "@magyarsportonline/db/d1";
const schema = z
  .object({
    scheduledAt: z.string().datetime(),
    status: z.enum(["ok", "error"]),
    branches: z.array(z.object({ status: z.enum(["fulfilled", "rejected"]) }).strict()).max(6),
  })
  .strict();
export async function POST(request: NextRequest) {
  if (request.headers.get("authorization") !== `Bearer ${env.CRON_SECRET}`)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const input = schema.safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: "invalid heartbeat" }, { status: 400 });
  const db = d1Binding();
  if (!db) return NextResponse.json({ error: "D1 unavailable" }, { status: 503 });
  const now = d1Timestamp(new Date());
  await db
    .prepare(
      `INSERT INTO operational_state(component,status,updated_at,last_error_at,detail) VALUES('scheduler',?,?,?,?) ON CONFLICT(component) DO UPDATE SET status=excluded.status,updated_at=excluded.updated_at,last_error_at=coalesce(excluded.last_error_at,operational_state.last_error_at),detail=excluded.detail WHERE excluded.updated_at>=operational_state.updated_at`,
    )
    .bind(
      input.data.status,
      now,
      input.data.status === "error" ? now : null,
      JSON.stringify(input.data),
    )
    .run();
  return NextResponse.json({ recorded: true });
}

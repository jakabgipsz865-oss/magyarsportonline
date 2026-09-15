import { NextResponse } from "next/server";
import { env } from "../../../../../lib/env";
import { enqueuePendingFacebookPosts } from "../../../../../lib/facebook-publication";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  if (request.headers.get("authorization") !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await enqueuePendingFacebookPosts());
}

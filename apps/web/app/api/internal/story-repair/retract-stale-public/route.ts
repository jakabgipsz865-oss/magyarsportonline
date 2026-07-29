import { NextResponse, type NextRequest } from "next/server";
import { createRepositories } from "../../../../../lib/db";
import { env } from "../../../../../lib/env";
import { retractPublicContentOlderThan } from "../../../../../lib/public-content-recovery";

export const maxDuration = 60;

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (request.headers.get("authorization") !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const publishedBeforeRaw = request.nextUrl.searchParams.get("publishedBefore");
  const publishedBefore = publishedBeforeRaw ? new Date(publishedBeforeRaw) : null;
  if (!publishedBefore || Number.isNaN(publishedBefore.getTime())) {
    return NextResponse.json({ error: "valid publishedBefore is required" }, { status: 400 });
  }

  const result = await retractPublicContentOlderThan(createRepositories(), publishedBefore);
  return NextResponse.json(result);
}

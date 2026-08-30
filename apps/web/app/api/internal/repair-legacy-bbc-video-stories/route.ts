import { NextResponse, type NextRequest } from "next/server";
import { env } from "../../../../lib/env";
import { repairLegacyBbcVideoStories } from "../../../../lib/legacy-bbc-repair";
import { getLogger } from "../../../../lib/logger";

export const maxDuration = 60;

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (request.headers.get("authorization") !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const repaired = await repairLegacyBbcVideoStories();
    return NextResponse.json({ repairedCount: repaired.length, repaired });
  } catch (error) {
    getLogger().error(
      { error: error instanceof Error ? error.message : String(error) },
      "legacy BBC video Story repair failed",
    );
    return NextResponse.json({ error: "repair failed" }, { status: 500 });
  }
}

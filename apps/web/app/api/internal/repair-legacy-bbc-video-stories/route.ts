import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { repairLegacyBbcVideoStories } from "../../../../lib/legacy-bbc-repair";
import { getLogger } from "../../../../lib/logger";

export const maxDuration = 300;
const TOKEN_SHA256 = "1a257d5b1495d88157c6421117db5f91348f1429b1d29136ddb561449bb2425e";

function isAuthorized(request: NextRequest): boolean {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return false;
  const actual = createHash("sha256").update(token).digest();
  const expected = Buffer.from(TOKEN_SHA256, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(request)) {
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

import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getLogger } from "../../../../lib/logger";
import { recoverMigrationProofStories } from "../../../../lib/migration-proof-recovery";

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
    const recovered = await recoverMigrationProofStories();
    return NextResponse.json({ recoveredCount: recovered.length, recovered });
  } catch (error) {
    getLogger().error(
      { error: error instanceof Error ? error.message : String(error) },
      "migration proof Story recovery failed",
    );
    return NextResponse.json({ error: "recovery failed" }, { status: 500 });
  }
}

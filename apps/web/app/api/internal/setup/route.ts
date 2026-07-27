import { seed, seedStatus } from "@magyarsportonline/db";
import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "../../../../lib/db";
import { env } from "../../../../lib/env";
import { getLogger } from "../../../../lib/logger";

/**
 * Ismételhető production-aktiválási végpont: lefuttatja az idempotens
 * seedet (BBC Sport Football forrás + alap taxonómia), és visszaadja az
 * alap táblaszámlálókat, hogy a deploy állapota távolról, shell-hozzáférés
 * nélkül is ellenőrizhető legyen. A sémamigráció nem itt fut: azt a build
 * végzi minden deploynál (ADR 0007).
 *
 * Auth: ugyanaz a `Bearer CRON_SECRET` konvenció, mint a cron végponté —
 * sosem publikus.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const db = getDb();
    await seed(db);
    const counts = await seedStatus(db);

    return NextResponse.json({
      seeded: true,
      counts,
      llmProvider: env.LLM_PROVIDER,
      monthlyLlmBudgetUsd: env.LLM_MONTHLY_BUDGET_USD,
    });
  } catch (error) {
    getLogger().error(
      { error: error instanceof Error ? error.message : String(error) },
      "setup endpoint failed",
    );
    return NextResponse.json({ error: "setup failed" }, { status: 500 });
  }
}

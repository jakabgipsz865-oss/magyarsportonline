import { NextResponse, type NextRequest } from "next/server";
import { d1Binding } from "../../../../lib/db";
import { env } from "../../../../lib/env";
import { getLanguageQaClient } from "../../../../lib/language-qa-client";
import { processLanguageQa } from "../../../../lib/language-qa-service";
export async function POST(request: NextRequest) {
  if (request.headers.get("authorization") !== `Bearer ${env.CRON_SECRET}`)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!env.LANGUAGE_QA_ENABLED) return NextResponse.json({ processed: 0, disabled: true });
  const db = d1Binding();
  if (!db) return NextResponse.json({ error: "D1 unavailable" }, { status: 503 });
  try {
    return NextResponse.json(
      await processLanguageQa(
        db,
        {
          enabled: env.LANGUAGE_QA_ENABLED,
          dailyCalls: env.LANGUAGE_QA_DAILY_CALL_CAP,
          dailyBudgetUsd: env.LANGUAGE_QA_DAILY_BUDGET_USD,
          mock: env.LANGUAGE_QA_MOCK_MODE !== "false",
          ...(env.LANGUAGE_QA_PRIORITY_AFTER
            ? { priorityAfter: env.LANGUAGE_QA_PRIORITY_AFTER }
            : {}),
          sweep: request.nextUrl.searchParams.get("sweep") === "true",
        },
        getLanguageQaClient,
      ),
    );
  } catch {
    console.error("language_qa scheduling failure");
    return NextResponse.json(
      { error: "QA unavailable; public articles unaffected" },
      { status: 503 },
    );
  }
}

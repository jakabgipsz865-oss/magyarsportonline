import type { D1Client } from "@magyarsportonline/db/d1";

export interface WriterHealth {
  status: "OK" | "WARNING" | "BLOCKED";
  reason: string;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  retryAt: string | null;
}

const SAFE_REASONS = new Set([
  "monthly_budget",
  "daily_quota",
  "billing_unavailable",
  "forbidden",
  "http_401",
  "http_402",
  "http_400",
  "http_404",
  "rate_limited",
  "gateway_rate_limited",
  "gateway_error",
  "service_unavailable",
  "network_error",
  "timeout",
  "writer_technical_error",
  "paid_result_missing",
]);

/** No error body, account balance or credentials are ever stored/displayed here. */
export async function recordWriterFailure(
  db: D1Client,
  reason: string,
  retryAt: Date,
  status: "WARNING" | "BLOCKED",
  failures = 1,
) {
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO operational_state(component,status,updated_at,last_error_at,detail)
    VALUES('writer_health',?,?,?,?) ON CONFLICT(component) DO UPDATE SET
    status=excluded.status,updated_at=excluded.updated_at,last_error_at=excluded.last_error_at,detail=excluded.detail`,
    )
    .bind(
      status,
      now,
      now,
      JSON.stringify({
        reason: SAFE_REASONS.has(reason) ? reason : "provider_error",
        retryAt: retryAt.toISOString(),
        failures,
      }),
    )
    .run();
}

export async function loadWriterHealth(
  db: D1Client,
  activationAt: Date,
  now = new Date(),
): Promise<WriterHealth> {
  const [failure, success, held] = await Promise.all([
    db
      .prepare(
        "SELECT status,last_error_at,detail FROM operational_state WHERE component='writer_health'",
      )
      .first<{ status: string; last_error_at: string; detail: string }>(),
    db
      .prepare(
        "SELECT max(occurred_at) at FROM llm_usage WHERE occurred_at>=? AND julianday(occurred_at)>=julianday(?) AND julianday(occurred_at)<=julianday(?) AND role='primary' AND provider='gemini' AND status='success'",
      )
      .bind(
        new Date(Math.max(activationAt.getTime(), now.getTime() - 24 * 3600_000))
          .toISOString()
          .slice(0, 10),
        new Date(Math.max(activationAt.getTime(), now.getTime() - 24 * 3600_000)).toISOString(),
        now.toISOString(),
      )
      .first<{ at: string | null }>(),
    db
      .prepare(
        `SELECT last_error,available_at FROM pipeline_jobs WHERE status='pending' AND available_at>? AND created_at>=?
      AND (last_error LIKE '[daily_ai_quota:gemini]%' OR last_error LIKE '[monthly_ai_budget:gemini]%' OR last_error LIKE '[provider_ai_unavailable:gemini]%')
      ORDER BY available_at DESC LIMIT 1`,
      )
      .bind(now.toISOString(), activationAt.toISOString())
      .first<{ last_error: string; available_at: string }>(),
  ]);
  let detail: { reason?: string; retryAt?: string } = {};
  try {
    detail = JSON.parse(failure?.detail ?? "{}");
  } catch {
    /* unavailable diagnostics */
  }
  const lastSuccessAt = success?.at ?? null;
  const lastErrorAt = failure?.last_error_at ?? null;
  const currentFailure =
    failure?.status !== "OK" &&
    lastErrorAt &&
    new Date(lastErrorAt) >= activationAt &&
    (!lastSuccessAt || new Date(lastErrorAt) >= new Date(lastSuccessAt));
  const reason = held?.last_error.startsWith("[monthly_ai_budget:")
    ? "monthly_budget"
    : held?.last_error.startsWith("[daily_ai_quota:")
      ? "daily_quota"
      : detail.reason && SAFE_REASONS.has(detail.reason)
        ? detail.reason
        : "provider_error";
  if (held || currentFailure)
    return {
      status: held || failure?.status === "BLOCKED" ? "BLOCKED" : "WARNING",
      reason,
      lastSuccessAt,
      lastErrorAt,
      retryAt: held?.available_at ?? detail.retryAt ?? null,
    };
  return {
    status: lastSuccessAt ? "OK" : "WARNING",
    reason: lastSuccessAt ? "recent_success" : "no_recent_writer_evidence",
    lastSuccessAt,
    lastErrorAt,
    retryAt: null,
  };
}

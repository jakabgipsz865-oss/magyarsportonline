import { d1Timestamp, type D1Client } from "./client";

interface UsageInput {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  role?: string;
  status?: string;
  errorCode?: string | null;
  rawArticleId?: string;
  storyId?: string;
  jobId?: string;
  occurredAt?: Date;
}

/** D1-backed metering and atomic request reservations for the Writer. */
export class D1LlmUsageRepository {
  constructor(private readonly db: D1Client) {}

  async insert(input: UsageInput): Promise<{ id: string }> {
    const id = crypto.randomUUID();
    await this.db
      .prepare(
        `
      INSERT INTO llm_usage (id, provider, model, input_tokens, output_tokens,
        cost_usd, role, status, error_code, raw_article_id, story_id, job_id, occurred_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .bind(
        id,
        input.provider,
        input.model,
        input.inputTokens,
        input.outputTokens,
        input.costUsd.toFixed(6),
        input.role ?? "unspecified",
        input.status ?? "success",
        input.errorCode ?? null,
        input.rawArticleId ?? null,
        input.storyId ?? null,
        input.jobId ?? null,
        d1Timestamp(input.occurredAt ?? new Date()),
      )
      .run();
    return { id };
  }

  async sumCostUsdSince(since: Date): Promise<number> {
    const row = await this.db
      .prepare(
        `
      SELECT coalesce(sum(CAST(cost_usd AS REAL)), 0) AS total
      FROM llm_usage WHERE occurred_at >= ?
    `,
      )
      .bind(d1Timestamp(since))
      .first<{ total: number }>();
    return Number(row?.total ?? 0);
  }

  async countSince(provider: string, since: Date): Promise<number> {
    const row = await this.db
      .prepare(
        `
      SELECT count(*) AS total FROM llm_usage WHERE provider = ? AND occurred_at >= ?
    `,
      )
      .bind(provider, d1Timestamp(since))
      .first<{ total: number }>();
    return Number(row?.total ?? 0);
  }

  /** Language QA has its own daily budget; it does not consume the Gemini monthly cap. */
  async sumGenerationCostUsdSince(since: Date): Promise<number> {
    const row = await this.db
      .prepare(
        `SELECT coalesce(sum(CAST(cost_usd AS REAL)),0) total
      FROM llm_usage WHERE occurred_at>=? AND role<>'language_qa'`,
      )
      .bind(d1Timestamp(since))
      .first<{ total: number }>();
    return Number(row?.total ?? 0);
  }

  /** One serialized SQLite statement makes the cap check and reservation atomic. */
  async reserveRequest(
    provider: string,
    model: string,
    since: Date,
    cap: number,
    context?: { role: string; rawArticleId?: string; storyId?: string; jobId?: string },
    budget?: { since: Date; capUsd: number; externalSpentUsd: number; reserveUsd: number },
  ): Promise<string | null> {
    if (cap <= 0) return null;
    if (
      budget &&
      (!Number.isFinite(budget.capUsd) ||
        !Number.isFinite(budget.externalSpentUsd) ||
        !Number.isFinite(budget.reserveUsd) ||
        budget.capUsd <= 0 ||
        budget.externalSpentUsd < 0 ||
        budget.reserveUsd <= 0)
    )
      throw new Error("Invalid monthly AI budget reservation");
    const id = crypto.randomUUID();
    const reserveUsd = budget ? Math.ceil(budget.reserveUsd * 1_000_000) / 1_000_000 : 0;
    const result = await this.db
      .prepare(
        `
      INSERT INTO llm_usage (id, provider, model, input_tokens, output_tokens,
        cost_usd, role, status, raw_article_id, story_id, job_id, occurred_at)
      SELECT ?, ?, ?, 0, 0, ?, ?, 'reserved', ?, ?, ?, ?
      WHERE (SELECT count(*) FROM llm_usage
        WHERE provider = ? AND occurred_at >= ?) < ?
        AND (? IS NULL OR
          (SELECT coalesce(sum(CAST(cost_usd AS REAL)),0) FROM llm_usage
            WHERE occurred_at>=? AND role<>'language_qa') + ? + ? <= ?)
    `,
      )
      .bind(
        id,
        provider,
        model,
        reserveUsd.toFixed(6),
        context?.role ?? "unspecified",
        context?.rawArticleId ?? null,
        context?.storyId ?? null,
        context?.jobId ?? null,
        d1Timestamp(new Date()),
        provider,
        d1Timestamp(since),
        cap,
        budget ? d1Timestamp(budget.since) : null,
        d1Timestamp(budget?.since ?? since),
        budget?.externalSpentUsd ?? 0,
        reserveUsd,
        budget?.capUsd ?? 0,
      )
      .run();
    return result.meta.changes === 1 ? id : null;
  }

  async finalizeRequest(
    reservationId: string,
    inputTokens: number,
    outputTokens: number,
    costUsd = 0,
    status = "success",
    errorCode: string | null = null,
  ): Promise<void> {
    await this.db
      .prepare(
        `
      UPDATE llm_usage SET input_tokens = ?, output_tokens = ?, cost_usd = ?,
        status = ?, error_code = ? WHERE id = ? AND status = 'reserved'
    `,
      )
      .bind(inputTokens, outputTokens, costUsd.toFixed(6), status, errorCode, reservationId)
      .run();
  }

  async failRequest(reservationId: string, errorCode: string): Promise<void> {
    await this.db
      .prepare(
        `
      UPDATE llm_usage SET status = 'failed', error_code = ?
      WHERE id = ? AND status = 'reserved'
    `,
      )
      .bind(errorCode, reservationId)
      .run();
  }

  async releaseRequest(reservationId: string): Promise<void> {
    await this.db
      .prepare(
        `
      DELETE FROM llm_usage WHERE id = ? AND status = 'reserved'
        AND input_tokens = 0 AND output_tokens = 0
    `,
      )
      .bind(reservationId)
      .run();
  }
}

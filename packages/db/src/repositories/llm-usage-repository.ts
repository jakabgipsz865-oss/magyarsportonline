import { and, desc, eq, gte, sql } from "drizzle-orm";
import type { Database } from "../client";
import { llmUsage } from "../schema/index";

export type LlmUsageRow = typeof llmUsage.$inferSelect;

/**
 * Hívás-szintű LLM token-/költségnapló a havi budget-plafonhoz
 * (packages/llm/src/budget-guard.ts). Bounded-context repository a többi
 * repositoryval azonos mintára.
 */
export class LlmUsageRepository {
  constructor(private readonly db: Database) {}

  async insert(input: {
    provider: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    occurredAt?: Date;
  }): Promise<LlmUsageRow> {
    const [row] = await this.db
      .insert(llmUsage)
      .values({
        provider: input.provider,
        model: input.model,
        inputTokens: input.inputTokens,
        outputTokens: input.outputTokens,
        // `numeric` oszlop stringet vár — fix 6 tizedes, a séma skálájával egyezően.
        costUsd: input.costUsd.toFixed(6),
        ...(input.occurredAt ? { occurredAt: input.occurredAt } : {}),
      })
      .returning();
    if (!row) {
      throw new Error("LlmUsage insert returned no row");
    }
    return row;
  }

  /** A megadott időpont óta felhalmozott összköltség USD-ben (üres táblára 0). */
  async sumCostUsdSince(since: Date): Promise<number> {
    const [row] = await this.db
      .select({ total: sql<string>`coalesce(sum(${llmUsage.costUsd}), 0)` })
      .from(llmUsage)
      .where(gte(llmUsage.occurredAt, since));
    return row ? Number(row.total) : 0;
  }

  /** Legutóbbi N sikeres (nem-fallback) hívás naplója, legfrissebb elöl — diagnosztikai/audit célra (pl. "tényleg történt-e valódi Cloudflare-hívás mostanában"). */
  async listRecent(limit: number): Promise<LlmUsageRow[]> {
    return this.db.select().from(llmUsage).orderBy(desc(llmUsage.occurredAt)).limit(limit);
  }

  async countSince(provider: string, since: Date): Promise<number> {
    const [row] = await this.db
      .select({ total: sql<number>`count(*)::int` })
      .from(llmUsage)
      .where(and(eq(llmUsage.provider, provider), gte(llmUsage.occurredAt, since)));
    return row?.total ?? 0;
  }

  async reserveRequest(
    provider: string,
    model: string,
    since: Date,
    cap: number,
  ): Promise<string | null> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`mso-llm-cap:${provider}`}))`);
      const [count] = await tx
        .select({ total: sql<number>`count(*)::int` })
        .from(llmUsage)
        .where(and(eq(llmUsage.provider, provider), gte(llmUsage.occurredAt, since)));
      if ((count?.total ?? 0) >= cap) return null;
      const [reservation] = await tx
        .insert(llmUsage)
        .values({ provider, model, inputTokens: 0, outputTokens: 0, costUsd: "0.000000" })
        .returning({ id: llmUsage.id });
      return reservation?.id ?? null;
    });
  }

  async finalizeRequest(
    reservationId: string,
    inputTokens: number,
    outputTokens: number,
  ): Promise<void> {
    await this.db
      .update(llmUsage)
      .set({ inputTokens, outputTokens })
      .where(eq(llmUsage.id, reservationId));
  }

  async releaseRequest(reservationId: string): Promise<void> {
    await this.db
      .delete(llmUsage)
      .where(
        and(
          eq(llmUsage.id, reservationId),
          eq(llmUsage.inputTokens, 0),
          eq(llmUsage.outputTokens, 0),
        ),
      );
  }
}

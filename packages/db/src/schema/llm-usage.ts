import { integer, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Minden valódi (fizetős) LLM-hívás token- és költségadata — a havi
 * költségplafon (LLM_MONTHLY_BUDGET_USD) kikényszerítésének adatforrása.
 * A `agent_runs.llm_cost_usd`-vel ellentétben ez hívás-szintű, nem
 * futás-szintű: a Budget Guard (packages/llm/src/budget-guard.ts) minden
 * hívás előtt a tárgyhónap SUM(cost_usd)-ját olvassa innen, és a plafon
 * felett No-LLM módra vált a leállás helyett.
 */
export const llmUsage = pgTable("llm_usage", {
  id: uuid("id").primaryKey().defaultRandom(),
  model: text("model").notNull(),
  inputTokens: integer("input_tokens").notNull(),
  outputTokens: integer("output_tokens").notNull(),
  costUsd: numeric("cost_usd", { precision: 10, scale: 6 }).notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
});

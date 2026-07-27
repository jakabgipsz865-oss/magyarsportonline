import { integer, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Minden sikeres LLM-hívás token-, provider- és költségadata — a havi
 * Anthropic-költségplafon (LLM_MONTHLY_BUDGET_USD) kikényszerítésének
 * adatforrása, és a Gemini free-tier hívások auditnaplója (mindig
 * cost_usd=0). A `agent_runs.llm_cost_usd`-vel ellentétben ez hívás-szintű,
 * nem futás-szintű: a Budget Guard (packages/llm/src/budget-guard.ts)
 * minden Anthropic-hívás előtt a tárgyhónap SUM(cost_usd)-ját olvassa innen,
 * és a plafon felett No-LLM módra vált a leállás helyett. A
 * ProviderFallbackLlmClient (packages/llm/src/provider-fallback-client.ts)
 * ugyanide naplózza a Gemini-hívásokat is, `provider`-rel megkülönböztetve.
 */
export const llmUsage = pgTable("llm_usage", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** "anthropic" | "gemini" — lásd apps/web/lib/llm.ts. Régi soroknál (a mezőt megelőző hívások) alapértelmezésben "anthropic". */
  provider: text("provider").notNull().default("anthropic"),
  model: text("model").notNull(),
  inputTokens: integer("input_tokens").notNull(),
  outputTokens: integer("output_tokens").notNull(),
  costUsd: numeric("cost_usd", { precision: 10, scale: 6 }).notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
});

import { numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { agentRunStatusEnum } from "./enums";
import { stories } from "./stories";

/**
 * SZÁNDÉKOSAN vékony tábla — ez a docs/architecture/09-architecture-review.md
 * §6 legfontosabb korrekciója az eredeti 01-data-model.md ER diagramhoz
 * képest. Az eredeti terv `agent_runs` táblája minden agent-futáshoz teljes
 * input/output snapshotot tárolt volna Postgres OLTP-táblában — ez 10 000
 * Story/nap mellett milliós sor/nap lenne, és megölné a write-teljesítményt.
 *
 * A nyers, per-futás naplózás (input/output snapshot, részletes időzítés)
 * egy külön, dedikált observability-rendszerbe kerül
 * (docs/architecture/06-deployment.md §6.8, @magyarsportonline/observability
 * csomag) — ez a tábla csak egy vékony, auditra elégséges összegzést tart
 * meg Story-nkénti/agent-nkénti bontásban.
 */
export const agentRuns = pgTable("agent_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  agentName: text("agent_name").notNull(),
  storyId: uuid("story_id").references(() => stories.id),
  correlationId: uuid("correlation_id").notNull(),
  triggerEvent: text("trigger_event").notNull(),
  status: agentRunStatusEnum("status").notNull(),
  llmCostUsd: numeric("llm_cost_usd", { precision: 10, scale: 6 }),
  errorMessage: text("error_message"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
});

import { jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

/**
 * Story-/környezetfüggetlen szerkesztői memória a review döntésekből.
 *
 * A nyers review sorok Story UUID-khoz kötődnek, ezért önmagukban nem
 * hordozhatók staging és production között. Az admin tudásexport ezekből
 * személyes azonosító és Story FK nélkül, determinisztikus `patternKey`
 * alatt készít mintát; importkor ez a tábla őrzi meg idempotensen.
 */
export const knowledgeReviewPatterns = pgTable(
  "knowledge_review_patterns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    patternKey: text("pattern_key").notNull(),
    kind: text("kind").notNull(),
    payload: jsonb("payload").notNull(),
    learnedAt: timestamp("learned_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("knowledge_review_patterns_key_idx").on(table.patternKey)],
);

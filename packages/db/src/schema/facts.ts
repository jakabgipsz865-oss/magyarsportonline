import { boolean, integer, jsonb, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { factTypeEnum } from "./enums";
import { rawArticles } from "./raw-articles";
import { stories } from "./stories";

export const facts = pgTable("facts", {
  id: uuid("id").primaryKey().defaultRandom(),
  storyId: uuid("story_id")
    .notNull()
    .references(() => stories.id),
  rawArticleId: uuid("raw_article_id")
    .notNull()
    .references(() => rawArticles.id),
  factType: factTypeEnum("fact_type").notNull(),
  payload: jsonb("payload").notNull(),
  corroborationCount: integer("corroboration_count").notNull().default(1),
  isContradicted: boolean("is_contradicted").notNull().default(false),
  extractedAt: timestamp("extracted_at", { withTimezone: true }).notNull().defaultNow(),
});

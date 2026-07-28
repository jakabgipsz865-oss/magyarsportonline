import { boolean, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { storySourceContributionTypeEnum } from "./enums";
import { rawArticles } from "./raw-articles";
import { stories } from "./stories";

/**
 * Story ↔ RawArticle kapcsolótábla (docs/architecture/01-data-model.md
 * §1.2). Az unique constraint biztosítja az idempotenciát at-least-once
 * eseménykézbesítés mellett (docs/architecture/03-event-flow.md §3.6):
 * ugyanaz a RawArticle kétszeri feldolgozása sosem hoz létre duplikált
 * kapcsolatot.
 */
export const storySources = pgTable(
  "story_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storyId: uuid("story_id")
      .notNull()
      .references(() => stories.id),
    rawArticleId: uuid("raw_article_id")
      .notNull()
      .references(() => rawArticles.id),
    contributionType: storySourceContributionTypeEnum("contribution_type").notNull(),
    linkedAt: timestamp("linked_at", { withTimezone: true }).notNull().defaultNow(),
    // Admin szerkeszthetőség (2026-07-28-i "Hitelességi mutató" sprint) — egy
    // szerkesztő kizárhat egy forrást a Story hitelesség-számításából (pl.
    // téves egyezésnek bizonyul), indoklással. Kizárva a publikus "Források"
    // listából és a hitelesség-újraszámolásból is, de a kapcsolat maga
    // megmarad auditálhatónak.
    excluded: boolean("excluded").notNull().default(false),
    excludedReason: text("excluded_reason"),
  },
  (table) => [
    unique("story_sources_story_id_raw_article_id_unique").on(table.storyId, table.rawArticleId),
  ],
);

import { boolean, integer, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { categories } from "./categories";
import { riskLevelEnum, storyStatusEnum } from "./enums";
import { storyVersions } from "./story-versions";

/**
 * A Story-alapú adatmodell középpontja (docs/architecture/01-data-model.md
 * §1.1–§1.4). `current_version_id` és `story_versions.story_id` kölcsönösen
 * hivatkoznak egymásra — ezt a lazy `(): AnyPgColumn => ...` referencia-forma
 * oldja fel (Drizzle által ajánlott minta körkörös FK-khoz), a modulok közti
 * körkörös ES import pedig biztonságos, mert a hivatkozás csak akkor
 * értékelődik ki, amikor mindkét modul már betöltődött.
 */
export const stories = pgTable("stories", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").unique(),
  canonicalTitle: text("canonical_title").notNull(),
  status: storyStatusEnum("status").notNull().default("draft"),
  riskLevel: riskLevelEnum("risk_level"),
  confidenceScore: numeric("confidence_score", {
    precision: 4,
    scale: 3,
  }),
  categoryId: uuid("category_id").references(() => categories.id),
  // First non-null RawArticle.imageUrl seen for this Story (Real Sports
  // Portal UX sprint) — never overwritten once set, so a later source
  // without an image can't blank out an earlier one.
  imageUrl: text("image_url"),
  currentVersionId: uuid("current_version_id").references((): AnyPgColumn => storyVersions.id),
  versionCount: integer("version_count").notNull().default(0),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
  lastUpdatedAt: timestamp("last_updated_at", { withTimezone: true }).notNull().defaultNow(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  isDeveloping: boolean("is_developing").notNull().default(false),
  // --- Hitelességi mutató v1 (additív, 2026-07-28) ---
  // Mindig a legutolsó számítást tükrözik — a teljes történetet a
  // `story_credibility_history` tábla őrzi (packages/db/src/schema/
  // story-credibility-history.ts). `credibilityBand` a
  // `@magyarsportonline/shared` CREDIBILITY_BANDS slugja, a régi
  // `confidenceScore` (0-1 float) mellett, azt NEM helyettesíti — az a Fact
  // Verification Agent régi, forrásszám-alapú metrikája marad.
  credibilityScore: integer("credibility_score"),
  credibilityBand: text("credibility_band"),
  credibilityLabelHu: text("credibility_label_hu"),
  credibilityJustificationHu: text("credibility_justification_hu"),
  credibilityOfficialConfirmed: boolean("credibility_official_confirmed").notNull().default(false),
  credibilityCorroboratingCount: integer("credibility_corroborating_count"),
  credibilityUpdatedAt: timestamp("credibility_updated_at", { withTimezone: true }),
});

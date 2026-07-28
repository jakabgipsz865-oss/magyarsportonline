import { boolean, jsonb, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { stories } from "./stories";

/**
 * CQRS olvasási projekció (docs/architecture/01-data-model.md §1.5.2,
 * 09-architecture-review.md §5). A publikus `/api/v1/*` végpontok
 * (docs/architecture/04-api-spec.md §4.1) KIZÁRÓLAG ezt a táblát olvassák,
 * sosem a normalizált write-oldali táblákat közvetlenül — így a publikus
 * olvasási forgalom leválik az agentek write-terheléséről.
 *
 * Egy könnyű "projector" (nem üzleti agent, tisztán infrastrukturális
 * komponens — Fázis 9, 08-roadmap.md 76. lépés) tartja karban,
 * `story/published`/`story/updated.published` eseményekre feliratkozva.
 * Ez a Fázis 0-ban csak a séma-kontraktust rögzíti; a projector-logika
 * implementációja Fázis 9 feladata.
 */
export const storyReadModel = pgTable("story_read_model", {
  storyId: uuid("story_id")
    .primaryKey()
    .references(() => stories.id),
  slug: text("slug").notNull().unique(),
  titleHu: text("title_hu").notNull(),
  leadHu: text("lead_hu").notNull(),
  bodyHtml: text("body_html").notNull(),
  // Projected from stories.image_url — real Info source photo when the
  // source RSS provided one; null means the frontend renders a category-
  // tinted placeholder instead (Real Sports Portal UX sprint).
  imageUrl: text("image_url"),
  // Projected from story_versions.is_ai_generated (read-model-projector) —
  // false means LLM_PROVIDER=none produced this content (packages/llm's
  // NoLlmClient), so the frontend must show an explicit notice.
  isAiGenerated: boolean("is_ai_generated").notNull().default(true),
  metaDescription: text("meta_description"),
  structuredData: jsonb("structured_data"),
  sourcesSummary: jsonb("sources_summary").notNull().default([]),
  tags: jsonb("tags").notNull().default([]),
  category: jsonb("category"),
  confidenceScore: numeric("confidence_score", { precision: 4, scale: 3 }),
  isDeveloping: boolean("is_developing").notNull().default(false),
  publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
  lastUpdatedAt: timestamp("last_updated_at", { withTimezone: true }).notNull().defaultNow(),
  versionHistorySummary: jsonb("version_history_summary").notNull().default([]),
  // Hitelességi mutató v1 (additív, 2026-07-28) — a projector tölti fel a
  // `stories.credibility*` mezőkből és a `story_credibility_history`
  // táblából: { score, band, labelHu, justificationHu, officialConfirmed,
  // corroboratingSourceCount, updatedAt, history: [...] }.
  credibilitySummary: jsonb("credibility_summary"),
});

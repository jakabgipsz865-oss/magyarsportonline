import {
  boolean,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { stories } from "./stories";

/**
 * Immutábilis verziótörténet-bejegyzés (docs/architecture/01-data-model.md
 * §1.3, §1.6). Sosem módosul utólag — minden frissítés új sort hoz létre.
 * `stories.currentVersionId` mindig a legutolsó *publikált* verzióra mutat,
 * ami eltérhet a legutolsó, esetleg review alatt álló verziótól.
 */
export const storyVersions = pgTable(
  "story_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storyId: uuid("story_id")
      .notNull()
      .references(() => stories.id),
    versionNumber: integer("version_number").notNull(),
    titleHu: text("title_hu").notNull(),
    leadHu: text("lead_hu").notNull(),
    bodyHu: text("body_hu").notNull(),
    metaDescription: text("meta_description"),
    seoTags: jsonb("seo_tags"),
    structuredData: jsonb("structured_data"),
    changeSummaryHu: text("change_summary_hu"),
    generatedByModel: text("generated_by_model").notNull(),
    promptVersion: text("prompt_version").notNull(),
    factConsistencyScore: numeric("fact_consistency_score", {
      precision: 4,
      scale: 3,
    }),
    isPublished: boolean("is_published").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Defense-in-depth a verziószám-race ellen (09-architecture-review.md §9)
    // — az elsődleges védelem alkalmazás-oldali `SELECT ... FOR UPDATE`
    // tranzakció (Fázis 5 implementáció), ez a constraint a végső biztosíték.
    unique("story_versions_story_id_version_number_unique").on(table.storyId, table.versionNumber),
  ],
);

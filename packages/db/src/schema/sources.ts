import { boolean, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sourceLicenseTypeEnum, sourceReliabilityTierEnum, sourceTypeEnum } from "./enums";

/**
 * A begyűjtött hírforrás (docs/architecture/01-data-model.md §1.2).
 * `license_type` a jogi engedélyezettséget rögzíti (lásd
 * docs/feasibility-analysis.md §1) — a Source Ingest Agent csak
 * `is_active=true` forrásokat kérdez le.
 */
export const sources = pgTable("sources", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  baseUrl: text("base_url").notNull(),
  type: sourceTypeEnum("type").notNull(),
  language: text("language").notNull(),
  licenseType: sourceLicenseTypeEnum("license_type").notNull(),
  reliabilityTier: sourceReliabilityTierEnum("reliability_tier").notNull(),
  fetchConfig: jsonb("fetch_config").notNull(),
  isActive: boolean("is_active").notNull().default(false),
  onboardedAt: timestamp("onboarded_at", { withTimezone: true }).notNull().defaultNow(),
  lastFetchedAt: timestamp("last_fetched_at", { withTimezone: true }),
  lastFetchStatus: text("last_fetch_status"),
});

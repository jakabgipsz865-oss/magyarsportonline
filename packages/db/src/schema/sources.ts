import { boolean, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import {
  sourceCategoryEnum,
  sourceContentModeEnum,
  sourceLicenseTypeEnum,
  sourceReliabilityTierEnum,
  sourceTypeEnum,
} from "./enums";

/**
 * A begyűjtött hírforrás (docs/architecture/01-data-model.md §1.2).
 * `license_type` a jogi engedélyezettséget rögzíti (lásd
 * docs/feasibility-analysis.md §1) — a Source Ingest Agent csak
 * `is_active=true` forrásokat kérdez le.
 *
 * A 2026-07-28-i többforrásos/Story-építő irány (docs/source-registry.md)
 * Source Registry mezői ADDITÍV oszlopokként kerültek be — mind nullable,
 * hogy a meglévő, egyetlen BBC seed sort ne törjék el, és a meglévő
 * `reliabilityTier` A/B/C mezőt (amit a Fact Verification Agent
 * confidence score-ja ÉLESben használ, lásd
 * packages/agents/src/fact-verification/confidence-score.ts) NEM váltják
 * ki — a `trustBaseline` egy attól független, új numerikus alappont.
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
  // --- Source Registry (additív, 2026-07-28) ---
  /** ISO 3166-1 alpha-2 országkód, pl. "GB", "ES", "IT", "DE", "FR". */
  country: text("country"),
  /** Liga/klub címkék, pl. { leagues: ["premier-league"], clubs: ["arsenal-fc"] } — szabad jsonb, mert a liga/klub-taxonómia még bővül. */
  leagueTags: jsonb("league_tags"),
  category: sourceCategoryEnum("category"),
  contentMode: sourceContentModeEnum("content_mode"),
  /** 0-100 bizalmi alappont a hitelességi pontszámításhoz — a meglévő A/B/C `reliabilityTier` mellett, azt nem helyettesíti. */
  trustBaseline: integer("trust_baseline"),
  /** Szabad szöveg, mert a robots.txt-állapot forrásonként eltérő granularitású (pl. "engedi a /sport/rss-t, a HTML-t nem"). */
  robotsStatus: text("robots_status"),
  /** Szabad szöveg, az adott forrás ToS/felhasználási feltételeinek rövid összegzése. */
  termsStatus: text("terms_status"),
  /** Kötelező attribution-szöveg vagy -szabály, ha a forrás licence megköveteli. */
  attributionRule: text("attribution_rule"),
  /** Kép-/médiapolicy jsonb (pl. { allowOwnPhotos: false, allowSocialEmbeds: true, allowWikimedia: true }) — ld. docs/source-registry.md. */
  imagePolicy: jsonb("image_policy"),
  /** Lekérdezési gyakoriság percben. */
  pollingFrequencyMinutes: integer("polling_frequency_minutes"),
  /** Melyik ArticleExtractor implementáció kezeli (pl. "bbc-sport") — null, ha még nincs bekötve extractor, csak RSS-snippet módban fut. */
  extractorName: text("extractor_name"),
  /** Utolsó SIKERES lekérés időpontja — a meglévő `lastFetchedAt`-tal szemben (ami minden kísérletet rögzít), ez csak a sikereket. */
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  /** Utolsó HIBÁS lekérés időpontja. */
  lastErrorAt: timestamp("last_error_at", { withTimezone: true }),
});

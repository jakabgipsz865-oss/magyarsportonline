import { boolean, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { stories } from "./stories";

/**
 * A hitelességi pontszám változásainak naplója (2026-07-28-i "Hitelességi
 * mutató v1" sprint, a felhasználó explicit kérése: "hitelességi változások
 * története" jelenjen meg a publikus Story-oldalon). Minden újraszámoláskor
 * (a Fact Verification Agent futásakor, vagy admin "Újraszámolás"/"Felülbírálás"
 * műveletekor) egy ÚJ sor kerül be — sosem frissítünk meglévő sort. A
 * `stories.credibility*` mezők mindig a legutolsó sort tükrözik; ez a tábla
 * őrzi a teljes történetet.
 */
export const storyCredibilityHistory = pgTable("story_credibility_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  storyId: uuid("story_id")
    .notNull()
    .references(() => stories.id),
  score: integer("score").notNull(),
  band: text("band").notNull(),
  labelHu: text("label_hu").notNull(),
  justificationHu: text("justification_hu").notNull(),
  officialConfirmed: boolean("official_confirmed").notNull(),
  corroboratingSourceCount: integer("corroborating_source_count").notNull(),
  /** "auto" (Fact Verification Agent / admin újraszámolás) vagy "manual_override" (admin közvetlen felülbírálás). */
  source: text("source").notNull().default("auto"),
  /**
   * A hitelesség-magyarázat PILLANATKÉPE (2026-07-28-i bővítés):
   * { sourceBreakdown, contradictions, scoreBreakdown } — pontosan azokkal
   * az adatokkal, amikkel ez a pontszám ténylegesen kiszámolódott.
   * SZÁNDÉKOSAN nem a publikálás pillanatában újraszámolt, "élő" adat —
   * enélkül egy Story első verziójának publikálásakor a `stories.version_count`
   * már eggyel magasabb lenne, mint amivel a pontszám ténylegesen készült
   * (a "korábbi Story-frissítések" bónusz tévesen bekapcsolna), és a
   * megjelenített indoklás összege nem egyezne a ténylegesen mutatott
   * pontszámmal. `null`, ha egy régebbi sor még e bővítés előtt készült.
   */
  explanation: jsonb("explanation"),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
});

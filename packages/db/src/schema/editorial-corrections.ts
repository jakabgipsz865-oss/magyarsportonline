import { pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { stories } from "./stories";

/**
 * Hiba kategória, amit a szerkesztő a mondatonkénti javításkor választ
 * (2026-07-28-i "tanítható szerkesztői felület" sprint,
 * `/internal/editorial-ab-review`). A kategória dönti el, hogy egy
 * elfogadott javítás melyik levezetett listába kerül (lásd
 * packages/agents/src/shared/editorial-corrections.ts):
 * - "slang" / "terminology" → futballszleng-/terminológia-lexikon bővítés
 *   (ugyanaz a `LexiconEntry` alak, mint a kézzel írt football-lexicon.ts-ben).
 * - "literal_translation" → tiltott tükörfordítások listája.
 * - "style" / "grammar" → ajánlott magyar sportújságírói megfogalmazások.
 * Minden kategória bekerül a prompt-példatárba is, kategóriától függetlenül.
 */
export const editorialCorrectionCategoryEnum = pgEnum("editorial_correction_category", [
  "slang",
  "terminology",
  "literal_translation",
  "style",
  "grammar",
  "fact",
]);

/**
 * Egy szerkesztő által elfogadott, mondatszintű javítás — az emberi
 * visszajelzésből épülő, folyamatosan bővülő tanítóanyag. Sosem törlünk
 * belőle automatikusan; a jövőbeli generálásokba a legutóbbi N elem kerül be
 * (lásd editorial-corrections.ts `toPromptExamples` limitje), hogy a prompt
 * mérete kordában maradjon akkor is, ha a lista sokáig nő.
 */
export const editorialCorrections = pgTable("editorial_corrections", {
  id: uuid("id").primaryKey().defaultRandom(),
  storyId: uuid("story_id")
    .notNull()
    .references(() => stories.id),
  category: editorialCorrectionCategoryEnum("category").notNull(),
  /** Rövid angol kifejezés/idióma (opcionális — elsősorban slang/terminology kategóriáknál hasznos). */
  termEn: text("term_en"),
  /** Az eredeti angol mondat/kontextus, amit a szerkesztő a forrásból kiválasztott vagy beírt. */
  originalSentenceEn: text("original_sentence_en").notNull(),
  /** A jelenlegi (hibás/javítandó) magyar mondat, ahogy a pipeline legenerálta. */
  currentSentenceHu: text("current_sentence_hu").notNull(),
  /** A szerkesztő saját, elfogadott javítása. */
  correctedSentenceHu: text("corrected_sentence_hu").notNull(),
  /** Opcionális szabad szöveges indoklás/megjegyzés. */
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

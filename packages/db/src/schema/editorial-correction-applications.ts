import { pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { editorialCorrections } from "./editorial-corrections";
import { stories } from "./stories";

/** Melyik agent generálása után mértük a javítás hatását (2026-07-28-i "mérhető szerkesztői memória" sprint). */
export const editorialCorrectionApplicationStageEnum = pgEnum(
  "editorial_correction_application_stage",
  ["hungarian_writer", "editorial_rewrite"],
);

/**
 * ✔ "applied": a javított megfogalmazás megjelent, a régi hibás nem.
 * ⚠ "partial": mindkettő megjelent, vagy a kifejezés releváns volt, de sem a
 *   régi, sem a javított forma nem egyezett szó szerint (a modell máshogy
 *   fogalmazott).
 * ✖ "not_applied": a régi, javítandó megfogalmazás újra előfordult.
 */
export const editorialCorrectionApplicationVerdictEnum = pgEnum(
  "editorial_correction_application_verdict",
  ["applied", "partial", "not_applied"],
);

/**
 * Minden valódi (nem fallback) generálás után, minden releváns
 * `editorial_corrections` tételre egy mérési esemény — ebből épül fel, hogy
 * egy adott javítás idővel ténylegesen tanult mintaként viselkedik-e
 * (lásd packages/agents/src/shared/correction-effectiveness.ts). Nem
 * összegzés — a nyers eseménysor, hogy a trend (javult/romlott) is
 * levezethető legyen belőle utólag.
 */
export const editorialCorrectionApplications = pgTable("editorial_correction_applications", {
  id: uuid("id").primaryKey().defaultRandom(),
  correctionId: uuid("correction_id")
    .notNull()
    .references(() => editorialCorrections.id),
  storyId: uuid("story_id")
    .notNull()
    .references(() => stories.id),
  stage: editorialCorrectionApplicationStageEnum("stage").notNull(),
  verdict: editorialCorrectionApplicationVerdictEnum("verdict").notNull(),
  /** Rövid, ember által olvasható indoklás (pl. mely kifejezés/mondat egyezett). */
  evidence: text("evidence"),
  detectedAt: timestamp("detected_at", { withTimezone: true }).notNull().defaultNow(),
});

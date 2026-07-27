import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { stories } from "./stories";

/**
 * Story-létrehozási race condition elleni védelem
 * (docs/architecture/01-data-model.md §1.5.1,
 * docs/architecture/03-event-flow.md §3.7). A Deduplication Agent egy durva
 * (kategória + fő entitás + dátum-bucket alapú) determinisztikus hash-t
 * számol minden RawArticle-re; a Story Merge Agent a Story-létrehozást
 * `pg_advisory_xact_lock(hashtext(fingerprint_hash))`-kal védi, ezen a
 * táblán ellenőrizve/rögzítve, hogy egy adott fingerprinthez már létezik-e
 * Story — így két egyidejű, azonos eseményről szóló NEW_STORY jelölt sosem
 * hozhat létre két Story-t.
 */
export const storyFingerprints = pgTable("story_fingerprints", {
  fingerprintHash: text("fingerprint_hash").primaryKey(),
  storyId: uuid("story_id")
    .notNull()
    .references(() => stories.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

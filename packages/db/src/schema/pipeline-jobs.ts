import { index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { pipelineJobStatusEnum } from "./enums";

/**
 * Durable, Postgres-alapú job-queue (2026-07-29, aszinkron pipeline sprint,
 * docs/open-decisions.md #12) — a korábbi `InProcessDispatcher` (lásd
 * @magyarsportonline/events) szinkron, egyetlen HTTP-kérésen belüli
 * `emit()`-jét váltja ki: minden pipeline-esemény (`SportsNewsEvent`) egy sor
 * itt, nem egy azonnali, ugyanabban a call stackben lefutó függvényhívás.
 * Ez teszi lehetővé, hogy egyetlen HTTP-timeout se tudjon megszakítani egy
 * teljes Story-feldolgozást: minden pipeline-szakasz (dedup, story-merge,
 * fact-verification, Hungarian Writer, Editorial Rewrite, SEO, publish-gate,
 * read-model-projector) saját, külön feldolgozható jobként fut, retry/resume
 * képességgel.
 *
 * A `event` oszlop a TELJES, validált `SportsNewsEvent` burkot tárolja
 * (lásd packages/events/src/catalog.ts `sportsNewsEventSchema`) — nincs
 * külön, párhuzamos "job_type" taxonómia bevezetve, a worker az `event.type`
 * mezőből dönti el, melyik agent-handlert kell hívnia.
 *
 * SZÁNDÉKOSAN NEM helyettesíti az `agent_runs` táblát (az továbbra is a
 * vékony, insert-only audit napló marad) — ez a tábla a queue ÁLLAPOTÁT
 * (pending/in_progress/completed/dead_letter, próbálkozásszám, zárolás)
 * tartja, ami az `agent_runs`-ból teljesen hiányzik.
 */
export const pipelineJobs = pgTable(
  "pipeline_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    event: jsonb("event").notNull(),
    status: pipelineJobStatusEnum("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    /**
     * Mikortól "esedékes" a job — kezdetben `now()`, egy sikertelen próbálkozás
     * után `now() + backoff` (exponenciális visszalépés), így a
     * pending/available_at pár egyszerre szolgálja az "új job" és a
     * "retry-ra váró job" lekérdezését ugyanazzal az indexszel.
     */
    availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
    /**
     * Amikor egy worker "kicsekkolja" a jobot (claim). Egy `in_progress` job,
     * aminek a `locked_at`-ja egy elévülési küszöbnél régebbi, újra
     * felclaimelhető — ez adja a "resume" garanciát akkor is, ha a worker
     * function maga hal meg váratlanul (pl. platform-szintű kill) a job
     * feldolgozása közben, nem csak akkor, ha a handler maga dob hibát.
     */
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // A claim-lekérdezés (status + available_at szűrés/rendezés) fő indexe.
    index("pipeline_jobs_status_available_at_idx").on(table.status, table.availableAt),
  ],
);

import { createDatabaseClient, type Database } from "@magyarsportonline/db";
import { env } from "./env";

/**
 * Single shared Drizzle client for the whole app. `apps/web` reads ONLY the
 * `story_read_model` CQRS projection (docs/architecture/01-data-model.md
 * §1.5.2, 09-architecture-review.md §5) — never the write-side
 * `stories`/`story_versions` tables directly — see lib/stories.ts.
 */
export const db: Database = createDatabaseClient(env.DATABASE_URL);

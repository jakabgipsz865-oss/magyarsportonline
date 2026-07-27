import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index";

export type Database = ReturnType<typeof createDatabaseClient>;

/**
 * Creates a Drizzle client bound to the full schema. Deliberately takes the
 * connection string as a parameter rather than reading `process.env`
 * directly — env parsing/validation is @magyarsportonline/web's
 * responsibility (see docs/architecture/06-deployment.md §6.6), so this
 * package stays usable from any runtime (Next.js route handler, a future
 * standalone agent worker, a test harness with a throwaway database).
 */
export function createDatabaseClient(connectionString: string) {
  const client = postgres(connectionString);
  return drizzle(client, { schema });
}

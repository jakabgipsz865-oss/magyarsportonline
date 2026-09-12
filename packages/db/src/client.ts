import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index";

export type Database = ReturnType<typeof createDatabaseClient>;

export interface DatabaseClientOptions {
  /** Maximum physical connections opened by this client. */
  max?: number;
  /** Whether Postgres.js should query PostgreSQL type metadata. */
  fetchTypes?: boolean;
  /** Whether Postgres.js should use prepared statements. */
  prepare?: boolean;
}

/**
 * Creates a Drizzle client bound to the full schema. Deliberately takes the
 * connection string as a parameter rather than reading `process.env`
 * directly — env parsing/validation is @magyarsportonline/web's
 * responsibility (see docs/architecture/06-deployment.md §6.6), so this
 * package stays usable from any runtime (Next.js route handler, a future
 * standalone agent worker, a test harness with a throwaway database).
 */
export function createDatabaseClient(
  connectionString: string,
  options: DatabaseClientOptions = {},
) {
  const client = postgres(connectionString, {
    ...(options.max === undefined ? {} : { max: options.max }),
    ...(options.fetchTypes === undefined ? {} : { fetch_types: options.fetchTypes }),
    ...(options.prepare === undefined ? {} : { prepare: options.prepare }),
  });
  return drizzle(client, { schema });
}

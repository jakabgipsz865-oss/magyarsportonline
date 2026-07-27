import { defineConfig } from "drizzle-kit";

// `db:generate` only diffs the TypeScript schema against previously generated
// migrations — it does not need a live database connection, so this file
// must stay loadable without DATABASE_URL set. `db:migrate` (and any other
// command that does need a live connection, e.g. `studio`) reads
// `dbCredentials` below — read directly from `process.env`, matching
// `src/seed.ts`'s standalone-CLI-script pattern (this file isn't part of
// apps/web, so it can't go through apps/web/lib/env.ts). Never fall back to
// a placeholder connection string — an unset DATABASE_URL must fail loudly.
const connectionString = process.env["DATABASE_URL"];

export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  ...(connectionString ? { dbCredentials: { url: connectionString } } : {}),
});

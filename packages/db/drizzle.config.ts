import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  // `db:generate` only diffs the TypeScript schema against previously
  // generated migrations — it does not need a live database connection.
  // `dbCredentials` is intentionally left unset here; commands that do need
  // a live connection (`migrate`, `push`, `studio`) are introduced in a
  // later phase together with validated env handling
  // (docs/architecture/08-roadmap.md, Fázis 1+).
});

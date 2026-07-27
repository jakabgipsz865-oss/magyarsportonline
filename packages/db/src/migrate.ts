#!/usr/bin/env node
/**
 * Production-safe, idempotent migration runner (no truncation, no seeding —
 * see testing.ts / scripts/demo.ts for the destructive test/demo variants).
 * Invoked via `pnpm db:migrate`, wired into apps/web's `build` script so it
 * runs automatically on every deploy (Vercel, CI, local) using whatever
 * DATABASE_URL is already set in that environment.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDatabaseClient } from "./client";

const MIGRATIONS_FOLDER = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "drizzle");

async function main(): Promise<void> {
  const databaseUrl = process.env["DATABASE_URL"];
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set — cannot run migrations.");
  }

  const db = createDatabaseClient(databaseUrl);
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  await db.$client.end();
  console.error("Migrations applied.");
}

main().catch((error: unknown) => {
  console.error("Migration failed:", error);
  process.exitCode = 1;
});

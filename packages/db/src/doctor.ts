import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

/**
 * Environment Doctor — a single-command developer-experience check
 * (docs/infrastructure-setup.md), not a business feature. Lets a new
 * developer (or a freshly set up machine) confirm in a couple of minutes
 * whether the dev environment is ready, without reading through the setup
 * doc line by line. Run via `pnpm env:doctor` from the repo root or
 * `pnpm --filter @magyarsportonline/db run env:doctor`. Named `env:doctor`,
 * not `doctor`, because pnpm reserves the bare `doctor` subcommand for its
 * own built-in lockfile/store checks — `pnpm doctor` would silently run
 * that instead of this script.
 *
 * Uses the raw `postgres` client rather than the Drizzle schema on purpose:
 * a diagnostic tool should still work (and report drift accurately) even
 * when the schema and the live database have diverged.
 */

type Status = "PASS" | "WARNING" | "ERROR" | "SKIPPED";

interface CheckResult {
  name: string;
  status: Status;
  message: string;
  remediation?: string;
}

const SYMBOLS: Record<Status, string> = {
  PASS: "\x1b[32m✓\x1b[0m",
  WARNING: "\x1b[33m⚠\x1b[0m",
  ERROR: "\x1b[31m✗\x1b[0m",
  SKIPPED: "\x1b[2m–\x1b[0m",
};

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");

function readMinNodeVersion(): string {
  const rootPackageJson = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf-8")) as {
    engines?: { node?: string };
  };
  return (rootPackageJson.engines?.node ?? ">=0.0.0").replace(/^>=/, "");
}

function readExpectedPnpmVersion(): string {
  const rootPackageJson = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf-8")) as {
    packageManager?: string;
  };
  return (rootPackageJson.packageManager ?? "pnpm@0.0.0").replace(/^pnpm@/, "");
}

function compareVersions(a: string, b: string): number {
  const partsA = a.split(".").map(Number);
  const partsB = b.split(".").map(Number);
  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const diff = (partsA[i] ?? 0) - (partsB[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function checkNodeVersion(): CheckResult {
  const installed = process.versions.node;
  const required = readMinNodeVersion();
  if (compareVersions(installed, required) < 0) {
    return {
      name: "Node.js verzió",
      status: "ERROR",
      message: `${installed} (minimum ${required} szükséges, lásd .nvmrc)`,
      remediation: `nvm install ${required} && nvm use ${required}`,
    };
  }
  return { name: "Node.js verzió", status: "PASS", message: installed };
}

function checkPnpmVersion(): CheckResult {
  const expected = readExpectedPnpmVersion();
  let installed: string;
  try {
    installed = execFileSync("pnpm", ["--version"], { encoding: "utf-8" }).trim();
  } catch {
    return {
      name: "pnpm verzió",
      status: "ERROR",
      message: "pnpm nem található a PATH-on",
      remediation: "corepack enable && corepack use pnpm@" + expected,
    };
  }
  if (installed !== expected) {
    return {
      name: "pnpm verzió",
      status: "WARNING",
      message: `${installed} telepítve, ${expected} van rögzítve (ADR 0001)`,
      remediation: `corepack use pnpm@${expected}`,
    };
  }
  return { name: "pnpm verzió", status: "PASS", message: installed };
}

function checkRequiredEnvVar(name: string, remediation: string): CheckResult {
  const value = process.env[name];
  if (!value) {
    return {
      name,
      status: "ERROR",
      message: "nincs beállítva",
      remediation,
    };
  }
  return { name, status: "PASS", message: "beállítva" };
}

function checkOptionalEnvVars(): CheckResult {
  const optional = [
    "INNGEST_EVENT_KEY",
    "INNGEST_SIGNING_KEY",
    "META_GRAPH_API_TOKEN",
    "X_API_BEARER_TOKEN",
    "NEXTAUTH_SECRET",
  ];
  const unset = optional.filter((name) => !process.env[name]);
  if (unset.length === optional.length) {
    return {
      name: "Opcionális env változók (későbbi fázisok)",
      status: "SKIPPED",
      message: "egyik sincs beállítva (rendben — csak Fázis 2+ funkciókhoz kellenek)",
    };
  }
  return {
    name: "Opcionális env változók (későbbi fázisok)",
    status: "SKIPPED",
    message: `${optional.length - unset.length}/${optional.length} beállítva`,
  };
}

async function checkDatabase(): Promise<CheckResult[]> {
  const connectionString = process.env["DATABASE_URL"];
  if (!connectionString) {
    const skipped: CheckResult = {
      name: "PostgreSQL kapcsolat",
      status: "SKIPPED",
      message: "DATABASE_URL hiányzik, nincs mit ellenőrizni",
    };
    return [
      skipped,
      { ...skipped, name: "PostgreSQL verzió" },
      { ...skipped, name: "pgvector extension" },
      { ...skipped, name: "Migrációk állapota" },
      { ...skipped, name: "Seed státusz" },
    ];
  }

  const sql = postgres(connectionString, { connect_timeout: 5, max: 1 });
  const results: CheckResult[] = [];

  try {
    await sql`select 1`;
    results.push({
      name: "PostgreSQL kapcsolat",
      status: "PASS",
      message: "sikeres kapcsolódás",
    });
  } catch (error) {
    results.push({
      name: "PostgreSQL kapcsolat",
      status: "ERROR",
      message: error instanceof Error ? error.message : String(error),
      remediation:
        "Ellenőrizd a DATABASE_URL-t (Neon konzol → Connection Details), hogy a projekt nincs-e suspended állapotban, és hogy a connection string tartalmazza-e a ?sslmode=require paramétert.",
    });
    await sql.end({ timeout: 1 });
    return [
      ...results,
      { name: "PostgreSQL verzió", status: "SKIPPED", message: "nincs kapcsolat" },
      { name: "pgvector extension", status: "SKIPPED", message: "nincs kapcsolat" },
      { name: "Migrációk állapota", status: "SKIPPED", message: "nincs kapcsolat" },
      { name: "Seed státusz", status: "SKIPPED", message: "nincs kapcsolat" },
    ];
  }

  try {
    const [row] = await sql<{ version: string }[]>`select version()`;
    const versionString = row?.version ?? "ismeretlen";
    const majorMatch = /PostgreSQL (\d+)/.exec(versionString);
    const major = majorMatch ? Number(majorMatch[1]) : 0;
    results.push(
      major >= 13
        ? { name: "PostgreSQL verzió", status: "PASS", message: versionString }
        : {
            name: "PostgreSQL verzió",
            status: "WARNING",
            message: versionString,
            remediation: "A pgvector extension PostgreSQL 13+ verziót igényel.",
          },
    );
  } catch (error) {
    results.push({
      name: "PostgreSQL verzió",
      status: "WARNING",
      message: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    const [row] = await sql<{ extversion: string }[]>`
      select extversion from pg_extension where extname = 'vector'
    `;
    if (row) {
      results.push({
        name: "pgvector extension",
        status: "PASS",
        message: `telepítve (v${row.extversion})`,
      });
    } else {
      const [available] = await sql<{ name: string }[]>`
        select name from pg_available_extensions where name = 'vector'
      `;
      results.push(
        available
          ? {
              name: "pgvector extension",
              status: "WARNING",
              message: "elérhető, de még nincs létrehozva",
              remediation:
                "pnpm --filter @magyarsportonline/db db:migrate (a migráció tartalmazza a CREATE EXTENSION IF NOT EXISTS vector-t)",
            }
          : {
              name: "pgvector extension",
              status: "ERROR",
              message: "nem elérhető ezen a Postgres-példányon",
              remediation:
                "Neon esetén ellenőrizd, hogy a projekt támogatja-e a pgvector extension-t (Neon konzol → Extensions).",
            },
      );
    }
  } catch (error) {
    results.push({
      name: "pgvector extension",
      status: "WARNING",
      message: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    const journal = JSON.parse(
      readFileSync(resolve(here, "../drizzle/meta/_journal.json"), "utf-8"),
    ) as { entries: unknown[] };
    const totalMigrations = journal.entries.length;

    let appliedMigrations = 0;
    try {
      const [row] = await sql<{ count: number }[]>`
        select count(*)::int as count from drizzle.__drizzle_migrations
      `;
      appliedMigrations = row?.count ?? 0;
    } catch {
      appliedMigrations = 0;
    }

    if (appliedMigrations >= totalMigrations) {
      results.push({
        name: "Migrációk állapota",
        status: "PASS",
        message: `mind a ${totalMigrations} migráció alkalmazva`,
      });
    } else {
      results.push({
        name: "Migrációk állapota",
        status: "ERROR",
        message: `${appliedMigrations}/${totalMigrations} migráció alkalmazva`,
        remediation: "pnpm --filter @magyarsportonline/db db:migrate",
      });
    }
  } catch (error) {
    results.push({
      name: "Migrációk állapota",
      status: "WARNING",
      message: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    const [row] = await sql<{ name: string }[]>`
      select name from sources where name = 'BBC Sport - Football' limit 1
    `;
    results.push(
      row
        ? { name: "Seed státusz", status: "PASS", message: "dev seed adatok megtalálhatók" }
        : {
            name: "Seed státusz",
            status: "WARNING",
            message: "a dev seed adatok (BBC Sport - Football forrás) hiányoznak",
            remediation: "pnpm --filter @magyarsportonline/db db:seed",
          },
    );
  } catch {
    results.push({
      name: "Seed státusz",
      status: "SKIPPED",
      message: "a 'sources' tábla még nem létezik — futtasd előbb a migrációt",
      remediation: "pnpm --filter @magyarsportonline/db db:migrate",
    });
  }

  await sql.end({ timeout: 1 });
  return results;
}

function printResult(result: CheckResult): void {
  const line = `${SYMBOLS[result.status]} ${result.name}: ${result.message}`;
  process.stdout.write(`${line}\n`);
  if (result.remediation) {
    process.stdout.write(`  \x1b[2m→ Teendő: ${result.remediation}\x1b[0m\n`);
  }
}

async function main(): Promise<void> {
  process.stdout.write("\n\x1b[1mEnvironment Doctor — magyarsportonline.hu\x1b[0m\n\n");

  process.stdout.write("\x1b[1mEszközök\x1b[0m\n");
  const toolResults = [checkNodeVersion(), checkPnpmVersion()];
  toolResults.forEach(printResult);

  process.stdout.write("\n\x1b[1mKörnyezeti változók\x1b[0m\n");
  const envResults = [
    checkRequiredEnvVar(
      "DATABASE_URL",
      "Töltsd ki a DATABASE_URL-t a Neon konzolból (docs/infrastructure-setup.md 1. szakasz).",
    ),
    checkRequiredEnvVar(
      "ANTHROPIC_API_KEY",
      "Szerezz be egy API kulcsot az Anthropic Console-ból, és állítsd be az ANTHROPIC_API_KEY-t.",
    ),
    checkRequiredEnvVar(
      "CRON_SECRET",
      "Generálj egy titkot (pl. `openssl rand -hex 32`) és állítsd be CRON_SECRET-ként.",
    ),
    checkOptionalEnvVars(),
  ];
  envResults.forEach(printResult);

  process.stdout.write("\n\x1b[1mAdatbázis (Neon PostgreSQL)\x1b[0m\n");
  const dbResults = await checkDatabase();
  dbResults.forEach(printResult);

  const allResults = [...toolResults, ...envResults, ...dbResults];
  const errorCount = allResults.filter((r) => r.status === "ERROR").length;
  const warningCount = allResults.filter((r) => r.status === "WARNING").length;
  const passCount = allResults.filter((r) => r.status === "PASS").length;

  process.stdout.write(
    `\n\x1b[1mÖsszefoglaló:\x1b[0m ${passCount} PASS, ${warningCount} WARNING, ${errorCount} ERROR\n`,
  );

  if (errorCount > 0) {
    process.stdout.write("\n\x1b[31m\x1b[1m✗ A környezet NEM készen áll fejlesztésre.\x1b[0m\n");
    process.stdout.write(
      "Javítsd a fenti ERROR bejegyzéseket a jelzett teendők alapján, majd futtasd újra a `pnpm env:doctor` parancsot.\n\n",
    );
    process.exitCode = 1;
    return;
  }

  if (warningCount > 0) {
    process.stdout.write(
      "\n\x1b[33m\x1b[1m⚠ A környezet nagyrészt kész, de van néhány figyelmeztetés.\x1b[0m\n",
    );
    process.stdout.write("Nézd át a fenti WARNING bejegyzéseket — a fejlesztés megkezdhető.\n\n");
    return;
  }

  process.stdout.write("\n\x1b[32m\x1b[1m✓ Ready for Development\x1b[0m\n\n");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

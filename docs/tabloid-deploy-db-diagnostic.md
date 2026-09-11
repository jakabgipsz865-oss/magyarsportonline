# MSO deploy DB diagnosis — 2026-09-11

Read-only Safari preflight: Vercel user `jakabgipsz865-8537`, team `GipszJakabTeam` (Hobby), project `magyarsportonline-web`. Neon user `jakabgipsz865`, organization/project `magyarsportonline`, project `wild-lake-68761162` (Free).

## Reproduced failure

Failing deployment: https://vercel.com/gipsz-jakab-team/magyarsportonline-web/DpDiSdtLAr2ZdM8J8j1LJaKC6a6p
Environment: **Preview**, commit `1ea350da7671312e469d9d3f163799f19dfebc02`.

| FAIL STAGE | ERROR | ROOT CAUSE | AFFECTED FILE/QUERY | MINIMAL FIX |
| --- | --- | --- | --- | --- |
| web build → db:migrate, before next build | Either connection "url" or "host", "database" are required for PostgreSQL database connection | Preview has no DATABASE_URL; the visible project variable is Production-only | apps/web/package.json build; packages/db/drizzle.config.ts; no SQL query executes | Configure Preview DATABASE_URL for a separately verified, approved Preview database; retain fail-loud migration behavior |

Locally reproduced with DATABASE_URL explicitly removed from the migration process environment: `drizzle-kit migrate` exits 1 with the identical error, before connecting to a database. No secrets were revealed or read for this reproduction.

The latest Production deployment is Ready: https://vercel.com/gipsz-jakab-team/magyarsportonline-web/9yV5HDGD2ix12nYNiume69WJuGup (commit 9cc84d2c9f9a1e224ab0643263dfe63415196f96). Other recent main/Production entries are also Ready; the recurring errors in the inspected history are Preview entries. Ready status is not a fresh runtime smoke test.

## Scope of evidence

- Build-time DB access exists intentionally: migration runs before Next.js build, documented in ADR 0007.
- The observed failure precedes connection and SQL execution. Missing tables, missing columns, and migration drift are not causes of this particular error. No exhaustive production schema-drift audit was performed.
- Homepage, article, category and sitemap code already declare force-dynamic; no evidence that these pages query the DB for static prerendering caused the observed failure.
- Removing/skipping migration would hide the configuration failure and would restore a previously documented runtime missing-table risk. No such change was made.

## Configuration blocker / safe stop

Neon currently contains exactly three branches: production (Default), clean-prod-20260829, legacy-prod-20260829. The verified production branch is clean-prod-20260829 / br-broad-mountain-a2de1tqm. None is identified as an approved Preview target. Neither the default branch name nor a legacy branch is sufficient authorization to attach Preview builds, which automatically run migrations.

Needed: explicit Preview branch selection or authorization to provision a dedicated Preview branch, then configure only Vercel Preview DATABASE_URL. No production connection string copying, new login, account switch, secret reveal or configuration mutation was attempted.

The requested safe raw-only ingestion and production run have not started because the prerequisite configuration fix is blocked. This diagnostic performed no external writes, deployment, migration, RSS ingestion, queueing, generation or publication. Gemini calls: 0. Existing local calibration changes remain intact.

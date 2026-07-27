# ADR 0008 — CI Postgres service (pgvector) a DB-integrációs tesztekhez

**Státusz:** elfogadva
**Dátum:** 2026-07-27
**Kontextus:** MVP pipeline implementáció (`packages/db`, `packages/agents` integrációs tesztjei)

## Döntési helyzet

A `packages/db` és `packages/agents` csomagok integrációs tesztjei (pl. `locking-advisory.test.ts` — a race-condition javítás valódi `pg_advisory_xact_lock` viselkedésének bizonyítása, vagy a teljes agent-pipeline tesztjei) **valódi Postgres-t** igényelnek, nem mock-ot — ez tudatos döntés, mert egy mock sosem bizonyítaná, hogy a tényleges advisory-lock szemantika (vagy a Drizzle-séma, a migráció, a `pgvector` kiterjesztés) ténylegesen működik.

Az eredeti CI workflow ([ADR-független, `.github/workflows/ci.yml`](../../.github/workflows/ci.yml), Fázis 0) nem rendelkezett adatbázissal, így ezek a tesztek a `describe.skipIf(!databaseUrl)` védelem miatt **némán kimaradtak** CI-ban — csak lokálisan futottak, ahol a fejlesztő kézzel felállított egy Postgres-t.

## Döntés

A CI workflow kiegészült egy **`pgvector/pgvector:pg16` service container**-rel (GitHub Actions natív `services:` mechanizmusa), `DATABASE_URL`/`TEST_DATABASE_URL` környezeti változókkal beállítva a job szintjén.

## Indoklás

- **Ugyanaz az image-család**, mint a `CONTRIBUTING.md`-ben dokumentált helyi fejlesztői beállítás (Postgres 16 + pgvector) — nincs eltérés dev és CI között.
- **GitHub Actions natív service container mechanizmusa** — nem igényel Docker Compose-t vagy egyéni szkriptet, a legegyszerűbb, legkevésbé kockázatos megoldás.
- Eközben derült ki egy **valódi, komoly hiba**: a `turbo.json` `test` taskja nem deklarálta a `DATABASE_URL`/`TEST_DATABASE_URL`/`ANTHROPIC_API_KEY` változókat `passThroughEnv`-ként, így a Turborepo alapértelmezett szigorú env-módja **kiszűrte** ezeket a Turbo által indított folyamatoktól — a tesztek `pnpm --filter <csomag> test` közvetlen hívással lefutottak, de `pnpm test` (Turbo-n keresztül) alatt némán kimaradtak volna, még helyi DATABASE_URL megléte esetén is. Ez most javítva van (`turbo.json`).
- **`pnpm demo` hozzáadva külön CI-lépésként** — mivel most már van valódi Postgres CI-ban, a teljes end-to-end pipeline (nem csak az egyes agentek unit/integrációs tesztjei) is lefuttatható és ellenőrizhető minden PR-en, `ANTHROPIC_API_KEY` hiányában a dokumentált fallback módban (ADR 0007).

## Következmény

- A CI-futási idő nő (service container indítása + a teljes demo lefuttatása), de ez a jelenlegi (MVP) skálán elhanyagolható.
- **Ez nem helyettesíti** a `docs/architecture/06-deployment.md` §6.4-ben leírt "DB migráció dry-run Neon preview branch ellen" lépést — az Neon-specifikus, valódi projekt/hitelesítő adat kell hozzá (Fázis 1, roadmap 4. lépés). A CI Postgres service kizárólag a tesztfuttatáshoz szükséges, nem a Neon-migráció validálásához.

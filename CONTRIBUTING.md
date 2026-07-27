# Közreműködési útmutató

## Előfeltételek

- Node.js `20.9.0`+ (lásd `.nvmrc`)
- pnpm `10.33.0` (a `package.json` `packageManager` mezője rögzíti — `corepack enable` javasolt)

## Első lépések

```bash
pnpm install
cp apps/web/.env.example apps/web/.env.local   # töltsd ki a szükséges értékeket, lásd lent
pnpm dev      # apps/web indítása fejlesztői módban
```

## Gyakori parancsok (Turborepo-n keresztül, a teljes workspace-re)

```bash
pnpm lint           # ESLint minden csomagban/appban
pnpm typecheck       # tsc --noEmit minden csomagban/appban
pnpm test            # Vitest minden csomagban/appban
pnpm build            # build (Next.js / tsc) minden csomagban/appban
pnpm format:check    # Prettier ellenőrzés
pnpm format           # Prettier automatikus javítás
```

Egyetlen csomagra szűkítve: `pnpm --filter @magyarsportonline/<csomagnév> <script>` (pl. `pnpm --filter @magyarsportonline/db test`).

**Minden PR-nek zöldnek kell lennie mind az öt fenti ellenőrzésen** — ugyanezeket futtatja a CI (`.github/workflows/ci.yml`).

## Monorepo struktúra

Lásd [`docs/architecture/05-repo-structure.md`](docs/architecture/05-repo-structure.md) a teljes tervezett struktúráért. Fázis 0 után létező csomagok:

| Csomag                   | Felelősség                                                                                                                            |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web`               | Next.js frontend (publikus oldalak, admin UI, API route-ok)                                                                           |
| `packages/config`        | megosztott ESLint/TypeScript/Prettier presetek                                                                                        |
| `packages/shared`        | megosztott típusok, enumok                                                                                                            |
| `packages/events`        | event-contract (Zod sémák)                                                                                                            |
| `packages/db`            | Drizzle adatbázis-séma, kliens, fingerprint/locking segédfüggvények                                                                   |
| `packages/observability` | strukturált logolási határ                                                                                                            |
| `packages/llm`           | Anthropic kliens, modellkonstansok, fallback-detektálás                                                                               |
| `packages/agents`        | MVP agentek (Source Ingest, Deduplication, Story Merge, Fact Verification, Hungarian Writer, SEO, Publish Gate, Read Model Projector) |

Az end-to-end MVP-folyamat egyetlen paranccsal futtatható: `pnpm demo` (lásd `scripts/demo.ts`).

## Fontos kódstílus-döntések (ADR-ek)

Mielőtt "kijavítanál" valamit, ami szokatlannak tűnik, nézd meg a `docs/adr/` könyvtárat — ott van megindokolva:

- **[ADR 0001](docs/adr/0001-dependency-version-pinning.md)** — a függőségek konkrét verzióra vannak rögzítve, nem `latest`-re; a frissítés tudatos, külön feladat.
- **[ADR 0002](docs/adr/0002-embedding-vector-dimensions.md)** — `raw_articles.embedding` 1536 dimenziós, felülvizsgálandó a Fázis 4 embedding-modell választásakor.
- **[ADR 0003](docs/adr/0003-extensionless-relative-imports.md)** — a monorepo egészében a relatív importok **kiterjesztés nélküliek** (`from "./enums"`, NEM `from "./enums.js"`), mert a `drizzle-kit generate` CJS-alapú betöltője és a Next.js webpack-bundlere sem tud `.js`-re végződő importot feloldani `.ts` fájlhoz. Ne írj vissza `.js`-re relatív importokat sehol.
- **[ADR 0004](docs/adr/0004-phase-0-env-vars-optional.md)** — a `apps/web/lib/env.ts`-ben egyik secret sincs kötelezővé téve Fázis 0-ban, mert még semmi nem használja őket; minden változó a saját roadmap-fázisában válik kötelezővé.
- **[ADR 0005](docs/adr/0005-mvp-direct-orchestration-no-queue.md)** — az MVP `pnpm demo` folyamata az agenteket közvetlen, szinkron függvényhívásokkal láncolja, nem üzenetsoron (Inngest/queue) keresztül; a queue-alapú orchestrálás bevezetése későbbi fázis.
- **[ADR 0006](docs/adr/0006-mvp-fingerprint-only-dedup.md)** — az MVP deduplikációja kizárólag fingerprint-egyezésen (kategória + elsődleges entitás + dátum-bucket) alapul, embedding-alapú szemantikus keresés nélkül.
- **[ADR 0007](docs/adr/0007-mvp-llm-fallback-mode.md)** — `ANTHROPIC_API_KEY` hiányában a Fact Verification és Hungarian Writer agentek szabály-, illetve sablon-alapú fallback-ra váltanak, ezt a kimenetben (`extractionMethod`/`generatedByModel`) mindig őszintén jelölve.
- **[ADR 0008](docs/adr/0008-ci-postgres-service.md)** — a CI `pgvector/pgvector:pg16` service containert használ valódi Postgres ellen futó integrációs tesztekhez.
- **[ADR 0009](docs/adr/0009-serialize-db-touching-test-tasks.md)** — `packages/db`, `packages/agents` és `apps/web` `test` taskja a `turbo.json`-ban explicit függőséggel szekvenciálisra van kötve (`db#test` → `agents#test` → `web#test`), mert mindhárom ugyanazt a megosztott Postgres-t használja integrációs tesztekhez, és a Turborepo alapból párhuzamosan futtatná őket.

Ha egy hasonlóan nem-nyilvánvaló, tervben nem rögzített döntést hozol, **írj hozzá egy új, sorszámozott ADR-t** a `docs/adr/` alá ugyanebben a formátumban (döntési helyzet / döntés / indoklás / következmény).

## Titkok és környezeti változók

- Soha ne commitolj valódi secretet — `.env.local` git-ignorált (lásd `.gitignore`), csak `.env.example` (üres/placeholder értékekkel) kerül verziókezelésbe.
- Minden env-változó validálva van a `apps/web/lib/env.ts`-ben (Zod séma) — soha ne olvasd `process.env.X`-et közvetlenül máshol az `apps/web`-ben.
- Preview/staging/production környezetben a titkok Vercel Environment Variables-ként, környezetenként elkülönítve élnek — lásd [`docs/architecture/06-deployment.md` §6.6](docs/architecture/06-deployment.md#66-titkok-és-környezeti-változók-kezelése).

## Commit- és branch-konvenció

- Commit üzenetek: rövid, imperative összefoglaló első sor (`feat(db): ...`, `fix(events): ...`, `chore: ...`, `docs: ...`, `ci: ...`, `style: ...`), szükség esetén részletesebb törzs a "miért"-ről.
- Kis, áttekinthető commitok — egy commit egy logikai egység (pl. egy csomag hozzáadása, egy konkrét hiba javítása).
- Minden commit előtt fusson le lokálisan legalább az érintett csomag(ok) `lint`/`typecheck`/`test`/`build` scriptje.

## Architektúra

A teljes rendszertervet a [`docs/architecture/`](docs/architecture/) tartalmazza — érdemes ott kezdeni:

1. [`README.md`](docs/architecture/README.md) — áttekintés
2. [`01-data-model.md`](docs/architecture/01-data-model.md) — Story-alapú adatmodell
3. [`02-agents.md`](docs/architecture/02-agents.md) — AI Agent specifikációk
4. [`08-roadmap.md`](docs/architecture/08-roadmap.md) — fázisolt fejlesztési terv
5. [`09-architecture-review.md`](docs/architecture/09-architecture-review.md) — kritikai review és a belőle következő tervmódosítások

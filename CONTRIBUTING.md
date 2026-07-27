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

| Csomag                   | Felelősség                                                          |
| ------------------------ | ------------------------------------------------------------------- |
| `apps/web`               | Next.js frontend (publikus oldalak, admin UI, API route-ok)         |
| `packages/config`        | megosztott ESLint/TypeScript/Prettier presetek                      |
| `packages/shared`        | megosztott típusok, enumok                                          |
| `packages/events`        | event-contract (Zod sémák)                                          |
| `packages/db`            | Drizzle adatbázis-séma, kliens, fingerprint/locking segédfüggvények |
| `packages/observability` | strukturált logolási határ                                          |

**`packages/agents` még nem létezik** — az agent-logika (Source Ingest, Deduplication, stb.) a roadmap Fázis 3+ része, lásd [`docs/architecture/08-roadmap.md`](docs/architecture/08-roadmap.md).

## Fontos kódstílus-döntések (ADR-ek)

Mielőtt "kijavítanál" valamit, ami szokatlannak tűnik, nézd meg a `docs/adr/` könyvtárat — ott van megindokolva:

- **[ADR 0001](docs/adr/0001-dependency-version-pinning.md)** — a függőségek konkrét verzióra vannak rögzítve, nem `latest`-re; a frissítés tudatos, külön feladat.
- **[ADR 0002](docs/adr/0002-embedding-vector-dimensions.md)** — `raw_articles.embedding` 1536 dimenziós, felülvizsgálandó a Fázis 4 embedding-modell választásakor.
- **[ADR 0003](docs/adr/0003-extensionless-relative-imports.md)** — a `packages/shared`, `packages/events`, `packages/db` csomagokban a relatív importok **kiterjesztés nélküliek** (`from "./enums"`, NEM `from "./enums.js"`), mert a `drizzle-kit generate` CJS-alapú betöltője nem tud `.js`-re végződő importot feloldani `.ts` fájlhoz. Ne írd vissza `.js`-re ezekben a csomagokban.
- **[ADR 0004](docs/adr/0004-phase-0-env-vars-optional.md)** — a `apps/web/lib/env.ts`-ben egyik secret sincs kötelezővé téve Fázis 0-ban, mert még semmi nem használja őket; minden változó a saját roadmap-fázisában válik kötelezővé.

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

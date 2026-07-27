# ADR 0003 — Relatív importok kiterjesztés nélkül (nem `./foo.js`)

**Státusz:** elfogadva
**Dátum:** 2026-07-27
**Kontextus:** Fázis 0 implementáció (`packages/db`)

## Döntési helyzet

A `packages/shared`, `packages/events` és `packages/db` csomagok kezdetben az explicit `.js` kiterjesztéses relatív import konvenciót használták (`from "./enums.js"`), ami a jövőbeli NodeNext/ESM-kompatibilitás miatt gyakori ajánlott gyakorlat TypeScript projektekben.

A `packages/db` Drizzle-sémájának migráció-generálása (`drizzle-kit generate`, lásd `docs/architecture/08-roadmap.md` Fázis 1 előkészítése) egy belső, CJS `require()`-alapú betöltőt használ a `drizzle.config.ts` és az általa hivatkozott séma-fájlok beolvasásához. Ez a betöltő **nem** végez TypeScript-stílusú kiterjesztés-átírást (`.js` → `.ts`) — szó szerint `enums.js` fájlt keres, amit nem talál, mert csak `enums.ts` létezik. Ez `MODULE_NOT_FOUND` hibával elbuktatta a `db:generate` scriptet.

## Döntés

A `packages/shared`, `packages/events` és `packages/db` csomagokon belüli **összes relatív import/export kiterjesztés nélkülire** lett átírva (`from "./enums"`, nem `from "./enums.js"`).

## Indoklás

- A monorepo mindenütt `"moduleResolution": "Bundler"`-t használ (`packages/config/tsconfig/base.json`), ami **nem követeli meg** az explicit kiterjesztést relatív importoknál — a kiterjesztés-nélküli forma tehát nem regresszió `tsc`, Vitest vagy a Next.js build szempontjából (mindegyiket leteszteltük utána, lásd a Fázis 0 commit-történetet).
- Ez a **legegyszerűbb, azonnal működő megoldás** a `drizzle-kit generate` hibára, anélkül hogy a Drizzle-konfiguráció betöltési mechanizmusát kellene testre szabni (pl. egyedi `tsx`/`esbuild-register` loader bevezetése csak a `db:generate` scripthez) — utóbbi jelentősen nagyobb, nehezebben visszafordítható beavatkozás lett volna egy Fázis 0-beli akadály elhárításához képest.
- **Nem architekturális döntés** — egyik `docs/architecture/*.md` fájl sem ír elő importkonvenciót, ez tisztán kódstílus/tooling-kompatibilitási kérdés.

## Következmény

- **Minden jövőbeli, ebben a három csomagban írt fájlban** kiterjesztés nélküli relatív importot kell használni, amíg ez a döntés érvényben van.
- Ha egy jövőbeli fázis a `packages/db` sémát valódi ESM-only Node runtime-ban futtatja (ahol a kiterjesztés kötelező), ezt a döntést felül kell vizsgálni — akkorra a `drizzle-kit` betöltési korlátja is megváltozhatott.

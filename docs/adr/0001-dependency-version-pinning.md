# ADR 0001 — Függőségi verziók rögzítése (nem "latest" követés)

**Státusz:** elfogadva
**Dátum:** 2026-07-27
**Kontextus:** Fázis 0 implementáció

## Döntési helyzet

A `docs/architecture/` dokumentáció megnevezi a technológiai stacket (Next.js, TypeScript, PostgreSQL/Drizzle, Zod-alapú event-séma, Vitest-alapú tesztelés — utóbbi kettő a Fázis 0-2 review-kiegészítésekből), de **konkrét verziószámokat nem ír elő**. A telepítéskor elérhető legfrissebb verziók (pl. TypeScript 7.x, Next.js 16.x, ESLint 10.x, Zod 4.x) jelentősen újabbak, mint amikkel a fejlesztési asszisztens API-felülete és ökoszisztéma-viselkedése megbízhatóan ismert — ezek használata megnövelné a Fázis 0 implementáció közben felmerülő, nem tervezett kompatibilitási problémák kockázatát.

## Döntés

A Fázis 0 implementáció **konkrét, rögzített (nem `latest` vagy tág `^` tartomány) verziókat** használ olyan jól ismert, stabil kiadásokból, amik az architektúra-tervben megnevezett technológiákat lefedik:

- TypeScript `5.7.3` (strict mód)
- Next.js `15.1.4` (App Router), React `19.0.0`
- ESLint `9.18.0` (flat config) + `typescript-eslint` `8.19.1`
- Prettier `3.4.2`
- Vitest `2.1.8`
- Zod `3.24.1`
- Drizzle ORM `0.38.3` + Drizzle Kit `0.30.1`
- Turborepo `2.3.3`

## Indoklás

- **Legegyszerűbb, könnyen visszafordítható megoldás**: egy explicit verzió-pin bármikor, tudatosan, kontrollált módon frissíthető felfelé (`pnpm update` + regressziós teszt), míg egy bevezetéskor bekerülő, nem kellően ismert bleeding-edge major verzió esetleges inkompatibilitása visszamenőleg nehezebben deríthető ki.
- Ez **nem architekturális döntés** — egyik `docs/architecture/*.md` fájl sem ír elő konkrét verziót, így ez a döntés nem módosítja a tervet, csak a Fázis 0 implementációs részletét rögzíti.
- **Frissítési felelősség**: a verziók emelése (pl. TypeScript 7, Next 16) egy külön, tudatos jövőbeli feladat, saját regressziós teszteléssel — nem a Fázis 0 hatóköre.

## Következmény

- A `package.json` fájlokban a fenti verziók **pontosan rögzítve** szerepelnek (nem `^`/`~` tartomány a legkritikusabb keret-eszközöknél: Next.js, TypeScript, ESLint, Drizzle), hogy a `pnpm install` determinisztikus maradjon Fázis 0 után is.
- Későbbi fázisokban (pl. Fázis 13 — Production Hardening) érdemes egy külön "dependency upgrade" feladatot beiktatni.

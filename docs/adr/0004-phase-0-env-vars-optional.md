# ADR 0004 — Fázis 0-beli env-változók opcionálisak a validált sémában

**Státusz:** elfogadva
**Dátum:** 2026-07-27
**Kontextus:** Fázis 0 implementáció (`apps/web/lib/env.ts`)

## Döntési helyzet

A `docs/architecture/06-deployment.md` §6.6 felsorolja a szükséges titkokat (Anthropic API-kulcs, Meta Graph API, X API, Inngest signing key, DB connection string), de nem specifikálja, hogy Fázis 0-ban ezek kötelezőek (`required()`) vagy opcionálisak legyenek-e a validált env-sémában.

## Döntés

A `apps/web/lib/env.ts` Zod-sémájában **egyik secret sincs `required()`-ként jelölve** — mindegyik `.optional()`, a `LOG_LEVEL` kivételével (aminek van biztonságos alapértelmezése).

## Indoklás

- Fázis 0-ban **semmilyen kódút nem használja még** ezeket az értékeket (nincs DB-kapcsolat bekötve, nincs LLM-hívás, nincs Inngest-esemény kibocsátás, nincs közösségimédia-integráció, nincs admin-auth) — ha kötelezővé tennénk őket, a `pnpm build`/`pnpm dev` **minden** környezetben elbukna, amíg valaki nem provisionál Neon/Anthropic/Inngest/Meta/X hitelesítő adatokat, ami Fázis 0-ban senkinek nincs.
- Ez a **legegyszerűbb, könnyen visszafordítható** megoldás: minden egyes változó saját fázisában (a kódban komment jelzi, melyikben) egyetlen karakteres módosítással (`.optional()` törlése) tehető kötelezővé, amikor a hozzá tartozó funkció ténylegesen bekötésre kerül.
- **Nem architekturális döntés** — a `docs/architecture/06-deployment.md` nem ír elő required/optional bontást, ez tisztán Fázis 0-beli implementációs részlet.

## Következmény

- **Minden fázis, ami ténylegesen használni kezd egy titkot, felelős azért, hogy azt kötelezővé tegye** a sémában (pl. Fázis 1: `DATABASE_URL` → required, amikor a `packages/db` kliens ténylegesen bekötésre kerül `apps/web`-be).
- Amíg egy változó opcionális, a kódnak defenzíven kell kezelnie a hiányát (pl. `env.DATABASE_URL` lehet `undefined`) — ez jelenleg nem probléma, mert semmi nem olvassa még.

# ADR 0010 — Séma-migráció a build-folyamatba építve, nem kézi lépésként

**Státusz:** elfogadva
**Dátum:** 2026-07-27
**Kontextus:** első felhő (Vercel + Neon) deploy, `story_read_model does not exist` runtime 500-as hiba

## Döntési helyzet

A Vercel Preview deploy sikeresen buildelt és elérte a Neon adatbázist, de a publikus kezdőoldal 500-as hibát adott, mert a séma soha nem lett migrálva a Neon adatbázison — a migráció eddig kizárólag teszt-segédfüggvényeken keresztül futott (`packages/db/src/testing.ts`), amit csak lokális/CI integrációs tesztek hívtak meg.

A migráció lefuttatásához eddig a `DATABASE_URL` (Neon connection string) szükséges lett volna ebben a munkamenetben — ezt a felhasználó biztonsági okból nem akarta chatben megosztani, és jogosan: a session-nek nincs semmilyen konfigurált Vercel- vagy Neon-hozzáférése (nincs `vercel` CLI, nincs Vercel/Neon MCP szerver, nincs tárolt token), így a titkot csak közvetlen beillesztéssel tudta volna átadni.

## Döntés

A migrációt **a build-folyamat része** teszi, nem külön, kézzel indított lépés:

- Új, production-biztonságos, nem destruktív script: `packages/db/src/migrate.ts` (`pnpm db:migrate`) — csak `drizzle-orm`'s `migrate()`-et futtatja a `DATABASE_URL` ellen, nem trunkál, nem seedel.
- `apps/web/package.json` `build` scriptje mostantól: `pnpm --filter @magyarsportonline/db db:migrate && next build`.

Így bármelyik környezet (Vercel build container, CI, lokális gép) a **saját, már beállított** `DATABASE_URL`-jét használva migrálja a sémát, mielőtt a Next.js build lefutna — a connection string soha nem hagyja el az adott környezetet, és nem kerül be ebbe a Claude Code sessionbe.

## Indoklás

- **A migráció idempotens** — a `drizzle-orm` migrátor egy `__drizzle_migrations` táblában tartja nyilván a lefutott migrációkat, tehát minden build (Vercel, CI, lokális `pnpm build`) biztonságosan újra lefuttathatja.
- **Nem igényel új hozzáférést vagy integrációt** — a Vercel projektben már be van állítva a `DATABASE_URL` (ezt a felhasználó korábban megerősítette), ezt a build-lépés csak újrahasznosítja.
- **A `DATABASE_URL` az `apps/web` build sikerességéhez már korábban is kötelező volt** (`lib/env.ts`, ADR 0004 nyomán szigorítva) — a migráció hozzáadása nem vezet be új követelményt, csak kihasználja a már meglévőt.
- **Alternatíva lett volna** egy admin API route (`/api/admin/migrate`) létrehozása — ezt elvetettük, mert egy publikusan elérhető, sémaváltoztatásra képes endpoint indokolatlan biztonsági kockázat lenne egy MVP-n, ami YAGNI-t is sértene.
- **A seed (demo) adatok szándékosan KIMARADTAK ebből a döntésből** — a jelenlegi `scripts/demo.ts`/`seed.ts` minden tábla `TRUNCATE`-jével kezd, ezért automatikus, minden build-en lefutó pipeline-ba égetve pusztító lenne egy éles adatbázison. A seedelés módját külön kell eldönteni (pl. nem-destruktív, `ON CONFLICT DO NOTHING` alapú variáns egyszeri, kézi futtatásra).

## Következmény

- Minden jövőbeli séma-migráció automatikusan alkalmazódik a következő deploy-nál, kézi lépés nélkül.
- `pnpm build` (helyi gépen és CI-ban is) mostantól élő adatbázis-kapcsolatot igényel az `apps/web` build lépéséhez — ez már korábban is így volt a kötelező `DATABASE_URL` validáció miatt, csak most ténylegesen ír is az adatbázisba (a migrációs táblát).
- A demo/seed adatok Neon-ra töltése továbbra is nyitott, külön döntést igénylő kérdés — nem ez az ADR oldja meg.

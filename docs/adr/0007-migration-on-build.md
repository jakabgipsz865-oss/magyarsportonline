# ADR 0007 — Séma-migráció a build-folyamatba építve, nem kézi lépésként

**Státusz:** elfogadva
**Dátum:** 2026-07-27
**Kontextus:** első Vercel Preview deployment valódi Neon PostgreSQL ellen (PR #2)

## Döntési helyzet

A Vercel Preview deploy sikeresen buildelt és elérte a Neon adatbázist, de a publikus kezdőoldal 500-as hibát adott futásidőben: `relation "story_read_model" does not exist`. A séma soha nem lett migrálva a Neon adatbázison — a `pnpm --filter @magyarsportonline/db db:migrate` (`drizzle-kit migrate`) eddig csak kézi, review utáni lépésként szerepelt a PR "Test plan" checklistjében, nem futott le automatikusan sehol.

A migráció kézi lefuttatásához a Neon `DATABASE_URL`-re lett volna szükség — ezt a felhasználó biztonsági okból nem osztotta meg chatben, és jogosan: a munkamenetnek nincs semmilyen konfigurált Vercel- vagy Neon-hozzáférése (nincs `vercel` CLI, nincs Vercel/Neon MCP szerver, nincs tárolt token).

## Döntés

A migrációt **a build-folyamat része** teszi, nem külön, kézzel indított lépés: `apps/web/package.json` `build` scriptje mostantól

```
pnpm --filter @magyarsportonline/db db:migrate && next build
```

A már meglévő `db:migrate` (`drizzle-kit migrate`, `packages/db/drizzle.config.ts` a `DATABASE_URL`-t közvetlenül `process.env`-ből olvassa) így minden `apps/web` buildnél lefut — Vercel Preview/Production, CI, vagy lokális gép —, mindig az adott környezet **saját, már beállított** `DATABASE_URL`-jét használva. A connection string így soha nem hagyja el az adott környezetet.

Ellenőrizve: tiszta (séma nélküli) Postgres ellen a `pnpm build` most már létrehozza mind a 16 táblát és sikeresen buildel; másodszorra futtatva idempotens (`No schema changes` / `already exists, skipping`).

**Turbo cache-kockázat, amit menet közben találtunk és lezártunk:** a `build` Turborepo task alapból cache-eli a sikeres futás kimenetét a bemenetek hash-e alapján. Mivel a `db:migrate` most már a `build` egy valódi, külső mellékhatása (ír egy adatbázisba, ami a task hash-én kívül eső állapot), egy hash-azonos, cache-elt build **lejátszaná a korábbi "sikeres" logot anélkül, hogy ténylegesen újra lefuttatná a migrációt** — pl. ha a Neon adatbázis egy friss branch-re vált, vagy egy Preview environment üres DB-re mutat, de a build inputjai (kód, lockfile) nem változtak. Ezt ténylegesen reprodukáltuk: egy megürített DB ellen egy cache-elt `turbo run build` "sikeresként" futott le úgy, hogy a DB üres maradt. Ezért a `turbo.json`-ban egy `@magyarsportonline/web#build` per-csomag task-felülírás **kikapcsolja a cache-elést** erre a taskra (`"cache": false`) — minden `apps/web` build ténylegesen újra lefut, a többi csomag (`db`, `agents`, `shared`, stb.) build-je változatlanul cache-elhető marad, mert azoknak nincs külső mellékhatásuk.

## Indoklás

- **A migráció idempotens** — a `drizzle-kit migrate` egy `__drizzle_migrations` táblában tartja nyilván a lefutott migrációkat, minden build biztonságosan újra lefuttathatja.
- **Nem igényel új hozzáférést vagy integrációt** — a Vercel projektben már be van állítva a `DATABASE_URL`; a build-lépés csak újrahasznosítja.
- **`turbo.json` `build` taskjának meglévő `"env": ["DATABASE_URL", ...]` deklarációja már elegendő** a passthrough-hoz (ellenőrizve: a migráció ténylegesen megkapta és használta a `DATABASE_URL`-t egy `turbo run build` alatt) — nem kellett hozzá `passThroughEnv`-et is bevezetni.
- **Alternatíva lett volna** egy admin API route (`/api/admin/migrate`) — elvetve: publikusan elérhető, sémaváltoztatásra képes endpoint indokolatlan biztonsági kockázat egy MVP-n.
- **Alternatíva: külön, kézzel indított GitHub Actions job** (Neon API-kulccsal) — elvetve *erre a fázisra*, mert újabb secretet (Neon API-kulcs) és Neon-projekt-specifikus CI-integrációt igényelne; lásd a "Következmény" szakaszt a felülvizsgálat feltételéről.

## Következmény

- Minden jövőbeli séma-migráció automatikusan alkalmazódik a következő deploy-nál, kézi lépés nélkül.
- Minden `apps/web` build (Vercel, CI, lokális gép) mostantól élő adatbázis-kapcsolatot igényel — ez korábban is így volt a kötelező `DATABASE_URL` env-validáció miatt (`lib/env.ts`), csak eddig nem írt is az adatbázisba.
- **Kockázat, amit tudatosan vállalunk MVP-fázisban:** ha egyszerre két Preview build fut ugyanarra a Neon branch-re (pl. két gyors egymás utáni push), mindkettő megpróbálja lefuttatni a migrációt. A `drizzle-kit migrate` migrációnként tranzakcióban fut, így ütközés esetén legrosszabb esetben az egyik build hibázik újrapróbálkozás nélkül, nem korrupt sémát hagy maga után. Ha ez a gyakorlatban problémát okoz, a felülvizsgálat iránya egy különálló, kontrollált, csak `main`-ágra (vagy manuálisan) futó migrációs job GitHub Actionsben, Neon API-kulccsal — ezt ez az ADR tudatosan **nem** vezeti be most, mert új secret-kezelést és Neon-specifikus CI-integrációt igényelne, ami MVP-n túlmutató hatókör.

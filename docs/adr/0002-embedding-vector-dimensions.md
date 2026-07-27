# ADR 0002 — `raw_articles.embedding` vektor-dimenzió

**Státusz:** elfogadva
**Dátum:** 2026-07-27
**Kontextus:** Fázis 0 implementáció (`packages/db` séma)

## Döntési helyzet

A Deduplication Agent (`docs/architecture/02-agents.md` §2.2) embedding-alapú hasonlóságkeresést használ, amihez a `raw_articles.embedding` oszlopnak (pgvector `vector` típus) egy **fix dimenziószámmal** kell rendelkeznie már a séma létrehozásakor. A konkrét embedding modell kiválasztása (`docs/architecture/08-roadmap.md` Fázis 4, 38. lépés) **még nem történt meg** — ez explicit, jövőbeli döntés.

## Döntés

A Fázis 0 séma **1536 dimenziós** `vector` oszlopot definiál (`RAW_ARTICLE_EMBEDDING_DIMENSIONS` konstans, `packages/db/src/schema/raw-articles.ts`).

## Indoklás

- Ez a legelterjedtebb embedding-dimenzió a jelenlegi piaci megoldások között — legegyszerűbb, semleges alapértelmezés, ami nem zárja ki egyik jövőbeli modellválasztást sem.
- **Könnyen visszafordítható**: a Fázis 0-ban nincs éles adat a táblában, így a dimenzió módosítása (pl. ha a Fázis 4-ben kisebb/nagyobb dimenziójú modell mellett dönt a csapat) egy egyszerű migráció (oszlop újralétrehozása), nem adatvesztéssel járó, kockázatos átalakítás.
- Ez **nem architekturális döntés** — a `docs/architecture/*.md` egyik fájlja sem ír elő konkrét embedding modellt vagy dimenziószámot, ez tisztán a séma létrehozásához szükséges Fázis 0-beli implementációs részlet.

## Következmény

- A Fázis 4 embedding-modell kiválasztásakor **kötelező felülvizsgálni** ezt az ADR-t, és szükség esetén migrációval frissíteni a dimenziószámot, mielőtt éles adat kerül a táblába.

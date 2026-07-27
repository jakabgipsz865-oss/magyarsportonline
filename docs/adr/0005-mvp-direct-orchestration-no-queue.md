# ADR 0005 — MVP: direkt, in-process orchestráció Inngest/queue helyett

**Státusz:** elfogadva
**Dátum:** 2026-07-27
**Kontextus:** első működő end-to-end MVP (RSS → Story → magyar összefoglaló → publikálás → frissítés)

## Döntési helyzet

A jóváhagyott architektúra ([03-event-flow.md](../architecture/03-event-flow.md)) event-driven, queue-alapú (Inngest) kommunikációt ír elő az agentek között. A felhasználó ugyanakkor explicit YAGNI-elvet adott az MVP-hez: *"Csak a működéshez feltétlenül szükséges komponenseket implementáld"* és *"egyetlen parancsból elindítható"* demót kért.

Egy valódi Inngest-bekötés (akár csak a lokális Dev Server is) új mozgó alkatrészt (külön folyamat, port-kezelés, SDK-regisztráció, step-orchestráció) vezetne be, ami a roadmap Fázis 2-ben (`08-roadmap.md`, 21-28. lépés) amúgy is külön, dedikált munka — az MVP célja viszont az üzleti logika (Story-létrehozás, dedup, confidence score, verziózás) bemutatása, nem az esemény-busz infrastruktúra.

## Döntés

Az MVP pipeline **direkt, in-process függvényhívás-lánccal** fut (`packages/agents/*` egyszerű `async function`-ök, amiket egy `scripts/demo.ts` orchestrátor egymás után hív meg), **nem** Inngesten vagy más queue-n keresztül.

## Indoklás

- **Legegyszerűbb, működő megoldás** a kért céllal ("egyetlen parancsból elindítható... végigviszi a teljes folyamatot") — nincs külön szerverfolyamat, nincs hálózati/port-függőség a demó lefuttatásához.
- **Nem "elássa" az event-driven kontraktust**: minden agent-függvény bemenete/kimenete pontosan a `packages/events` Zod-sémáiban már rögzített esemény-alakot követi (lásd `packages/events/src/catalog.ts`) — az orchestrátor csak *helyben* adja tovább a payloadot a következő függvénynek, ahelyett hogy queue-ra tenné. Emiatt a Fázis 2 Inngest-bekötése **later, minimális átalakítással** elvégezhető: minden agent-függvény szó szerint egy Inngest `step.run`/function body-jává válik, a payload-alak nem változik.
- **Nem architekturális visszavonás** — a `docs/architecture/03-event-flow.md` terv változatlan marad; ez a döntés kizárólag az MVP *implementációjára* vonatkozik, nem a jóváhagyott tervre.

## Következmény

- Az agentek konkurencia-védelme (pl. Story-szintű concurrency-limit, `docs/architecture/03-event-flow.md` §3.6) az MVP-ben **nincs** külön kikényszerítve queue-szinten — ehelyett a `packages/db`-ben már meglévő `pg_advisory_xact_lock`-alapú fingerprint-lock ([ADR-független, Fázis 0](../../packages/db/src/locking.ts)) és a Postgres tranzakciós garanciák adják a konkurencia-védelmet, ami az egyetlen, szekvenciális demo-futtatáshoz elégséges.
- Fázis 2 (Inngest bevezetése) megmarad külön, jövőbeli feladatnak — amikor ténylegesen több forrás/párhuzamos feldolgozás indokolja.
- A `story/*`, `source/*` események az MVP-ben **nem mennek keresztül tényleges queue-n**, csak in-memory objektumként adódnak át és kerülnek strukturáltan naplózásra (`@magyarsportonline/observability`) — auditálhatóság szempontjából ez egyenértékű, csak a szállítási mechanizmus más.

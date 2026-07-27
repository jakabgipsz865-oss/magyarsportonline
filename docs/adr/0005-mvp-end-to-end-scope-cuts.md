# ADR 0005 — MVP end-to-end vágás: mit egyszerűsítünk a jóváhagyott tervhez képest

**Státusz:** elfogadva
**Dátum:** 2026-07-27
**Kontextus:** Fázis 1 (repository-réteg) lezárása + Fázis 3/4/5/6/7/9 első, működő end-to-end metszete

## Döntési helyzet

A cél egy ténylegesen futó end-to-end MVP: RSS forrás → Story → magyar AI-összefoglaló → tárolás → megjelenítés → ugyanazon esemény új forrásból történő frissítés → confidence score növelés → verziótörténet/timeline. Ez a roadmap 3–9. fázisait érinti egyszerre, teljes mélységben megvalósítva viszont több hetes/hónapos munka (embedding-modell kiválasztás, Inngest-fiók, Meta/X integráció stb.). Az architektúra alapelvei (Story-modell, event-kontraktus, agent-kontraktus, Publish Gate, CQRS read-model, fingerprint-lock) **nem változnak** — az alábbi pontok kizárólag **hatókör-szűkítések** az MVP-hez, minden esetben úgy, hogy a később bővítendő komponens ugyanazt az interfészt/kontraktust használja, amit a végleges terv előír.

Ezt a döntést a felhasználóval egyeztetve hoztuk (2026-07-27, projekt-átvételi beszélgetés): nincs élő adatbázis/LLM-hitelesítő adat ebben a fejlesztői környezetben, ezért a kód teszt/fake-lefedettséggel készül, éles E2E futtatás a `DATABASE_URL`/`ANTHROPIC_API_KEY` beállítása után a fejlesztő felelőssége.

## Döntés

1. **Event bus: in-process dispatcher, Inngest-kötés elhalasztva.** A [02-agents.md §2.0](../architecture/02-agents.md) közös agent-kontraktusa (`Agent(event, ctx) → { writes, emits }`) már úgy van megtervezve, hogy az agentek tiszta függvények — nincs bennük Inngest-specifikus kód. Az MVP-hez a `packages/events`-ben egy típusos, in-process pub/sub dispatcher hívja meg ugyanezeket a függvényeket, ugyanazzal az esemény-katalógussal ([03-event-flow.md §3.2](../architecture/03-event-flow.md)). A valódi Inngest-regisztráció (Fázis 2 hátralévő lépései: retry/backoff, dead-letter, concurrency-limit, `/api/inngest` route) **később, adapter-cserével** köthető be — az agent-logika nem változik.
2. **Deduplication Agent: csak fingerprint-alapú egyezés, pgvector embedding-keresés elhalasztva.** A `story_fingerprints` mechanizmus ([01-data-model.md §1.5.1](../architecture/01-data-model.md)) már a tervben szerepel mint a race condition elleni védelem — az MVP ezt használja fel **elsődleges** egyezés-detekcióként is (kategória + fő entitás + dátum-bucket), nem csak race-lock kulcsként. A finomabb szemantikai (embedding ANN + `AMBIGUOUS` határeset) réteg Fázis 4 feladata marad, mert külön embedding-modell API-kulcsot igényelne (pl. Voyage AI), amiről még nem született döntés (lásd [ADR 0002](0002-embedding-vector-dimensions.md)).
3. **Entitás-egyeztetés: determinisztikus alias-lookup, nem NER-modell.** A Dedup Agent "gyors, olcsó modell" entitás-kinyerése ([02-agents.md §2.2](../architecture/02-agents.md)) MVP-ben egy egyszerű, seedelt `entities` táblán futó, case-insensitive alias-illesztés — nincs önálló NER-hívás. Ez a `packages/entity-resolution` (Fázis 13, 101. lépés) által kiemelendő logika egyik korai, egyszerű implementációja, nem azzal ellentétes.
4. **SEO Agent: csak slug-generálás.** A meta description, tag/kategória-hozzárendelés és `schema.org` JSON-LD generálás ([02-agents.md §2.6](../architecture/02-agents.md)) Fázis 8 hatóköre marad; az MVP-hez a slug (stabil URL) kötelező, a többi mező `story_versions`/`story_read_model`-ben `null`/üres marad, amíg nincs bekötve.
5. **Fact Verification Agent: LLM-alapú risk-finomítás elmarad, csak szabályalapú szűrő + prompt injection heurisztika.** A kemény szabály (érzékeny kategóriában 1 forrás sosem elég auto-publikáláshoz) és az extrakció-limitálás elve MVP-ben is érvényes és implementálva van; a határesetek LLM-alapú finomítása (§2.4 "LLM-alapú finomító rétege") Fázis 6 hátralévő feladata.
6. **Debounce élő Story-khoz, Social Media Agent, Admin Review UI, Monitoring & Audit Agent, observability-stack (OTel/Grafana/PITR):** ezek már a jóváhagyott roadmap-ban is későbbi fázisok (10–13) — nem MVP-vágás, csak megerősítjük, hogy az MVP nem nyúlik hozzájuk.
7. **Forrás: BBC Sport Football RSS, kizárólag DB-konfigurációként, nem kódba égetve.** A `sources.fetch_config` (`{ "url": "..." }`) jsonb mezőn keresztül, `SourceAdapter` interfészen át kerül be — új RSS/API forrás hozzáadása seed/admin-insert kérdés, nem kódmódosítás. Ez a licencelt/engedélyezett forrás-onboarding (roadmap Fázis 3, 32. lépés — jogi ellenőrzés) helyett kizárólag fejlesztői/demonstrációs célt szolgál, `license_type='public_rss'` jelöléssel.

## Indoklás

- Minden pont egy már jóváhagyott, tervezett komponens **hatókör-szűkítése**, nem újratervezése — a végleges interfész (event-kontraktus, repository-határ, agent-kontraktus) változatlan, így a bővítés (Inngest-kötés, embedding-dedup, NER, teljes SEO, LLM risk-finomítás) later adapter-/implementáció-csere, nem migráció.
- A legegyszerűbb, könnyen visszafordítható út: egyik döntés sem zár ki semmilyen jövőbeli irányt, és mindegyik egy már a tervben szereplő, csak később ütemezett munka előrehozott, egyszerűsített változata.

## Következmény

- Az MVP pipeline-t bővítő jövőbeli munka (Fázis 2 Inngest-kötés, Fázis 4 embedding-dedup, Fázis 6 LLM risk-finomítás, Fázis 8 teljes SEO) **ennek az ADR-nek a 1–5. pontját zárja le**, nem egy külön újratervezést igényel.
- Amíg ez az ADR érvényben van, az MVP pipeline egyetlen process-en belül fut (nincs valódi queue-alapú hibatűrés/retry/dead-letter) — ez éles üzemhez **nem elegendő**, kizárólag fejlesztői/demonstrációs használatra alkalmas, ahogy azt a roadmap Fázis 9 "soft launch" előtti állapota is feltételezi.

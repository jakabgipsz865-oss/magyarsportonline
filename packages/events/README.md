# @magyarsportonline/events

Az event-driven architektúra **kontraktusa** (`docs/architecture/03-event-flow.md` §3.2): Zod-alapú, futásidőben validált sémák minden eseménytípushoz, verziózott borítékkal (`id`, `version`, `occurred_at`, `correlation_id`, `trace_id`).

Ez a csomag **csak a kontraktust** rögzíti — nincs benne queue-kliens, Inngest-integráció vagy agent-logika. Ezeket a Fázis 2 (`docs/architecture/08-roadmap.md`, 21-28. lépés) vezeti be, erre a sémára építve, hogy ne kelljen később visszabontani az esemény-alakot.

## Miért most?

A `docs/architecture/09-architecture-review.md` review kifejezetten kérte, hogy az event-contract, az idempotencia és a fingerprint-alapú race-condition védelem **már a Fázis 0-ban rögzüljön típus-szinten** — a `story/candidate.identified` esemény payload-ja pl. kötelezően tartalmazza a `fingerprint_hash` mezőt (`03-event-flow.md` §3.7), így a Deduplication/Story Merge Agent (Fázis 4-5) implementációja nem hozhat létre olyan eseményt, ami hiányzó fingerprinttel futtatná a race-condition elleni advisory lockot.

# @magyarsportonline/events

Az event-driven architektúra **kontraktusa** (`docs/architecture/03-event-flow.md` §3.2): Zod-alapú, futásidőben validált sémák minden eseménytípushoz, verziózott borítékkal (`id`, `version`, `occurred_at`, `correlation_id`, `trace_id`).

Ez a csomag a kontraktust (`catalog.ts`, `envelope.ts`) és egy **in-process dispatchert** (`dispatcher.ts`) tartalmaz — utóbbi az Inngest-integráció ideiglenes, MVP-hatókörű helyettesítője (`docs/adr/0005-mvp-end-to-end-scope-cuts.md` 1. döntés): ugyanazt a `Agent(event, ctx) → { writes, emits }` kontraktust futtatja, amit a valódi Inngest-regisztráció (Fázis 2, `docs/architecture/08-roadmap.md` 21-28. lépés) is használna, csak in-memory, retry/dead-letter/concurrency-limit nélkül. A tényleges Inngest-kötés later adapter-csere, nem az agent-kód újraírása.

## Miért most?

A `docs/architecture/09-architecture-review.md` review kifejezetten kérte, hogy az event-contract, az idempotencia és a fingerprint-alapú race-condition védelem **már a Fázis 0-ban rögzüljön típus-szinten** — a `story/candidate.identified` esemény payload-ja pl. kötelezően tartalmazza a `fingerprint_hash` mezőt (`03-event-flow.md` §3.7), így a Deduplication/Story Merge Agent (Fázis 4-5) implementációja nem hozhat létre olyan eseményt, ami hiányzó fingerprinttel futtatná a race-condition elleni advisory lockot.

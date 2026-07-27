# @magyarsportonline/agents

A pipeline agentjeinek MVP-implementációja (`docs/architecture/02-agents.md`): egyszerű, tesztelt `async` függvények — nem Inngest-function-ök — összekötve `scripts/demo.ts`-ben, `docs/adr/0005-mvp-direct-orchestration-no-queue.md` szerint.

## Agentek

| Mappa                | Agent             | MVP-specifikus egyszerűsítés                                                                                   |
| -------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------- |
| `source-ingest/`     | Source Ingest     | valódi RSS-fetch (`rss-parser`), URL-alapú dedup                                                               |
| `deduplication/`     | Deduplication     | **fingerprint-only** (nincs embedding-keresés) — [ADR 0006](../../docs/adr/0006-mvp-fingerprint-only-dedup.md) |
| `story-merge/`       | Story Merge       | advisory-lock-védett Story-létrehozás, gyors regex-diff a corroboration/new_info döntéshez                     |
| `fact-verification/` | Fact Verification | LLM-extrakció VAGY szabályalapú fallback — [ADR 0007](../../docs/adr/0007-mvp-llm-fallback-mode.md)            |
| `hungarian-writer/`  | Hungarian Writer  | LLM-generálás + self-check VAGY sablon-fallback — [ADR 0007](../../docs/adr/0007-mvp-llm-fallback-mode.md)     |
| `seo/`               | SEO               | csak slug-generálás (meta description/tags/structured data még nincs — Fázis 8)                                |
| `publish-gate/`      | Publish Gate      | teljes, determinisztikus szabály a tervnek megfelelően                                                         |
| `read-model/`        | (projector)       | `story_read_model` CQRS-projekció, direkt hívással (nem esemény-feliratkozással)                               |
| `telemetry/`         | —                 | minden agent-hívást becsomagol strukturált logolással + `agent_runs` metrikával                                |
| `shared/`            | —                 | agentek közötti közös logika (confidence score, quick-fact regex, kontribúló-forrás lekérdezés)                |
| `test-utils/`        | —                 | lokális fixture RSS HTTP szerver teszthez/demóhoz                                                              |

## Tesztelés

Minden agent mellett van unit teszt (tiszta függvényekre) és/vagy valódi Postgres ellen futó integrációs teszt (`describe.skipIf(!databaseUrl)`) — lásd `CONTRIBUTING.md` a helyi adatbázis beállításához. `TEST_DATABASE_URL` (vagy `DATABASE_URL`) hiányában az integrációs tesztek kihagyásra kerülnek, nem buknak el.

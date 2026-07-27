# @magyarsportonline/db

Az adatbázis-séma (Drizzle ORM, PostgreSQL) a teljes Story-alapú adatmodellhez (`docs/architecture/01-data-model.md`), kiegészítve a `docs/architecture/09-architecture-review.md` review két kritikus javításával:

- **`story_fingerprints`** — Story-létrehozási race condition elleni advisory-lock mechanizmus (`01-data-model.md` §1.5.1, `03-event-flow.md` §3.7).
- **`story_read_model`** — CQRS olvasási projekció, amit a publikus API fog olvasni a write-oldali táblák helyett (`01-data-model.md` §1.5.2).

Az `agent_runs` tábla **szándékosan vékony** (nem tartalmaz input/output snapshotot) — lásd a `agent-runs.ts` fájl kommentjét és `09-architecture-review.md` §6.

## Mi VAN ebben a csomagban

- Teljes Drizzle séma (`src/schema/`)
- Adatbázis-kliens factory (`src/client.ts`) — connection stringet paraméterként vár, nem olvas env-et közvetlenül
- `computeFingerprint()` — tiszta, tesztelt hash-függvény a fingerprint-alapú lockoláshoz (`src/fingerprint.ts`)
- `withFingerprintLock()` — `pg_advisory_xact_lock`-alapú helper (`src/locking.ts`), unit-tesztelve egy könnyű test double-lal
- **Repository-réteg** (`src/repositories/`) — Fázis 1, 08-roadmap.md 19. lépés, review §4 szerint agentenként szűkített (`SourceRepository`, `RawArticleRepository`, `StoryRepository`, `StoryVersionRepository`, `FactRepository`, `StorySourceRepository`, `EntityRepository`, `CategoryRepository`, `ReviewQueueRepository`, `StoryReadModelRepository`, `AgentRunRepository`). A `StoryRepository.createOrMatchByFingerprint()` és a `StoryVersionRepository.createNextVersion()` implementálja ténylegesen a race-condition védelmet (advisory lock, ill. `SELECT ... FOR UPDATE`), nem csak a helper-t adja.
- **Seed script** (`src/seed.ts`, `pnpm db:seed`) — Fázis 1, 08-roadmap.md 20. lépés: alap kategória/entitás-taxonómia + egy dev/demo RSS `Source` (BBC Sport Football) — az URL kizárólag seed-adatként létezik, nincs a Source Ingest Agent kódjába égetve (`docs/adr/0005-mvp-end-to-end-scope-cuts.md`).

## Mi NINCS ebben a csomagban (későbbi fázisok)

- Tényleges migráció futtatás éles/dev adatbázis ellen — ehhez `DATABASE_URL` kell (a repository-réteg és a seed script már fel vannak készítve rá, csak élő kapcsolat hiányzik ebben a fejlesztői környezetben)
- Agent-logika (dedup, story merge, stb.) — lásd `packages/agents`

## Migráció generálása

```bash
pnpm --filter @magyarsportonline/db db:generate
```

Ez a séma alapján SQL migrációs fájlokat generál a `drizzle/` könyvtárba — élő adatbázis-kapcsolat nélkül is működik (csak a TypeScript sémát diffeli a korábban generált migrációkhoz képest).

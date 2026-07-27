# ADR 0009 — DB-t érintő csomagok tesztjei szekvenciálisan futnak

**Státusz:** elfogadva
**Dátum:** 2026-07-27
**Kontextus:** MVP pipeline, `pnpm test` (teljes workspace)

## Döntési helyzet

`packages/db`, `packages/agents` és `apps/web` mindegyike valódi Postgres ellen futó integrációs teszteket tartalmaz, közös `TEST_DATABASE_URL`/`DATABASE_URL` ellen (lásd `CONTRIBUTING.md`). Az egyes csomagokon *belül* ez már kezelve volt (`vitest.config.ts` `fileParallelism: false`, lásd `packages/agents/vitest.config.ts` eredeti kommentje) — de a Turborepo **csomagok között párhuzamosan** futtatja a `test` taskot, mert alapból nincs köztük deklarált függőség.

Ez valódi, reprodukálható hibákat okozott `pnpm test` (teljes workspace) futtatásakor, amikor `packages/db`, `packages/agents` és `apps/web` tesztjei egyszerre futottak, mindegyik a saját `beforeEach`-ében `TRUNCATE ... CASCADE`-elve a közös táblákat:

- `packages/agents`: `insert or update on table "story_sources" violates foreign key constraint` — egy másik csomag tesztje törölte a `raw_articles` sort, amire épp hivatkozni próbált egy folyamatban lévő tranzakció.
- `apps/web`: `PostgresError: deadlock detected` — két csomag egyidejű tranzakciója kölcsönösen várt egymás lock-jára.

## Döntés

`turbo.json`-ban explicit taskfüggőség köti össze a három csomag `test` feladatát: `@magyarsportonline/db#test` → `@magyarsportonline/agents#test` → `@magyarsportonline/web#test`, így ezek **szekvenciálisan** futnak, míg a többi csomag (`shared`, `events`, `observability`, `llm`, `config`) tesztjei — amik nem érnek hozzá közös adatbázishoz — továbbra is **párhuzamosan** futhatnak.

## Indoklás

- **Legegyszerűbb, célzott megoldás**: nem kellett bevezetni csomagonkénti külön adatbázist/sémát (ami valós, de nagyobb, MVP-n túlmutató infrastruktúra-változás lenne — pl. dinamikus séma-nevek generálása tesztfuttatáskor), csak a már meglévő Turborepo taskgráfban jelölni a valódi függőségi viszonyt (ami ténylegesen fennáll: közös, megosztott állapot).
- **Nem lassítja feleslegesen a nem-DB csomagokat** — a `shared`/`events`/`observability`/`llm` tesztek (amik gyorsak és nem érnek adatbázishoz) változatlanul párhuzamosan futnak.
- **A csomagon belüli `fileParallelism: false` külön is szükséges marad** (`packages/db`, `packages/agents`, `apps/web` mindegyikében) — enélkül egyetlen csomagon belüli tesztfájlok is versenyezhetnének egymással ugyanígy.

## Következmény

- `pnpm test` (teljes workspace) futási ideje nő a korábbi, teljesen párhuzamos futáshoz képest — ez MVP-skálán elhanyagolható (másodperces nagyságrend).
- Ha egy jövőbeli fázis (pl. Fázis 13, terheléses tesztelés) valódi, egymástól izolált teszt-adatbázisokat vezet be csomagonként, ez az ADR felülvizsgálandó — akkor a taskfüggőség feloldható, mert a valódi ok (megosztott állapot) megszűnik.

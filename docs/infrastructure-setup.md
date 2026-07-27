# Infrastructure Setup — valódi Neon PostgreSQL bekötése

Ez a dokumentum azt írja le, hogyan indítható el a projekt **első alkalommal
valódi Neon PostgreSQL adatbázissal**, hibamentesen, egy friss repository
klónozása után. Nem ír le semmilyen üzleti funkciót — csak az
infrastruktúra bekötését (env változók, migráció, seed, első valós
end-to-end teszt).

> Ez a dokumentum **sosem** tartalmaz valódi connection stringet, API
> kulcsot vagy más secretet — csak változóneveket és parancsokat. A valódi
> értékeket a Neon konzolból (illetve az Anthropic konzolból) kell
> beszerezni, és csak a helyi, git-ignorált `.env.local` fájlba (vagy a
> Vercel Environment Variables közé) kerülhetnek.

## 1. Szükséges környezeti változók

A `packages/db` és a `apps/web` **kizárólag** környezeti változóból olvassa
a kapcsolati adatokat — sehol nincs (és nem is szabad, hogy legyen)
beégetett connection string vagy placeholder érték a kódban.

Másold az `.env.example` fájlt, és töltsd ki valódi értékekkel:

```bash
cp apps/web/.env.example apps/web/.env.local
```

| Változó            | Kötelező | Forrás                                                                             |
| ------------------ | -------- | ----------------------------------------------------------------------------------- |
| `DATABASE_URL`     | igen     | Neon konzol → Project → Connection Details ("Pooled connection" ajánlott)           |
| `LLM_PROVIDER`     | nem (alapértelmezés: `none`) | `none` vagy `anthropic` — lásd lent                             |
| `ANTHROPIC_API_KEY` | csak ha `LLM_PROVIDER=anthropic` | Anthropic Console → API Keys                                |
| `CRON_SECRET`      | igen     | tetszőleges, magad generált titkos érték (pl. `openssl rand -hex 32`)               |

### `LLM_PROVIDER` — fizetős LLM API nélküli üzemmód

Alapértelmezetten (`LLM_PROVIDER=none`, vagy a változó hiánya) a pipeline a
determinisztikus **`NoLlmClient`** adaptert használja
(`packages/llm/src/no-llm-client.ts`) — nincs kimenő API-hívás, nincs
költség, `ANTHROPIC_API_KEY` nem szükséges. Ebben a módban a Fact
Verification / Hungarian Writer agentek nem generálnak AI-fordítást: az
eredeti, angol nyelvű RSS-cím és -leírás jelenik meg változatlanul, a Story
oldalon egyértelmű **"nem AI-fordított tartalom"** jelöléssel (lásd
`story_read_model.is_ai_generated` és a `/hir/[slug]` oldal figyelmeztetése).
Minden más — RSS ingest, deduplikáció, Story-létrehozás, Confidence Score,
Risk Classifier, Publish Gate, Timeline/verziókezelés — ettől függetlenül,
teljes egészében működik, mert ezek eleve nem használnak LLM-et.

Amikor lesz Anthropic (vagy később OpenAI) API-kereted, a váltás **egyetlen
env-változó módosítása**, kód nélkül:

```bash
LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=<valódi kulcs>
```

(`apps/web/lib/llm.ts` ekkor a valódi `AnthropicLlmClient`-et adja vissza —
ha `LLM_PROVIDER=anthropic`, de `ANTHROPIC_API_KEY` hiányzik, az app egy
egyértelmű hibával áll le boot-kor, nem csendes fallback-kel.)

A `DATABASE_URL`-nek Neon esetén tartalmaznia kell az `sslmode=require`
paramétert, pl. formátumban:

```
postgresql://<user>:<password>@<neon-host>/<dbname>?sslmode=require
```

(A `postgres` npm csomag, amit a `packages/db/src/client.ts` használ, a
connection string `sslmode` query-paraméterét automatikusan SSL-kapcsolatra
fordítja — nincs szükség külön SSL-konfigurációra a kódban.)

A `packages/db` csomag CLI-szkriptjei (`db:migrate`, `db:seed`,
`drizzle-kit`) **nem** az `apps/web/lib/env.ts`-en keresztül olvassák a
`DATABASE_URL`-t (azok önálló, apps/web-től független CLI-eszközök — lásd
`packages/db/src/seed.ts` és `packages/db/drizzle.config.ts` fejléckommentjeit),
hanem közvetlenül a shell környezetből. Exportáld a héjadban, mielőtt
futtatod őket:

```bash
export DATABASE_URL="postgresql://<user>:<password>@<neon-host>/<dbname>?sslmode=require"
```

Az `apps/web` (`pnpm dev`, `pnpm build`) a `.env.local`-ból olvassa a
változókat a Next.js beépített mechanizmusával, validálva
`apps/web/lib/env.ts`-ben — ott hiányzó/hibás érték esetén az app boot-kor
hibázik, nem egy véletlen kérés közepén.

## 2. Environment Doctor — egyetlen paranccsal ellenőrizhető állapot

Bármikor, a folyamat bármely pontján lefuttatható egy összefoglaló
ellenőrzés, ami megmondja, mi van kész és mi hiányzik még:

```bash
pnpm env:doctor
```

(`packages/db/src/doctor.ts` — nem üzleti funkció, tisztán fejlesztői
élményt szolgáló diagnosztikai eszköz.) Ellenőrzi:

- Node.js és pnpm verzió (a `.nvmrc` / `packageManager` mezőhöz képest);
- `DATABASE_URL` / `ANTHROPIC_API_KEY` / `CRON_SECRET` megléte;
- PostgreSQL kapcsolat és verzió;
- a `pgvector` extension elérhetősége/telepítettsége;
- a migrációk állapota (hányat vár a `drizzle/meta/_journal.json`, hány van
  ténylegesen alkalmazva);
- a dev seed adatok megléte.

Minden sor `PASS` / `WARNING` / `ERROR` / `SKIPPED` státusszal és — ha nem
`PASS` — egy pontos "Teendő" javaslattal zárul. Ha minden rendben,
`✓ Ready for Development` jelenik meg; `ERROR` esetén a parancs `1`-es
kilépőkóddal áll le, tehát szkriptekben/CI-ban is használható kapuként.

## 3. Migráció futtatása

A séma (`packages/db/src/schema/index.ts`) és a hozzá tartozó SQL migráció
(`packages/db/drizzle/0000_wise_gertrude_yorkes.sql`) tartalmazza a
`CREATE EXTENSION IF NOT EXISTS vector;` utasítást is (pgvector, a dedup ANN
kereséshez — docs/adr/0002). A Neon natívan támogatja a `vector`
kiterjesztést, a Neon projekt alapértelmezett tulajdonos szerepköre
jogosult a létrehozására — nincs szükség külön admin lépésre a Neon
konzolban.

```bash
pnpm install
pnpm --filter @magyarsportonline/db db:migrate
```

Ez a `drizzle-kit migrate` parancsot futtatja, ami a `packages/db/drizzle/`
alatti migrációkat alkalmazza a `DATABASE_URL` által mutatott adatbázisra
(lásd `packages/db/drizzle.config.ts` — a `dbCredentials` onnan olvassa a
kapcsolati stringet).

Ha a `DATABASE_URL` nincs beállítva, a parancs hibával leáll — nincs
csendes fallback vagy placeholder kapcsolat.

## 4. Seedelés

```bash
pnpm --filter @magyarsportonline/db db:seed
```

Ez a `packages/db/src/seed.ts`-t futtatja: idempotens, biztonságosan
újrafuttatható. Feltölti a `labdarugas` kategóriát, egy alap
csapat/verseny entitás-taxonómiát (a determinisztikus alias-lookup
entitás-egyeztetéshez, ADR 0005), és a "BBC Sport - Football" `Source`
sort (`fetchConfig.url` = a fejlesztői RSS feed).

## 5. Első valós end-to-end teszt

1. Indítsd el az appot:

   ```bash
   pnpm --filter @magyarsportonline/web dev
   ```

2. Hívd meg a cron belépési pontot (`apps/web/app/api/internal/cron/dispatch-ingest/route.ts`)
   a `.env.local`-ban beállított `CRON_SECRET`-tel:

   ```bash
   curl -X POST http://localhost:3000/api/internal/cron/dispatch-ingest \
     -H "Authorization: Bearer $CRON_SECRET"
   ```

   Sikeres válasz esetén a pipeline lefutott: RSS ingest → dedup → Story
   Merge → Fact Verification (valódi Anthropic-hívás) → Hungarian Writer
   (valódi Anthropic-hívás) → SEO → Publish Gate → read model projection.

3. Ellenőrizd az eredményt:

   ```bash
   curl http://localhost:3000/api/v1/stories
   ```

   vagy nyisd meg a `http://localhost:3000` főoldalt böngészőben — az
   újonnan létrejött, publikált Story-nak meg kell jelennie.

4. Futtasd újra a 2. lépést (`curl -X POST .../dispatch-ingest`) — ha az
   RSS feed időközben ugyanarról az eseményről új cikket tartalmaz, a
   meglévő Story-nak frissülnie kell (confidence score nő, új verzió
   kerül a `story_versions`-be). Ez ellenőrzi a Story Timeline / verziótörténet
   működését is.

## Sorrend összefoglalva

```
1. cp apps/web/.env.example apps/web/.env.local   (+ export DATABASE_URL a shell-ben CLI-szkriptekhez)
2. pnpm install
3. pnpm --filter @magyarsportonline/db db:migrate
4. pnpm --filter @magyarsportonline/db db:seed
5. pnpm env:doctor                                     (ellenőrzés — "Ready for Development"-nek kell lennie)
6. pnpm --filter @magyarsportonline/web dev
7. curl -X POST http://localhost:3000/api/internal/cron/dispatch-ingest -H "Authorization: Bearer $CRON_SECRET"
8. curl http://localhost:3000/api/v1/stories   (vagy a főoldal böngészőben)
```

Ez a sorrend egy friss repository-klónozás után, más előfeltétel nélkül
(a Neon projekt és az Anthropic API kulcs meglétén túl) reprodukálható.

## 6. V1 üzemeltetési kiegészítések

### Admin/review felület

`/admin/review` — HTTP Basic auth, felhasználónév `admin`, jelszó az
`ADMIN_SECRET` env változó (min. 8 karakter; generálás: `openssl rand -hex 16`).
Ha az `ADMIN_SECRET` nincs beállítva, a felület 503-mal le van tiltva.
Vercel-en environment variable-ként állítsd be (Production + Preview).

### Havi LLM költségplafon

`LLM_MONTHLY_BUDGET_USD` (alapértelmezés: 5). Minden valódi Anthropic-hívás
token- és költségadata az `llm_usage` táblába íródik; a tárgyhónapban
felhalmozott költség a plafon elérésekor a rendszert automatikusan No-LLM
módra váltja (az eredeti forrásszöveg jelenik meg, "nem AI-fordított"
jelöléssel) — a pipeline nem áll le. Aktuális havi költés lekérdezése:

```sql
select coalesce(sum(cost_usd), 0) as spent_usd
from llm_usage
where occurred_at >= date_trunc('month', now());
```

### Ütemezett automatikus ingest

1. **Vercel cron** (`apps/web/vercel.json`): naponta egyszer hívja a
   `/api/internal/cron/dispatch-ingest` végpontot GET-tel — a Vercel a
   `CRON_SECRET` env alapján automatikusan beállítja az
   `Authorization: Bearer` fejlécet. (Szándékosan napi: a Hobby csomag
   gyakoribb cront nem enged.)
2. **GitHub Actions** (`.github/workflows/scheduled-ingest.yml`): 30
   percenként POST-olja ugyanazt a végpontot. Aktiválásához két repo
   secret kell (Settings → Secrets and variables → Actions):
   `PRODUCTION_URL` és `CRON_SECRET`. Amíg nincsenek beállítva, a workflow
   csendben kilép.

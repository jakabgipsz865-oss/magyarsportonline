# Infrastructure Setup — valódi Neon PostgreSQL bekötése

Ez a dokumentum azt írja le, hogyan indítható el a projekt **első alkalommal
valódi Neon PostgreSQL adatbázissal**, hibamentesen, egy friss repository
klónozása után. Nem ír le semmilyen üzleti funkciót — csak az
infrastruktúra bekötését (env változók, migráció, seed, első valós
end-to-end teszt).

> Ez a dokumentum **sosem** tartalmaz valódi connection stringet, API
> kulcsot vagy más secretet — csak változóneveket és parancsokat. A valódi
> értékeket a Neon és a Cloudflare konzolból kell
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
| `LLM_PROVIDER`     | nem (alapértelmezés: `cloudflare`) | productionben `cloudflare`; `none` csak explicit helyi teszt |
| `CLOUDFLARE_ACCOUNT_ID` | csak ha `LLM_PROVIDER=cloudflare` | Cloudflare Dashboard → jobb felső sáv → Account ID       |
| `CLOUDFLARE_API_TOKEN`  | csak ha `LLM_PROVIDER=cloudflare` | Cloudflare Dashboard → My Profile → API Tokens ("Workers AI" jogosultsággal) |
| `CLOUDFLARE_AI_MODEL`   | nem (alapértelmezés: `@cf/meta/llama-3.3-70b-instruct-fp8-fast`) | csak JSON Mode-ot támogató Cloudflare modell |
| `CRON_SECRET`      | igen     | tetszőleges, magad generált titkos érték (pl. `openssl rand -hex 32`)               |

### `LLM_PROVIDER` — Cloudflare-only production

Productionben kizárólag `LLM_PROVIDER=cloudflare` támogatott. A `none` mód
megmarad explicit helyi fejlesztési és unit teszt célra, de nem
production-fallback: a változó hiánya is Cloudflare-t választ, a hiányzó
Cloudflare-hitelesítés pedig hangos hibát okoz.

#### Kötelező production konfiguráció

```bash
LLM_PROVIDER=cloudflare
CLOUDFLARE_ACCOUNT_ID=<Cloudflare Dashboard jobb felső sáv>
CLOUDFLARE_API_TOKEN=<"Workers AI" jogosultságú API-token>
# opcionális; ez az alapértelmezés:
CLOUDFLARE_AI_MODEL=@cf/meta/llama-3.3-70b-instruct-fp8-fast
```

**Token beszerzése:**

1. Regisztrálj egy Cloudflare fiókot (dash.cloudflare.com).
2. Dashboard → jobb felső sáv → másold ki az **Account ID**-t.
3. Dashboard → My Profile → API Tokens → Create Token → válaszd a
   **Workers AI** sablont (vagy egyedi tokent "Workers AI: Read/Edit"
   jogosultsággal).
4. Production terheléshez aktiváld a **Workers Paid plan**-t. A Free plan
   napi 10 000 neuronja fejlesztési keret, nem production rendelkezésre
   állási garancia.

`packages/llm/src/cloudflare-client.ts` — raw HTTP-alapú kliens (nincs
`@cloudflare/...` SDK-függőség), a Workers AI OpenAI-kompatibilis
`/ai/v1/chat/completions` végpontját hívja **közvetlenül a Vercelről** —
az alkalmazás NINCS Cloudflare Workers-re migrálva, ez csak egy plusz
kimenő HTTP-hívás a meglévő Vercel serverless függvényből. A
`ProviderFallbackLlmClient` (`packages/llm/src/provider-fallback-client.ts`)
productionben `failClosed: true` módban csomagolja be: **bármilyen hiba** —
4xx/5xx, kvótatúllépés/429, tiltás/401/403, hálózati hiba, érvénytelen
JSON-kimenet vagy sémahiba — visszadobódik a tartós job queue-nak. Nincs
No-LLM cikk, nincs másodlagos provider és nincs hamis siker.

A napi ingyenes kvóta kimerülését a worker külön kezeli: az aktuális job
próbálkozásvesztés nélkül visszakerül a queue-ba, tartós circuit breaker
aktiválódik, és a következő 00:00 UTC reset után öt perccel folytatódik a
feldolgozás. Sikeres hívás esetén a token-felhasználás, a
`provider: "cloudflare"` és a
becsült USD-költség (Cloudflare listaár alapján, a tényleges napi ingyenes
Neuron-fogyasztás nyomon követéséhez) az `llm_usage` táblába kerül.

`CLOUDFLARE_API_TOKEN` kizárólag szerveroldalon (`apps/web/lib/llm.ts`,
Next.js szerver-futtatókörnyezet) kerül felhasználásra — az
`apps/web/lib/env.ts` Zod-sémájában a `server` blokkban van, sosem a
`client`-ben, tehát a böngésző felé kiszolgált JS-bundle-ba nem kerülhet be.

Az adapter stabil session-affinity fejlécet küld, így a Cloudflare
prefix-cache az azonos statikus system promptokat nagyobb eséllyel
újrahasznosítja. A dinamikus Story-adat mindig a statikus instrukciók után
kerül a promptba. A normál Story LLM-hívásszáma 5-ről 3-ra csökkent:
ténykinyerés, Writer, rövid self-check. Külön editorial rewrite csak akkor
fut, ha a determinisztikus quality gate konkrét hibát hagyott a drafton; a
magyar sportsajtós házi stílus fő szabályai közvetlenül a Writer statikus
promptjába kerültek.

A Cloudflare aszinkron Batch API támogatja a production modellt, de itt nem
csökkentené a neuronfogyasztást, miközben a Fact → Writer → self-check
lépések egymás eredményétől függenek. Emiatt nem része ennek a
költségoptimalizálásnak; később nagyobb Paid-plan throughputnál használható
kapacitáskiegyenlítésre, külön tartós batch-állapotgéppel.

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
   Merge → Fact Verification (Cloudflare Workers AI) → Hungarian Writer
   (Cloudflare Workers AI) → SEO → Publish Gate → read model projection.

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

Ez a sorrend egy friss repository-klónozás után, a Neon projekt és a
Cloudflare Workers AI hitelesítés meglétével reprodukálható.

## 6. V1 üzemeltetési kiegészítések

### Admin/review felület

`/admin/review` — HTTP Basic auth, felhasználónév `admin`, jelszó az
`ADMIN_SECRET` env változó (min. 8 karakter; generálás: `openssl rand -hex 16`).
Ha az `ADMIN_SECRET` nincs beállítva, a felület 503-mal le van tiltva.
Vercel-en environment variable-ként állítsd be (Production + Preview).

### Cloudflare Workers AI költségfigyelés

Minden sikeres Cloudflare-hívás token- és becsült költségadata az
`llm_usage` táblába íródik. Aktuális havi költés lekérdezése:

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

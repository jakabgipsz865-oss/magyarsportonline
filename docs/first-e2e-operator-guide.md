# Első valódi end-to-end futtatás — operátori útmutató

Ez az útmutató a **legelső valódi** (valódi Neon PostgreSQL + valódi
Anthropic API) end-to-end pipeline-futtatáshoz szükséges pontos lépéseket
írja le, kizárólag a már elkészült infrastruktúrára támaszkodva
(`docs/infrastructure-setup.md`, `pnpm env:doctor`). Nem ír le új
funkciót, csak a meglévő rendszer első valós bekapcsolását.

> Ez a dokumentum **sosem** tartalmaz valódi titkos kulcsértéket — csak
> változóneveket és biztonságos beállítási helyeket.

## 1. Hol és milyen környezetben állítsd be a titkokat

Kétféle "olvasó" van a repóban, és mindkettőnek külön be kell állítani
ugyanazokat az értékeket:

| Változó            | Hol olvassa                                                                 | Hogyan állítsd be                                                                                          |
| ------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`      | `apps/web` (Next.js dev/build szerver) **és** a `packages/db` CLI-szkriptjei (`db:migrate`, `db:seed`, `env:doctor`) | Kétszer kell beállítani: (a) `apps/web/.env.local`-ban a Next.js szerverhez, (b) exportálva a shell környezetedben a CLI-parancsokhoz |
| `ANTHROPIC_API_KEY` | csak `apps/web` (Next.js szerver, a Fact Verification / Hungarian Writer agentek hívják)  | csak `apps/web/.env.local`                                                                                    |
| `CRON_SECRET`       | csak `apps/web` (a cron endpoint hitelesítéséhez)                            | csak `apps/web/.env.local`                                                                                    |

Lépések:

```bash
cp apps/web/.env.example apps/web/.env.local
# nyisd meg apps/web/.env.local-t, és töltsd ki a három kötelező sort:
#   DATABASE_URL=...
#   ANTHROPIC_API_KEY=...
#   CRON_SECRET=...
```

A `packages/db` CLI-eszközei (`db:migrate`, `db:seed`, `env:doctor`) **nem**
olvassák be a `.env.local` fájlt — önálló szkriptek, amik közvetlenül a
shell környezetből olvasnak (lásd `packages/db/src/seed.ts` és
`drizzle.config.ts` fejléckommentjeit). Ugyanabban a terminál-munkamenetben,
ahol ezeket futtatod, exportáld is:

```bash
export DATABASE_URL="<ugyanaz az érték, mint az .env.local-ban>"
```

**Production/staging/preview környezetben** ugyanezek a változók **Vercel
Environment Variables**-ként élnek, környezetenként elkülönítve
(`docs/architecture/06-deployment.md` §6.6) — ez az útmutató a helyi
fejlesztői gépen történő első futtatásra vonatkozik, nem élesre.

## 2. `pnpm env:doctor` — az állapot ellenőrzése

Miután beállítottad a fenti változókat (a shell-ben is!), de **még a
migráció előtt**, futtasd:

```bash
pnpm env:doctor
```

Ezen a ponton, migráció előtt, ez a **várt** (nem hiba!) állapot:

- `Node.js verzió`, `pnpm verzió`, `DATABASE_URL`/`ANTHROPIC_API_KEY`/`CRON_SECRET`: **PASS**
- `PostgreSQL kapcsolat`, `PostgreSQL verzió`: **PASS** (ha ezek `ERROR`-t adnak, állj meg — lásd 8. szakasz, mielőtt továbbmennél)
- `pgvector extension`: **PASS** vagy **WARNING** ("elérhető, de még nincs létrehozva") — mindkettő rendben van migráció előtt
- `Migrációk állapota`: **ERROR** ("0/1 migráció alkalmazva") — ez a migráció előtti állapotban **elvárt**, nem blokkoló ezen a ponton
- `Seed státusz`: **SKIPPED** ("a 'sources' tábla még nem létezik") — szintén elvárt

Ha bármelyik `DATABASE_URL`/`ANTHROPIC_API_KEY`/`CRON_SECRET` sor `ERROR`,
vagy a `PostgreSQL kapcsolat` sor `ERROR`, állj meg itt és javítsd, mielőtt
folytatnád a 3. lépéssel.

## 3. Migráció és seed pontos parancsai

```bash
pnpm --filter @magyarsportonline/db db:migrate
pnpm --filter @magyarsportonline/db db:seed
```

A `db:migrate` a `packages/db/drizzle/0000_wise_gertrude_yorkes.sql`-t
alkalmazza (séma + `CREATE EXTENSION IF NOT EXISTS vector`). A `db:seed`
idempotens — feltölti a `labdarugas` kategóriát, az alap
csapat/verseny-taxonómiát, és a "BBC Sport - Football" `Source` sort.

Ezután futtasd újra a doctor-t — ezen a ponton **minden sornak `PASS`-nak
kell lennie** (az opcionális env változók sora marad `SKIPPED`, az nem
számít bele):

```bash
pnpm env:doctor
```

Várt végeredmény:

```
Összefoglaló: <N> PASS, 0 WARNING, 0 ERROR

✓ Ready for Development
```

Ha ez nem jelenik meg, **ne lépj tovább** — lásd 8. szakasz.

## 4. Fejlesztői szerver indítása

```bash
pnpm --filter @magyarsportonline/web dev
```

Vagy a workspace gyökeréből: `pnpm dev` (Turborepo ezt is `apps/web`-re
indítja). A szerver `http://localhost:3000`-en indul.

## 5. A cron ingest végpont pontos meghívása

Új terminálban, ugyanabban a könyvtárban:

```bash
curl -i -X POST http://localhost:3000/api/internal/cron/dispatch-ingest \
  -H "Authorization: Bearer $CRON_SECRET"
```

(A `$CRON_SECRET`-nek pontosan meg kell egyeznie az `apps/web/.env.local`-ban
beállított értékkel — a `curl -i` a fejléceket is kiírja, így egy `401`
azonnal látszik.)

Várt válasz: `200 OK`, JSON törzsben egy `results` tömb, soronként
`{ sourceId, ingestedCount, status: "ok" }` a "BBC Sport - Football"
forráshoz. `ingestedCount` a ténylegesen új (korábban nem látott URL-ű)
cikkek száma ebben a futásban — lehet `0` is, ha a feed nem publikált
semmi újat legutóbb óta (ez nem hiba, lásd 7. szakasz).

## 6. Mit ellenőrizz sikeres válasz után

**API-válaszok:**

```bash
curl http://localhost:3000/api/v1/stories
```

— tartalmaznia kell legalább egy Story-t (ha `ingestedCount > 0` volt és a
Publish Gate publikálta). Ha üres a lista, nézd meg a Story részletes
státuszát az adatbázisban (lásd lent) — lehet, hogy a Story a review queue-ba
került, nem hiba.

```bash
curl http://localhost:3000/api/v1/stories/<slug>
```

— a részletes nézet (törzsszöveg, `sources`, `versionHistory`).

**Adatbázis-rekordok** (`psql "$DATABASE_URL"` vagy bármelyik SQL-kliens):

```sql
select id, status, confidence_score, slug from stories order by first_seen_at desc limit 5;
select story_id, version_number, created_at from story_versions order by created_at desc limit 5;
select story_id, contribution_type, raw_article_id from story_sources order by linked_at desc limit 5;
select agent_name, status, occurred_at from agent_runs order by occurred_at desc limit 20;
select story_id, reason, status from review_queue_items order by created_at desc limit 5;
```

Amit keresel:

- `stories.status = 'published'` és van `confidence_score` érték a most létrejött sorhoz;
- pontosan **egy** sor a `story_versions`-ben (`version_number = 1`);
- egy sor a `story_sources`-ben, `contribution_type = 'initial'`;
- minden `agent_runs` sor `status = 'success'` (source-ingest, deduplication, story-merge, fact-verification, hungarian-writer, seo, publish-gate, read-model-projector) — egy `error` sor pontosan megmutatja, melyik agent hibázott;
- ha a Story **nem** publikálódott (`status` nem `published`), nézd meg a `review_queue_items`-et — ha van benne sor erre a `story_id`-ra, az azt jelenti, hogy a Publish Gate szándékosan review-ra küldte (alacsony confidence vagy magas kockázat), ez a rendszer helyes, dokumentált viselkedése, nem hiba.

**Weboldalak** (böngészőben):

- `http://localhost:3000/` — a főoldalon meg kell jelennie az új Story-nak;
- `http://localhost:3000/hir/<slug>` — a részletes oldal forráslistával és verziótörténet/timeline szekcióval.

## 7. Második futtatás — Story-frissítés igazolása duplikáció helyett

**Fontos, valós korlát:** a Source Ingest Agent URL alapján deduplikál
(`packages/agents/src/source-ingest/index.ts` — `findBySourceUrl`), tehát
ha a második `curl -X POST .../dispatch-ingest` hívás idején a BBC feed
**nem** publikált új cikket, a válasz `ingestedCount: 0` lesz mindkét
forrásra, és **semmi nem történik** — ez helyes, nem jelenti azt, hogy a
Story-frissítési logika hibás, csak azt, hogy nem volt új bemenet, amit
tesztelni lehetne.

A Story-frissítési logika (ugyanazon esemény új forrásból/cikkből történő
felismerése → meglévő Story frissítése, nem duplikálása → confidence nő →
új verzió) a `packages/agents/src/story-merge` és
`packages/agents/src/deduplication` csomagok automatizált tesztjeiben
(`*.test.ts`, fake adatokkal) már **determinisztikusan igazolt** —
ezt a `pnpm test` bármikor újra megerősíti.

A **valódi, élő feeden** történő igazoláshoz:

1. Hagyd futni a szervert, és ismételd meg az 5. lépés `curl` hívását
   időszakosan (pl. 30–60 percenként, vagy a következő napon) — a BBC
   Sport Football feed jellemzően több cikket is közöl ugyanarról a
   meccsről a nap folyamán (előzetes → élő szöveges közvetítés → végeredmény),
   más-más URL-lel.
2. Amikor egy ilyen hívás válaszában `ingestedCount > 0`, ellenőrizd:
   ```sql
   select count(*) from stories;                -- nem nőtt a korábbi legutóbbi számláláshoz képest
   select story_id, version_number from story_versions where story_id = '<a korábbi story id>' order by version_number desc;
   select confidence_score from stories where id = '<a korábbi story id>';
   ```
3. Sikeres igazolás jele: **ugyanaz** a `story.id` (nem jött létre új sor a
   `stories` táblában erre az eseményre), a `story_versions`-ben egy **új**,
   magasabb `version_number` jelent meg, és a `confidence_score` **nőtt**
   (vagy legalábbis nem csökkent) az előző értékhez képest. A `/hir/<slug>`
   oldal Timeline szekciójában is meg kell jelennie a második verziónak.
4. Ha szeretnéd ezt determinisztikusan, várakozás nélkül kipróbálni: nézd meg
   közvetlenül a nyers feedet (`curl https://feeds.bbci.co.uk/sport/football/rss.xml`),
   és csak akkor hívd meg újra a cron endpointot, ha látod, hogy új
   `<item>` jelent meg egy már ingestált meccsről/csapatról — ez nem új
   funkció, csak a meglévő pipeline időzítettebb elindítása.

## 8. Teendő hiba esetén (lépésenként)

| Lépés | Tünet | Teendő |
| --- | --- | --- |
| 2. (env:doctor) | `DATABASE_URL`/`ANTHROPIC_API_KEY`/`CRON_SECRET` sor `ERROR` | Ellenőrizd, hogy pontosan abban a shell-munkamenetben exportáltad-e, ahol a parancsot futtatod (`echo $DATABASE_URL`) |
| 2. (env:doctor) | `PostgreSQL kapcsolat` `ERROR` | Nézd meg a doctor kiírt hibaüzenetét — leggyakoribb ok: a Neon projekt "suspended" állapotban van (ébreszd fel egy egyszerű lekérdezéssel a Neon konzolból), vagy a connection string nem tartalmazza a `?sslmode=require`-t |
| 2. (env:doctor) | `pgvector extension` `ERROR` ("nem elérhető") | Ellenőrizd a Neon konzol → Extensions listáját; ha a `vector` nincs a projekt csomagjában elérhető listán, kontaktáld a Neon supportot vagy válts olyan Neon régióra/tier-re, ami támogatja |
| 3. (db:migrate) | parancs hibával leáll | Nézd meg a drizzle-kit kiírt SQL-hibát; leggyakoribb ok: a `DATABASE_URL` egy másik (üres vagy inkompatibilis) adatbázisra mutat, mint amit vártál — ellenőrizd a Neon konzolban a projekt/branch nevét |
| 3. (db:seed) | egyedi kulcs / unique constraint hiba | A script idempotens, biztonságos újrafuttatni; ha mégis hibázik, ellenőrizd, hogy a migráció ténylegesen lefutott-e előtte (`pnpm env:doctor`) |
| 4. (dev szerver indítás) | `Invalid environment variables` hiba induláskor | Az `apps/web/.env.local` valamelyik kötelező mezője hiányzik vagy rossz formátumú (`apps/web/lib/env.ts` Zod-sémája) — nézd meg a hibaüzenetben megnevezett mezőt |
| 5. (cron hívás) | `401 unauthorized` | A `CRON_SECRET` a `curl` parancsban nem egyezik pontosan az `.env.local`-ban lévővel (whitespace, idézőjel-eltérés) |
| 5. (cron hívás) | `500`, `"error": "ingest pipeline failed"` | Nézd meg a `pnpm dev` terminál kimenetét (strukturált logger, állítsd `LOG_LEVEL=debug`-ra az `.env.local`-ban a részletesebb kimenethez) — leggyakoribb okok: érvénytelen/lejárt `ANTHROPIC_API_KEY`, Anthropic API kvóta/rate-limit, vagy a BBC RSS feed pillanatnyi elérhetetlensége |
| 6. (nincs Story a listában) | `GET /api/v1/stories` üres, de a cron `200 OK`-t adott | Nézd meg a `stories.status`-t és a `review_queue_items`-et — a Publish Gate szándékosan review-queue-ba küldhette (alacsony confidence vagy magas kockázat); ez a rendszer helyes viselkedése, nem hiba |
| 7. (második futtatás) | `ingestedCount: 0` mindkétszer | A feed nem publikált új cikket a két hívás között — várj tovább, vagy nézd meg közvetlenül a nyers RSS feedet (lásd 7.4) |

## Merge-readiness — státusz

A fenti lépéssor teljes egészében a már mergelésre váró
`claude/project-handover-mvp-4bi7pl` ágon lévő kódra épül, új kódváltoztatás
nélkül. A PR CI-ja jelenleg zöld, a PR technikailag mergelésre kész — a
valódi Neon/Anthropic hitelesítő adatokkal történő tényleges E2E-futtatás
(ez a dokumentum) **nem előfeltétele** a mergének, hiszen a build/lint/
típusellenőrzés/teszt CI-ban placeholder értékekkel fut, a valódi
integráció pedig eleve csak beállított hitelesítő adatokkal futtatható,
ami nem történhet meg a CI-környezetben. A tényleges E2E-futtatás elvégzése
és eredménye a te döntésed a merge előtt/után — technikai akadálya nincs.

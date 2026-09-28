# Elkülönített Cloudflare D1 teljesfolyamat-próba — 2026-09-28

Ez a korábbi auditra épülő javítás ellenőrzése. A teszt kizárólag szintetikus
RSS-t és Writer-választ használt; nem az éles adatállomány egyeztetése.

## Környezet és biztonsági határ

- Branch: `codex/mso-remediation`; a production Worker változatlan.
- D1: `mso-remediation-e2e-20260928`, ID
  `9fa9cb85-c8f2-49a9-aa80-a0cc47335c27`. Üres, 28 táblás séma és egy
  elkülönített tesztforrás; nem a történeti dumpot tartalmazó D1.
- Szintetikus RSS/HTML Worker: `mso-d1-e2e-feed`, verzió
  `2d08ccc1-9620-4f80-8279-24b1031c8e3b`; `noindex, nofollow`.
- A teljes Next.js alkalmazás távoli Cloudflare preview-ja helyi
  `127.0.0.1:8790` kapun futott, külön
  `apps/web/wrangler.d1.e2e.jsonc` konfigurációval. A bindingok `DB`,
  `E2E_FEED`, `ASSETS`; nincs Hyperdrive, Neon URL, Facebook Queue vagy AI
  token. A Writer válasza a konfigurációban rögzített tesztadat volt.
- Az alkalmazás `SITE_URL` értéke egy nem éles workers.dev tesztcím,
  `FACEBOOK_AUTO_PUBLISH=false`. A szintetikus cikk soha nem került az
  `mso24.hu` éles felületére.

## Végponttól végpontig nyomvonal

1. `POST /api/internal/cron/dispatch-ingest`: az RSS-tétel tartósan bekerült
   a D1 `raw_articles` táblába. A teljes forrásoldal kivonatolása után
   `content_origin=full_article`, és egy `pipeline_jobs` tétel jött létre.
2. `POST /api/internal/jobs/process`: `processed=1`, `succeeded=1`,
   `outcome.status=published`,
   `storyId=20c3238e-de7e-4168-a7df-6bb0f3f09cd7`,
   `versionId=47173bde-ff0d-4180-a9ae-56b12a1b58f0`. A Writer-válasz
   mentett drafton és minőségellenőrzésen át jutott a publikációig.
3. A `/hir/az-arsenal-uj-jatekossal-erositett-20c3238e` HTML cikkoldal
   HTTP 200 (16 839 bájt), az azonos slugú `/api/v1/stories/...` JSON API
   HTTP 200 (1 022 bájt), az `/rss.xml` HTTP 200 (813 bájt).
4. Az `/impresszum` és `/adatkezeles` HTTP 200. A válaszokban a márkanév
   MSO24, a kapcsolati cím `hello@mso24.hu`, hivatkozása
   `mailto:hello@mso24.hu`. A korábbi márkanév és Gmail-cím ezekben a
   tesztválaszokban nem szerepelt.
5. Az RSS és a jobsor megismételt futtatása `persistedCount=0`,
   `queuedCount=0`, illetve `processed=0` eredményt adott. D1-ben pontosan
   egy Story, egy verzió, egy olvasási nézet és egy befejezett job maradt.
6. A tesztfeed nem sportos mintatétele `rejectedCount=1` mellett
   `processing_status=rejected_topic`, `decision_reason=topic_filter`
   értékekkel tárolódott. A tesztfixture korábbi változata két további,
   tévesen átengedett szintetikus sort hagyott `fetch_retry` állapotban;
   ezekhez nem keletkezett job vagy cikk.
7. Távoli D1 olvasási SQL: `social_posts=0`, `llm_usage=0`,
   `pragma_foreign_key_check=0`. A Facebook-küldés és valódi AI-hívás
   szándékosan ki volt kapcsolva.

## Helyi regresszió és hibatűrés

- 61/61 adatbázis-, 537/537 agent- és 109/109 webteszt sikeres.
  Hat PostgreSQL-integrációs teszt élő Neon-kapcsolat hiányában kihagyva.
- A D1 teljesfolyamat-tesztek igazolják az egyetlen Facebook social intentet
  `https://mso24.hu/hir/...` linkkel, a megismételt job idempotenciáját,
  a megszakítás után mentett draft AI-hívás nélküli újraellenőrzését,
  a Writer-hiba utáni backoffos újrapróbálást, valamint a nem igazolt számszerű
  állítás kézi review-ba irányítását publikáció és Facebook intent nélkül.
- Az RSS parser natív Workers `fetch` útvonala, a D1 költségnapló/napi
  híváslimit, valamint a DB, agents és web TypeScript ellenőrzése sikeres.
  A web és agent módosított fájlok ESLint-ellenőrzése tiszta.

## Nem igazolt és éles átállási feltételek

- Valódi Gemini/Cloudflare AI-hívás D1-en: **NOT VERIFIED**. Ez a teszt
  tesztválaszt használt, így a távszolgáltató válasza és költségnaplója
  nincs E2E-vel bizonyítva.
- Valódi Facebook-poszt: **NOT VERIFIED**. A már beállított Page tokenhez nem
  nyúltunk; az automatikus posztolás kikapcsolva maradt.
- Teljes D1-only admin/szerkesztői útvonal: **NOT VERIFIED**; több belső
  útvonal még a PostgreSQL repositoryt hívja.
- A történeti dump D1-egyezése csak a 2026-09-27 18:02:49 UTC körüli mentés
  pillanatáig bizonyított. A későbbi módosítások és törlések teljes halmaza
  nem ismert. A Neon ingyenes kvótája új kapcsolatot elutasít; fizetős váltás
  nem engedélyezett. A veszteségmentes végső szinkron és production cutover
  emiatt blokkolt. A régebbi snapshotra átirányítás külön felhasználói döntés
  nélkül nem történhet.
- 2026-09-28 16:00 UTC körül az éles főoldal és RSS HTTP 500, az Impresszum
  HTTP 200 volt. A tesztelt D1 read path elvileg kiszolgálhatná a korábbi
  pillanatképet, de annak 18:02:49 UTC utáni adatfrissessége nem bizonyított;
  nem kapcsoltuk be.

## Visszaállíthatóság

A teszt Worker és a teszt D1 külön nevű, külön kötésű erőforrás. Nem módosította
az éles D1/Neon adatokat vagy az éles route-okat. A végső átállás előtt friss,
konzisztens adatbizonyíték, befagyasztás, egyeztetés, régi Worker-verzió és
Neon-ág megőrzése, valamint próbált visszakapcsolási lépés kell. Az eredeti
dump és táblánkénti export változatlanul megmarad.

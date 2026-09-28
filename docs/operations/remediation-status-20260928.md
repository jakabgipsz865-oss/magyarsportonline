# MSO24 javítás és Cloudflare átállás — bizonyíték szerinti állapot

2026-09-28. Ez a korábbi auditon alapuló végrehajtási állapot, nem új audit.

| Terület | Helyben / elkülönített környezetben | Tényleges production | Végponttól végpontig bizonyíték |
| --- | --- | --- | --- |
| Production-forrás eltérés | A production v183 forrása a `4054dad` commitban rekonstruálva; a javítások és D1-munka a `codex/mso-remediation` ágon verziózva. | GitHub `main` jelenleg `84411b91`; a javítási ág nincs élesítve. | Forráseltérés rendezése a javítási ágon: PASS. Éles futás: **NOT VERIFIED**. |
| RSS/job/Writer és kivonatolók | 536/536 agent, 105/105 web, 59/59 db helyi teszt sikeres; a PostgreSQL-integrációs tesztek élő kapcsolat hiányában ebben a futásban kihagyva. | A jelenlegi éles főoldal és RSS 2026-09-28-án HTTP 500. | Helyi regresszió: PASS; valódi új production feldolgozás: **NOT VERIFIED**. |
| Történeti PostgreSQL mentés | A 2026-09-27 18:02:49 UTC körüli custom dump helyi PostgreSQL 18-ba hibamentesen visszaállt. 28/28 tábla, 26 731/26 731 sor egyező logikai hash; 31 FK; nulla invalid index. | Neon megőrizve. A jelenlegi ágról az új kapcsolatok kvóta miatt elutasítottak. | Mentés visszaállíthatósága: PASS. Jelenlegi Neonhoz való teljesség: **NOT VERIFIED**. |
| D1 adatállomány | 28 táblás séma és 26 731 soros import; elkülönített remote D1 export-visszaimport 28/28 hash egyezés, `foreign_key_check` tiszta. | Nincs D1 adatkapcsoló éles Workeren. | Történeti mentéshez egyezés: PASS. Végső friss szinkron: **NOT VERIFIED**. |
| D1 alkalmazás | Publikus Next.js útvonalak D1-kötéssel: főoldal, cikklista/részlet, cikkoldal, RSS, sitemap, kategória, csapatok HTTP 200 a helyi Workers runtime-ban; csak `DB` és `ASSETS` kötés, nincs `DATABASE_URL`/Hyperdrive. A nem portolt belső PostgreSQL-útvonalak D1 módban hibával leállnak. | A production web/publisher továbbra is Hyperdrive-os verzió. A csak olvasó D1 teszt Worker külön workers.dev címen fut, D1 kötésen kívül nincs más erőforrása. | Helyi D1 E2E: PASS. Távoli D1 Worker health/list/detail/taxonomy: PASS. Teljes Next.js távoli D1 preview főoldal, cikk API/oldal, RSS, Impresszum, Adatvédelem: PASS. Írási pipeline D1-en: **NOT VERIFIED**. |
| Facebook | D1 social intent, idempotens claim és publisher adapter; a consumer az aktiválási határ előtti intentet elutasítja, a pending sweep kihagyja. Publisher 17/17 helyi teszt, köztük D1 perzisztencia és mockolt Meta-válasz. | A már beállított Page tokent nem olvastuk ki és nem generáltuk újra. Automatikus posztolás kikapcsolva. | Valódi új cikk Facebook-posztja: **NOT VERIFIED**. |
| MSO24 név és `hello@mso24.hu` | A helyi D1-only Next.js oldalon fejléc/lábléc MSO24, RSS-cím MSO24, Impresszum és Adatvédelem kapcsolati `mailto` helyes; régi Gmail nincs. | A két statikus production oldal HTTP 200, de még a korábbi márkanevet és kapcsolati emailt mutatja. | Helyi és távoli D1 preview oldal/RSS: PASS. Éles cache és felület: **NOT VERIFIED**. |
| Domain/email | A korábbi magyarsportonline.hu → mso24.hu átirányítás és Cloudflare Email Routing korábbi élő tesztje sikeres volt. | A www.mso24.hu proxizott DNS-rekord és host alapú 301 szabály 2026-09-28-án létrejött; a meglévő MX/routing változatlan. | Cloudflare élcímen HTTP és HTTPS kérés 301, útvonal és query megőrizve: PASS. Helyi resolver cache még NXDOMAIN; Gmail új végponttól végpontig teszt ebben a munkaszakaszban: **NOT VERIFIED**. |

## Az éles adatátállás külön akadálya

A teljes dump 18:02-es pillanatkép. 23:53:52 UTC-kor az eredeti frissebb
Neon-ágon a négy alapvető tábla nettó sorállománya +46 raw, +43 story, +43 job,
+42 verzió volt. A későbbi részleges export egy 18:25-kor publikált cikket
igazol, de nem tartalmazza minden tábla minden sorát, módosítását és törlését.
A véletlen augusztusi restore-ág dumpja nem a szeptemberi delta. A pontos
hiány `post-snapshot-data-gap-20260928.md` fájlban van. A régi D1 snapshot
élesítését adatvesztési kockázatként kezeljük; nem irányítottuk át rá a
production forgalmat. A végső átálláshoz egy új teljes, konzisztens mentés
vagy minden táblára kiterjedő, hiteles változás- és törlésnapló kell az eredeti
frissebb ágról, majd befagyasztás, egyeztetés és rollback-próba. A Neon ingyenes
kvótája jelenleg minden új kapcsolatot elutasít; fizetős váltás nincs
javasolva vagy indítva.

## Következő technikai kapuk

1. A még PostgreSQL-es belső szerkesztői, Writer és publikációs műveletek,
   valamint a job feldolgozó útvonal D1-re portolása és Workers-regressziója.
   Az RSS fogadás/fetch D1-adaptere elkészült, de a Writer még nem fut D1-en.
   A publikus olvasás és a Facebook social intent önmagában nem teljes
   Cloudflare-only alkalmazás.
2. A teljes Next.js és job-feldolgozó útvonalak D1 staging feltöltése és
   távoli funkcionális tesztje. A Worker Scripts jog már megvan egy elkülönített,
   helyes fiókhoz tartozó CLI-konfigurációban; a read-only teszt Worker feltöltése
   és lekérdezése sikerült.
3. A fenti friss teljes adatbizonyíték után kontrollált D1 szinkron és
   adatvesztést elkerülő rollback. Az éles MSO24 márka-/email- és pipeline
   javításokhoz külön, sikeres production deploy és valódi futás szükséges.

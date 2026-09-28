# MSO24 javítás és Cloudflare átállás — bizonyíték szerinti állapot

2026-09-28. Ez a korábbi auditon alapuló végrehajtási állapot, nem új audit.

| Terület | Helyben / elkülönített környezetben | Tényleges production | Végponttól végpontig bizonyíték |
| --- | --- | --- | --- |
| Production-forrás eltérés | A production v183 forrása a `4054dad` commitban rekonstruálva; a javítások és D1-munka a `codex/mso-remediation` ágon verziózva. | GitHub `main` jelenleg `84411b91`; a javítási ág nincs élesítve. | Forráseltérés rendezése a javítási ágon: PASS. Éles futás: **NOT VERIFIED**. |
| RSS/job/Writer és kivonatolók | 537/537 agent, 110/110 web, 62/62 db helyi teszt sikeres; 6 PostgreSQL-integrációs teszt élő kapcsolat hiányában kihagyva. D1 job-claim, lease, Writer-draft, költségnapló/napi limit, minőségkapu, publikáció, olvasási projekció és cutover-határos dead-letter helyreállítás elkészült. | Az éles főoldal és RSS 2026-09-28 16:00 UTC körül ismét HTTP 500. | Izolált távoli D1-folyamat teszt Writer-válasszal: PASS; valódi új production feldolgozás: **NOT VERIFIED**. |
| Történeti PostgreSQL mentés | A 2026-09-27 18:02:49 UTC körüli custom dump helyi PostgreSQL 18-ba hibamentesen visszaállt. 28/28 tábla, 26 731/26 731 sor egyező logikai hash; 31 FK; nulla invalid index. | Neon megőrizve. A jelenlegi ágról az új kapcsolatok kvóta miatt elutasítottak. | Mentés visszaállíthatósága: PASS. Jelenlegi Neonhoz való teljesség: **NOT VERIFIED**. |
| D1 adatállomány | 28 táblás séma és 26 731 soros import; elkülönített remote D1 export-visszaimport 28/28 hash egyezés, `foreign_key_check` tiszta. | Nincs D1 adatkapcsoló éles Workeren. | Történeti mentéshez egyezés: PASS. Végső friss szinkron: **NOT VERIFIED**. |
| D1 alkalmazás | Publikus Next.js útvonalak és az RSS → Writer → publikációs job D1-kötéssel futnak; az elkülönített E2E preview-ban `DB`, `E2E_FEED` és `ASSETS` van, Neon/Hyperdrive nincs. A még nem portolt belső szerkesztői PostgreSQL-útvonalak D1 módban hibával leállnak. | A production web/publisher továbbra is Hyperdrive-os verzió. A külön D1 tesztkörnyezet nem szolgálja ki az éles domaint. | Távoli D1 RSS-betöltés, elutasítási indok, Writer tesztválasszal, publikáció, cikk API/HTML/RSS, ismételt futás: PASS. Valódi AI-szolgáltatás és teljes belső admin-funkció D1-en: **NOT VERIFIED**. |
| Facebook | D1 social intent, idempotens claim és publisher adapter; a consumer az aktiválási határ előtti intentet elutasítja, a pending sweep kihagyja. A D1 Writer helyi teljesfolyamat-tesztje pontosan egy mso24.hu intentet hozott létre, ismétlésre sem duplikált. | A már beállított Page tokent nem olvastuk ki és nem generáltuk újra. Automatikus posztolás kikapcsolva. | Izolált távoli tesztben posztküldés nem történt; valódi új cikk Facebook-posztja: **NOT VERIFIED**. |
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

## A 2026-09-28-i izolált D1-próba

A `mso-remediation-e2e-20260928` külön D1-adatbázisban szintetikus RSS-itemből
egy teljes cikk és egy feldolgozott job keletkezett. A teszt Writer-válasz után
egy Story, egy verzió és egy olvasási nézet állt elő; a cikk HTML és API útvonala
HTTP 200. Az RSS, Impresszum és Adatvédelem is HTTP 200, az MSO24 és a kért
kapcsolati mailto szerepel. Egy második, nem sportos item `rejected_topic` /
`topic_filter` indokkal tárolódott. A megismételt betöltés és jobsor-futtatás
nem hozott új cikket. `foreign_key_check` nulla, `social_posts` nulla,
`llm_usage` nulla. A teszt nem használt valódi AI-t és nem küldött Facebook-posztot.
A korábbi hibás tesztfixture két `fetch_retry` sort is hagyott ebben a kizárólag
szintetikus adatbázisban; ezek nem voltak jobok és nem érintik productiont.
Részletes bizonyíték: `d1-e2e-evidence-20260928.md`.

## Következő technikai kapuk

1. A még PostgreSQL-es belső szerkesztői/admin útvonalak D1-re portolása és
   regressziója. A D1 Writer és jobfolyamat elkészült, de a teljes admin-felület
   Cloudflare-only működése még nincs igazolva.
2. Valódi AI-szolgáltatóval, a megadott költségkereten belüli célzott D1 próba,
   valamint az éles új cikk Facebook-végpontig tartó igazolása a tényleges
   átállás és bekapcsolási határ után. A tesztfeed soha nem kerülhet az éles
   oldalra.
3. A fenti friss teljes adatbizonyíték után kontrollált D1 szinkron és
   adatvesztést elkerülő rollback. Az éles MSO24 márka-/email- és pipeline
   javításokhoz külön, sikeres production deploy és valódi futás szükséges.

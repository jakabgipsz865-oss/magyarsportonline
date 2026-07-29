# Nyitott döntések és megválaszolatlan kérdések

**Verzió:** 1.0
**Dátum:** 2026-07-28
**Cél:** A 2026-07-28-i utasítás explicit kérése ("a korábban feltett, megválaszolatlan kérdéseket ne hagyd elveszni") szerint minden ebben a sessionben felmerült, még nyitott vagy csak részlegesen lezárt kérdés egy helyen, nyomon követhetően. Minden tétel frissítendő, ahogy a döntés megszületik vagy a kockázat lezárul — ez egy élő dokumentum, nem egyszeri jegyzőkönyv.

Formátum soronként: **Kérdés** → Jelenlegi válasz/döntés → Bizonyíték → Nyitott kockázat → Következő teendő → Felelős/státusz.

---

## 1. A fejlesztői sandbox nem ér el kifelé élő internetet

- **Kérdés:** Hogyan ellenőrizhető, hogy egy extractor/RSS-URL/robots.txt-állítás valóban működik-e élőben, ha a fejlesztői környezet nem tud kimenő HTTP-kérést küldeni külső domainekre?
- **Jelenlegi döntés:** Minden élő-web-függő kódot (extractorok) defenzíven írunk (soha nem dob kivételt, `null`/fallback minden hibára), és egy **külön, `workflow_dispatch` GitHub Actions workflow-t** hozunk létre, ami valódi internet-hozzáférésű runneren futtatja és bizonyítja a kódot élő tartalmon.
- **Bizonyíték:** `curl -sS -m 15 -A "Mozilla/5.0..." https://www.bbc.co.uk/sport/football` → `curl: (56) CONNECT tunnel failed, response 403` ebből a sandboxból. `.github/workflows/bbc-extractor-diagnostic.yml` a bizonyított munkamintázat.
- **Nyitott kockázat:** Ez a minta forrásonként egy külön workflow-t igényel — 20+ forrásnál ez sok ismétlődő boilerplate; érdemes lehet egy generikus, paraméterezhető diagnosztikai workflow-ra váltani.
- **Következő teendő:** Amikor a 2. sprint extractor (Sky Sports vagy más) elkészül, döntsd el: külön workflow fájl minden forráshoz, vagy egy közös, forrás-paraméteres workflow.
- **Felelős/státusz:** Nyitva, nem blokkoló.

## 2. `reliabilityTier` (A/B/C) vs. az új `trustBaseline` (0-100)

- **Kérdés:** A meglévő, élesben használt A/B/C megbízhatósági szint helyettesíthető-e egy numerikus bizalmi alapponttal, ahogy a hitelességi mutató specifikációja sugallja ("forrás megbízhatósági súlya")?
- **Jelenlegi döntés:** NEM helyettesítjük — a `reliabilityTier` aktívan, élesben használt bemenete a Fact Verification Agent confidence score-jának (`packages/agents/src/fact-verification/confidence-score.ts` `sourceReliabilityScore()`). Az új `trustBaseline` (0-100) **additív**, önálló oszlop a `sources` táblán, amit a jövőbeli hitelességi mutató fog használni.
- **Bizonyíték:** grep megerősítette, hogy `reliabilityTiers` tömböt gyűjt és használ a `packages/agents/src/fact-verification/index.ts` és a confidence-score modul; a `packages/db/drizzle/0011_superb_thunderbolt_ross.sql` migráció csak `ADD COLUMN`-okat tartalmaz, egyetlen meglévő oszlopot sem érint.
- **Nyitott kockázat:** Két párhuzamos "megbízhatóság" fogalom (A/B/C tier + 0-100 baseline) hosszabb távon összemosódhat vagy inkonzisztenssé válhat, ha külön csapat/logika frissíti őket. Érdemes lehet egy jövőbeli sprintben egy explicit leképezést definiálni (pl. A ⇄ 85-100, B ⇄ 60-84, C ⇄ 0-59) mindkét irányban konzisztencia-ellenőrzéssel.
- **Következő teendő:** A hitelességi mutató motor (7. tétel a fő sprint-listából) megírásakor dönteni kell erről a leképezésről.
- **Felelős/státusz:** Nyitva, nem blokkoló.

## 3. `source_type` enum "scraper" értéke

- **Kérdés:** A régi `sourceTypeEnum(["rss","api","scraper"])` hogyan illeszkedik az új "elérési mód: api/rss/html/social-embed" taxonómiához?
- **Jelenlegi döntés:** "scraper" megmarad az enumban (deprecated, nem törölve — Postgres enum-érték biztonságos eltávolítása táblaátírást igényelne, feleslegesen kockázatos egy soha nem használt értékért), és két új érték került hozzá: `html`, `social_embed`.
- **Bizonyíték:** grep megerősítette, hogy egyetlen seed-sor sem használja a `"scraper"` értéket; `0011_superb_thunderbolt_ross.sql` csak `ALTER TYPE ... ADD VALUE`-t tartalmaz, nem távolít el semmit.
- **Nyitott kockázat:** Minimális — a deprecated érték örökre az enum-definícióban marad, ez kognitív zaj, de nem funkcionális kockázat.
- **Következő teendő:** Nincs sürgős teendő.
- **Felelős/státusz:** Lezárva (elfogadott kompromisszum).

## 4. Kluboldalak (96 klub) egyedi dokumentálása

- **Kérdés:** Az öt liga mind a kb. 96 klubjának hivatalos híroldalát egyenként kell-e dokumentálni (RSS/API/HTML elérhetőség, extrakciós mód, korlátozás, megbízhatóság), mielőtt bármelyiket bekötnénk?
- **Jelenlegi döntés:** Ebben a sprintben **módszertan** készült (docs/source-registry.md 3. pont) 96 egyedi, élőben nem ellenőrzött állítás kitalálása helyett — mert a sandbox nem tudja ezt élőben megerősíteni, és a session "bizonyíts, ne feltételezz" elve tiltja a nem-ellenőrzött részletek tömeges kitalálását.
- **Bizonyíték:** Lásd 1. tétel (sandbox-korlát); a klublista maga (csapatnevek) stabil, közismert tény, de az RSS/robots/ToS-részletek forrásonkénti ellenőrzést igényelnek.
- **Nyitott kockázat:** A felhasználó explicit kérése ("dokumentáld forrásonként") technikailag nem 100%-ban teljesült a klubok szintjén — ez tudatosan vállalt, dokumentált hiány, nem elfeledett feladat.
- **Következő teendő:** Egy generikus, minden klubdomain ellen futó audit-workflow megírása (RSS-autodiscovery + robots.txt-ellenőrzés élő internettel), majd a Registry tényleges feltöltése az audit eredményével. A felhasználó explicit kérése szerint ez a teljes 96-klubos audit **nem kezdődhet el**, amíg a többforrásos Story- és hitelességi motor élő adaton nincs bizonyítva.
- **Felelős/státusz:** **LEZÁRVA** — a felhasználó jóváhagyta a kétlépéses megközelítést ("A 96 klub kétlépcsős auditja elfogadható: most módszertan, taxonómia és adapter-architektúra; később külön élő RSS/robots/terms audit."). A teljes audit ütemezése a hitelességi motor bizonyítása utánra várat.

## 5. Sport & Sztárok / sportbulvár konkrét forráslista

- **Kérdés:** A második termékpillérhez (sportolók/edzők/klubok és családtagjaik nyilvános szereplése) mely konkrét bulvár-/közösségimédia-források tartoznak?
- **Jelenlegi döntés:** Nincs konkrét forráslista összeállítva ebben a sprintben — csak a kategória- és content-mode taxonómia (`category=tabloid`/`social`, `type=social_embed`) készült el a schema szintjén.
- **Bizonyíték:** docs/source-registry.md 7. pont.
- **Nyitott kockázat:** Ez a termékpillér jogilag/etikailag érzékenyebb (magánélet, pletyka vs. tény), mint a mérkőzés-hírek — forráslista összeállítás előtt érdemes tisztázni, mely bulvárlapok/közösségimédia-fiókok elfogadhatók forrásnak.
- **Következő teendő:** Külön sprint: konkrét forráslista + a "pletyka sosem megerősített tényként" szabály technikai kikényszerítése (pl. kötelező "nem megerősített" jelölő, ha csak egyetlen, nem hivatalos forrás van).
- **Felelős/státusz:** Nyitva, nem blokkoló ebben a sprintben.

## 6. Eredeti Source Fetcher lista (Reuters Sport, AP Sports) vs. az új médialista

- **Kérdés:** A 4. felhasználói üzenet ("Kezdd el most...") az első Source Fetcher körre ezt kérte: *BBC Sport, Sky Sports, Reuters Sport, AP Sports, ESPN*. Az 5. üzenet (a jelenlegi, végleges termékirány) médialistája viszont ez: *BBC Sport, Sky Sports, The Guardian, ESPN, Marca, AS, Mundo Deportivo, Gazzetta dello Sport, Corriere dello Sport, Kicker, Sport1, L'Équipe, RMC Sport* — **a Reuters Sport és az AP Sports nem szerepel benne**, viszont megjelent a Guardian és 8 új, nem-angol nyelvű forrás.
- **Jelenlegi döntés:** Az 5. (legutóbbi, "végleges induló termékirány") üzenetet tekintjük irányadónak, mint a korábbi, részleges specifikáció felülírását — ez összhangban van azzal, hogy az 5. üzenet explicit "végleges" jelzőt használ.
- **Bizonyíték:** A két üzenet szó szerinti szövege (lásd session-history).
- **Nyitott kockázat:** Ha a Reuters Sport / AP Sports kimaradása véletlen (nem szándékos) volt a felhasználó részéről, ez a döntés tévesen zárná ki ezt a két hírügynökséget, amelyek valószínűleg magas megbízhatóságú (`reliabilityTier=A`) forrás lennének.
- **Következő teendő:** Nincs — lásd döntés.
- **Felelős/státusz:** **LEZÁRVA** — a felhasználó megerősítette: "Reuters Sport és AP Sports egyelőre ne kerüljenek vissza az induló forráscsomagba. Később külön licenc/policy audit után térünk vissza rájuk." Mindkettő dokumentálva marad, mint jövőbeli jelölt, de nem kerül bekötésre ebben és a következő sprintben sem.

## 7. Képjogi és attribution adatmodell — csak oszlop, nincs szabálymotor

- **Kérdés:** A `sources.imagePolicy` (jsonb) oszlop és a leendő kép-entitás tábla milyen konkrét mezőket/szabályokat tartalmazzon (eredeti URL, szerző, jogosult, licenc, kötelező attribution, lejárat, alt text)?
- **Jelenlegi döntés:** Ebben a sprintben csak a `sources.imagePolicy` jsonb oszlop és a forrásonkénti policy-leírás (docs/source-registry.md) készült el — **önálló `images`/`story_images` tábla, konkrét licenc-workflow (Wikimedia Commons API-integráció, klubcímer-fallback-grafika) még nincs megírva.**
- **Bizonyíték:** `packages/db/src/schema/sources.ts` — `imagePolicy: jsonb("image_policy")`, nincs önálló kép-tábla a schema mappában.
- **Nyitott kockázat:** A 20-Story bizonyító riport (fő sprint-lista 10. tétele) elvárja, hogy minden Story-nál látszódjon "a kép forrása és licence" — ez jelenleg NEM teljesíthető, mert nincs kép-adatmodell.
- **Következő teendő:** Önálló sprint: `images` tábla (eredeti URL, szerző, jogosult, licenc típus, attribution szöveg, lejárat, alt text, forrásmegjelölés a UI-on) + Wikimedia Commons API-adapter + klubcímer/stadion fallback-grafika-készlet.
- **Felelős/státusz:** **NYITVA, nem megkezdett** — ez a fő sprint-lista egyik legnagyobb hiányzó eleme.

## 8. Többforrásos állítás-összevonás, hitelességi motor, admin szerkeszthetőség, 20-Story riport

- **Kérdés:** Elkészült-e ebben a sprintben a claim-merging engine, a credibility scoring engine, az admin UI szerkeszthetőség, és a 20 valós Story bizonyító riport?
- **Jelenlegi döntés:** **NEM** — ezek a fő sprint-lista legnagyobb, önálló architektúrát igénylő tételei (6., 7., 9., 10. pont), amiket ez a sprint tudatosan NEM próbált meg felületesen, ellenőrizetlenül leszállítani. Ehelyett ez a sprint a **alapozó, verifikálható rétegre** koncentrált: Source Registry schema + dokumentáció + a BBC Sport referencia-extractor.
- **Bizonyíték:** Nincs `claim`/`credibility-score`/story-source admin-szerkesztő kód ebben a commitban — ellenőrizhető a diff-ben.
- **Nyitott kockázat:** A felhasználó explicit "ne tekintsd késznek, amíg a 20 Storynál nem látható..." kritériuma ebben a sprintben nyilvánvalóan nem teljesül — ezt a záró státuszriportban nyíltan közölni kell, nem elhallgatni.
- **Következő teendő:** Minden egyes tétel (claim-merging, credibility engine, admin UI, 20-Story riport) saját, önálló sprint — javasolt sorrend a státuszriportban.
- **Felelős/státusz:** **NYITVA, több különálló jövőbeli sprint.**

## 9. FORCE_REVIEW_MODE és automatikus publikálás

- **Kérdés:** Bekapcsolható-e az automatikus publikálás ennek a sprintnek bármely pontján?
- **Jelenlegi döntés:** **NEM** — `FORCE_REVIEW_MODE=true` változatlanul érvényben marad, ahogy a felhasználó explicit megismételte a legutóbbi üzenetben is ("Tartsd a FORCE_REVIEW_MODE=true beállítást. Ne kapcsolj be automatikus publikálást.").
- **Bizonyíték:** Nincs kód-módosítás ebben a sprintben, ami ezt a flaget vagy a publish-gate logikát érintené.
- **Nyitott kockázat:** Nincs — ez egy stabil, változatlan korlát.
- **Következő teendő:** Nincs, amíg a felhasználó másképp nem dönt.
- **Felelős/státusz:** Lezárva, stabil szabály.

## 10. Paywall-kezelés (Gazzetta dello Sport, L'Équipe)

- **Kérdés:** Hogyan viselkedjen az extractor, ha a cikk paywall mögött van?
- **Jelenlegi döntés:** Tervezett viselkedés dokumentálva (docs/source-registry.md 6. pont: essen vissza `discovery_only`-ra), de **nincs ténylegesen megírt paywall-detektáló logika egyik extractorban sem** (ez a két forrás egyelőre nincs is bekötve).
- **Bizonyíték:** Nincs `paywall` kulcsszó a kódban ezen a sprinten.
- **Nyitott kockázat:** Ha a jövőbeli Gazzetta/L'Équipe extractor véletlenül a paywall-oldal "előnézeti" HTML-jét (pl. az első bekezdést) próbálná teljes cikként kezelni, az félrevezető, hiányos tartalmat eredményezne — ez pontosan az a hiba, amit a Source Fetcher réteg orvosolni próbál az RSS-snippetnél.
- **Következő teendő:** Amikor ezen forrás(ok) extractora megíródik, explicit paywall-jel-ellenőrzést kell beépíteni (pl. ismert paywall-CSS-osztály vagy "előfizetői tartalom" szöveg-minta), ami `null`-t ad vissza (biztonságos fallback), ha paywallt észlel.
- **Felelős/státusz:** Nyitva, jövőbeli sprint feladata.

## 11. Sky Sports bekötése kivételként — a többforrásos motor élő bizonyítása

- **Kérdés:** A "többforrásos állítás-összevonás + hitelességi motor" sprint bizonyító bárja legalább 10 valós Storyt kér, ahol "legalább két forrás, amikor elérhető" látszik — de ebben a sprintben induláskor csak a BBC Sport volt bekötve, tehát valós adatban sosem lett volna két KÜLÖNBÖZŐ forrásból (outlet) származó Story, csak két cikk ugyanattól a BBC-től. Hogyan bizonyítsuk a többforrásos összevonást/ellentmondás-kezelést valós adaton, ha a felhasználó explicit tiltja új médiapartnerek hozzáadását, amíg a motor nincs bizonyítva?
- **Jelenlegi döntés:** A felhasználó feloldotta ezt explicit kivétellel: "Válasszuk a Sky Sports bekötését kivételként... Ebben a sprintben engedélyezem a BBC + Sky Sports párost. Ne bővíts tovább új forrásokkal." A Sky Sports (már dokumentálva a forráscsomagban) kapott egy második, valódi `ArticleExtractor`-t (`sky-sports.ts`) és aktív `sources` sort — ez az EGYETLEN kivétel, minden más dokumentált-de-nem-bekötött forrás (Guardian, ESPN, Marca stb.) változatlanul `is_active=false` marad.
- **Bizonyíték:** `packages/agents/src/source-ingest/article-fetcher/extractors/sky-sports.ts` + tesztek; `packages/db/src/seed.ts` Sky Sports `upsertSource` hívása `isActive: true`-val; `.github/workflows/sky-sports-extractor-diagnostic.yml` a BBC-mintát követi az élő bizonyításhoz.
- **Nyitott kockázat:** A Sky Sports szelektorai (mint a BBC-é is) nem lettek élőben ellenőrizve a sandbox hálózati korlátja miatt — a diagnosztikai workflow futtatása még nem történt meg (GitHub Actions runneren kell kézzel elindítani).
- **Következő teendő:** A `Sky Sports extractor diagnostic (one-off)` workflow lefuttatása a PR merge-je után egy valódi Sky Sports cikken.
- **Felelős/státusz:** Lezárva (döntés), a diagnosztikai futtatás még nyitva.

## 12. Ingest pipeline: szinkron HTTP-timeout mint architekturális korlát → aszinkron job-motor

- **Kérdés:** A bizonyító riport előkészítése közben (2026-07-28/29) kiderült: éles production adatban NULLA valódi BBC+Sky kétforrásos Story létezik. Miért, és mi a végleges megoldás?
- **Jelenlegi döntés:** Két összefüggő, valós hiba azonosítva és a második részben javítva: (1) a Sky Sports forrás sosem kapott esélyt, mert a BBC mindig elsőként futott, és minden korábbi ingest-futás időtúllépéssel halt meg még a BBC feldolgozása közben — javítva forrás-rotációval (`source-repository.ts` `listActive()` `last_fetched_at ASC NULLS FIRST`); (2) még EGYETLEN cikk teljes szinkron pipeline-lánca (dedup → story-merge → fact-verification → Hungarian Writer → Editorial Rewrite → SEO → publish-gate, mind egy HTTP-kérésben) is túllépi a Vercel-timeoutot — ez egy valódi architekturális korlát, NEM oldható meg a cikk-limit további csökkentésével (már 1-en van, a gyakorlati minimumon). A felhasználó explicit döntése: az Editorial Rewrite Agent NEM kerül ki a pipeline-ból, és a végleges megoldás a pipeline teljes aszinkronizálása (Postgres-alapú `pipeline_jobs` job-queue, szakaszonként külön, retry/resume-képes job), NEM a platform limitjéhez való további igazodás. Rövid távú stabilizálásként a `dispatch-ingest` route `maxDuration`-je 60→300mp-re emelve (Vercel Fluid Compute — 2025 áprilisa óta minden ÚJ projekten alapértelmezett, ez a projekt 2026-07-27-én jött létre, Hobby csomagon így 300mp engedélyezett) — ez KIFEJEZETTEN ideiglenes, nem helyettesíti az aszinkron átépítést.
- **Bizonyíték:** Két valódi, egymást követő HTTP 504 (`FUNCTION_INVOCATION_TIMEOUT`) production-smoke.yml futásban (2026-07-29 00:15 és 04:58 UTC), mindkettő pontosan ~60,1-60,2mp-nél; a `credibility-proof-report` végpont valós lekérdezése megerősítette: `articleCountBySourceName: {"BBC Sport - Football": 86}`, Sky Sports 0 (a rotációs javítás előtt).
- **Nyitott kockázat:** ~~A `maxDuration=300` bump-ot még nem erősítette meg egy sikeres, valós ingest-futás~~ **MEGERŐSÍTVE, NEGATÍV EREDMÉNNYEL (2026-07-29 05:29 UTC):** a `production-smoke.yml` valós futása után a `dispatch-ingest` hívás PONTOSAN ~60,18 másodpercnél kapott HTTP 504-et (`FUNCTION_INVOCATION_TIMEOUT`) — NEM 300 másodpercnél. Ez azt jelenti, hogy a Vercel Fluid Compute NINCS ténylegesen aktiválva ezen a projekten: a platform csendben visszavágta a ténylegesen érvényesített limitet 60mp-re a kódban beállított `maxDuration=300` ellenére (nem build-hibát adott, egyszerűen figyelmen kívül hagyta). A dashboard-beállítás emberi beavatkozást igényelne, de mivel az aszinkron job-motor (Part B) ETTŐL FÜGGETLENÜL is a helyes, végleges megoldás (egyetlen 300mp-es ablak sem lenne elég egy nagyobb backlöghöz), ez a rövid távú stopgap véglegesen el lett vetve — nincs további kísérlet rajta.
- **Következő teendő:** ~~A job-alapú pipeline megépítése~~ **KÉSZ ÉS ÉLESBEN BIZONYÍTVA (2026-07-29 06:00-06:19 UTC):** `pipeline_jobs` tábla+repo (PR #45, merge-elve), queueing dispatcher+worker route+ingest átkötés (PR #46, merge-elve), majd a `scheduled-pipeline.yml` workflow egy valós hibáján (worker-hívás időtúllépése hamis job-failure-t okozott) javítás (PR #47, merge-elve). Két kézi `workflow_dispatch` futás valós productionben: 1. futás — ingest 20+4 új cikket sorolt be gyorsan (nem szinkron LLM-munka többé), worker 34 jobot dolgozott fel sikeresen, 0 hibával, majd a 2. worker-hívás a megerősített ~60,18mp-es valós plafonba ütközött (kliens-oldali curl timeout) — ez NEM Story-vesztés, csak a hívás lezárása, a job állapota Postgres-ben megmaradt. 2. futás (a PR #47 javítás után) — 10 worker-hívás mind HTTP 200-at adott, összesen 15 jobot dolgozott fel sikeresen, 0 hibával, 0 dead-letterrel, és a korábbi hamis "failure" megszűnt. Összesen: **49 pipeline-job sikeresen feldolgozva élesben, 0 hiba, 0 dead-letter** az aszinkron motoron keresztül. Egyetlen job átlagosan ~20-40mp (valódi LLM-hívások szakaszonként), ezért egy nagyobb backlog több 5-perces cron-ciklus alatt ürül ki fokozatosan — ez a várt, tervezett viselkedés, nem hiba. A `scheduled-pipeline.yml` mostantól 5 percenként fut automatikusan a `main`-en, tehát a valós BBC+Sky ingest folyamatosan halad háttérben. **Következő lépés:** a bizonyító riport (`credibility-proof-report.yml`) tényleges lefuttatása a felgyülemlett valós adaton, őszinte tényleges Story-számokkal (lehet, hogy még kevés vagy nulla valódi kétforrásos Story áll rendelkezésre ezen a ponton — ez elfogadható, a felhasználó explicit kérése szerint nem szabad az 5-darabos célt rossz összevonásokkal erőltetni).
- **Felelős/státusz:** Döntés lezárva, implementáció KÉSZ és élesben bizonyítva. A rövid távú stopgap kísérlet lezárva, negatív eredménnyel; az aszinkron job-motor él, működik, retry/resume bizonyítva valós hibán (lásd az E2E-tesztek), és a hamis workflow-failure is javítva. Hátralévő: a bizonyító riport tényleges lefuttatása és a kétforrásos Story-k tényleges tálalása (36-37. feladat).

---

## Összegzés — mi vár még felhasználói döntésre

A fenti tételek közül kettő **ténylegesen blokkoló, felhasználói választ igénylő kérdés**:
- **6. tétel:** Reuters Sport / AP Sports szándékosan maradt-e ki az új médialistából?
- **4. tétel:** Elfogadható-e a kétlépéses (módszertan most, élő audit később) megközelítés a 96 klub dokumentálásához, vagy kézi kutatást vár el a felhasználó már most?

Minden más tétel nyitott, de nem blokkoló — a session folytatódhat ezek megválaszolása nélkül is.

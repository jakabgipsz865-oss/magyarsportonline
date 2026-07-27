# Megvalósíthatósági elemzés — magyarsportonline.hu AI-alapú sporthír-platform

**Verzió:** 1.0
**Dátum:** 2026-07-27
**Cél:** Teljesen automatizált, emberi beavatkozás nélkül (vagy minimális emberi felügyelettel) működő AI-alapú sporthír-platform megvalósíthatóságának vizsgálata, kezdetben egyetlen angol nyelvű forrásból, később több száz forrásra skálázva.

---

## 0. Vezetői összefoglaló

A leírt rendszer **nagyrészt (85-95%-ban) automatizálható**, de **teljesen 100%-os, örökös emberi beavatkozás nélküli üzemeltetés jogilag és üzemeltetésileg nem javasolt**. A technikai lépések (gyűjtés, dedup, AI-összefoglalás, SEO, publikálás, közösségi média) mind megoldhatók kód + AI agent kombinációval. A valódi kockázat nem technikai, hanem **jogi (szerzői jog, hírmonopólium-jogok, sajtójog, MTI-szabályozás)** és **hitelességi (téves/hallucinált tartalom, forrás félreértelmezése)** téren jelentkezik.

**Javasolt modell:** "Automatizált mag + emberi vészfék" (human-in-the-loop by exception, nem by default). A rendszer önállóan fut, de:
- van egy automatikus **bizalmi pontszám / risk gate**, ami a kockázatos eseteket (ellentmondó források, sérülésről/halálesetről szóló hír, jogi/doppingügy, nagy horderejű állítás) emberi jóváhagyásra teszi félre,
- van egy **napi audit log és riasztási csatorna** (Slack/e-mail), amivel egy ember gyorsan tud reagálni hibára,
- a rendszer **kill-switch**-csel rendelkezik.

Ez nem "kevésbé automatizált" megoldás — a hírek 95%+-a így is teljesen emberi kéz nélkül megy ki –, hanem kockázatkezelés, ami a domain (hírmédia, közzététel, sajtófelelősség) miatt elengedhetetlen.

---

## 1. Sporthírek automatikus begyűjtése

### Kezdeti fázis: egyetlen angol nyelvű forrás

**100%-ban automatizálható.** Egyetlen forrás (pl. egy RSS-feedet vagy API-t biztosító sportportál, mint a BBC Sport, ESPN, Sky Sports, PA Media/Reuters sport) esetén a begyűjtés klasszikus, jól bejáratott mérnöki feladat:

- **RSS/Atom feed polling** cron alapon (pl. 5-10 percenként), vagy
- **API-alapú lekérdezés**, ha a forrás kínál strukturált API-t (pl. sportadat-szolgáltatók: Sportradar, Opta, API-Football, TheSportsDB), vagy
- **Webscraping** utolsó megoldásként, ha nincs feed/API — ez a legkockázatosabb és legkevésbé stabil módszer.

**Technikai akadályok:** feed-formátum változása, rate limit, IP-tiltás scraping esetén, tartalom mögötti JS-rendering (headless browser szükséges lehet).

**Jogi akadályok:** Fontos különbséget tenni **RSS-feed/API-alapú, a forrás által szándékoltan megosztott adat** és **engedély nélküli scraping** között. Az EU-s és magyar szerzői jogi szabályozás (2013-as és 2019-es EU sajtókiadói szomszédos jogi irányelv, ún. "link tax"/upload filter szabályozás, valamint a magyar Szjt.) alapján:
- Egy cím + rövid kivonat (snippet) + forrás-link **jellemzően megengedett** a "fair dealing"/idézési jog vagy a hírmonopólium-mentes tényközlés elve alapján, DE ez forrásonként, joghatóságonként eltér.
- **A teljes cikk lemásolása vagy közvetlen (nem-transzformatív) fordítása szerzői jogsértés**, még akkor is, ha forrást megjelölsz.
- Sportadatok (eredmények, statisztikák) önmagukban **nem védettek szerzői joggal** (tények nem védhetők), de az adatbázis-jog (sui generis) védheti az adatbázist, amiből származnak (pl. hivatalos liga-adatbázisok).

**Javaslat:** Kezdésként válassz **API-t vagy hivatalos RSS-t biztosító, engedélyezett használatú forrást** (pl. sportradar-szerű strukturált adat, vagy olyan hírportál, amelynek van publikus feedje kifejezetten aggregációs célra, vagy fizetős hírügynökségi előfizetés — pl. Reuters/PA Media licenc). Ne scrape-elj olyan oldalt, aminek ToS-e ezt kifejezetten tiltja. **Emberi beavatkozás:** csak a forrás kiválasztásánál és a licencszerződés megkötésénél szükséges — ez nem automatizálható (jogi döntés), de egyszeri, nem ismétlődő feladat forrásonként.

### Skálázás több száz forrásra

Technikailag ez **jól skálázható** (feed-aggregátor architektúra, pl. queue-alapú fetch worker-ek), de:
- **Duplikáció és zaj exponenciálisan nő** — ez erősebb dedup és klaszterezés logikát igényel (lásd 2. pont).
- **Forrásminőség-ellenőrzés** szükséges: minden új forrás felvételekor validálni kell a megbízhatóságot (pl. van-e history téves hírekre, retrakciókra).
- **Jogi átvilágítás forrásonként** — 300 forrás esetén ez nem elvégezhető emberi kézzel egyenként hagyományos módon, ezért **forrás-kategóriánkénti szabálykészletet** érdemes kialakítani (pl. "hivatalos liga/klub közlemény → szabadon felhasználható tényközlésként", "fizetős hírügynökség API → licenc szerint", "kisebb blog → csak link+snippet, sosem összefoglaló újraírás engedély nélkül").

**Javasolt megoldás:** Forrás-onboarding folyamat, ami **fél-automatizált**: egy AI agent felméri az új forrás robots.txt-jét, ToS-ét, feed-elérhetőségét, és **javaslatot** tesz (engedélyezhető / tiltandó / emberi felülvizsgálat szükséges), de a végső "engedélyezem ezt a forrást" döntést kezdetben ember hozza. Idővel, bevált mintázatok alapján, ez is automatizálható alacsony kockázatú kategóriákra (pl. hivatalos klub-RSS-ek).

---

## 2. Duplikált hírek felismerése és kezelése

**100%-ban automatizálható**, jó technikai megoldásokkal, bár tökéletes pontosság nem garantálható (ez elfogadható kockázat).

**Módszerek, növekvő komplexitás szerint:**
1. **URL/canonical-alapú dedup** — triviális, azonos forrás ismételt lekérése ellen.
2. **Fuzzy string matching** (pl. cím + lead hasonlóság, SimHash/MinHash, Levenshtein) — gyors, olcsó, jó első szűrő.
3. **Embedding-alapú szemantikai hasonlóság** (pl. OpenAI/Anthropic vagy nyílt embedding modell + vektor-adatbázis, pgvector Postgres-ben) — felismeri, ha két forrás ugyanarról az eseményről ír más szavakkal.
4. **Entitás- és esemény-kinyerés** (NER: csapatnevek, játékosnevek, dátum, verseny) — klaszterezéshez: "ugyanaz a mérkőzés/esemény/transzfer-e".

**Kezelési logika:**
- Ha egy új cikk egy már létező "story cluster"-hez tartozik → **nem új hír, hanem frissítés** (lásd 6. pont).
- Ha több forrás ír ugyanarról az eseményről egy időben → **story cluster** jön létre, és az AI-összefoglaló ezt a klasztert dolgozza fel, nem egyetlen cikket (ez egyben minőségjavulást is hoz: kereszt-validáció).

**Akadályok:** Álnegatívok (nem ismeri fel, hogy ugyanaz a hír) → duplikált publikáció, ami SEO-büntetést (duplicate content) és hitelességi problémát okozhat. Álpozitívok (két különböző hírt összevon) → információvesztés.

**Javaslat:** Pgvector + embedding hasonlóság küszöbérték-alapú klaszterezéssel, entitás-kinyeréssel kombinálva. **Nincs szükség emberi beavatkozásra** normál esetben; a küszöbértékek finomhangolása mérnöki feladat, nem szerkesztői.

---

## 3. AI-alapú magyar nyelvű, saját megfogalmazású összefoglaló

Ez a **legkritikusabb és legkockázatosabb lépés**, technikailag megoldható, de gondos tervezést igényel.

### Megvalósíthatóság

**100%-ban automatizálható a generálás**, de a **minőség- és hitelesség-biztosítás nem hagyható 100%-ig automatizált módon felügyelet nélkül**, legalábbis nem a jelenlegi LLM-technológia mellett. Miért:

- **Hallucináció kockázata**: LLM-ek időnként kitalált részleteket (téves eredmény, rossz név, nem létező idézet) generálnak. Sporthírben egy téves végeredmény vagy sérülési infó komoly hitelességi kárt okoz.
- **"Nem fordítás, hanem eredeti összefoglaló"** jogi szempontból **előny**: egy megfelelően transzformatív, tényalapú összefoglaló (amely nem az eredeti szöveg szerkezetét/mondatait követi, hanem a tényeket önállóan rendezi újra) jogilag sokkal biztonságosabb, mint egy fordítás, mert **a tények maguk nem védettek szerzői joggal**, csak a forrás konkrét megfogalmazása. Ez egy fontos tervezési elv, amit a prompt-architektúrába be kell építeni: az AI-nak **strukturált tényeket** (ki, mit, mikor, hol, eredmény, idézetek forrásmegjelöléssel) kell kinyernie a forrásból, majd ebből **magyarul, önálló mondatszerkezettel** kell újraírnia — sosem mondatról mondatra fordítania.
- **Idézetek kezelése speciális eset**: ha a forrás egy játékos/edző szó szerinti idézetét tartalmazza, annak magyar fordítása **fordításnak minősül** (ami megengedett rövid idézet esetén, forrás megjelöléssel, idézőjelben), de nem szabad az AI-nak új, ki nem mondott idézetet "generálnia" vagy parafrazált idézetet szó szerinti idézetként feltüntetnie.

### Technikai megoldás

Kétlépcsős AI pipeline:
1. **Extrakciós lépés**: strukturált JSON kinyerése a forrás(ok)ból (tények, számok, idézetek, dátumok, entitások) — alacsony hőmérsékletű, function-calling/structured-output módú LLM hívás.
2. **Generációs lépés**: a strukturált tényekből magyar nyelvű, szerkesztői stílusú cikk generálása, explicit instrukcióval a hallucináció elkerülésére ("csak a megadott tényeket használd, ne tegyél hozzá semmit").
3. **Validációs lépés (AI-alapú, de automatizált)**: egy második LLM-hívás vagy szabályalapú ellenőrzés, ami visszaveti a generált szöveget a forrás-tényekre (fact-consistency check / NLI-alapú "entailment" ellenőrzés) — ha a cikk olyan állítást tartalmaz, ami nincs alátámasztva a forrásban, **automatikusan elutasítja vagy emberi review-ra küldi**.

### Emberi beavatkozás szükségessége

- **Rutin, alacsony kockázatú hírek** (eredmény, meccs-összefoglaló, transzfer hivatalos bejelentés alapján): **teljesen automatizálható**, validációs lépéssel biztosítva.
- **Magas kockázatú kategóriák** (sérülés súlyossága, haláleset, doppingvád, jogi ügy, még nem hivatalos transzferpletyka, ellentmondó források): javasolt **automatikus risk-scoring**, ami ezeket egy review-queue-ba teszi, és vagy (a) emberi jóváhagyásig nem publikálódik, vagy (b) publikálódik "megerősítésre vár" jelöléssel, majd emberi audit követi utólag.

### Alternatívák
- **Csak sablon-alapú generálás** (nem LLM, hanem struktúra + adatbetöltés) — biztonságosabb, de nem ad "saját megfogalmazású" érzést, gyenge olvasói élmény, nem skálázható tetszőleges forrásra.
- **Teljesen felügyelet nélküli LLM generálás azonnali publikálással** — leggyorsabb, de jogi/hitelességi kockázata elfogadhatatlanul magas hír-domainben.
- **Javasolt: hibrid** — extrakció + generálás + automatikus fact-check + risk-alapú review gate. Ez adja a legjobb egyensúlyt sebesség és biztonság között.

---

## 4. Forrás automatikus feltüntetése és hivatkozása

**100%-ban automatizálható**, alacsony kockázat.

- Minden generált cikkhez a rendszer automatikusan csatolja: eredeti forrás neve, link, publikálás időpontja, és — több forrásos story cluster esetén — az összes hozzájáruló forrás.
- Ez technikailag egyszerű (metaadat a pipeline-ban végig követi a cikket), és **jogi szempontból is elvárás/védelem**: a forrásmegjelölés csökkenti a szerzői jogi és sajtóetikai kockázatot, és megfelel a magyar sajtószabályozás (Smtv.) forrásmegjelölési gyakorlatának.
- Javasolt UI-elem: "Forrás: [Név], [link]" doboz minden cikk alján/tetején, strukturált adatként (schema.org `Article` + `citation`/`isBasedOn`), ami SEO szempontból is előnyös.

**Emberi beavatkozás nem szükséges.**

---

## 5. A hír automatikus publikálása a weboldalon

**100%-ban automatizálható**, ha a fenti validációs kapuk (dedup, fact-check, risk-score) átmentek.

- CMS-szerű adatbázis-modell (cikk, forrás, kategória, tag, story-cluster tábla) + publikálási API végpont.
- **Publikálási munkafolyamat**: draft → automatikus validáció → (ha risk-score alacsony) auto-publish, → (ha magas) queue emberi review-ra.
- **Kockázat**: hibás/hamis hír élesben megy ki. Ez a legnagyobb üzemeltetési/reputációs kockázat egy hírportálnál. Ezért javasolt egy **"soft launch" / staggered rollout** stratégia: kezdetben minden cikk emberi jóváhagyással megy ki (1-2 hét), a rendszer pontosságának megfigyelésével, majd fokozatosan bővítve az automatikus publikálás körét a bizonyított kategóriákra.

**Alternatíva:** teljesen instant auto-publish már az első naptól — technikailag lehetséges, de üzemeltetési szempontból nem javasolt, amíg nincs mért adat a rendszer hibaarányáról.

---

## 6. Ugyanazon hír folyamatos frissítése

**Megvalósítható, de architekturálisan az egyik legösszetettebb rész.**

- A story-cluster modell (lásd 2. pont) teszi lehetővé: amikor egy új forrás vagy új infó érkezik egy már publikált cikk témájához, a rendszer:
  1. Felismeri, hogy ugyanahhoz a klaszterhez tartozik.
  2. Az AI újragenerálja/kiegészíti az összefoglalót az új tényekkel (nem ír teljesen újat, hanem "diff"-alapú frissítést végez: mi változott).
  3. A publikált cikk frissül, **"Frissítve: [időpont]"** jelöléssel és — ideális esetben — egy rövid changelog-szerű jelöléssel ("Frissítés: megerősítést nyert a sérülés súlyossága").
- **SEO szempont**: a `slug` és URL **nem változhat** frissítéskor (a régi linkek ne törjenek), csak a tartalom és a `dateModified` schema.org mező.
- **Jogi szempont**: sajtóetikai és Smtv. szempontból ajánlott/elvárt a helyesbítés/frissítés átláthatósága — ez erősíti, nem gyengíti a megfelelést.

**Emberi beavatkozás**: alacsony kockázatú frissítéseknél (pl. végeredmény pontosítása) nem szükséges. **Magas horderejű frissítéseknél** (pl. korábbi hír visszavonása, jelentős ténybeli módosítás) javasolt automatikus jelölés + gyors emberi audit, mert ezek reputációs szempontból érzékenyek.

---

## 7. SEO-optimalizált cím, slug, meta leírás, címkék, kategóriák

**100%-ban automatizálható**, ez az egyik legkevésbé kockázatos, legjobban bejáratott LLM-alkalmazási terület.

- **Cím**: LLM generálja, szabályokkal (max karakterszám, kulcsszó az elején, no clickbait-tiltás sajtóetikai megfelelés miatt).
- **Slug**: cím alapján determinisztikus szabály (ékezet-eltávolítás, kisbetűsítés, kötőjelezés) + ütközés-ellenőrzés adatbázisban.
- **Meta description**: LLM generálja, karakterlimit betartásával (150-160 karakter).
- **Címkék/kategóriák**: entitás-kinyerés (csapat, sportág, verseny, játékos) alapján automatikus taxonómia-hozzárendelés, előre definiált kategóriafa alapján (pl. "Labdarúgás > NB I > Ferencváros").
- **Strukturált adat (schema.org NewsArticle/SportsEvent)**: automatikusan generálható a kinyert entitásokból.

**Emberi beavatkozás nem szükséges** rutin esetben; a kategóriafa/taxonómia **kezdeti kialakítása** emberi/szerkesztői döntés (egyszeri feladat).

---

## 8. Közösségi média automatikus kiszolgálása (Facebook, X, Threads, stb.)

**Technikailag jól megvalósítható, de platform-specifikus akadályokkal.**

- Minden platformnak van hivatalos API-ja (Meta Graph API Facebook/Threads-hez, X API), amivel automatikus posztolás megoldható.
- **Technikai akadályok:**
  - X API díjszabása és rate limitjei jelentősen korlátozzák a magas frekvenciájú automatapostolást (érdemes API-tier tervezést végezni).
  - Meta App Review folyamat szükséges a Facebook/Threads posztoláshoz (fejlesztői app jóváhagyás, ez egyszeri, néhány hetes adminisztratív folyamat).
  - Platformok időnként változtatják API-jukat/szabályaikat — üzemeltetési karbantartást igényel.
- **Tartalmi szempont:** a közösségi poszt szövegét (rövidebb, platform-specifikus hangvétel, hashtag-ek) érdemes külön AI-generálási lépésként kezelni, nem csak a cikk címét/leadjét másolni be.
- **Kockázat:** automatikus posztolás hibás/visszavont hírről nehezebben javítható (a közösségi platformokon a törlés/szerkesztés nem mindig lehetséges vagy nem tűnik el azonnal a megosztásokból). Ezért javasolt: **a közösségi posztolás csak a risk-gate-en már átment, publikált cikkekhez kapcsolódjon**, sosem előzze meg a weboldalas publikálást.

**Javaslat:** Fázisolt bevezetés — először a weboldal stabil, majd utána kapcsolódjon rá a közösségi-media modul, queue-alapú, retry-logikával, platformonkénti rate-limit kezeléssel.

---

## 9. Átfogó jogi és etikai kockázatelemzés

| Terület | Kockázat | Kezelés |
|---|---|---|
| Szerzői jog (cikk-átvétel) | Magas, ha szó szerinti/majdnem szó szerinti átvétel történik | Transzformatív, tényalapú összefoglaló + forrásmegjelölés + rövid idézet-korlátozás |
| Sajtójogi felelősség (Smtv., Ptk. jóhírnév) | Közepes-magas hibás/rágalmazó tartalom esetén | Risk-gate + gyors korrekciós mechanizmus + impresszum/felelős szerkesztő feltüntetése |
| MTI/hírügynökségi tartalom védelme | Magas, ha MTI-hírt dolgoz fel engedély nélkül | Csak licencelt/engedélyezett forrásokat használni |
| Adatbázis-jog (sportstatisztikák) | Közepes, hivatalos liga-adatoknál | Hivatalos API/licenc használata statisztikai adatokhoz |
| GDPR (személyes adatok, pl. játékos egészségi állapota) | Alacsony-közepes | Nyilvánosan közölt tényekre szorítkozás, nem spekuláció |
| AI-tartalom jelölési kötelezettség (EU AI Act, 2026-tól élesedő rendelkezések) | Közepes, jogszabály-függő | Transzparens jelölés, hogy a cikk AI-asszisztált |
| Impresszum / felelős kiadó megjelölése | Kötelező magyar jog szerint | Weboldalon impresszum, felelős szerkesztő/üzemeltető feltüntetése — **ez emberi/jogi entitás, nem automatizálható** |

**Fontos:** magyar médiaszolgáltatásra vonatkozó jogszabályok (2010. évi CIV. törvény a sajtószabadságról) alapján egy hírportálnak **kell legyen felelős szerkesztője és impresszuma** — ez nem technikai, hanem jogi-formai követelmény, és nem "automatizálható el". Ez nem jelenti azt, hogy minden cikket kézzel kell jóváhagyni, de **jogi felelősség mindig egy azonosítható természetes/jogi személynél kell, hogy legyen**.

---

## 10. Ajánlott architektúra

```
┌──────────────────────────────────────────────────────────────────────┐
│                         FORRÁS RÉTEG                                  │
│  RSS / API / (engedélyezett) scraper workerek — forrásonként          │
│  Cron (Vercel Cron / GitHub Actions schedule) → Ingest Queue          │
└───────────────────────────┬────────────────────────────────────────────┘
                             ▼
┌──────────────────────────────────────────────────────────────────────┐
│                    INGEST & NORMALIZÁLÁS                              │
│  Next.js API route / Edge function → nyers cikk mentése Postgres-be   │
│  (raw_articles tábla), metaadat: forrás, url, timestamp, nyelv        │
└───────────────────────────┬────────────────────────────────────────────┘
                             ▼
┌──────────────────────────────────────────────────────────────────────┐
│              DEDUPLIKÁCIÓ & KLASZTEREZÉS AGENT                        │
│  Embedding generálás → pgvector hasonlóság-keresés →                  │
│  story_clusters tábla (új cluster vagy meglévőhöz csatolás)           │
└───────────────────────────┬────────────────────────────────────────────┘
                             ▼
┌──────────────────────────────────────────────────────────────────────┐
│         AI SZERKESZTŐ AGENT (Claude-alapú, orchestrált)               │
│  1. Extrakció (strukturált tények, JSON schema)                       │
│  2. Magyar nyelvű generálás (cím, lead, törzs, tag-ek, kategória)     │
│  3. Fact-consistency validáció (entailment / önellenőrzés)            │
│  4. Risk-scoring (kockázati kategória: alacsony/közepes/magas)        │
└───────────────────────────┬────────────────────────────────────────────┘
                             ▼
                 ┌───────────┴────────────┐
                 ▼                        ▼
     ┌───────────────────┐    ┌────────────────────────┐
     │  ALACSONY KOCKÁZAT │    │   MAGAS KOCKÁZAT        │
     │  Auto-publish       │    │   Review Queue          │
     │  (queue worker)     │    │   (Slack/Admin UI       │
     │                      │    │   emberi jóváhagyás)    │
     └──────────┬──────────┘    └───────────┬─────────────┘
                 ▼                            ▼
┌──────────────────────────────────────────────────────────────────────┐
│                    PUBLIKÁCIÓS RÉTEG                                  │
│  Next.js (App Router, SSR/ISR) + Postgres (articles tábla)            │
│  SEO: schema.org NewsArticle, sitemap generálás, ISR revalidate       │
│  Vercel-en hostolva                                                    │
└───────────────────────────┬────────────────────────────────────────────┘
                             ▼
┌──────────────────────────────────────────────────────────────────────┐
│           KÖZÖSSÉGI MÉDIA DISZTRIBÚCIÓS AGENT                         │
│  Queue-alapú posztolás: Facebook/Threads (Meta Graph API), X API      │
│  Platform-specifikus szöveg-generálás (külön AI lépés)                │
└──────────────────────────────────────────────────────────────────────┘

           ┌─────────────────────────────────────────┐
           │      MEGFIGYELÉS & AUDIT RÉTEG            │
           │  Minden agent-lépés logolása (Postgres/    │
           │  observability tool), napi riasztás e-mail/│
           │  Slack, kill-switch env flag                │
           └─────────────────────────────────────────┘
```

### Stack-specifikus javaslatok

- **Next.js + TypeScript (Vercel)**: publikus frontend (App Router, ISR a friss tartalomhoz, statikus generálás a régi cikkekhez), Admin/Review UI a magas kockázatú cikkekhez.
- **PostgreSQL (Supabase vagy Neon)**: `raw_articles`, `sources`, `story_clusters`, `articles`, `article_sources` (many-to-many), `agent_runs`/`audit_log`, `social_posts` táblák. **Supabase javasolt**, ha kell beépített auth (admin login a review UI-hoz) és realtime (review queue élő frissítés); **Neon javasolt**, ha csak tiszta Postgres kell, szerver-less skálázással, és külön auth-megoldást (pl. NextAuth) használnál. pgvector mindkettőn elérhető a dedup/klaszterezéshez.
- **Cron/Queue**: kezdetben **Vercel Cron** elég az ingest ütemezéshez; skálázáskor (több száz forrás) érdemes valódi queue-ra váltani (pl. Supabase-ban tábla-alapú queue + worker, vagy külső: Upstash QStash/Redis, Inngest, Trigger.dev — ezek jól illeszkednek Vercel/serverless környezethez, és van beépített retry/backoff logikájuk, ami fontos API-hívásoknál).
- **AI Agentek**: Claude (Anthropic API) mint fő LLM az extrakció/generálás/validáció lépésekhez, function-calling/structured output móddal a determinisztikus JSON-kimenethez. Az orchestrációt (extrakció → generálás → validáció → risk-score) érdemes **saját, explicit kódolt pipeline-ként** megvalósítani (nem "fekete doboz" agent-keretrendszerrel), hogy minden lépés logolható, tesztelhető, és a hibapontok egyértelműen izolálhatók legyenek.
- **Claude Code + GitHub**: fejlesztői workflow — a pipeline kódját, prompt-sablonokat, risk-scoring szabályokat verziózva, PR-alapú review-val fejlesztitek, ami a *kód* minőségét biztosítja (nem a publikált tartalom emberi review-ját helyettesíti).

### Javasolt bevezetési ütemterv

1. **0. fázis (1-2 hét)**: egyetlen licencelt/engedélyezett angol forrás, teljes pipeline, **minden cikk emberi jóváhagyással** megy ki. Cél: pontosság mérése, prompt finomhangolása.
2. **1. fázis (2-4 hét)**: alacsony kockázatú kategóriák (pl. végeredmények, hivatalos közlemények) auto-publish, magas kockázatúak review-queue-ban maradnak.
3. **2. fázis**: közösségi média modul bekapcsolása, csak publikált cikkekhez kapcsolva.
4. **3. fázis**: forrásbázis bővítése tucatnyi, majd száz+ forrásra, fél-automatizált forrás-onboarding folyamattal, folyamatos hibaarány-monitorozással.

---

## 11. Összegzés — mi automatizálható 100%-ban, mi nem

**Teljesen automatizálható emberi beavatkozás nélkül (rutin esetben):**
- Forrás lekérdezés/ingest (engedélyezett forrásokból)
- Duplikáció-felismerés és klaszterezés
- AI-összefoglaló generálás alacsony kockázatú hírekhez
- Forrás-feltüntetés
- SEO-metaadat generálás
- Alacsony kockázatú cikkek publikálása
- Meglévő hírek frissítése új infó alapján (alacsony kockázatú esetben)
- Közösségi média posztolás (már publikált cikkekhez)

**Nem javasolt/nem lehetséges teljes automatizálás:**
- Új forrás jogi/licenc-alapú engedélyezése (kezdetben; később fél-automatizálható szabálykészlettel)
- Magas kockázatú tartalom (sérülés/haláleset/doppingvád/jogi ügy/meg nem erősített pletyka) publikálása
- Felelős szerkesztő/impresszum jogi szerepe (törvényi követelmény, mindig azonosítható személy/entitás kell)
- Súlyos hiba utáni helyesbítési döntés (kiadható-e helyesbítés, hogyan)

Ez a modell — **automatizált mag, kivétel-alapú emberi felügyelet** — adja a leggyorsabb, leginkább skálázható megoldást, miközben a hírmédia-domain jogi és hitelességi kockázatait kezelhető szinten tartja.

# MSO Preview — bérletügy, rekordhír és 10 további cross-source esemény

Run `90e55b13-ba8c-4197-af78-35a2ed84e8f8` · 2026-09-11T15:32:40.084Z → 2026-09-11T15:34:11.907Z

**A kért Preview-validáció PASS. Production deploy/aktiválás nem történt.**

## Root cause és javítás

Bérletügy: a két ACCEPT cím már korábban is `team:manchester-united` entitásra normalizálódott. Az eseménytípus-listából hiányzott a jegy-/bérletszankció, ezért a descriptor null lett; a sourceId/rawId fallback két külön hash-t adott. Az audit teljes, módosítás előtti két sora a riport végén szerepel.

Javítás: általános ticket-enforcement kategória; jegy/bérlet tárgy + visszavonás/eltávolítás/szankció fogalom + az érintett darabszám. A 685 nincs hardcode-olva. Klub-, forrás- és teljescím-specifikus kivétel nincs. A más klubbal, eltérő darabszámmal és puszta jegyértékesítéssel futó kontrollok is PASS.

Arsenal: bizonyítottan versenyteljesítmény/rekord, ezért REJECT. A korábbi önálló `look` divatjel az angol `look to smash` fordulatra is illeszkedett, megkerülve a matchNews ellenőrzést. A divatjel most kontextust igényel; a sportrekord/milestone/győzelmi sorozat önmagában hard REJECT. A rekordot tartó játékos kifejezett esküvői/magánéleti története továbbra is elfogadható.

A további valódi raw-párok lefedték a korábbi eseményszótár hiányait is. Általános eseménytípusok, canonical személy-/csapataliasok és megkülönböztető tárgyak kerültek be: mezreakció/alkalom/idény, egészségvallomás témája, agresszív szurkolóval konfliktus, két szereplő közti beszólás, bajnoki cím miatti szankcióigény/verseny/év, csapatprank témája, tulajdonosi ügy érintett klubja, edzői lemondás és szokatlan interjú. A címvitához csak közvetlenül kapcsolt évszám számít; korábbi munkahely évada nem. Nincs LLM vagy új adatbázisséma.

## Kontrollált RSS-ingest

| FETCHED | EXAMINED | RAW NEW | ACCEPT | REJECT | EXACT DUP | EVENT DUP MERGED |
|---:|---:|---:|---:|---:|---:|---:|
| 956 | 558 | 11 | 27 | 531 | 547 | 13 |

Az ACCEPT/REJECT az összes vizsgált RSS-előfordulást tartalmazza, exact duplikátum esetén is. A 13 event-duplicate döntés 11 külön raw cikket érintett; egyes cikkek több feedben is szerepeltek. A történeti mintán elvégzett eseménypróba külön szerepel, nincs új RSS-forgalomnak vagy új cikknek feltüntetve.

## Események — végső Preview DB-visszaolvasás

| EVENT | SOURCES | RAW ARTICLES | CANONICAL EVENT COUNT | PASS/FAIL |
|---|---:|---:|---:|---|
| Donnarumma kirablásának tárgyalása | 7 | 7 | 1 | PASS |
| Edson Álvarez emberrablási vádak | 4 | 4 | 1 | PASS |
| Sorba Thomas autóbalesete | 2 | 2 | 1 | PASS |
| Manchester United bérletszankció | 2 | 2 | 1 | PASS |
| Bayern Oktoberfest-mez szurkolói reakció | 2 | 2 | 1 | PASS |
| Gary Lineker egészség/öregedés vallomás | 2 | 2 | 1 | PASS |
| Darren Fletcher és az agresszív szurkoló | 3 | 3 | 1 | PASS |
| Carrick válasza Anderson Manchester-megjegyzésére | 2 | 2 | 1 | PASS |
| Pochettino vitatja a Chelsea 2017-es címét | 2 | 2 | 1 | PASS |
| Arteta pánik elleni csapatprankjei | 2 | 2 | 1 | PASS |
| Staveley nyilatkozata a sikertelen West Ham-ajánlatról | 2 | 2 | 1 | PASS |
| Ismail Kartal lemondása a Roma-meccs után | 2 | 2 | 1 | PASS |
| Olise szokatlan DAZN-interjúja | 4 | 4 | 1 | PASS |
| Boehly Chelsea-részesedésének eladása | 2 | 2 | 1 | PASS |

Az első négy sor a kötelező esemény; az utána következő tíz tíz külön további valós esemény, nem az eredeti három történetből kombinált párok. A forráscímek és szövegek közvetlenül a Preview raw állományból kerültek a regressziós fixture-be. Az Olise-trióhoz a DB-ben egy negyedik, SPORT BILD raw is ugyanahhoz a jelölthöz tartozik.

A tíz további eset a raw-rétegben történő eseményazonosítást bizonyítja; köztük REJECT és legacy raw is van. Ez nem ad új publikációs jogosultságot: a besorolásuk nem változott ACCEPT-re pusztán a dedup miatt, Writer queue-ba nem kerültek. A Gary Lineker-pár augusztus 31-i történeti raw; nem számít friss 48 órás RSS-tételnek. Az egyik BILD-mezraw-nál a publisher timestamp hiányzik, ott a meglévő ingestedAt volt a fallback, nem kitalált dátum.

## Regresszió és biztonság

- Gold-set: **64/64 PASS**.
- Eredeti negatív eseménykontrollok: **12/12 külön marad**.
- Horner/F1, Koné normál injury, Arsenal rekord: **3/3 REJECT**, DB decision metadata-ból is visszaolvasva.
- Célzott tesztek: **179 agent + 8 web = 187 PASS**. Typecheck és érintett fájlok lint: PASS. `git diff --check`: PASS.
- Raw-megőrzés: **895/895 (100%)**. Az eredeti source ID, cím, teljes body, source URL, image URL, nyelv, időpontok és Story-kapcsolat változása **0**. Raw összesen **895 → 906**, pontosan **11 új**.
- Eseményazonosításkor csak JSONB metaadat kerül a raw-hoz. Nem törlünk és nem egyesítünk fizikailag forráscikkeket; minden source/raw önállóan visszakereshető.
- Writer queue **0 → 0**; jobs **1403 → 1403**, teljes rekordhash változatlan.
- Stories **103 → 103**, versions **168 → 168**; mindkét teljes rekordhash változatlan. Új Story/version/Story-kapcsolat **0**.
- Egy újra látott legacy match-live raw már korábban kapcsolódott Story-hoz. A generikus `noLinkedStories=false` emiatt szerepel a futási JSON-ban; a kiinduló és záró readback bizonyítja, hogy a kapcsolat változatlan.
- Agent runs **4887 → 4887**. Gemini **0**. AUTO-PUBLISH **OFF** (`TABLOID_AUTO_PUBLISH=false`), aktív source rekordok **0 → 0**.
- Corporate cron **OFF**, az ellenőrzött céges Worker Settingsben „No cron triggers configured”. Régi Worker nem módosult.
- Production DB-kapcsolat/írás/migráció **0**. Production deploy **0**. Csak a hard-asserttel ellenőrzött Preview host szerepelt a futásokban.
- Source/image pipeline változtatás **0**, 25 védett forrás-/képfeldolgozó/config fájl hash-e egyezik. Képfájl-letöltés/rehost/cache/rewrite **0**. A friss ACCEPT-előfordulásoknál remote URL **26/27**, a kiválasztott URL változatlan.
- Vercel Safari: jakabgipsz865-8537 / GipszJakabTeam / magyarsportonline-web / Preview; repo jakabgipsz865-oss/magyarsportonline VERIFIED. Neon: jakabgipsz865 / magyarsportonline / wild-lake-68761162 / vercel-preview / br-flat-sun-a25d40c9 / neondb VERIFIED. Deploy nem módosult.

### Negatív kontrollok

- Cristiano Ronaldo wedding with Georgina / Cristiano Ronaldo diet interview — külön esemény / PASS
- Cristiano Ronaldo wedding with Georgina / Cristiano Ronaldo luxury cars — külön esemény / PASS
- Cristiano Ronaldo diet interview / Cristiano Ronaldo luxury cars — külön esemény / PASS
- Cristiano Ronaldo wedding with Georgina / Cristiano Ronaldo wedding with Irina — külön esemény / PASS
- Cristiano Ronaldo holiday in Ibiza / Cristiano Ronaldo holiday in Dubai — külön esemény / PASS
- Donnarumma and girlfriend robbery in Paris / Donnarumma and girlfriend robbery in Madrid — külön esemény / PASS
- Donnarumma and girlfriend robbery 2026-09-01 / Donnarumma and girlfriend robbery 2026-09-10 — külön esemény / PASS
- Sorba Thomas car crash / Sorba Thomas nightclub party — külön esemény / PASS
- Edson Alvarez denies kidnapping allegations / Edson Alvarez car crash — külön esemény / PASS
- David Beckham baby with Victoria / David Beckham divorce with Victoria — külön esemény / PASS
- Arsenal party in London / Arsenal car crash — külön esemény / PASS
- Donnarumma robbery / Donnarumma and girlfriend robbery — külön esemény / PASS

## Forrásonként

| SOURCE | FETCHED | EXAMINED | RAW NEW | ACCEPT | REJECT | EXACT DUP | EVENT DUP |
|---|---:|---:|---:|---:|---:|---:|---:|
| The Sun / SunSport Football | 30 | 30 | 3 | 1 | 29 | 27 | 0 |
| Daily Star Football | 25 | 24 | 0 | 4 | 20 | 24 | 2 |
| Daily Mail Football | 150 | 50 | 0 | 8 | 42 | 50 | 4 |
| Daily Mirror Football | 25 | 25 | 0 | 5 | 20 | 25 | 2 |
| SPORTbible Football | 25 | 24 | 0 | 0 | 24 | 24 | 0 |
| Daily Express Football | 10 | 10 | 0 | 2 | 8 | 10 | 2 |
| Metro Football | 29 | 29 | 1 | 0 | 29 | 28 | 0 |
| Metro Oddballs | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| talkSPORT Football | 100 | 50 | 0 | 1 | 49 | 50 | 1 |
| OKDIARIO Paparazzi | 50 | 1 | 0 | 1 | 0 | 1 | 1 |
| OKDIARIO Fútbol | 50 | 16 | 0 | 0 | 16 | 16 | 0 |
| Mundo Deportivo El Otro Mundo | 100 | 35 | 0 | 0 | 35 | 35 | 0 |
| Virgilio Sport Gossip | 30 | 1 | 0 | 0 | 1 | 1 | 0 |
| Tuttosport Calcio | 30 | 30 | 0 | 1 | 29 | 30 | 0 |
| Gazzetta Calcio | 30 | 30 | 1 | 0 | 30 | 29 | 0 |
| Corriere dello Sport Calcio | 30 | 30 | 1 | 0 | 30 | 29 | 0 |
| BILD Sport | 100 | 50 | 4 | 0 | 50 | 46 | 0 |
| SPORT BILD Football | 50 | 50 | 1 | 4 | 46 | 49 | 1 |
| Kronen Zeitung Fussball | 49 | 39 | 0 | 0 | 39 | 39 | 0 |
| AS Tikitakas | 43 | 34 | 0 | 0 | 34 | 34 | 0 |

## Minden cross-source teszteset és visszakereshető forráscikk

### 1. Donnarumma kirablásának tárgyalása

Canonical fingerprint: `e95675745290e86b19aa688690f690a62f36b8cbf4a6f615d7911af1812b7385`

- **OKDIARIO Paparazzi / es** — [Salen a la luz todos los detalles del asalto armado a Donnarumma y su novia embarazada](https://okdiario.com/deportes/salen-luz-todos-detalles-del-asalto-armado-donnarumma-novia-embarazada-20269181); raw `235a257d-9cf0-4bd1-8f1f-d5e82cc9c526`.
- **Daily Mirror Football / en** — [Man City's Gianluigi Donnarumma and pregnant girlfriend 'bound and hit' in terrifying robbery](https://www.mirror.co.uk/sport/football/news/man-city-gianluigi-donnarumma-psg-37650409); raw `40af8232-25da-4a9b-a46b-87e844a591d3`.
- **SPORT BILD Football / de** — [Horror-Prozess eskaliert - So brutal war der Überfall auf Donnarumma und seine Frau](https://sportbild.bild.de/fussball/internationaler-fussball/so-brutal-war-der-ueberfall-auf-donnarumma-und-seine-frau-6aa3c79e56f343d9f4dd189a); raw `6c59d388-777f-48b6-a7a5-aae1310aa05b`.
- **Daily Mail Football / en** — [Man City star Gianluigi Donnarumma and his pregnant girlfriend 'hit, bound and threatened with a knife by robbers while sleeping in their Paris flat'](https://www.dailymail.com/sport/football/article-16121869/Man-City-star-Gianluigi-Donnarumma-pregnant-girlfriend-hit-bound-threatened-knife-robbers-sleeping-Paris-flat.html?ns_mchannel=rss&ns_campaign=1490&ito=1490); raw `7c4886e5-02c0-4048-ba41-fa9d1353f525`.
- **Daily Star Football / en** — [Premier League ace and pregnant girlfriend 'hit and bound' in horrific knifepoint robbery](https://www.dailystar.co.uk/sport/football/gianluigi-donnarumma-alessia-knifepoint-robbery-37650882); raw `825fa7cf-bb4b-44e1-bcdc-d0b1854b2a5b`.
- **The Sun / SunSport Football / en** — [Man City ace Donnarumma ‘bound and hit’ when robbers raided flat… as judge suspends first day of ‘catastrophic’ trial](https://www.thesun.co.uk/sport/40342876/man-city-ace-robbed-flat-trial-suspended/); raw `9cd85992-5b9e-427b-be08-12060d327ffe`.
- **Daily Express Football / en** — [Gianluigi Donnarumma and pregnant girlfriend 'bound and hit' by knife-wielding robbers](https://www.express.co.uk/sport/football/2247635/Gianluigi-Donnarumma-girlfriend-robbers); raw `d160f8f7-4103-4e78-8aa1-4d0e06e3ce4b`.

### 2. Edson Álvarez emberrablási vádak

Canonical fingerprint: `d7654b81a674069aeaaadeee4a1f0f2ce15e2fbdbf0e5a3d8fc3bb542093faa2`

- **Daily Mail Football / en** — [West Ham footballer Edson Alvarez forced to deny bombshell claims linking him to a KIDNAPPING plot](https://www.dailymail.com/sport/football/article-16121729/West-Ham-footballer-Edson-Alvarez-forced-deny-bombshell-claims-linking-KIDNAPPING-plot.html?ns_mchannel=rss&ns_campaign=1490&ito=1490); raw `166649c2-4e38-4208-bf20-f7b7d7cc5aeb`.
- **Daily Mirror Football / en** — [West Ham star threatens legal action over 'false allegations' after kidnap claims](https://www.mirror.co.uk/sport/football/news/west-ham-united-edson-alvarez-37650221); raw `73e93d84-666d-4011-a725-f2c0b7858558`.
- **talkSPORT Football / en** — [West Ham midfielder Edson Alvarez furiously rejects allegations he was involved in a kidnapping plot](https://talksport.com/football/4573277/west-ham-edson-alvarez-kidnapping-allegations-statement/); raw `f144700d-244c-4147-bce3-c4d7d83470b5`.
- **Daily Star Football / en** — [West Ham star issues strong statement over wild kidnap plot claims](https://www.dailystar.co.uk/sport/football/west-ham-united-edson-alvarez-37649939); raw `f80da132-78e1-4cff-954f-ca138aa036ce`.

### 3. Sorba Thomas autóbalesete

Canonical fingerprint: `2a91671e1dde18090612a58e50b6a56863456f9ac69ee7a5a7391057a28964e2`

- **Daily Express Football / en** — [Premier League star involved in car crash near training ground as club release statement](https://www.express.co.uk/sport/football/2247665/Hull-Thomas-Premier-League-Car-Crash-Statement); raw `7bce8d06-ae31-4c6d-acc6-7b4df906c736`.
- **Daily Mirror Football / en** — [Premier League star flips car onto roof in terrifying incident as club release statement](https://www.mirror.co.uk/sport/football/news/sorba-thomas-hull-car-crash-37651323); raw `ed2738bf-5626-44d5-afb7-f19055287aa0`.

### 4. Manchester United bérletszankció

Canonical fingerprint: `6f26b10f7bae7371c9c030e0eb7374d38d66a8f277d4d91a7c33c1ab7bae974b`

- **The Sun / SunSport Football / en** — [Man Utd brutally strip 685 fans of their season tickets and warn 464 more amid controversial ticket touting crackdown](https://www.thesun.co.uk/sport/40346472/man-utd-season-tickets-tout-crackdown/); raw `2956fc66-fbf3-44da-b5fb-12979aead0d9`.
- **Daily Star Football / en** — [Man Utd 'remove 685 season tickets' after controversial summer crackdown](https://www.dailystar.co.uk/sport/football/man-utd-remove-685-season-37653030); raw `befe94d6-a170-47c1-8659-0cd61d4e494f`.

### 5. Bayern Oktoberfest-mez szurkolói reakció

Canonical fingerprint: `6100c36fb10a870a513dfa656d0a90e5f22f589266ba42d43d45262f402c0549`

- **SPORT BILD Football / de** — [„Wie eine Tischdecke“ - Das denken die Bayern-Fans über das neue Wiesn-Trikot](https://sportbild.bild.de/fussball/1-bundesliga/wie-eine-tischdecke-das-denken-die-bayern-fans-ueber-das-neue-wiesn-trikot-6aa308a3240b302c8a8409bd); raw `069927ba-4892-4301-a9aa-b959a00fe748`.
- **BILD Sport / de** — [„Wie eine Tischdecke“ - Das denken die Bayern-Fans über das neue Wiesn-Trikot](https://www.bild.de/sport/fussball/wie-eine-tischdecke-das-denken-die-bayern-fans-ueber-das-neue-wiesn-trikot-6aa2fd49240b302c8a84091c); raw `47275301-ab4d-490a-a8f3-5f0d8c3efa42`.

### 6. Gary Lineker egészség/öregedés vallomás

Canonical fingerprint: `fa994bd207c0879a9edacadf1002ce2285fffa51e13f4bf9126c58b3fff7b83e`

- **Daily Express - Football / en** — [Gary Lineker admits 'we're all worried' as he opens up on death fears](https://www.express.co.uk/celebrity-news/2243972/Gary-Lineker-worried-opens-up-death-fears); raw `1af000d3-c148-4817-9998-447d4f9cc48a`.
- **Daily Star - Football / en** — [Gary Lineker, 65, admits health fears and says 'I'm not worried about death'](https://www.dailystar.co.uk/sport/football/gary-lineker-65-admits-health-37610017); raw `c7382a4f-e195-4f15-bad1-ffbe2c3688e8`.

### 7. Darren Fletcher és az agresszív szurkoló

Canonical fingerprint: `0c25e13056e1b627bd9b9297212af53da291c1e63d60aaa3d260b1e80bf007a1`

- **talkSPORT Football / en** — [Darren Fletcher seen confronting abusive Man United fan immediately after Champions League win](https://talksport.com/football/4573965/darren-fletcher-confrontation-man-united-fan-champions-league/); raw `380e0d15-2673-4e4c-92ce-23860ca2d8d8`.
- **Daily Mirror Football / en** — [Darren Fletcher cheered as 'abusive Man Utd fan' put in place after Champions League win](https://www.mirror.co.uk/sport/football/news/man-utd-darren-fletcher-sabah-37650423); raw `85f27262-8486-4b0f-bd2e-3ad3307c7f92`.
- **Daily Star Football / en** — [Darren Fletcher confronts 'abusive' Man Utd fan as tempers flare at Old Trafford](https://www.dailystar.co.uk/sport/football/darren-fletcher-man-utd-fan-37651457); raw `fe2d4175-8547-4f95-b8eb-da6e6159adee`.

### 8. Carrick válasza Anderson Manchester-megjegyzésére

Canonical fingerprint: `8123e2a9b6721aa902142193a9109601250206b3186fc11486f58a88b990da7c`

- **The Sun / SunSport Football / en** — [Man Utd boss Michael Carrick scoffs at Elliot Anderson jibe ahead of Manchester derby](https://www.thesun.co.uk/sport/40345280/man-utd-michael-carrick-elliot-anderson-city/); raw `882662f5-79ae-482d-a325-103ec63ac22c`.
- **Daily Mirror Football / en** — [Michael Carrick responds to Elliot Anderson's 'Kings of Manchester' jibe](https://www.mirror.co.uk/sport/football/news/michael-carrick-responds-elliot-andersons-37652122); raw `b8cfc992-f877-4c0c-8a86-1658f1a63eda`.

### 9. Pochettino vitatja a Chelsea 2017-es címét

Canonical fingerprint: `142dd24e34986ad10cecec8bcb8a4d8a42e036ee22c678bf9e3b52bff9183a76`

- **SPORTbible Football / en** — [Mauricio Pochettino demands Premier League strip club of title in extraordinary interview](https://www.sportbible.com/football/premier-league/mauricio-pochettino-premier-league-stripped-spurs-chelsea-103103-20260910); raw `a58aef30-8bbe-42c6-9a3c-836c27e5fef8`.
- **Daily Star Football / en** — [Mauricio Pochettino demands 'take Premier League title off Chelsea and give it to Tottenham'](https://www.dailystar.co.uk/sport/football/pochettino-chelsea-tottenham-premier-league-37646364); raw `c3631890-8af4-4441-ba4d-93b45ee611c0`.

### 10. Arteta pánik elleni csapatprankjei

Canonical fingerprint: `db3093e500671f8daf9c62da772cc0fb9faa0093490d9a370c66a50c9339b6b3`

- **Daily Mirror Football / en** — [Mikel Arteta reveals bizarre traps including air con trick to stop Arsenal stars 'panicking'](https://www.mirror.co.uk/sport/football/news/mikel-arteta-arsenal-press-conference-37651344); raw `48ef626c-893c-4ba2-9134-43ffb0942bd5`.
- **Daily Star Football / en** — [Mikel Arteta admits sabotaging Arsenal with odd tricks to stop stars 'panicking'](https://www.dailystar.co.uk/sport/football/arsenal-mikel-arteta-sabotage-training-37652664); raw `9932b1c4-8229-400a-b63f-603b792c890a`.

### 11. Staveley nyilatkozata a sikertelen West Ham-ajánlatról

Canonical fingerprint: `4f7ac9fe04ea6c32d57f6ec6eda532f2275b6f965e5b9337f701a05efdfba9cf`

- **The Sun / SunSport Football / en** — [Amanda Staveley breaks silence after failing in bid to buy West Ham stake… but admits ambitions for Hammers NOT over](https://www.thesun.co.uk/sport/40344885/amanda-staveley-west-ham-stake-bid-failure/); raw `1b6d44d8-0c08-434d-8050-e3515a0aa0f8`.
- **talkSPORT Football / en** — [Amanda Staveley breaks silence on West Ham saga and insists this isn&#8217;t over yet](https://talksport.com/football/4574205/amanda-staveley-breaks-silence-west-ham-takeover-saga/); raw `4f382055-2562-4905-81b5-36c8cb565d8d`.

### 12. Ismail Kartal lemondása a Roma-meccs után

Canonical fingerprint: `2cebdbfba2afd1687ab491684744a224a412a214491e478d9b05ce4869c39bf6`

- **talkSPORT Football / en** — [Champions League manager immediately resigns minutes after opening match](https://talksport.com/football/4573631/fenerbahce-manager-resigns-immediately-ismail-kartal-champions-league/); raw `62909e8d-4cff-4c04-b830-466c0dbb7304`.
- **Daily Express Football / en** — [Champions League manager resigns immediately after full-time as players stunned](https://www.express.co.uk/sport/football/2247552/champions-league-manager-fenerbahce-Ismail-Kartal); raw `9cce7c73-fd87-4243-b6e0-536c297979a2`.

### 13. Olise szokatlan DAZN-interjúja

Canonical fingerprint: `19434c1b30444f07f9e95768f30966d3b624c1845dfbb419f276961bf9e914ee`

- **SPORT BILD Football / de** — [Total bizarres Gespräch - Warum Olise das Interview geben musste](https://sportbild.bild.de/fussball/1-bundesliga/total-bizarres-gespraech-warum-olise-das-interview-geben-musste-6aa3b501240b302c8a840fed); raw `4aa56936-1fba-40d8-b1c2-2bff403b98ef`.
- **SPORTbible Football / en** — [Michael Olise divides football fans with uncomfortable interview after Bayern Munich win in Champions League](https://www.sportbible.com/football/football-news/champions-league/michael-olise-interview-bayern-munich-768368-20260911); raw `95d08bf6-0c36-4a61-8590-4506db954394`.
- **Corriere dello Sport Calcio / it** — [Olise e l'intervista surreale dopo la Champions: "Gol capolavoro? Ho tirato e basta". La sua faccia dice tutto](https://www.corrieredellosport.it/news/calcio/champions-league/2026/09/11-151169969/olise_e_l_intervista_surreale_dopo_la_champions_gol_capolavoro_ho_tirato_e_basta_la_sua_faccia_dice_tutto/); raw `965c0f46-4a13-4203-bd8d-cebe321a5fd2`.
- **Kronen Zeitung Fussball / de** — [Reporter verzweifelt - Olise ist selbst im Interview … außergewöhnlich](https://www.krone.at/4290698); raw `a93ff452-5777-44b5-ab4f-86df82a3b92d`.

### 14. Boehly Chelsea-részesedésének eladása

Canonical fingerprint: `2beedba6ccd03f608527660415dbbf6cb4383fb7a614cbfa5add3737a130f63b`

- **The Sun / SunSport Football / en** — [Todd Boehly on brink of SELLING Chelsea shares & profit on £2.5BILLION stake leaving Blues under full control of Eghbali](https://www.thesun.co.uk/sport/40343571/chelsea-todd-boehly-sale-mark-walter/); raw `056a172c-0d96-4025-ad44-789684e6a1d8`.
- **Daily Mail Football / en** — [Todd Boehly is on the brink of leaving Chelsea and selling his minority stake - with Behdad Eghbali's Clearlake Capital set to take control of club](https://www.dailymail.com/sport/football/article-16122101/Todd-Boehly-brink-leaving-Chelsea-selling-minority-stake-Behdad-Eghbalis-Clearlake-Capital-set-control-club.html?ns_mchannel=rss&ns_campaign=1490&ito=1490); raw `65109c93-2013-4d05-b3d6-8f7af8c39aa3`.

## Módosítás előtti részletes audit

# Bérletügy és Arsenal rekordhír — módosítás előtti audit

| SOURCE | TITLE | NORMALIZED ENTITIES | EVENT TYPE | EVENT KEY/FINGERPRINT | WHY NOT MATCHED |
|---|---|---|---|---|---|
| The Sun / SunSport Football | Man Utd brutally strip 685 fans of their season tickets and warn 464 more amid controversial ticket touting crackdown | team:manchester-united | null | event key=null; `8972b1c8649e12d994d9bf2b69e8b72b84d86e4c664946dfa1871a109de8fe72` | A ticket-enforcement típus hiányzik; a visszaeső hash sourceId/rawId-t használ. |
| Daily Star Football | Man Utd 'remove 685 season tickets' after controversial summer crackdown | team:manchester-united | null | event key=null; `b41bcc98905307899ea6269a54595b96ae9a12e68a518fff9744c385a92f2553` | A ticket-enforcement típus hiányzik; a visszaeső hash sourceId/rawId-t használ. |

A normalizált klub mindkét esetben azonos. A hiányzó komponens az eseménytípus; a 48 órás ablakhoz és a secondary entity összevetéshez a kód el sem jut. Fájl: packages/agents/src/tabloid-event.ts; describeTabloidEvent(types.length !== 1), resolveTabloidEvent(!descriptor).

## Arsenal

Best starts to the season EVER as Arsenal look to smash Chelsea’s 21-year-old record and continue incredible winning run

ARSENAL have enjoyed a flying start in their bid to win their first ever back-to-back Premier league titles. The Gunners finally broke their duck last season by winning their first Prem trophy since the Invincibles' 2004 triumph. And the North Londoners have won all three of their opening matches this term in the English top...

Besorolás: sporteredmény/rekord/versenyteljesítmény, REJECT. A tabloid.ts offField regexének önálló look szava a look to smash kifejezésre illeszkedik. Ez true-ra állítja offFieldHeadline-t, így a matchNews win/won egyezéseit figyelő feltétel kimarad. A visszatérési feltételben ugyanez az offField egyezés ACCEPT-et ad.

Audit elkészült az alkalmazáskód módosítása előtt.


## Bizonyítás határa

A 14 megnevezett eseménycsalád és a megadott regressziós készlet PASS. Ez nem minden lehetséges futballeseményre vonatkozó szemantikus garancia. Ismeretlen/többértelmű entitás vagy esemény, illetve hiányzó kötelező megkülönböztető adat esetén a konzervatív fallback megmarad; a teljes span legfeljebb 48 óra. Production aktiválás nem történt.

**STOP.**

# MSO Preview event-dedup validáció

Run: `8c4a3406-be3e-444c-8028-a4194b85d670` · 2026-09-11T15:11:00.253Z → 2026-09-11T15:12:30.682Z

**A három kötelező esemény Preview DB-dedupja PASS. Production aktiválás nem történt.**

Vercel Safari VERIFIED: jakabgipsz865-8537 / GipszJakabTeam / magyarsportonline-web / Preview. Repository: jakabgipsz865-oss/magyarsportonline. Neon VERIFIED: jakabgipsz865 / magyarsportonline / wild-lake-68761162 / vercel-preview / br-flat-sun-a25d40c9 / neondb.

A futás a meglévő helyi event-dedup kóddal, a már izolált Preview DB-n történt. A Vercel deployment nem változott. A korábbi 535 raw újraértékelése után egyetlen friss RSS-lekérés/feed történt, legfeljebb 50 friss tétellel/source, 48 órás ablakban.

| FETCHED | EXAMINED | RAW NEW | ACCEPT | REJECT | EXACT DUP | EVENT DUP MERGED |
|---:|---:|---:|---:|---:|---:|---:|
| 956 | 558 | 99 | 27 | 531 | 459 | 12 |

Az ACCEPT/REJECT a vizsgált RSS-előfordulások száma, az exact duplicate-eket is tartalmazza. A 12 event-duplicate döntés 10 külön raw rekord közös canonical jelölthöz rendelését jelenti; két Daily Mail tétel több feedben is szerepelt. Összesen 25 külön ACCEPT raw volt a friss mintában. Valódi Story-összevonás/létrehozás nem történt.

| EVENT | SOURCES | RAW ARTICLES | OLD FINGERPRINT COUNT | NEW CANONICAL EVENT COUNT | PASS/FAIL |
|---|---:|---:|---:|---:|---|
| Donnarumma és Alessia Elefante párizsi kirablásának tárgyalása | 7 | 7 | 7 | 1 | PASS |
| Edson Álvarez: emberrablási vádak visszautasítása | 4 | 4 | 4 | 1 | PASS |
| Sorba Thomas autóbalesete a Hull City edzőpályája közelében | 2 | 2 | 2 | 1 | PASS |

A táblázat a kötelező, ACCEPT-ként azonosított 13 forráscikket tartalmazza. A REJECT cikkek nem kapnak Story-jelöltet, de szintén megmaradnak.

## Raw-megőrzés és biztonság

- 796/796 korábbi raw ID visszaolvasható. Source ID, eredeti cím, teljes RSS-tartalom, source URL, image URL és Story-kapcsolat változása: **0**.
- Raw összesen: **796 → 895**, pontosan **99 új**. A 13 kötelező cikk külön source/raw rekordként megmaradt, csak a JSONB eseményazonosító közös.
- A 535-es korábbi mintában **25 ACCEPT / 510 REJECT**; a két P0 false positive REJECT.
- Writer queue: **0 → 0**. Pipeline jobs: **1403 → 1403**, teljes rekordhash változatlan.
- Stories: **103 → 103**; StoryVersions: **168 → 168**, teljes rekordhash változatlan.
- Új raw-hoz Story-kapcsolat: **0**. A futás egy korábban már Story-hoz kapcsolt, REJECT match-live raw-t is újra látott; a kapcsolat már előtte megvolt, változatlan. Emiatt a generikus `noLinkedStories` mező false, de **új Story-kapcsolat/létrehozás nem történt**.
- Agent runs: **4887 → 4887**. Gemini hívás: **0**. A futtató nem indít Writert/publikációt, az insert enqueue paramétere false.
- AUTO-PUBLISH: **OFF** a futásban (`TABLOID_AUTO_PUBLISH=false`). Aktív forrásrekordok: **0 → 0**; az operátori futás explicit RSS-fetch-et végzett.
- Corporate Cloudflare account: Footballinvestmentkft@gmail.com's Account / 7a225d650d7e05daba6355e5526a8fb9. Worker Settings: **No cron triggers configured**. Csak read-only ellenőrzés.
- Production DB kapcsolat/írás/migráció: **0**. Production deploy: **0**. Kizárólag a hard-asserttel ellenőrzött Preview hostname volt használva.
- Alkalmazás-, source-, image- és validációs kódmódosítás: **0**; a futás előtti/utáni fájlhash-összevetés egyezik.

## Regressziók

- Gold-set **64/64 PASS**; összes kért célzott ellenőrzés **92/92 PASS**.
- Horner/F1: **REJECT**; Koné injury sports update: **REJECT**, a Preview raw döntés-metaadatából is visszaolvasva.

### 12 negatív kontroll: mind külön esemény / PASS

- Cristiano Ronaldo wedding with Georgina / Cristiano Ronaldo diet interview
- Cristiano Ronaldo wedding with Georgina / Cristiano Ronaldo luxury cars
- Cristiano Ronaldo diet interview / Cristiano Ronaldo luxury cars
- Cristiano Ronaldo wedding with Georgina / Cristiano Ronaldo wedding with Irina
- Cristiano Ronaldo holiday in Ibiza / Cristiano Ronaldo holiday in Dubai
- Donnarumma and girlfriend robbery in Paris / Donnarumma and girlfriend robbery in Madrid
- Donnarumma and girlfriend robbery 2026-09-01 / Donnarumma and girlfriend robbery 2026-09-10
- Sorba Thomas car crash / Sorba Thomas nightclub party
- Edson Alvarez denies kidnapping allegations / Edson Alvarez car crash
- David Beckham baby with Victoria / David Beckham divorce with Victoria
- Arsenal party in London / Arsenal car crash
- Donnarumma robbery / Donnarumma and girlfriend robbery

## Képellenőrzés

A friss minta: **26/27 RSS ACCEPT előforduláshoz** remote URL; külön raw-kra számítva **24/25**. A korábbi 535-ös mintán a két REJECT korrekció után 23/25. URL-ek változtatás nélkül tárolva; meglévő raw képei változatlanok. Képfájl-letöltés/HEAD-probing/rehost/cache/rewrite: 0. Nincs képoptimalizálás.

## Friss mintában jelzett, most nem javított korlátok

- Gyanús téves ACCEPT: The Sun — **Best starts to the season EVER as Arsenal look to smash Chelsea’s 21-year-old record and continue incredible winning run**. Sportsiker/rekord fókuszú cím, további szerkesztőségi regressziós jelölt.
- További, a kötelező három családon kívüli cross-source hiány: Sun és Daily Star Manchester United 685 visszavont bérletről szóló híre **2 külön fallback fingerprintet** kap. A jelenlegi explicit eseménytípus-lista ezt az ügyet nem ismeri; nem adható általános, minden eseményre vonatkozó dedup-PASS.
- A fenti megfigyelések miatt sincs production aktiválás. Szabályhangolás/javítási ciklus nem indult.

## Forrásonkénti friss futás

| SOURCE | FETCHED | EXAMINED | RAW NEW | ACCEPT | REJECT | EXACT DUP | EVENT DUP |
|---|---:|---:|---:|---:|---:|---:|---:|
| The Sun / SunSport Football | 30 | 30 | 15 | 2 | 28 | 15 | 0 |
| Daily Star Football | 25 | 24 | 2 | 4 | 20 | 22 | 1 |
| Daily Mail Football | 150 | 50 | 4 | 7 | 43 | 46 | 4 |
| Daily Mirror Football | 25 | 25 | 10 | 5 | 20 | 15 | 2 |
| SPORTbible Football | 25 | 25 | 4 | 0 | 25 | 21 | 0 |
| Daily Express Football | 10 | 10 | 2 | 2 | 8 | 8 | 2 |
| Metro Football | 29 | 28 | 4 | 0 | 28 | 24 | 0 |
| Metro Oddballs | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| talkSPORT Football | 100 | 50 | 6 | 1 | 49 | 44 | 1 |
| OKDIARIO Paparazzi | 50 | 1 | 0 | 1 | 0 | 1 | 1 |
| OKDIARIO Fútbol | 50 | 16 | 0 | 0 | 16 | 16 | 0 |
| Mundo Deportivo El Otro Mundo | 100 | 35 | 2 | 0 | 35 | 33 | 0 |
| Virgilio Sport Gossip | 30 | 1 | 0 | 0 | 1 | 1 | 0 |
| Tuttosport Calcio | 30 | 30 | 3 | 1 | 29 | 27 | 0 |
| Gazzetta Calcio | 30 | 30 | 7 | 0 | 30 | 23 | 0 |
| Corriere dello Sport Calcio | 30 | 30 | 5 | 0 | 30 | 25 | 0 |
| BILD Sport | 100 | 50 | 23 | 0 | 50 | 27 | 0 |
| SPORT BILD Football | 50 | 50 | 4 | 4 | 46 | 46 | 1 |
| Kronen Zeitung Fussball | 49 | 39 | 3 | 0 | 39 | 36 | 0 |
| AS Tikitakas | 43 | 34 | 5 | 0 | 34 | 29 | 0 |

## Kötelező események visszakereshető forráscikkei

### Donnarumma és Alessia Elefante párizsi kirablásának tárgyalása

Canonical fingerprint: `e95675745290e86b19aa688690f690a62f36b8cbf4a6f615d7911af1812b7385`

- Daily Star Football: [Premier League ace and pregnant girlfriend 'hit and bound' in horrific knifepoint robbery](https://www.dailystar.co.uk/sport/football/gianluigi-donnarumma-alessia-knifepoint-robbery-37650882) — raw `825fa7cf-bb4b-44e1-bcdc-d0b1854b2a5b`
- Daily Mail Football: [Man City star Gianluigi Donnarumma and his pregnant girlfriend 'hit, bound and threatened with a knife by robbers while sleeping in their Paris flat'](https://www.dailymail.com/sport/football/article-16121869/Man-City-star-Gianluigi-Donnarumma-pregnant-girlfriend-hit-bound-threatened-knife-robbers-sleeping-Paris-flat.html?ns_mchannel=rss&ns_campaign=1490&ito=1490) — raw `7c4886e5-02c0-4048-ba41-fa9d1353f525`
- The Sun / SunSport Football: [Man City ace Donnarumma ‘bound and hit’ when robbers raided flat… as judge suspends first day of ‘catastrophic’ trial](https://www.thesun.co.uk/sport/40342876/man-city-ace-robbed-flat-trial-suspended/) — raw `9cd85992-5b9e-427b-be08-12060d327ffe`
- Daily Mirror Football: [Man City's Gianluigi Donnarumma and pregnant girlfriend 'bound and hit' in terrifying robbery](https://www.mirror.co.uk/sport/football/news/man-city-gianluigi-donnarumma-psg-37650409) — raw `40af8232-25da-4a9b-a46b-87e844a591d3`
- Daily Express Football: [Gianluigi Donnarumma and pregnant girlfriend 'bound and hit' by knife-wielding robbers](https://www.express.co.uk/sport/football/2247635/Gianluigi-Donnarumma-girlfriend-robbers) — raw `d160f8f7-4103-4e78-8aa1-4d0e06e3ce4b`
- OKDIARIO Paparazzi: [Salen a la luz todos los detalles del asalto armado a Donnarumma y su novia embarazada](https://okdiario.com/deportes/salen-luz-todos-detalles-del-asalto-armado-donnarumma-novia-embarazada-20269181) — raw `235a257d-9cf0-4bd1-8f1f-d5e82cc9c526`
- SPORT BILD Football: [Horror-Prozess eskaliert - So brutal war der Überfall auf Donnarumma und seine Frau](https://sportbild.bild.de/fussball/internationaler-fussball/so-brutal-war-der-ueberfall-auf-donnarumma-und-seine-frau-6aa3c79e56f343d9f4dd189a) — raw `6c59d388-777f-48b6-a7a5-aae1310aa05b`

### Edson Álvarez: emberrablási vádak visszautasítása

Canonical fingerprint: `d7654b81a674069aeaaadeee4a1f0f2ce15e2fbdbf0e5a3d8fc3bb542093faa2`

- Daily Star Football: [West Ham star issues strong statement over wild kidnap plot claims](https://www.dailystar.co.uk/sport/football/west-ham-united-edson-alvarez-37649939) — raw `f80da132-78e1-4cff-954f-ca138aa036ce`
- Daily Mail Football: [West Ham footballer Edson Alvarez forced to deny bombshell claims linking him to a KIDNAPPING plot](https://www.dailymail.com/sport/football/article-16121729/West-Ham-footballer-Edson-Alvarez-forced-deny-bombshell-claims-linking-KIDNAPPING-plot.html?ns_mchannel=rss&ns_campaign=1490&ito=1490) — raw `166649c2-4e38-4208-bf20-f7b7d7cc5aeb`
- Daily Mirror Football: [West Ham star threatens legal action over 'false allegations' after kidnap claims](https://www.mirror.co.uk/sport/football/news/west-ham-united-edson-alvarez-37650221) — raw `73e93d84-666d-4011-a725-f2c0b7858558`
- talkSPORT Football: [West Ham midfielder Edson Alvarez furiously rejects allegations he was involved in a kidnapping plot](https://talksport.com/football/4573277/west-ham-edson-alvarez-kidnapping-allegations-statement/) — raw `f144700d-244c-4147-bce3-c4d7d83470b5`

### Sorba Thomas autóbalesete a Hull City edzőpályája közelében

Canonical fingerprint: `2a91671e1dde18090612a58e50b6a56863456f9ac69ee7a5a7391057a28964e2`

- Daily Mirror Football: [Premier League star flips car onto roof in terrifying incident as club release statement](https://www.mirror.co.uk/sport/football/news/sorba-thomas-hull-car-crash-37651323) — raw `ed2738bf-5626-44d5-afb7-f19055287aa0`
- Daily Express Football: [Premier League star involved in car crash near training ground as club release statement](https://www.express.co.uk/sport/football/2247665/Hull-Thomas-Premier-League-Car-Crash-Statement) — raw `7bce8d06-ae31-4c6d-acc6-7b4df906c736`

**STOP. Új ingest, deploy vagy production aktiválás nem indul.**

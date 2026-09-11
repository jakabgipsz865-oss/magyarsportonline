# MSO — kontrollált Preview RSS-validáció

Futás: `472532db-d5df-4541-a925-cb0929672960` · 2026-09-11T12:20:56.047Z → 2026-09-11T12:21:29.239Z.

**Production felé: STOP.** Gold-set PASS, de két súlyos élő false positive és hiányzó cross-source Story-dedup garancia.

A validáció a helyi V2 + editorial calibration kódot futtatta az igazolt Neon Preview DB ellen; a Vercel webalkalmazást ebben a körben nem deployoltuk. Ugyanaz az RSS adapter, isFootballTabloid filter, remote-image selector és RawArticleRepository mentés futott. A normál AUTO-PUBLISH-hoz kötött dispatcher helyett az egyszeri operátori futtató minden elemre `insertTabloid(data, false)`-t hívott. Nem végponti/Vercel runtime E2E bizonyíték.

Cél: `wild-lake-68761162` / `vercel-preview` / `br-flat-sun-a25d40c9` / `neondb`. A futtató fix Preview-host ellenőrzés után nyitott kapcsolatot, tiszta process environmenttel, LLM-kulcsok nélkül. Sem Production-kapcsolat, sem migráció, sem deploy nem volt.

## Forrásonkénti eredmény

Egy friss RSS-letöltés/feed; csak validált CORE/SECONDARY registry. Maximum 50 elem/source, 48 órán belüli publikálási idővel. `FETCHED` minden normalizált feed-elem; `SAMPLED` az időablak és limit után. `ACCEPT/REJECT` az újonnan mentett raw rekordok döntése. `DUPLICATE` a DB által elutasított source URL/GUID ütközés. `IMAGE URL` az új ACCEPT rekordok képpel/összes ACCEPT aránya. A futás végén minden source inaktív maradt.

| SOURCE | LANG | MODE | RSS | FETCHED | FRESH 48H | SAMPLED | RAW STORED | ACCEPT | REJECT | DUPLICATE | IMAGE URL | WRITER QUEUED |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| The Sun / SunSport Football | en | BROAD_TABLOID_FOOTBALL | RSS_VALID | 27 | 27 | 27 | 27 | 2 | 25 | 0 | 2/2 | 0 |
| Daily Star Football | en | BROAD_TABLOID_FOOTBALL | RSS_VALID | 25 | 24 | 24 | 24 | 3 | 21 | 0 | 3/3 | 0 |
| Daily Mail Football | en | BROAD_TABLOID_FOOTBALL | RSS_VALID | 150 | 69 | 50 | 37 | 5 | 32 | 13 | 4/5 | 0 |
| Daily Mirror Football | en | BROAD_TABLOID_FOOTBALL | RSS_VALID | 25 | 25 | 25 | 25 | 5 | 20 | 0 | 5/5 | 0 |
| SPORTbible Football | en | BROAD_TABLOID_FOOTBALL | RSS_VALID | 25 | 22 | 22 | 22 | 0 | 22 | 0 | 0/0 | 0 |
| Daily Express Football | en | BROAD_TABLOID_FOOTBALL | RSS_VALID | 10 | 10 | 10 | 10 | 2 | 8 | 0 | 2/2 | 0 |
| Metro Football | en | BROAD_TABLOID_FOOTBALL | RSS_VALID | 27 | 27 | 27 | 27 | 0 | 27 | 0 | 0/0 | 0 |
| Metro Oddballs | en | DIRECT_GOSSIP | RSS_VALID | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0/0 | 0 |
| talkSPORT Football | en | BROAD_TABLOID_FOOTBALL | RSS_VALID | 100 | 49 | 49 | 49 | 1 | 48 | 0 | 1/1 | 0 |
| OKDIARIO Paparazzi | es | DIRECT_GOSSIP | RSS_VALID | 50 | 1 | 1 | 1 | 1 | 0 | 0 | 1/1 | 0 |
| OKDIARIO Fútbol | es | BROAD_TABLOID_FOOTBALL | RSS_VALID | 50 | 17 | 17 | 17 | 0 | 17 | 0 | 0/0 | 0 |
| Mundo Deportivo El Otro Mundo | es | BROAD_TABLOID_FOOTBALL | RSS_VALID | 100 | 36 | 36 | 36 | 0 | 36 | 0 | 0/0 | 0 |
| Virgilio Sport Gossip | it | DIRECT_GOSSIP | RSS_VALID | 30 | 1 | 1 | 1 | 0 | 1 | 0 | 0/0 | 0 |
| Tuttosport Calcio | it | BROAD_TABLOID_FOOTBALL | RSS_VALID | 30 | 30 | 30 | 30 | 2 | 28 | 0 | 2/2 | 0 |
| Gazzetta Calcio | it | BROAD_TABLOID_FOOTBALL | RSS_VALID | 30 | 30 | 30 | 30 | 1 | 29 | 0 | 0/1 | 0 |
| Corriere dello Sport Calcio | it | BROAD_TABLOID_FOOTBALL | RSS_VALID | 30 | 30 | 30 | 29 | 0 | 29 | 1 | 0/0 | 0 |
| BILD Sport | de | BROAD_TABLOID_FOOTBALL | RSS_VALID | 100 | 100 | 50 | 50 | 1 | 49 | 0 | 1/1 | 0 |
| SPORT BILD Football | de | BROAD_TABLOID_FOOTBALL | RSS_VALID | 50 | 50 | 50 | 50 | 3 | 47 | 0 | 3/3 | 0 |
| Kronen Zeitung Fussball | de | BROAD_TABLOID_FOOTBALL | RSS_VALID | 49 | 38 | 38 | 38 | 1 | 37 | 0 | 1/1 | 0 |
| AS Tikitakas | es | DIRECT_GOSSIP | RSS_VALID | 42 | 32 | 32 | 32 | 0 | 32 | 0 | 0/0 | 0 |

Összesen: 950 fetched; 549 vizsgált; 535 raw stored = 27 ACCEPT + 508 REJECT; 14 exact duplikátum; 25/27 ACCEPT remote képpel. 20/20 RSS_VALID, köztük AS Tikitakas; Metro Oddballs valid üres feed.

## Editorial eltérések — nem javítottuk automatikusan

| MINŐSÍTÉS | SOURCE | ACTUAL | CÍM | INDOK |
| --- | --- | --- | --- | --- |
| CONFIRMED FALSE POSITIVE — P0 | BILD Sport | ACCEPT | Es geht um ein Buch - Neuer Zoff zwischen Horner und Red Bull | Formula–1 / Christian Horner. A cím német „Neuer” szava a játékosnév-regex „neuer” elemére illeszkedik; ez téves football relevance. |
| CONFIRMED FALSE POSITIVE — P0 | Tuttosport Calcio | ACCEPT | Kone, niente esami ma resta in dubbio per Torino-Roma: le condizioni del centrocampista | Sima térdsérülés/keretbe visszatérés sportfrissítés. A „ginocchio” nem kerül kizárásra; az „accusato” szó tévesen az accusa* human-angle jelre illeszkedik. |
| EDITORIAL REVIEW — lehetséges FALSE POSITIVE | Gazzetta Calcio | ACCEPT | Brignoli e l'esordio in Champions a 35 anni: "A Donnarumma chiederò la maglia, a Gasp una... foto!" | A fő téma a Champions League-debütálás; a maglia/foto mellékszál emeli ACCEPT-re. Kézi szerkesztői döntést igényel. |
| EDITORIAL REVIEW — határeset | Daily Mirror Football | ACCEPT | Mikel Arteta reveals bizarre traps including air con trick to stop Arsenal stars 'panicking' | Edzői menedzsmentmódszer és furcsa tréfák keveréke; nem bizonyított súlyos false positive. |
| LIKELY FALSE NEGATIVE | Daily Star Football | REJECT | Darren Fletcher confronts 'abusive' Man Utd fan as tempers flare at Old Trafford | Szurkolói konfliktus; a meccseredmény csak háttér. |
| LIKELY FALSE NEGATIVE | Daily Mail Football | REJECT | Darren Fletcher puts 'abusive' Man United autograph-hunters in their place: Coach shouts back after angry fans attacked players for not stopping when they wanted to meet their heroes | Autogramkérők és edző konfliktusa; egyértelmű személyes incidens. |
| LIKELY FALSE NEGATIVE | Metro Football | REJECT | Premier League star crashes £160k Land Rover on residential street | Sorba Thomas személyes autóbalesete. Ugyanezt a Mirror és az Express ACCEPT-re tette. |
| LIKELY FALSE NEGATIVE | The Sun / SunSport Football | REJECT | Premier League star flips £60,000 Land Rover Defender on way to training days after £10million summer transfer | Személyes autóbaleset, a címben szereplő korábbi transfer háttérinformáció. |
| LIKELY FALSE NEGATIVE | SPORTbible Football | REJECT | Michael Olise divides football fans with uncomfortable interview after Bayern Munich win in Champions League | Virális, kínos interjú; az eredmény és a kapcsolódó transfer-link sportháttérként kizárja. |
| LIKELY FALSE NEGATIVE | Corriere dello Sport Calcio | REJECT | Olise e l'intervista surreale dopo la Champions: "Gol capolavoro? Ho tirato e basta". La sua faccia dice tutto | Szürreális interjú; ugyanaz az Olise-téma SPORT BILD-en ACCEPT. |
| LIKELY FALSE NEGATIVE | BILD Sport | REJECT | Halbfinalist der US Open und Fußball-Superstar - Sie sind aktuell das Glamour-Paar der Sportwelt | Trinity Rodman labdarúgó és Ben Shelton kapcsolata; a football-person felismerés nem elég. |
| LIKELY FALSE NEGATIVE | BILD Sport | REJECT | Worum es geht - Schwere Vorwürfe gegen Fußball-Legende Eto’o | Samuel Eto’o elleni vádak; a futballlegenda-relevancia/névváltozat hiányosan felismerhető. |
| LIKELY FALSE NEGATIVE | SPORT BILD Football | REJECT | Lebenslange Sperre - Brutale Attacke auf Linienrichter | Linienrichter bántalmazása és életre szóló eltiltás; személyes erőszakos/disciplinary incidens. |

A döntési ok/category nincs külön visszaadva a jelenlegi boolean filterből. A fenti indok kézi kód- és RSS-szöveg-értékelés, nem új classifier output. Minden REJECT a Preview raw_articles táblában megmaradt.

## Három valódi többforrásos esemény — dedup NEM PASS

| ESEMÉNY | ACCEPT SOURCE-OK | KÜLÖN RAW | KÜLÖN STORY FINGERPRINT | TÉNYLEGES ÚJ STORY | EGY-STORY GARANCIA |
| --- | --- | --- | --- | --- | --- |
| Donnarumma és Alessia Elefante párizsi kirablásának tárgyalása | Daily Star Football, Daily Mail Football, The Sun / SunSport Football, Daily Mirror Football, Daily Express Football, OKDIARIO Paparazzi, SPORT BILD Football | 7 | 7 | 0 | FAIL |
| Edson Álvarez: emberrablási vádak visszautasítása | Daily Star Football, Daily Mail Football, Daily Mirror Football, talkSPORT Football | 4 | 4 | 0 | FAIL |
| Sorba Thomas autóbalesete a Hull City edzőpályája közelében | Daily Mirror Football, Daily Express Football | 2 | 2 | 0 | FAIL |

A jelenlegi `publishTabloid` a `sha256(tabloid:sourceId:rawId)` fingerprintet használja. A fenti valódi, Preview-ban tárolt raw ID-kból különböző kulcsok adódnak. Ez statikus fingerprint-ellenőrzés, nem Writer/publish futtatás. A same-source exact URL/GUID guard működik (14 ütközés), de az eseményekből későbbi auto-publish mellett több Story keletkezhetne. A mostani nulla publikáció a Writer tiltása, nem cross-source dedup bizonyíték. A korábban kért cross-source dedup/Story Merge tiltást nem írtuk át.

### Eseménybizonyítékok

**Donnarumma és Alessia Elefante párizsi kirablásának tárgyalása**
- [Daily Star Football](https://www.dailystar.co.uk/sport/football/gianluigi-donnarumma-alessia-knifepoint-robbery-37650882) · raw `825fa7cf-bb4b-44e1-bcdc-d0b1854b2a5b`
- [Daily Mail Football](https://www.dailymail.com/sport/football/article-16121869/Man-City-star-Gianluigi-Donnarumma-pregnant-girlfriend-hit-bound-threatened-knife-robbers-sleeping-Paris-flat.html?ns_mchannel=rss&ns_campaign=1490&ito=1490) · raw `7c4886e5-02c0-4048-ba41-fa9d1353f525`
- [The Sun / SunSport Football](https://www.thesun.co.uk/sport/40342876/man-city-ace-robbed-flat-trial-suspended/) · raw `9cd85992-5b9e-427b-be08-12060d327ffe`
- [Daily Mirror Football](https://www.mirror.co.uk/sport/football/news/man-city-gianluigi-donnarumma-psg-37650409) · raw `40af8232-25da-4a9b-a46b-87e844a591d3`
- [Daily Express Football](https://www.express.co.uk/sport/football/2247635/Gianluigi-Donnarumma-girlfriend-robbers) · raw `d160f8f7-4103-4e78-8aa1-4d0e06e3ce4b`
- [OKDIARIO Paparazzi](https://okdiario.com/deportes/salen-luz-todos-detalles-del-asalto-armado-donnarumma-novia-embarazada-20269181) · raw `235a257d-9cf0-4bd1-8f1f-d5e82cc9c526`
- [SPORT BILD Football](https://sportbild.bild.de/fussball/internationaler-fussball/so-brutal-war-der-ueberfall-auf-donnarumma-und-seine-frau-6aa3c79e56f343d9f4dd189a) · raw `6c59d388-777f-48b6-a7a5-aae1310aa05b`

**Edson Álvarez: emberrablási vádak visszautasítása**
- [Daily Star Football](https://www.dailystar.co.uk/sport/football/west-ham-united-edson-alvarez-37649939) · raw `f80da132-78e1-4cff-954f-ca138aa036ce`
- [Daily Mail Football](https://www.dailymail.com/sport/football/article-16121729/West-Ham-footballer-Edson-Alvarez-forced-deny-bombshell-claims-linking-KIDNAPPING-plot.html?ns_mchannel=rss&ns_campaign=1490&ito=1490) · raw `166649c2-4e38-4208-bf20-f7b7d7cc5aeb`
- [Daily Mirror Football](https://www.mirror.co.uk/sport/football/news/west-ham-united-edson-alvarez-37650221) · raw `73e93d84-666d-4011-a725-f2c0b7858558`
- [talkSPORT Football](https://talksport.com/football/4573277/west-ham-edson-alvarez-kidnapping-allegations-statement/) · raw `f144700d-244c-4147-bce3-c4d7d83470b5`

**Sorba Thomas autóbalesete a Hull City edzőpályája közelében**
- [Daily Mirror Football](https://www.mirror.co.uk/sport/football/news/sorba-thomas-hull-car-crash-37651323) · raw `ed2738bf-5626-44d5-afb7-f19055287aa0`
- [Daily Express Football](https://www.express.co.uk/sport/football/2247665/Hull-Thomas-Premier-League-Car-Crash-Statement) · raw `7bce8d06-ae31-4c6d-acc6-7b4df906c736`

## Editorial gold set

32 explicit példa, mindkét módban: **64/64 PASS**. A fixture-goldset külön ellenőrzés, nem része a friss RSS-countnak; a friss súlyos false positive-okat nem fedi le.

| PÉLDA | EXPECTED | ACTUAL DIRECT | ACTUAL BROAD | PASS/FAIL |
| --- | --- | --- | --- | --- |
| Man City ace Donnarumma ‘bound and hit’ when robbers raided flat… as judge suspends first day of ‘catastrophic’ trial | ACCEPT | ACCEPT | ACCEPT | PASS |
| West Ham star issues strong statement over wild kidnap plot claims | ACCEPT | ACCEPT | ACCEPT | PASS |
| Premier League stars obsessed with collecting football cards in their free time | ACCEPT | ACCEPT | ACCEPT | PASS |
| Marcos Llorente, sobre sus fotos con Ferran Torres: «Me sorprende que en 2026 siga generando debate que dos hombres se den cariño» | ACCEPT | ACCEPT | ACCEPT | PASS |
| El vídeo más viral: cazan a Olise en un barco tocando a una joven que le hace twerking en bikini | ACCEPT | ACCEPT | ACCEPT | PASS |
| Pillan a Nico Williams en un barco con varias mujeres horas después de romper con su novia: las fotos que revolucionan las redes | ACCEPT | ACCEPT | ACCEPT | PASS |
| Diamante Crispino, l'ex portiere di Napoli e Como protagonista a Temptation Island con la fidanzata Bernadette | ACCEPT | ACCEPT | ACCEPT | PASS |
| Donnarumma e Alessia Elefante sposi: sarà per sempre sì, l’annuncio social. Ma intanto l’Arsenal scappa | ACCEPT | ACCEPT | ACCEPT | PASS |
| David e Victoria Beckham turisti tra le vie di Capri | ACCEPT | ACCEPT | ACCEPT | PASS |
| Francesco Totti e Ilary Blasi, la scelta delle due feste separate per la comunione della figlia Isabel | ACCEPT | ACCEPT | ACCEPT | PASS |
| Alisha Lehmann a Wimbledon con il nuovo fidanzato Montel McKenzie: anello in vista, Douglas Luiz e la Juventus dimenticati | ACCEPT | ACCEPT | ACCEPT | PASS |
| Manu Koné fa impazzire la Francia per una collana: "Si è spinto oltre". Ecco qual è e quanto costa | ACCEPT | ACCEPT | ACCEPT | PASS |
| El Shaarawy e Ludovica Pagani trasformano il loro matrimonio in un gesto di solidarietà: l'iniziativa | ACCEPT | ACCEPT | ACCEPT | PASS |
| Fiocco blu in casa Leotta-Karius, è nato il secondogenito Leonardo: l'annuncio sui social | ACCEPT | ACCEPT | ACCEPT | PASS |
| Arsenal match report: furious fans | REJECT | REJECT | REJECT | PASS |
| Stuttgart feiert Demirovic-Party nach Dreipack | REJECT | REJECT | REJECT | PASS |
| Real Madrid live score: fans react | REJECT | REJECT | REJECT | PASS |
| Juventus pagelle: polemica | REJECT | REJECT | REJECT | PASS |
| Palmeri: Il Napoli si è difeso bene con Arsenal e basta | REJECT | REJECT | REJECT | PASS |
| Arsenal lineup sparks outrage | REJECT | REJECT | REJECT | PASS |
| Gasperini: Koné infortunio e problema muscolare | REJECT | REJECT | REJECT | PASS |
| Bundesliga Tabelle und Ergebnisse | REJECT | REJECT | REJECT | PASS |
| Wieso läuft die Champions League am Donnerstag? | REJECT | REJECT | REJECT | PASS |
| Richarlison will weg: Tottenham-Streit eskaliert | REJECT | REJECT | REJECT | PASS |
| Messi signs new contract: fans celebrate | REJECT | REJECT | REJECT | PASS |
| Real Madrid: polémica por el límite salarial | REJECT | REJECT | REJECT | PASS |
| Arsenal TV guide: where to watch the match live | REJECT | REJECT | REJECT | PASS |
| Taylor Swift and Travis Kelce wedding: football star opens up | REJECT | REJECT | REJECT | PASS |
| Kansas City Chiefs star and his girlfriend on holiday | REJECT | REJECT | REJECT | PASS |
| Football fans love this viral party photo | REJECT | REJECT | REJECT | PASS |
| Soundhood SON Estrella Galicia returns to Barcelona for a music party | REJECT | REJECT | REJECT | PASS |
| Ex-Premier League star delivers ambitious invite to Raheem Sterling, Jadon Sancho and other free agents to join second tier club | REJECT | REJECT | REJECT | PASS |

## Képvalidáció — mind a 27 ACCEPT raw rekord

**25/27 remote URL (92,6%)**. Ez technikai filter-ACCEPT coverage, a két P0 false positive is benne van. Ismeretlen deklarált méret esetén csak engedélyezett article-level metadata fallback; méretet nem találtunk ki. Képfájl GET/HEAD, download, rehost, cache és URL-rewrite: 0. A DB-visszaolvasás minden tárolt URL-t változatlanul egyezőnek talált.

| SOURCE | CÍM | IMAGE SOURCE | DECLARED WIDTH | REMOTE URL | RAW ID |
| --- | --- | --- | --- | --- | --- |
| The Sun / SunSport Football | Man Utd brutally strip 685 fans of their season tickets and warn 464 more amid controversial ticket touting crackdown | srcset | 6000 | YES | 2956fc66-fbf3-44da-b5fb-12979aead0d9 |
| Daily Star Football | Premier League ace and pregnant girlfriend 'hit and bound' in horrific knifepoint robbery | srcset | 1200 | YES | 825fa7cf-bb4b-44e1-bcdc-d0b1854b2a5b |
| Daily Star Football | West Ham star issues strong statement over wild kidnap plot claims | srcset | 1200 | YES | f80da132-78e1-4cff-954f-ca138aa036ce |
| Daily Mail Football | Man City star Gianluigi Donnarumma and his pregnant girlfriend 'hit, bound and threatened with a knife by robbers while sleeping in their Paris flat' | og | 1200 | YES | 7c4886e5-02c0-4048-ba41-fa9d1353f525 |
| The Sun / SunSport Football | Man City ace Donnarumma ‘bound and hit’ when robbers raided flat… as judge suspends first day of ‘catastrophic’ trial | srcset | 4932 | YES | 9cd85992-5b9e-427b-be08-12060d327ffe |
| Daily Mail Football | How Kai Havertz and Martin Odegaard's inseparable bond is powering their resurgent form - trips abroad together, the running joke at Arsenal's HQ and how Gunners captain helped Havertz and his wife Sophia cope with vile abuse | — | UNKNOWN | NO | 57e2b82c-6840-4d9e-a5ae-8ebae7a3d4c7 |
| Daily Star Football | Porto star 'grabbed Erling Haaland's bum' after Champions League tunnel chaos | srcset | 1200 | YES | 9111b514-10c1-4750-b5ef-d9f9ea4148cf |
| Daily Mail Football | West Ham footballer Edson Alvarez forced to deny bombshell claims linking him to a KIDNAPPING plot | og | 1200 | YES | 166649c2-4e38-4208-bf20-f7b7d7cc5aeb |
| Daily Mail Football | Manchester United facing ANOTHER protest... as furious local residents hit back over club's plans to open fanzone behind the Stretford End | og | 1200 | YES | d7d93962-4f40-40c5-aefc-638eec5e0ff3 |
| Daily Mirror Football | Premier League star flips car onto roof in terrifying incident as club release statement | srcset | 1200 | YES | ed2738bf-5626-44d5-afb7-f19055287aa0 |
| Daily Mirror Football | Premier League stars obsessed with collecting football cards in their free time | srcset | 1200 | YES | 4e5bab34-60ba-4047-8c1c-2998a81c6cad |
| Daily Mail Football | Rodri apologises after leaked video showed Barcelona star brutally ridiculing Spanish rivals Valencia | og | 1200 | YES | da184ba3-3473-44df-b8e0-b045715ad604 |
| Daily Mirror Football | Mikel Arteta reveals bizarre traps including air con trick to stop Arsenal stars 'panicking' | srcset | 1200 | YES | 48ef626c-893c-4ba2-9134-43ffb0942bd5 |
| Daily Mirror Football | Man City's Gianluigi Donnarumma and pregnant girlfriend 'bound and hit' in terrifying robbery | srcset | 1200 | YES | 40af8232-25da-4a9b-a46b-87e844a591d3 |
| Daily Mirror Football | West Ham star threatens legal action over 'false allegations' after kidnap claims | srcset | 1200 | YES | 73e93d84-666d-4011-a725-f2c0b7858558 |
| Daily Express Football | Gianluigi Donnarumma and pregnant girlfriend 'bound and hit' by knife-wielding robbers | og | 1200 | YES | d160f8f7-4103-4e78-8aa1-4d0e06e3ce4b |
| Daily Express Football | Premier League star involved in car crash near training ground as club release statement | og | 1200 | YES | 7bce8d06-ae31-4c6d-acc6-7b4df906c736 |
| talkSPORT Football | West Ham midfielder Edson Alvarez furiously rejects allegations he was involved in a kidnapping plot | srcset | 3760 | YES | f144700d-244c-4147-bce3-c4d7d83470b5 |
| OKDIARIO Paparazzi | Salen a la luz todos los detalles del asalto armado a Donnarumma y su novia embarazada | og | 1800 | YES | 235a257d-9cf0-4bd1-8f1f-d5e82cc9c526 |
| Tuttosport Calcio | Kone, niente esami ma resta in dubbio per Torino-Roma: le condizioni del centrocampista | og | UNKNOWN | YES | c4162d81-537a-45b3-8889-9d91cf92523e |
| Tuttosport Calcio | Scandalo Eto’o, "mezzo milione dalla Russia mai depositato": cosa è successo | og | UNKNOWN | YES | bd6b6e32-af72-4723-a0d1-3028df6daaf5 |
| Gazzetta Calcio | Brignoli e l'esordio in Champions a 35 anni: "A Donnarumma chiederò la maglia, a Gasp una... foto!" | — | UNKNOWN | NO | 1553ef2a-89de-45fa-9069-579fff9c80f6 |
| SPORT BILD Football | Horror-Prozess eskaliert - So brutal war der Überfall auf Donnarumma und seine Frau | json-ld | 1280 | YES | 6c59d388-777f-48b6-a7a5-aae1310aa05b |
| BILD Sport | Es geht um ein Buch - Neuer Zoff zwischen Horner und Red Bull | json-ld | 1280 | YES | dd6ab228-5094-4ee9-84a0-de4600ad8265 |
| SPORT BILD Football | Total bizarres Gespräch - Warum Olise das Interview geben musste | srcset | 992 | YES | 4aa56936-1fba-40d8-b1c2-2bff403b98ef |
| SPORT BILD Football | Nach dem WM-Finale - Trump verblüfft Weltmeister-Coach mit Ballon-d'Or-Spruch | json-ld | 1280 | YES | 670a2d4c-fed8-4efb-ad80-319fe5910af4 |
| Kronen Zeitung Fussball | Nicht ganz dicht - Barcas Milliarden-Projekt Stadion: Es regnet rein | media:content | 1260 | YES | f6e5155a-c055-4ce6-91fc-50d44f70b94e |

A teljes remote URL-k a JSON-riportban és a Preview raw_articles.image_url mezőben találhatók; a riport nem ágyaz be képeket és nem tölt le képfájlt.

## DB safety

| ELLENŐRZÉS | ELŐTTE | UTÁNA | EREDMÉNY |
| --- | --- | --- | --- |
| raw_articles | 261 | 796 | +535, kizárólag Preview |
| pipeline_jobs összes (örökölt történeti jobokkal) | 1403 | 1403 | változatlan, tartalmi hash is |
| pending/in_progress queue | 0 | 0 | PASS |
| ehhez a futáshoz tartozó Writer-job | 0 | 0 | PASS |
| stories (örökölt adat) | 103 | 103 | 0 új; tartalmi hash változatlan |
| story_versions (örökölt adat) | 168 | 168 | 0 generált verzió; tartalmi hash változatlan |
| agent_runs | 4887 | 4887 | változatlan |
| aktív source-ok | 0 | 0 | 0, kézi one-shot fetch |
| új raw → Story link | 0 | 0 | PASS |
| Gemini-hívások | 0 | 0 | Writer kliens nincs importálva / hívva |
| AUTO-PUBLISH | OFF | OFF | explicit false a futtatóban; Vercel configot nem módosítottuk |
| corporate cron | OFF | OFF | Safari: No cron triggers configured |

Production: a munkamenet egyetlen DB-kliense a hardcoded-ellenőrzött Preview hosthoz kapcsolódott; Production DB/secret/config nem lett elérve vagy módosítva. Ez a saját műveleteink izolációjának bizonyítéka; más párhuzamos kliensek tevékenységéről nem állít globális auditot.

Validáció után nem történt új hangolás vagy ismételt ingest. A futás befejezését és DB-visszaolvasását követően a megmaradó operátori folyamatot leállítottuk; új hálózati futás nem indult. A futtató lezárási kódja ezután explicitté lett téve a jövőbeli one-shot kilépéshez.

## Forrásonként legfeljebb 10 ACCEPT és 10 REJECT cím

### The Sun / SunSport Football (en, BROAD_TABLOID_FOOTBALL)

**ACCEPT**
- [Man Utd brutally strip 685 fans of their season tickets and warn 464 more amid controversial ticket touting crackdown](https://www.thesun.co.uk/sport/40346472/man-utd-season-tickets-tout-crackdown/) · raw `2956fc66-fbf3-44da-b5fb-12979aead0d9`
- [Man City ace Donnarumma ‘bound and hit’ when robbers raided flat… as judge suspends first day of ‘catastrophic’ trial](https://www.thesun.co.uk/sport/40342876/man-city-ace-robbed-flat-trial-suspended/) · raw `9cd85992-5b9e-427b-be08-12060d327ffe`

**REJECT**
- [Premier League cult hero, 46, takes charge of Fenerbahce as Champions League club refuse to accept manager’s resignation](https://www.thesun.co.uk/sport/40347902/dirk-kuty-premier-league-legend-fenerbahce-manager-resignation/) · raw `7a29af70-e6c4-42f0-81a2-903e68cc1cff`
- [Lamine Camara lifts lid on failed Chelsea deadline day move after Monaco pulled plug despite £47m transfer agreement](https://www.thesun.co.uk/sport/40347357/lamine-camara-reveals-failed-chelsea-transfer-monaco/) · raw `8e3e3d45-85ba-44bb-8f47-af7ab3ab4aa5`
- [Mikel Arteta admits he deliberately sabotaged Arsenal players by delaying travel, ruining meals & cranking up heating](https://www.thesun.co.uk/sport/40347195/arteta-sabotaged-arsenal-players-delayed-travel-ruined-meals/) · raw `b71512d9-da9b-40c4-ad9e-f899f3da1860`
- [Mikel Arteta left stunned by Gabriel Jesus after explosive comments on Arsenal exit but admits he has to play ‘bad cop’](https://www.thesun.co.uk/sport/40347148/mikel-arteta-stunned-by-gabriel-jesus-comments-arsenal-exit/) · raw `eb0ad88f-26b0-45fd-bafe-2cf4e269ffca`
- [‘Didn’t like my role’ – Christopher Nkunku lifts lid on Chelsea nightmare and also SLAMS ex-Man Utd boss Ruben Amorim](https://www.thesun.co.uk/sport/40344480/christopher-nkunku-on-chelsea-nightmare-and-ruben-amorim/) · raw `ac713821-bdf5-4d20-86fd-fe40ae0286ce`
- [Inside Malick Fofana’s crazy 55-hour Sunderland transfer ordeal from owner’s crucial intervention to Arsenal snub](https://www.thesun.co.uk/sport/40324223/malick-fofanas-sunderland-palace-arsenal/) · raw `395fb3a4-76dd-4d87-a8d4-04bba8a03317`
- [Amanda Staveley breaks silence after failing in bid to buy West Ham stake… but admits ambitions for Hammers NOT over](https://www.thesun.co.uk/sport/40344885/amanda-staveley-west-ham-stake-bid-failure/) · raw `1b6d44d8-0c08-434d-8050-e3515a0aa0f8`
- [Premier League star flips £60,000 Land Rover Defender on way to training days after £10million summer transfer](https://www.thesun.co.uk/sport/40345748/sorba-thomas-flips-land-rover-defender-way-training/) · raw `ed5190fa-148b-4e87-94a7-c2d509c2dbac`
- [See Lionel Messi at Inter Miami game then enjoy Caribbean cruise from £1,649 with flights, tickets and hotel included](https://www.thesun.co.uk/sport/39491917/lionel-messi-inter-miami-match-cruise-tickets-flights-holiday/) · raw `0acee92a-21e4-4c8a-988a-85b564ab1fe6`
- [Man United tickets with hotels and VIP hospitality deals for Premier League and Champions League clash v Sabah](https://www.thesun.co.uk/sport/39220790/man-united-premier-league-ticket-hotel-packages-old-trafford/) · raw `99a02ed7-7125-4434-89ad-beb0e293b221`

### Daily Star Football (en, BROAD_TABLOID_FOOTBALL)

**ACCEPT**
- [Premier League ace and pregnant girlfriend 'hit and bound' in horrific knifepoint robbery](https://www.dailystar.co.uk/sport/football/gianluigi-donnarumma-alessia-knifepoint-robbery-37650882) · raw `825fa7cf-bb4b-44e1-bcdc-d0b1854b2a5b`
- [West Ham star issues strong statement over wild kidnap plot claims](https://www.dailystar.co.uk/sport/football/west-ham-united-edson-alvarez-37649939) · raw `f80da132-78e1-4cff-954f-ca138aa036ce`
- [Porto star 'grabbed Erling Haaland's bum' after Champions League tunnel chaos](https://www.dailystar.co.uk/sport/football/erling-haaland-man-city-porto-37645169) · raw `9111b514-10c1-4750-b5ef-d9f9ea4148cf`

**REJECT**
- [Darren Fletcher confronts 'abusive' Man Utd fan as tempers flare at Old Trafford](https://www.dailystar.co.uk/sport/football/darren-fletcher-man-utd-fan-37651457) · raw `fe2d4175-8547-4f95-b8eb-da6e6159adee`
- [Premier League star crashes £60k Land Rover and flips it onto roof as club issue statement](https://www.dailystar.co.uk/sport/football/sorba-thomas-hull-car-crash-37651471) · raw `0ed51a7c-31e2-4584-b919-5f076a2c4e4e`
- [Arsenal news: Two players snubbed in controversy as star told he 'missed an opportunity'](https://www.dailystar.co.uk/sport/football/arsenal-news-transfers-declan-rice-37650679) · raw `ffdb188a-46a6-4858-a7c1-e26495e3255a`
- [Michael Carrick's key tactical decision as Man Utd make emphatic Champions League return](https://www.dailystar.co.uk/sport/football/breaking-michael-carrick-man-utd-37650038) · raw `e9276c8f-6dfa-4798-9434-4b35eaa618c3`
- [Man Utd news: Michael Carrick enforces new rule as challenge to players laid down](https://www.dailystar.co.uk/sport/football/man-utd-news-transfers-carrick-37650476) · raw `6593be78-7847-4db3-827c-507b52405408`
- [Liverpool news: Transfer update for £47m defender as issue highlighted with star](https://www.dailystar.co.uk/sport/football/liverpool-news-transfers-araujo-barcola-37650663) · raw `7b593290-4f79-4fe9-91a2-7207fa5d817b`
- [Man Utd icon ignored 'all the nonsense' after record transfer – 'everyone's an expert'](https://www.dailystar.co.uk/sport/football/andy-cole-manchester-united-newcastle-37645181) · raw `a748fc8e-0217-44c5-977a-a8234deeaf03`
- [Liverpool star Alisson hit with massive fine after actions during Premier League clash](https://www.dailystar.co.uk/sport/football/liverpool-star-alisson-fined-fa-37648956) · raw `a5891196-ad0a-4871-b322-ed3032d53f2b`
- ['Argentina stars who can't speak English are pathetic – learn the lingo or get out'](https://www.dailystar.co.uk/sport/football/argentina-footballers-english-enzo-fernandez-37647763) · raw `c2f56e5e-6364-41e5-bb03-6066cec1133f`
- [Wrexham's Prem dream gets serious as ex-Newcastle chief arrives — is Parkinson at risk?](https://www.dailystar.co.uk/sport/football/wrexhams-prem-dream-gets-serious-37648931) · raw `9330e141-2be6-4a57-b3ab-c2b6f3764152`

### Daily Mail Football (en, BROAD_TABLOID_FOOTBALL)

**ACCEPT**
- [West Ham footballer Edson Alvarez forced to deny bombshell claims linking him to a KIDNAPPING plot](https://www.dailymail.com/sport/football/article-16121729/West-Ham-footballer-Edson-Alvarez-forced-deny-bombshell-claims-linking-KIDNAPPING-plot.html?ns_mchannel=rss&ns_campaign=1490&ito=1490) · raw `166649c2-4e38-4208-bf20-f7b7d7cc5aeb`
- [Man City star Gianluigi Donnarumma and his pregnant girlfriend 'hit, bound and threatened with a knife by robbers while sleeping in their Paris flat'](https://www.dailymail.com/sport/football/article-16121869/Man-City-star-Gianluigi-Donnarumma-pregnant-girlfriend-hit-bound-threatened-knife-robbers-sleeping-Paris-flat.html?ns_mchannel=rss&ns_campaign=1490&ito=1490) · raw `7c4886e5-02c0-4048-ba41-fa9d1353f525`
- [How Kai Havertz and Martin Odegaard's inseparable bond is powering their resurgent form - trips abroad together, the running joke at Arsenal's HQ and how Gunners captain helped Havertz and his wife Sophia cope with vile abuse](https://www.dailymail.com/sport/football/article-16121131/kai-havertz-martin-odegaard-arsenal-bond.html?ns_mchannel=rss&ns_campaign=1490&ito=1490) · raw `57e2b82c-6840-4d9e-a5ae-8ebae7a3d4c7`
- [Manchester United facing ANOTHER protest... as furious local residents hit back over club's plans to open fanzone behind the Stretford End](https://www.dailymail.com/sport/football/article-16120705/Manchester-United-facing-protest-furious-locals.html?ns_mchannel=rss&ns_campaign=1490&ito=1490) · raw `d7d93962-4f40-40c5-aefc-638eec5e0ff3`
- [Rodri apologises after leaked video showed Barcelona star brutally ridiculing Spanish rivals Valencia](https://www.dailymail.com/sport/football/article-16119895/Rodri-apologises-leaked-video-showed-Barcelona-star-brutally-ridiculing-Spanish-rivals-Valencia.html?ns_mchannel=rss&ns_campaign=1490&ito=1490) · raw `da184ba3-3473-44df-b8e0-b045715ad604`

**REJECT**
- [Mikel Arteta reveals his new bonkers management technique: SABOTAGING his own team! Arsenal boss 'delayed transport, ramped up dressing room thermostats and removed beds' to 'challenge' his players](https://www.dailymail.com/sport/football/article-16123221/Mikel-Arteta-new-bonkers-management-technique-SABOTAGING-Arsenal-delayed-transport-dressing-room-thermostats-removed-beds.html?ns_mchannel=rss&ns_campaign=1490&ito=1490) · raw `05722ed7-da45-44ee-89ac-ad1b317b85a5`
- [How Aaron Ramsdale fell to become FOURTH-CHOICE in the Championship: Insiders speak out on ex-Arsenal keeper - now playing in front of just 246 fans after transfers worth £80m](https://www.dailymail.com/sport/football/article-16123309/aaron-ramsdale-southampton-championship-demotion.html?ns_mchannel=rss&ns_campaign=1490&ito=1490) · raw `73ddebc1-f54a-4180-a33a-c672eed91413`
- [Premier League LIVE: Lewis Hall signs new Newcastle contract - plus Andoni Iraola, Enzo Maresca, Xabi Alonso and Roberto De Zerbi speak ahead of weekend games](https://www.dailymail.com/sport/football/article-16123185/Premier-League-LIVE-Lewis-Hall-Newcastle-Andoni-Iraola-Enzo-Maresca-Xabi-Alonso-Roberto-Zerbi.html?ns_mchannel=rss&ns_campaign=1490&ito=1490) · raw `8c5c403d-e963-486d-a9d8-135fe14eb5ce`
- [Darren Fletcher puts 'abusive' Man United autograph-hunters in their place: Coach shouts back after angry fans attacked players for not stopping when they wanted to meet their heroes](https://www.dailymail.com/sport/football/article-16122849/Darren-Fletcher-abusive-Man-United-autograph-hunters-shouts-angry-fans-players-not-stopping-wanted-meet-heroes.html?ns_mchannel=rss&ns_campaign=1490&ito=1490) · raw `e273a1ee-4494-431b-b3f7-44525180557e`
- [Premier League star flips his £160,000 car on its roof in crash: Hull City's new £10m signing left hanging upside down in his Land Rover Defender while on the way to training](https://www.dailymail.com/sport/football/article-16123111/sorba-thomas-hull-city-car-crash.html?ns_mchannel=rss&ns_campaign=1490&ito=1490) · raw `6d9cee90-9aae-49ba-9375-96c9c31e8c62`
- [I've seen JJ Gabriel's supreme talent develop first-hand: This is why he MUST be fast-tracked into Man United's squad for the Carabao Cup, the team-mates he's wowing at Carrington and the real reason he's deleted his United photos on Instagram](https://www.dailymail.com/sport/football/article-16123199/jj-gabriel-manchester-united-talent-carabao-cup.html?ns_mchannel=rss&ns_campaign=1490&ito=1490) · raw `54935de0-fbc6-451d-bc5a-491c4be1ac7e`
- [Fenerbahce's night of chaos: Manager QUITS after 1-1 draw against Roma - with angry fan launching a bottle at him from the stands - as stunned English star learns of decision during live interview](https://www.dailymail.com/sport/football/article-16123001/fenerbahce-manager-ismail-kartal-resigns-bottle.html?ns_mchannel=rss&ns_campaign=1490&ito=1490) · raw `8e3b4121-5871-48f9-89f1-c890d8f3d6be`
- [Gary Neville names Man United's 'best XI' for the derby against Man City - and includes one of three players 'they were banking on selling' this summer](https://www.dailymail.com/sport/football/article-16122923/gary-neville-man-united-best-xi.html?ns_mchannel=rss&ns_campaign=1490&ito=1490) · raw `2f75aa97-680b-47b5-b736-dbb57c979670`
- [Why Man City are fired up to end their Old Trafford hoodoo: Squad unity, the star duo drumming standards into newcomers and the missing ingredient players say Enzo Maresca has added ahead of Man United clash](https://www.dailymail.com/sport/football/article-16117927/man-city-old-trafford-united-maresca.html?ns_mchannel=rss&ns_campaign=1490&ito=1490) · raw `8fdd5d0e-caf4-4c4d-959f-767acfb6987d`
- [How Patrick Dorgu fared on his left-back audition in Man United's win over Sabah: The key areas he needs to improve, where he is BETTER than Luke Shaw and what Michael Carrick learnt ahead of Man City clash](https://www.dailymail.com/sport/football/article-16120561/How-Patrick-Dorgu-fared-left-audition-Man-Uniteds-win-Sabah-key-areas-needs-improve-BETTER-Luke-Shaw-Michael-Carrick-learnt-ahead-Man-City-clash.html?ns_mchannel=rss&ns_campaign=1490&ito=1490) · raw `3adb8f68-c1fd-4fea-84bb-0208daea8335`

### Daily Mirror Football (en, BROAD_TABLOID_FOOTBALL)

**ACCEPT**
- [Premier League star flips car onto roof in terrifying incident as club release statement](https://www.mirror.co.uk/sport/football/news/sorba-thomas-hull-car-crash-37651323) · raw `ed2738bf-5626-44d5-afb7-f19055287aa0`
- [Mikel Arteta reveals bizarre traps including air con trick to stop Arsenal stars 'panicking'](https://www.mirror.co.uk/sport/football/news/mikel-arteta-arsenal-press-conference-37651344) · raw `48ef626c-893c-4ba2-9134-43ffb0942bd5`
- [Man City's Gianluigi Donnarumma and pregnant girlfriend 'bound and hit' in terrifying robbery](https://www.mirror.co.uk/sport/football/news/man-city-gianluigi-donnarumma-psg-37650409) · raw `40af8232-25da-4a9b-a46b-87e844a591d3`
- [West Ham star threatens legal action over 'false allegations' after kidnap claims](https://www.mirror.co.uk/sport/football/news/west-ham-united-edson-alvarez-37650221) · raw `73e93d84-666d-4011-a725-f2c0b7858558`
- [Premier League stars obsessed with collecting football cards in their free time](https://www.mirror.co.uk/sport/football/news/premier-league-stars-obsessed-collecting-37650261) · raw `4e5bab34-60ba-4047-8c1c-2998a81c6cad`

**REJECT**
- [England U21s all-time top goalscorer asked to change allegiance despite senior cap](https://www.mirror.co.uk/sport/football/news/england-u21s-eddie-nketiah-ghana-37651394) · raw `178c5965-09a3-44df-a08d-9d9fecc7c1a8`
- [Lisandro Martinez trolls Jamie Carragher as Man Utd star leaves Micah Richards in hysterics](https://www.mirror.co.uk/sport/football/news/lisandro-martinez-jamie-carragher-united-37651219) · raw `3416771d-5a5e-414a-a9f4-9152719cab82`
- [Mikel Arteta 'close to signing' new Arsenal contract despite one move interesting him](https://www.mirror.co.uk/sport/football/news/mikel-arteta-arsenal-contract-future-37650626) · raw `a2865a0a-6d89-4f4f-bfde-1a4b66509263`
- [Jamie Carragher warns Michael Carrick he faces same problem as Gareth Southgate](https://www.mirror.co.uk/sport/football/news/jamie-carragher-warns-michael-carrick-37651163) · raw `001ab5d7-5ff2-44c5-a052-11f1e6906859`
- [Darren Fletcher cheered as 'abusive Man Utd fan' put in place after Champions League win](https://www.mirror.co.uk/sport/football/news/man-utd-darren-fletcher-sabah-37650423) · raw `85f27262-8486-4b0f-bd2e-3ad3307c7f92`
- [Mikel Arteta fires back at Gabriel Jesus as row over bitter Arsenal transfer exit escalates](https://www.mirror.co.uk/sport/football/news/arsenal-mikel-arteta-gabriel-jesus-37650988) · raw `7eaff618-40f5-47ca-a019-81ef96d200a2`
- [Liverpool news: Bradley Barcola issue called out as transfer chief breaks silence on star](https://www.mirror.co.uk/sport/football/news/liverpool-bradley-barcola-ronald-araujo-37648874) · raw `16631c28-f04c-4fd5-b9fb-9d4fd71e1e5f`
- [Bruno Fernandes injury scare as Man Utd star seen 'limping' ahead of Manchester derby](https://www.mirror.co.uk/sport/football/news/bruno-fernandes-man-utd-injury-37650430) · raw `416410c7-27d5-4c27-b573-26effcf3e40a`
- [Man Utd news: Michael Carrick makes rule change as club's Premier League request granted](https://www.mirror.co.uk/sport/football/news/man-utd-carrick-premier-league-37648560) · raw `30e9e8cc-45e3-4bb5-8ccf-7a4a0fbac65e`
- [Arsenal news: Declan Rice makes risky comment as 'rusty' star called out](https://www.mirror.co.uk/sport/football/news/arsenal-declan-rice-champions-league-37648003) · raw `51b07c33-fa12-490a-a9f4-6f879790c9bb`

### SPORTbible Football (en, BROAD_TABLOID_FOOTBALL)

**ACCEPT**

Nincs új ilyen döntés a mintában.

**REJECT**
- [Darren Fletcher involved in heated exchange with Man United fans after Sabah win](https://www.sportbible.com/football/football-news/man-utd/man-utd-sabah-champions-league-darren-fletcher-772355-20260911) · raw `fa9f16cf-8bff-46a1-8c4a-c9d71d9a1af4`
- [Anthony Gordon hands Barcelona unexpected boost worth millions after just five games for the club](https://www.sportbible.com/football/la-liga/fc-barcelona/anthony-gordon-transfer-boost-millions-first-matches-438869-20260911) · raw `07c10c4d-9098-4ce7-81ed-c39c9c8a4d14`
- [Michael Olise divides football fans with uncomfortable interview after Bayern Munich win in Champions League](https://www.sportbible.com/football/football-news/champions-league/michael-olise-interview-bayern-munich-768368-20260911) · raw `95d08bf6-0c36-4a61-8590-4506db954394`
- [Non-league star who smashed Jamie Vardy's transfer record makes debut for new club](https://www.sportbible.com/football/football-news/jamie-vardy-national-league-record-abdul-abdulmalik-501810-20260911) · raw `a794e810-4969-4cbe-bfa0-3ae8aec33d84`
- [Archie Brown finds out during post-match interview that Fenerbahce manager Ismail Kartal has resigned](https://www.sportbible.com/football/football-news/champions-league/archie-brown-finds-out-fenerbahce-manager-ismail-kartal-has-resigned-262886-20260910) · raw `8aaea9c5-cf5f-4200-b9ee-364e39ead821`
- [Lisandro Martinez gets round of applause from CBS studio for response to 'who is your favourite pundit on the show'](https://www.sportbible.com/football/football-news/man-utd/lisandro-martinez-cbs-interview-thierry-henry-micah-richards-carragher-547140-20260910) · raw `8d31c722-2380-4294-923e-8ed4597e5290`
- [Jamie Carragher forced to address elephant in the room during viral Lisandro Martinez interview](https://www.sportbible.com/football/football-news/man-utd/lisandro-martinez-interview-jamie-carragher-cbs-929529-20260911) · raw `d9c31a9c-50af-47db-88ac-c46bf1a33cbc`
- [Why Bryan Mbeumo, Patrick Dorgu and Leny Yoro are wearing different kits to Man Utd teammates vs Sabah](https://www.sportbible.com/football/football-news/champions-league/bryan-mbeumo-is-wearing-different-kit-to-man-utd-teammates-vs-sabah-170692-20260910) · raw `a2250afb-38b8-4ebb-9992-b51d6ebb15c4`
- [Marcus Rashford receives explanation from Barcelona behind decision to snub him for Anthony Gordon](https://www.sportbible.com/football/football-news/man-utd/marcus-rashford-explanation-from-barcelona-decision-anthony-gordon-339957-20260910) · raw `19116108-bcc2-4eeb-9818-b4688c5e84cf`
- [What would actually happen if Chelsea were stripped of 2017 Premier League title after Mauricio Pochettino demand](https://www.sportbible.com/football/premier-league/chelsea-stripped-title-tottenham-hotspur-pochettino-what-would-happen-895607-20260910) · raw `7c8705fb-63f5-49c4-a084-f49cad1fca30`

### Daily Express Football (en, BROAD_TABLOID_FOOTBALL)

**ACCEPT**
- [Premier League star involved in car crash near training ground as club release statement](https://www.express.co.uk/sport/football/2247665/Hull-Thomas-Premier-League-Car-Crash-Statement) · raw `7bce8d06-ae31-4c6d-acc6-7b4df906c736`
- [Gianluigi Donnarumma and pregnant girlfriend 'bound and hit' by knife-wielding robbers](https://www.express.co.uk/sport/football/2247635/Gianluigi-Donnarumma-girlfriend-robbers) · raw `d160f8f7-4103-4e78-8aa1-4d0e06e3ce4b`

**REJECT**
- [Jamie Carragher holds nothing back on Michael Carrick as Man Utd tipped to replace him](https://www.express.co.uk/sport/football/2247650/jamie-carragher-michael-carrick-man-utd) · raw `672232d6-9049-4908-9e81-032afcdba0bb`
- [Non-League's most expensive player leaves fans all saying same thing after debut in Europe](https://www.express.co.uk/sport/football/2247685/Abdul-Abdulmalik-transfer-Djurgarden-non-league) · raw `eb3e0ed6-2d7c-4d69-8265-f0c03c5532bd`
- [FPL injury news: Shaw, Gakpo, O'Reilly, Dedic, Timber, Garner latest for GW4](https://www.express.co.uk/sport/football/2247670/fpl-injury-news-shaw-gakpo-fernandes-oreilly-timber) · raw `a9e0d270-9d79-41fe-aced-a84c0850a83d`
- [Gary Neville calls out Michael Carrick as Man Utd decision slammed - 'You've got to stop'](https://www.express.co.uk/sport/football/2247653/Gary-Neville-Michael-Carrick-Man-Utd) · raw `3999f06e-8807-4ddb-8622-b087c87cb5f1`
- [Bruno Fernandes injury fears explode as Man Utd star spotted 'limping' after Sabah victory](https://www.express.co.uk/sport/football/2247593/Bruno-Fernandes-injury-Man-Utd) · raw `3d3b64d2-589f-474b-abb9-7ffdc0704fcf`
- [Arsenal news: Declan Rice snubs team-mates as 'rusty' star called out](https://www.express.co.uk/sport/football/2247562/arsenal-news-declan-rice) · raw `ac6a086d-b991-4629-a16e-5cbc960c09c0`
- [Champions League manager resigns immediately after full-time as players stunned](https://www.express.co.uk/sport/football/2247552/champions-league-manager-fenerbahce-Ismail-Kartal) · raw `9cce7c73-fd87-4243-b6e0-536c297979a2`
- [Man Utd player ratings vs Sabah: Bruno Fernandes the standout as six 7/10s shine](https://www.express.co.uk/sport/football/2247540/man-utd-player-ratings-sabah-champions-league-fernandes-sesko-dorgu) · raw `27a1b65f-d74d-4c04-98a5-e66b61cf42fc`

### Metro Football (en, BROAD_TABLOID_FOOTBALL)

**ACCEPT**

Nincs új ilyen döntés a mintában.

**REJECT**
- [Mikel Arteta responds to Arsenal star who claims he was mistreated during summer exit](https://metro.co.uk/2026/09/11/mikel-arteta-responds-arsenal-star-claims-mistreated-summer-exit-29585571/) · raw `e3bd28ce-1593-4716-b891-94f97028c225`
- [Enzo Maresca praises ‘very good’ Man Utd signing ahead of Manchester derby](https://metro.co.uk/2026/09/11/enzo-maresca-praises-very-good-man-utd-signing-ahead-manchester-derby-29585267/) · raw `2619578a-dee2-4c05-8ea3-2824f2773e34`
- [Premier League star crashes £160k Land Rover on residential street](https://metro.co.uk/2026/09/11/premier-league-star-crashes-160k-land-rover-residential-street-29585414/) · raw `af90e4d0-9e80-4b33-9a1b-a58aa0e4ac41`
- [Bruno Fernandes injury concern with Man Utd star spotted limping ahead of derby](https://metro.co.uk/2026/09/11/bruno-fernandes-injury-concern-man-utd-star-spotted-limping-ahead-derby-29584853/) · raw `04e42a0b-1ebc-4c2a-b1d7-2b1179485ca4`
- [Alan Shearer predicts who will beat Arsenal in Champions League final this season](https://metro.co.uk/2026/09/11/alan-shearer-predicts-will-beat-arsenal-champions-league-final-this-season-29584140/) · raw `f772170e-68b8-4979-9a1b-dbb8b5c94535`
- [Man Utd dealt blow as details of Lewis Hall’s Newcastle contract are revealed](https://metro.co.uk/2026/09/11/man-utd-dealt-blow-details-lewis-halls-newcastle-contract-revealed-29584316/) · raw `86756d9b-eb4c-4468-a5ef-0cf06c430166`
- [Enzo Maresca gives Nico O’Reilly injury update ahead of Man Utd vs Man City](https://metro.co.uk/2026/09/11/enzo-maresca-gives-nico-oreilly-injury-update-ahead-man-utd-vs-man-city-29584756/) · raw `4785f446-9995-4298-b08c-ed85100ad4ee`
- [Mikel Arteta gives injury update on Arsenal star who limped off against Napoli](https://metro.co.uk/2026/09/11/mikel-arteta-gives-injury-update-arsenal-star-limped-off-napoli-29584403/) · raw `77574399-2bb0-4054-b361-4c45dd6c1071`
- [Alan Shearer’s Premier League predictions including Man Utd vs Man City](https://metro.co.uk/2026/09/11/alan-shearers-premier-league-predictions-including-man-utd-vs-man-city-2-29583987/) · raw `3d32f5a0-473b-4031-ae67-2707433716ff`
- [Owen Hargreaves claims Man Utd star can become ‘best in the world’ after Champions League win](https://metro.co.uk/2026/09/10/owen-hargreaves-claims-man-utd-star-can-become-best-world-sabah-win-29581797/) · raw `9cef4266-b9e9-4550-a0e2-da69cc8bf0dd`

### Metro Oddballs (en, DIRECT_GOSSIP)

**ACCEPT**

Nincs új ilyen döntés a mintában.

**REJECT**

Nincs új ilyen döntés a mintában.

### talkSPORT Football (en, BROAD_TABLOID_FOOTBALL)

**ACCEPT**
- [West Ham midfielder Edson Alvarez furiously rejects allegations he was involved in a kidnapping plot](https://talksport.com/football/4573277/west-ham-edson-alvarez-kidnapping-allegations-statement/) · raw `f144700d-244c-4147-bce3-c4d7d83470b5`

**REJECT**
- [Sunderland vs Arsenal LIVE commentary: Match kick-off time moved as Guimaraes prepares for hostile debut](https://talksport.com/football/4567017/where-to-watch-sunderland-vs-arsenal-time-score-teams-commentary/) · raw `4b1a5715-1182-4d5c-8614-6144388e6c05`
- [Ex-Chelsea and Manchester United star Juan Mata becomes free agent and instantly lands new job](https://talksport.com/football/4574455/juan-mata-free-agent-melbourne-victory-new-job/) · raw `2b5cccd4-5a28-4e59-8c6c-a9fdf96610f6`
- [Hull player in rollover crash as car pictured upside down near training ground](https://talksport.com/football/4574621/hull-sorba-thomas-car-crash/) · raw `d13bc46b-f722-4483-b9ef-116f1e0c8885`
- [Man United should have cashed in on Bruno Fernandes when they had the chance](https://talksport.com/football/4574543/manchester-united-bruno-fernandes-sale-exit-analysis/) · raw `7ee0dd5c-e2fc-4e80-a3ce-d93f6854db1a`
- [‘Amazing story’ – How Loris Karius bounced back from night that almost ended his career](https://talksport.com/football/4567835/loris-karius-schalke-liverpool-real-madrid-champions-league-final/) · raw `8070f761-cf42-4429-8ecb-98e6c2788b94`
- [Why there is no 12:30pm Premier League kick-off this Saturday with Arsenal clash moved](https://talksport.com/football/4565074/why-no-premier-league-early-kick-off-arsenal-sunderland/) · raw `a4dd7e5c-aa4c-4b59-8651-d7acbdc63690`
- [Darren Fletcher seen confronting abusive Man United fan immediately after Champions League win](https://talksport.com/football/4573965/darren-fletcher-confrontation-man-united-fan-champions-league/) · raw `380e0d15-2673-4e4c-92ce-23860ca2d8d8`
- [Amanda Staveley breaks silence on West Ham saga and insists this isn’t over yet](https://talksport.com/football/4574205/amanda-staveley-breaks-silence-west-ham-takeover-saga/) · raw `4f382055-2562-4905-81b5-36c8cb565d8d`
- [England U21’s new Arjen Robben warned against Chelsea transfer from sister club](https://talksport.com/football/4566986/sam-amo-ameyaw-strasbourg-chelsea-england-arjen-robben/) · raw `7a9d77ab-f84f-4254-a8bd-508a17bf2acf`
- [Stunned Fenerbahce player has to double take during interview after learning manager resigned](https://talksport.com/football/4573801/fenerbahce-stunned-interview-archie-brown-ismail-kartal/) · raw `b4d20449-72de-48f9-a803-8babea14a46e`

### OKDIARIO Paparazzi (es, DIRECT_GOSSIP)

**ACCEPT**
- [Salen a la luz todos los detalles del asalto armado a Donnarumma y su novia embarazada](https://okdiario.com/deportes/salen-luz-todos-detalles-del-asalto-armado-donnarumma-novia-embarazada-20269181) · raw `235a257d-9cf0-4bd1-8f1f-d5e82cc9c526`

**REJECT**

Nincs új ilyen döntés a mintában.

### OKDIARIO Fútbol (es, BROAD_TABLOID_FOOTBALL)

**ACCEPT**

Nincs új ilyen döntés a mintában.

**REJECT**
- [El Real Madrid firma el récord absoluto del límite salarial y saca 250 millones a un Barcelona que crece un 66%](https://okdiario.com/deportes/real-madrid-firma-record-absoluto-del-limite-salarial-saca-250-millones-barcelona-que-crece-66-20267074) · raw `8cb617cf-420c-41af-bd70-56644f017713`
- [La prensa afín a Mohamed VI se mofa de España por la final del Mundial: «¿Harán un gran estadio en la Ceuta ocupada?»](https://okdiario.com/deportes/prensa-afin-mohamed-vi-mofa-espana-final-del-mundial-haran-gran-estadio-ceuta-ocupada-20267248) · raw `0c612eee-af1a-4231-bbab-d567d747f412`
- [La Champions cierra su primera jornada: el Como debuta a lo grande, United y Bayern golean y el Lens remonta](https://okdiario.com/deportes/champions-cierra-primera-jornada-como-debuta-lo-grande-united-bayern-golean-lens-remonta-20268486) · raw `03bb459f-b803-4132-8a12-1133465d6fb7`
- [La Federación pasa de Marruecos: «Es un movimiento político, la final la tenemos que hacer nosotros»](https://okdiario.com/deportes/federacion-pasa-marruecos-movimiento-politico-final-tenemos-que-hacer-nosotros-20267571) · raw `6440c25c-a459-4b36-b4d0-fffec5383aed`
- [La FIFA desmiente a Marruecos limitándose a repetir que la sede de la final del Mundial 2030 no está decidida](https://okdiario.com/deportes/fifa-desmiente-marruecos-limita-repetir-que-sede-final-del-mundial-2030-no-esta-decidida-20265990) · raw `6a3e0905-37e2-4906-825d-5facfb736f8d`
- [UFP arremete contra Marlaska por el expediente a los policías agredidos por el ultra del Barça: «Absolutamente inaceptable»](https://okdiario.com/deportes/ufp-arremete-contra-marlaska-expediente-policias-agredidos-ultra-del-barca-absolutamente-inaceptable-20265774) · raw `4015fe4f-c9c9-4739-9a0d-cea3cd660be6`
- [Pochettino le declara la guerra al Chelsea: pide que le den una Premier League nueve años después](https://okdiario.com/deportes/pochettino-declara-guerra-chelsea-pide-que-den-premier-league-nueve-anos-despues-20263899) · raw `35124d01-985f-4c38-8d9e-73960c33d704`
- [El Barcelona reniega ahora de Julián: «No le dijimos que expresara su deseo de irse del Atlético»](https://okdiario.com/deportes/barcelona-reniega-ahora-julian-no-dijimos-que-que-expresara-deseo-irse-del-atletico-20263579) · raw `9134c9ba-f63c-41f4-a51d-cbe215f073b2`
- [Koke pide «dejar en paz» a Julián Álvarez: «Sois muy cansinos»](https://okdiario.com/deportes/koke-pide-ahora-dejar-paz-julian-alvarez-sois-muy-cansinos-20263058) · raw `1d13c4ef-e5ca-42f8-9786-5e3887eacf76`
- [El presidente de la Federación de Marruecos y ministro del Gobierno dice que la final del Mundial 2030 será en Casablanca](https://okdiario.com/deportes/presidente-federacion-futbol-marruecos-asegura-que-final-del-mundial-2030-sera-casablanca-20263241) · raw `8dd249ee-83ec-4d27-a559-5e7b6275dd54`

### Mundo Deportivo El Otro Mundo (es, BROAD_TABLOID_FOOTBALL)

**ACCEPT**

Nincs új ilyen döntés a mintában.

**REJECT**
- ["No dejar a tu perro olfatear, es como llevarle a una biblioteca y prohibirle leer"](https://www.mundodeportivo.com/elotromundo/mascotas/20260911/1004225930/mariam-martinez-veterinaria-no-dejas-perro-olfatee-paseo-llevarle-biblioteca-prohibirle-abrir-libros-smd.html) · raw `71f1730b-981c-46d8-81b4-059a1d73df74`
- [La miniserie de HBO basada en un 'best seller' que no baja del Top 2 en España](https://www.mundodeportivo.com/elotromundo/television/20260911/1004225908/miniserie-hbo-max-basada-best-seller-no-baja-top-2-espana-perfecta-ver-sola-tarde-tvp-dct.html) · raw `7c7e9df1-b186-41b4-8bbc-181d6a57536e`
- [Una conocida cara de Telecinco anuncia su embarazo: "Llevo tres meses callándome esto"](https://www.mundodeportivo.com/elotromundo/television/20260911/1004225921/conocida-cara-telecinco-anuncia-embarazo-llevo-tres-meses-callandome-esto-dct.html) · raw `ed14aeb2-e20d-4674-8448-8b0e5973d7b2`
- [De Goicoechea a Miki Núñez: posados de los concursantes de 'La Travessa VIP': esta es su fecha de estreno](https://www.mundodeportivo.com/elotromundo/television/20260911/1004225900/miki-nunez-jessica-goicoechea-posados-oficiales-todos-concursantes-travessa-expedicio-tramuntana-estrena-29-septiembre-galeria-dct.html) · raw `623fb84a-6914-44fa-92c3-0e3b34252f9a`
- [Paris Hilton abre las puertas de su nueva mansión: campo de golf, cancha de baloncesto y piscina con cascada](https://www.mundodeportivo.com/elotromundo/gente/20260911/1004225875/paris-hilton-abre-puertas-nueva-mansion-campo-golf-cancha-baloncesto-piscina-cascada-galeria-dct.html) · raw `bd34f57e-3906-4826-94d3-14cee3e8fd65`
- [El estreno de 'SV All Stars 3' lidera (15,6 %), pero lo hace con su peor dato histórico](https://www.mundodeportivo.com/elotromundo/television/20260911/1004225849/audiencias-tv-ayer-10-septiembre-estreno-supervivientes-all-stars-3-lidera-15-6-peor-dato-historico-dct.html) · raw `144e0857-e736-452b-91e1-d6db06d75c43`
- ['Control de fronteras: España': el caso del cargamento de piñas con cocaína dentro](https://www.mundodeportivo.com/elotromundo/television/20260911/1004225546/avance-exclusivo-decimo-aniversario-control-fronteras-espana-caso-cargamento-pinas-cocaina-dct.html) · raw `ded161ce-e917-4894-aba6-4d49f7f9665f`
- [Crítica unánime al estreno de 'SV All Stars 3': la última bala de Telecinco para evitar su declive total](https://www.mundodeportivo.com/elotromundo/television/20260911/1004225846/critica-unanime-estreno-supervivientes-all-stars-3-ultima-bala-telecinco-evitar-declive-total-dct.html) · raw `270fd9a6-547e-48a0-8bff-11941cba927b`
- [Ester Expósito: "Lo más sexy que alguien puede tener es el humor y la inteligencia"](https://www.mundodeportivo.com/elotromundo/television/20260910/1004225787/ester-exposito-hormiguero-sexy-alguien-humor-inteligencia-valores-compromiso-causas-sociales-mundo-no-sea-alguien-vive-burbuja-le-da-igual-dct.html) · raw `03fea832-40e5-49bc-ac56-7136c8f4574d`
- [¿Sigue abierto el restaurante 'Bodeguita Los 50' de 'Pesadilla en la cocina'?](https://www.mundodeportivo.com/elotromundo/television/20260910/1004225760/sigue-abierto-restaurante-bodeguita-50-pesadilla-cocina-dct.html) · raw `1b1307bf-19d7-4193-86ef-614358b0e30a`

### Virgilio Sport Gossip (it, DIRECT_GOSSIP)

**ACCEPT**

Nincs új ilyen döntés a mintában.

**REJECT**
- [Martina Colombari trasformista a Venezia 83 riceve il Filming Italy Venice Award per "Buen Camino"](https://sport.virgilio.it/martina-colombari-venezia-2026-970982) · raw `73b40a5b-4126-42d5-bd5c-e1701a1fa407`

### Tuttosport Calcio (it, BROAD_TABLOID_FOOTBALL)

**ACCEPT**
- [Kone, niente esami ma resta in dubbio per Torino-Roma: le condizioni del centrocampista](https://www.tuttosport.com/news/calcio/serie-a/roma/2026/09/11-151171273/kone_niente_esami_ma_resta_in_dubbio_per_torino-roma_le_condizioni_del_centrocampista/) · raw `c4162d81-537a-45b3-8889-9d91cf92523e`
- [Scandalo Eto’o, "mezzo milione dalla Russia mai depositato": cosa è successo](https://www.tuttosport.com/news/calcio/2026/09/11-151170622/scandalo_etoo_mezzo_milione_dalla_russia_mai_depositato_cosa_successo/) · raw `bd6b6e32-af72-4723-a0d1-3028df6daaf5`

**REJECT**
- [La prima volta in gruppo, Spalletti respira: le novità dall’allenamento verso Sassuolo-Juve](https://www.tuttosport.com/news/calcio/serie-a/juventus/2026/09/11-151171749/la_prima_volta_in_gruppo_spalletti_respira_le_novit_dallallenamento_verso_sassuolo-juve/) · raw `2a95e8b4-2a26-437a-b3d2-ac8a1c0b034f`
- [Cuadrado, "soprattutto alla Juve": addio all'Italia e saluto speciale](https://www.tuttosport.com/news/calcio/serie-a/juventus/2026/09/11-151171563/cuadrado_soprattutto_alla_juve_addio_all_italia_e_saluto_speciale/) · raw `488b0c82-7690-4dac-8774-dd0697d0a99c`
- ["L’Olimpico così mi ricorda il Covid", Gattuso dal tifo Lazio ai nuovi: "C'è una gamba frizzantina"](https://www.tuttosport.com/news/calcio/serie-a/lazio/2026/09/11-151171748/lolimpico_cos_mi_ricorda_il_covid_gattuso_dal_tifo_lazio_ai_nuovi_c_una_gamba_frizzantina/) · raw `f60f1c13-fd3e-4fab-aa95-d09c6d929bc2`
- [Cacciamani-Toro: 2031](https://www.tuttosport.com/news/calcio/serie-a/torino/2026/09/11-151167545/cacciamani-toro_2031/) · raw `e5b07356-3d1b-40ad-87fe-b52d3c36b4bb`
- [Da Mister 100 milioni al Lahm spagnolo: i nuovi protagonisti dell'European Golden Boy](https://www.tuttosport.com/news/calcio/golden-boy/2026/09/11-151169872/da_mister_100_milioni_al_lahm_spagnolo_i_nuovi_protagonisti_dell_european_golden_boy/) · raw `a2c1724b-6fca-4ac9-b2ad-6cf6d91356e3`
- [James Rodriguez, niente Avellino: ufficiale il trasferimento all'Atletico Nacional](https://www.tuttosport.com/news/calcio/calciomercato/2026/09/11-151171453/james_rodriguez_niente_avellino_ufficiale_il_trasferimento_all_atletico_nacional/) · raw `b53eba07-c207-43c7-ae01-f4283da17178`
- [Amorim, due cambi dopo la Juve: tutte le novità in vista di Lazio-Milan](https://www.tuttosport.com/news/calcio/serie-a/milan/2026/09/11-151166331/amorim_due_cambi_dopo_la_juve_tutte_le_novit_in_vista_di_lazio-milan/) · raw `a83f368b-deed-48ee-9407-a238cd9d1832`
- [Golden Boy Web, Cubarsì ora si prende la scena: vota il tuo preferito!](https://www.tuttosport.com/news/calcio/golden-boy/2026/09/11-151170177/golden_boy_web_cubars_ora_si_prende_la_scena_vota_il_tuo_preferito_/) · raw `4b78126c-ab65-4952-b060-715079780a01`
- [Dybala alza il livello, Wesley sbatte e liscia, l’ex pericoloso: pagelle Fenerbahce-Roma](https://www.tuttosport.com/news/calcio/champions-league/2026/09/11-151166328/dybala_alza_il_livello_wesley_sbatte_e_liscia_lex_pericoloso_pagelle_fenerbahce-roma/) · raw `4e3a5749-dc08-4287-afe6-c7fcf7fa402f`
- ["Ha preso una bottiglia in testa": caos Fenerbahce! Kartal si dimette ma il presidente blocca tutto](https://www.tuttosport.com/news/calcio/champions-league/2026/09/11-151167725/ha_preso_una_bottiglia_in_testa_caos_fenerbahce_kartal_si_dimette_ma_il_presidente_blocca_tutto/) · raw `19593de5-88a3-459f-aa17-004cdd35d2f1`

### Gazzetta Calcio (it, BROAD_TABLOID_FOOTBALL)

**ACCEPT**
- [Brignoli e l'esordio in Champions a 35 anni: "A Donnarumma chiederò la maglia, a Gasp una... foto!"](https://www.gazzetta.it/Calcio/Champions-League/11-09-2026/alberto-brignoli-intervista-e-il-debutto-in-champions-a-35-anni-ora-il-como-e-la-roma.shtml) · raw `1553ef2a-89de-45fa-9069-579fff9c80f6`

**REJECT**
- [Theate riabbraccia il Bologna: "È come tornare a casa. Faremo una grande stagione"](https://www.tuttobolognaweb.it/mercato/il-ritorno-di-theate-oggi-il-bologna-e-diverso-tedesco-grande-mister/?intcmp=gazzanet-tuttobolognaweb) · raw `7f9f7ce3-51e5-4acc-b488-f2e35b6cb8d9`
- [LIVE Amorim: "Gattuso una leggenda. È un esempio per questo Milan"](https://www.gazzetta.it/Calcio/Serie-A/Milan/11-09-2026/amorim-pre-lazio-milan-la-conferenza-in-diretta.shtml) · raw `ac9081bd-7ed7-4292-8083-03f33ad315f1`
- [Quando Emma Bonino e il Foggia di Zeman si unirono per la pace in Bosnia](https://www.gazzetta.it/Calcio/Serie-A/11-09-2026/emma-bonino-il-foggia-di-zeman-e-quella-battaglia-condivisa-per-la-bosnia.shtml) · raw `a08c206f-fe1a-4840-a0b5-fe81022d6abc`
- [I dubbi sulla difesa, voleva un Matic e gli hanno preso Mastantuono: dov'è nata la rottura Grosso-Fiorentina](https://www.gazzetta.it/Calcio/Serie-A/Fiorentina/11-09-2026/fiorentina-grosso-motivi-tattici-esonero-mercato-moduli.shtml) · raw `d98334f5-e755-4b7f-9de9-750a7e83bc8e`
- [Infortuni e infermeria addio! È un Dybala mai visto. E col nuovo contratto più gioca, più guadagna](https://www.gazzetta.it/Calcio/Champions-League/11-09-2026/roma-dybala-infortuni-addio-la-joya-ora-gioca-sempre-guadagnando-di-piu.shtml) · raw `4dd4bfac-72b1-404a-95fc-8c479c7aa69f`
- [Un Como da 436 milioni! Chi sono e quanto valgono gli 11 di Fabregas che hanno stracciato il Lipsia](https://www.gazzetta.it/Calcio/Serie-A/Como/storie/11-09-2026/como-champions-formazione-lipsia/esordio-vincente.shtml) · raw `2010a1d0-f653-4694-8c6e-ea94f5b83450`
- [Reja: "Avverto disfattismo sul Napoli, ma Allegri va sostenuto. Anguissa è come un nuovo acquisto"](https://www.gazzetta.it/Calcio/Serie-A/Napoli/11-09-2026/edy-reja-intervista-allegri-napoli.shtml) · raw `e16719d6-6a2e-4331-9c41-d2cee9b86b83`
- [Dimarco a metà? C'è Carlos Augusto, il gregario d'oro. Ma ora Baccin deve allungargli il contratto](https://www.gazzetta.it/Calcio/Serie-A/Inter/11-09-2026/inter-carlos-augusto-rinnovo-titolare-udinese.shtml) · raw `73e2fcce-6a5d-4742-8447-c56ce922f225`
- [Juventus, col Sassuolo chance per Alajbegovic: con Yildiz infortunato troverà più spazio](https://www.gazzetta.it/calcio/fantanews/11-09-2026/juventus-sassuolo-chance-per-alajbegovic-con-yildiz-infortunato-trovera-piu-spazio.shtml) · raw `14816a32-8d82-4f77-b55d-cd38a4ae9d27`
- [Milan, le ultime verso la Lazio: Gabbia recuperato. In mezzo dubbio tra Modric e Jashari](https://www.gazzetta.it/calcio/fantanews/11-09-2026/milan-le-ultime-verso-la-lazio-gabbia-recuperato-in-mezzo-dubbio-tra-modric-e-jashari.shtml) · raw `f9fc4d50-e070-4193-882f-fd37a3200428`

### Corriere dello Sport Calcio (it, BROAD_TABLOID_FOOTBALL)

**ACCEPT**

Nincs új ilyen döntés a mintában.

**REJECT**
- [Lazio-Milan, la curva gela l'Olimpico: "Lotito chieda scusa". E lo stadio si tinge di rossonero..](https://www.corrieredellosport.it/news/calcio/serie-a/lazio/2026/09/11-151169686/lazio-milan_la_curva_gela_l_olimpico_lotito_chieda_scusa_e_lo_stadio_si_tinge_di_rossonero_/) · raw `ea045e6f-50fe-4d82-ab2e-4dcf07312ac7`
- [Gattuso punta il Milan e sogna: "Spero di vedere prima o poi l'Olimpico pieno. Frattesi? Gli è scattata una molla"](https://www.corrieredellosport.it/news/calcio/serie-a/lazio/2026/09/11-151172594/gattuso_punta_il_milan_e_sogna_spero_di_vedere_prima_o_poi_l_olimpico_pieno_frattesi_gli_scattata_una_molla/) · raw `e394fe2a-3b24-40e4-ae33-d31b47b19f54`
- [Fabregas visionario anche in patria: la Spagna incorona Cesc e il modello Como](https://www.corrieredellosport.it/news/calcio/serie-a/como/2026/09/11-151170818/fabregas_visionario_anche_in_patria_la_spagna_incorona_cesc_e_il_modello_como/) · raw `88806b6b-5393-42be-8086-e8f6f0307905`
- [Dove vedere Pisa-Entella in tv? Dazn o Prime Video, orario](https://www.corrieredellosport.it/news/calcio/serie-b/2026/09/11-151171743/dove_vedere_pisa-entella_in_tv_dazn_o_prime_video_orario/) · raw `857f69f8-dc11-4119-bb15-a9059025f879`
- [Bove, distorsione al ginocchio: i tempi di recupero e quando tornerà con il Watford](https://www.corrieredellosport.it/news/calcio/calcio-estero/2026/09/11-151171558/bove_distorsione_al_ginocchio_i_tempi_di_recupero_e_quando_torner_con_il_watford/) · raw `27715842-2399-41cd-bf19-e329d5cf0f56`
- [Dove vedere Benevento-Verona in tv? Dazn o Prime Video, orario](https://www.corrieredellosport.it/news/calcio/serie-b/2026/09/11-151171451/dove_vedere_benevento-verona_in_tv_dazn_o_prime_video_orario/) · raw `631df67e-b3a8-4010-b5cf-795c7673731f`
- [Dove vedere Empoli-Arezzo in tv? Dazn o Prime Video, orario](https://www.corrieredellosport.it/news/calcio/serie-b/2026/09/11-151171452/dove_vedere_empoli-arezzo_in_tv_dazn_o_prime_video_orario/) · raw `cf1021d6-873e-4300-9d15-2fe1af53d0c3`
- [Nessun esame per Koné: le condizioni dopo Fenerbahce-Roma](https://www.corrieredellosport.it/news/calcio/serie-a/roma/2026/09/11-151170997/nessun_esame_per_kon_le_condizioni_dopo_fenerbahce-roma/) · raw `833cb525-722d-42f4-8e2a-02da496a096c`
- [Fiorentina, cercasi carattere](https://www.corrieredellosport.it/news/calcio/serie-a/fiorentina/2026/09/11-151170445/fiorentina_cercasi_carattere/) · raw `688cfdf8-423b-458b-bd04-b431bb9d1fd8`
- [I tifosi della Lazio insistono: "Insieme alla squadra fino allo stadio, poi al pub o a casa". La protesta continua](https://www.corrieredellosport.it/news/calcio/serie-a/lazio/2026/09/11-151170176/i_tifosi_della_lazio_insistono_insieme_alla_squadra_fino_allo_stadio_poi_al_pub_o_a_casa_la_protesta_continua/) · raw `e8fa5619-ab87-406a-88eb-48868d491c33`

### BILD Sport (de, BROAD_TABLOID_FOOTBALL)

**ACCEPT**
- [Es geht um ein Buch - Neuer Zoff zwischen Horner und Red Bull](https://www.bild.de/sport/mehr-sport/es-geht-um-ein-buch-neuer-zoff-zwischen-horner-und-red-bull-6aa3ba1c240b302c8a84106e) · raw `dd6ab228-5094-4ee9-84a0-de4600ad8265`

**REJECT**
- [Nach Gelb-Rot gegen Gladbach - Medienbericht! Wende um Elversberg-Trainer](https://www.bild.de/sport/fussball/bayern-wende-um-elversberg-trainer-vincent-wagner-6aa3ef0856f343d9f4dd1d14) · raw `b9077c6e-258c-4daf-969a-945d26d79fcc`
- [Vertrag für neuen Torwart - Traditionsklub schnappt sich Sohn von Formel-1-Star](https://www.bild.de/sport/fussball/neuer-torwart-da-traditionsklub-schnappt-sich-sohn-von-formel-1-star-6aa3d8860f417ae59102e934) · raw `58d3fb42-f74e-4cfb-abdb-54e89396b2eb`
- [Halbfinal-Heldin muss unterrichten - Morgen Halbfinale! Sonntag Finale? Montag Mathe!](https://www.bild.de/sport/mehr-sport/halbfinal-heldin-alex-wilke-soll-am-montag-wieder-in-der-klasse-stehen-6aa2fc65240b302c8a840909) · raw `1a122146-b2f5-4eb8-95d3-99dd145bff93`
- [Schock-Moment - Formel-2-Auto geht komplett in Flammen auf](https://www.bild.de/sport/mehr-sport/schock-moment-formel-2-auto-geht-komplett-in-flammen-auf-6aa3c8e8181cb962d488bb16) · raw `bc170279-0fc2-43c4-9184-c6a392b1d147`
- [Sein Schrei ließ die Halle verstummen - Schock-Verletzung bei Handball-Star](https://www.bild.de/sport/mehr-sport/handball-schock-verletzung-schrei-von-handball-star-laesst-halle-verstummen-6aa3ebb0181cb962d488beb0) · raw `b650cf6c-9f84-4c06-be89-aa5e56b52c84`
- [„Wieder einer, der mit 16 Jahren angefangen hat“ - Spannende Reif-Aussagen zum BVB-Griechen](https://www.bild.de/sport/fussball/wieder-einer-der-mit-16-jahren-angefangen-hat-spannende-reif-aussagen-zum-bvb-griechen-6aa3c058181cb962d488b9a7) · raw `57b96a44-e9c8-423c-b35a-772fd89f128f`
- [Worum es geht - Schwere Vorwürfe gegen Fußball-Legende Eto’o](https://www.bild.de/sport/fussball/schwere-vorwuerfe-gegen-fussball-legende-samuel-etoo-6aa3bfe20f417ae59102e585) · raw `a4a566d4-ecb4-4ee8-a379-036698de9432`
- [Auf einmal war er raus - Diesem FCM-Star winkt jetzt die zweite Chance](https://www.bild.de/sport/fussball/paul-jaeckel-vor-fcm-comeback-zweite-chance-nach-braunschweig-debakel-6aa3aced56f343d9f4dd15d7) · raw `5d1536df-9e34-46ae-8506-3743225515f4`
- [Halbfinalist der US Open und Fußball-Superstar - Sie sind aktuell das Glamour-Paar der Sportwelt](https://www.bild.de/sport/mehr-sport/ben-shelton-und-trinity-rodman-die-schoenste-sportromanze-6aa38ddd181cb962d488b585) · raw `323a5e40-88e0-4dca-a0d3-26de292ea889`
- [„Daran kann man sich orientieren“ - Absteiger wird zum Werder-Vorbild](https://www.bild.de/sport/fussball/werder-bremen-bundesliga-absteiger-wird-zum-vorbild-fuer-thioune-6aa3b5e356f343d9f4dd1691) · raw `6c0109de-9933-4f35-88be-475b8e6bb799`

### SPORT BILD Football (de, BROAD_TABLOID_FOOTBALL)

**ACCEPT**
- [Horror-Prozess eskaliert - So brutal war der Überfall auf Donnarumma und seine Frau](https://sportbild.bild.de/fussball/internationaler-fussball/so-brutal-war-der-ueberfall-auf-donnarumma-und-seine-frau-6aa3c79e56f343d9f4dd189a) · raw `6c59d388-777f-48b6-a7a5-aae1310aa05b`
- [Total bizarres Gespräch - Warum Olise das Interview geben musste](https://sportbild.bild.de/fussball/1-bundesliga/total-bizarres-gespraech-warum-olise-das-interview-geben-musste-6aa3b501240b302c8a840fed) · raw `4aa56936-1fba-40d8-b1c2-2bff403b98ef`
- [Nach dem WM-Finale - Trump verblüfft Weltmeister-Coach mit Ballon-d'Or-Spruch](https://sportbild.bild.de/fussball/internationaler-fussball/nach-dem-wm-finale-trump-verbluefft-weltmeister-coach-6aa26563240b302c8a83fbaa) · raw `670a2d4c-fed8-4efb-ad80-319fe5910af4`

**REJECT**
- [Lebenslange Sperre - Brutale Attacke auf Linienrichter](https://sportbild.bild.de/fussball/internationaler-fussball/lebenslange-sperre-brutale-attacke-auf-linienrichter-6aa3cb6556f343d9f4dd18fd) · raw `96c6486d-0b73-4764-9bba-6131c312e143`
- [Mutter klärt auf - So geht es BVB-Star Karetsas](https://sportbild.bild.de/fussball/borussia-dortmund/mutter-klaert-auf-so-geht-es-bvb-star-karetsas-6aa3c77956f343d9f4dd188f) · raw `b6430dc0-a754-4381-9fc2-3facc153ebf5`
- [Erster Frankreich-Auftritt - Zidane plant Kader-Überraschung](https://sportbild.bild.de/fussball/internationaler-fussball/frankreich-zidane-plant-kader-ueberraschung-6aa3d27c0f417ae59102e865) · raw `8912268e-235b-4fd3-b42b-6c0dc130994d`
- [Reif wird bei Wirtz richtig deutlich - „Ich weiß nicht, ob Premier League sein Ding ist“](https://sportbild.bild.de/fussball/1-bundesliga/reif-wird-bei-wirtz-richtig-deutlich-ich-weiss-nicht-ob-premier-league-sein-ding-ist-6aa3b5f456f343d9f4dd1696) · raw `fc9343c0-7ddd-47c2-9a11-629028a37295`
- [Trainer wurde gerade gefeuert - Übernimmt Wagner diesen Klub?](https://sportbild.bild.de/fussball/internationaler-fussball/sandro-wagner-fc-basel-will-ihn-als-neuen-trainer-6aa3ae18240b302c8a840f71) · raw `a61a0f48-e1c9-4cab-9928-94b5b5ff6252`
- [Sport-Boss Deco klärt auf - Das hat Barça für Álvarez geboten](https://sportbild.bild.de/fussball/internationaler-fussball/deco-klaert-auf-das-hat-barca-fuer-alvarez-geboten-6aa3b59b0f417ae59102e490) · raw `0cb83d0f-15f1-4768-8942-815acc89ad06`
- [Völlig unerwartet - DAS VIDEO! Hier tritt Fenerbahces Trainer zurück](https://sportbild.bild.de/fussball/1-bundesliga/voellig-unerwartet-das-video-hier-tritt-fenerbahces-trainer-zurueck-6aa3b55a0f417ae59102e488) · raw `f14749bb-9251-48ce-9263-3e7a689a7463`
- [Deutliche Aussagen über Leipzig - „Deprimierend schlecht“](https://sportbild.bild.de/fussball/1-bundesliga/deutliche-aussagen-ueber-leipzig-deprimierend-schlecht-6aa3b545240b302c8a841004) · raw `e3a2c1cd-f6f2-4a25-af2b-2d625270ac05`
- [Es geht um bestimmten Zeitpunkt - Spannende Beobachtung bei Guirassy](https://sportbild.bild.de/fussball/1-bundesliga/es-geht-um-bestimmten-zeitpunkt-spannende-beobachtung-bei-guirassy-6aa3b51a240b302c8a840ffa) · raw `74ad0ad6-7b79-4c34-8fba-535367c295ea`
- [Spannende Aussagen zum BVB-Griechen - „Wieder einer, der mit 16 Jahren angefangen hat“](https://sportbild.bild.de/fussball/1-bundesliga/spannende-aussagen-zum-bvb-griechen-wieder-einer-der-mit-16-jahren-angefangen-hat-6aa3b5300f417ae59102e483) · raw `99656595-9df4-4dc4-988c-e4bd41f59a59`

### Kronen Zeitung Fussball (de, BROAD_TABLOID_FOOTBALL)

**ACCEPT**
- [Nicht ganz dicht - Barcas Milliarden-Projekt Stadion: Es regnet rein](https://www.krone.at/4289963) · raw `f6e5155a-c055-4ce6-91fc-50d44f70b94e`

**REJECT**
- [Nach schwacher WM - Sportdirektor fordert neue Wege bei der Ausbildung](https://www.krone.at/4288739) · raw `38d3711e-52c8-4ac7-b930-3cbec659633a`
- [Folge von Freitag - Jetzt holen wir uns extra Energie fürs Wochenende!](https://www.krone.at/4290907) · raw `1e046128-06b9-48c8-bd98-edfcd52c6b7e`
- [Reporter verzweifelt - Olise ist selbst im Interview … außergewöhnlich](https://www.krone.at/4290698) · raw `a93ff452-5777-44b5-ab4f-86df82a3b92d`
- [Sportkrone Inside - ÖFB: „Ausgeschöttelt“ und durchgeschüttelt?](https://www.krone.at/4290911) · raw `4a16014c-f440-41fa-beb0-3eebdadf771f`
- [Derby-Kracher - ÖFB-Cup: Termine für Achtelfinal-Partien fixiert](https://www.krone.at/4290849) · raw `39d90fda-3fc7-4bf6-826c-193982c052f4`
- [„Talentshow“ beim ÖFB - „Gogo“ Djuricin sucht den nächsten Fußballstar](https://www.krone.at/4290085) · raw `942180de-50f4-48d0-9ef0-4e517b916751`
- [Bayern macht Ernst - Nach „Bullshit“-Ansage: Freund-Verlängerung naht](https://www.krone.at/4290761) · raw `2579af9b-64b1-4806-8102-306bbfb6465d`
- [Regionalliga Ost live: - Cupfighter-Duell: Parndorf fordert Traiskirchen!](https://www.krone.at/4290718) · raw `6b18dbf8-c826-48c2-a786-9fba09a534df`
- [Pleite gegen Neuling - Albtraum-Start in Champions League: „Echt kacke!“](https://www.krone.at/4290701) · raw `6b54ade1-22ce-4804-a5f1-51f9780e2da6`
- [Lob für Bayern-Kicker - Kompany: „Das war ein großer Moment für ihn“](https://www.krone.at/4290642) · raw `e0e0ad6e-99f6-491a-8ff5-ef2f776532a4`

### AS Tikitakas (es, DIRECT_GOSSIP)

**ACCEPT**

Nincs új ilyen döntés a mintában.

**REJECT**
- [Ismael Galancho, experto en nutrición: “La gente consume la proteína que necesita de sobra, incluso muchos consumen más de la que necesitan”](https://as.com/tikitakas/salud/ismael-galancho-experto-en-nutricion-la-gente-consume-la-proteina-que-necesita-de-sobra-incluso-muchos-consumen-mas-de-la-que-necesitan-f202609-n/) · raw `9434197b-2ca2-43d6-b227-cce6b9f3bda1`
- [Marco Aurelio, emperador romano y filósofo: “Nunca te enfades con los acontecimientos, porque a ellos no les importa”](https://as.com/meristation/virales/marco-aurelio-emperador-romano-y-filosofo-nunca-te-enfades-con-los-acontecimientos-porque-a-ellos-no-les-importa-f202609-n/) · raw `8ab6bf39-6227-4275-b0ac-953190d7dc2e`
- [La nueva colección deportiva de Primark quiere competir con las grandes marcas sin subir precios](https://as.com/tikitakas/estilo/la-nueva-coleccion-deportiva-de-primark-quiere-competir-con-las-grandes-marcas-sin-subir-precios-f202609-n/) · raw `e5ee8d5c-92a6-45d4-8835-40b991b701a3`
- [El pack más exclusivo para el GP de España de F1: restaurante con un menú creado por chefs con estrellas Michelin](https://as.com/tikitakas/gastronomia/el-pack-mas-exclusivo-para-el-gp-de-espana-de-f1-restaurante-con-un-menu-creado-por-chefs-con-estrellas-michelin-f202609-n/) · raw `cdd9ac32-8b06-4400-aedf-cfd961c5bfbf`
- [Malena García Arredondo, experta en salud gastrointestinal: “Estos son los alimentos que favorecen una microbiota saludable”](https://as.com/tikitakas/salud/malena-garcia-arredondo-experta-en-salud-gastrointestinal-estos-son-los-alimentos-que-favorecen-una-microbiota-saludable-f202609-n/) · raw `4ba58567-8039-484c-8cc7-e0568e51d95f`
- [El espectacular cambio físico de Orlando Bloom a los 49 años que ha desatado todo tipo de comentarios: “Irreconocible”](https://as.com/tikitakas/famosos/el-espectacular-cambio-fisico-de-orlando-bloom-a-los-49-anos-que-ha-desatado-todo-tipo-de-comentarios-irreconocible-f202609-n/) · raw `5267bf0b-f0da-4d13-aea4-551f9c0cf690`
- [Dónde ver y disfrutar del Gran Premio de España de Fórmula 1 en Madrid: restaurantes y planes de ocio](https://as.com/tikitakas/donde-ver-y-disfrutar-del-gran-premio-de-espana-de-formula-1-en-madrid-restaurantes-y-planes-de-ocio-f202609-n/) · raw `a6189483-a208-4d58-844c-88fa32842652`
- [Ogadenia Díaz, diseñadora: “Una técnica ancestral puede dialogar perfectamente con la moda contemporánea”](https://as.com/tikitakas/estilo/ogadenia-diaz-disenadora-una-tecnica-ancestral-puede-dialogar-perfectamente-con-la-moda-contemporanea-f202609-n/) · raw `8a0636e7-29d5-44a0-ac3e-14beaa6187ea`
- [La fiebre por la Fórmula 1 también se dispara en el mercado de segunda mano: las búsquedas crecen un 18%](https://as.com/tikitakas/ocio/la-fiebre-por-la-formula-1-tambien-se-dispara-en-el-mercado-de-segunda-mano-las-busquedas-crecen-un-18-f202609-n/) · raw `76b5770b-9802-407a-9c6c-5898098f4a92`
- [Por qué te despiertas y no puedes moverte: la explicación de un experto en sueño](https://as.com/tikitakas/salud/por-que-te-despiertas-y-no-puedes-moverte-la-explicacion-de-un-experto-en-sueno-f202609-n/) · raw `f504d067-7363-4be6-b1d9-0bbd35c70cd8`

**STOP. Production deploy/aktiválás nem történt; Writer/generation és cron OFF marad.**

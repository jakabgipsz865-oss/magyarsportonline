# MSO — Editorial calibration és image fallback

**AUTO-PUBLISH OFF · CORPORATE CRON OFF · SOURCE ACTIVATION OFF · DEPLOY OFF · Gemini 0**

RSS-minta lekérve: 2026-09-11T05:45:30.186Z. Képminta ellenőrizve: 2026-09-11T05:45:31.316Z. Végső kiértékelés: 2026-09-11T05:45:31.316Z.

Ez helyi, csak olvasási preflight. Külső szolgáltatás konfigurációját és production adatot nem módosítottunk. A Writer nem futott. A képekre sem GET, sem HEAD nem történt; csak RSS/XML és az előző riportban szereplő 10 cikk nyilvános HTML-válasza került feldolgozásra.

## Validáció

- **184 célzott teszt PASS**: editorial/gold, RSS-képkiválasztás, HTML-fallback, source preflight és kikapcsolt publikálás regressziói.
- **Typecheck PASS**: agents és web. **Módosított agents/web fájlok lintje PASS**.
- **Gold set: 32/32 PASS mindkét source módban**, azaz 64 sikeres mód/eset ellenőrzés. Ebből 14 kért pozitív, eredeti RSS-cím+leírás; 17 szintetikus negatív határeset és 1 tényleges RSS átigazolási ellenpélda.
- A korábbi negatív regressziók is megmaradtak. A cím konkrét off-field témája mellett az RSS sportháttér nem önálló kizárási ok; a tényleges sportfrissítés/átigazolás/kontraktus/TV-guide továbbra is kizárt.
- A football szó önmagában nem relevancia. Association-football személy/szerep/klub vagy közvetlen kapcsolat kell; ex-futballista is számít. NFL/Kelce/Mahomes/Chiefs esetek REJECT-ek.

## Kért gold példák

| ESET / SOURCE | EXPECTED | DIRECT_GOSSIP | BROAD_TABLOID_FOOTBALL |
|---|---|---|---|
| sun-robbery — The Sun / SunSport Football | ACCEPT | PASS | PASS |
| star-kidnapping — Daily Star Football | ACCEPT | PASS | PASS |
| mirror-hobby — Daily Mirror Football | ACCEPT | PASS | PASS |
| llorente-photos — OKDIARIO Paparazzi | ACCEPT | PASS | PASS |
| olise-boat — OKDIARIO Paparazzi | ACCEPT | PASS | PASS |
| nico-boat — OKDIARIO Paparazzi | ACCEPT | PASS | PASS |
| virgilio-relationship — Virgilio Sport Gossip | ACCEPT | PASS | PASS |
| virgilio-wedding — Virgilio Sport Gossip | ACCEPT | PASS | PASS |
| virgilio-holiday — Virgilio Sport Gossip | ACCEPT | PASS | PASS |
| virgilio-family — Virgilio Sport Gossip | ACCEPT | PASS | PASS |
| virgilio-lifestyle — Virgilio Sport Gossip | ACCEPT | PASS | PASS |
| kone-necklace — Corriere dello Sport Fuori dal Campo | ACCEPT | PASS | PASS |
| shaarawy-wedding — Corriere dello Sport Fuori dal Campo | ACCEPT | PASS | PASS |
| leotta-karius-baby — Corriere dello Sport Fuori dal Campo | ACCEPT | PASS | PASS |
| match — Synthetic boundary regression | REJECT | PASS | PASS |
| result — Synthetic boundary regression | REJECT | PASS | PASS |
| live — Synthetic boundary regression | REJECT | PASS | PASS |
| ratings — Synthetic boundary regression | REJECT | PASS | PASS |
| tactics — Synthetic boundary regression | REJECT | PASS | PASS |
| lineup — Synthetic boundary regression | REJECT | PASS | PASS |
| injury — Synthetic boundary regression | REJECT | PASS | PASS |
| standings — Synthetic boundary regression | REJECT | PASS | PASS |
| schedule — Synthetic boundary regression | REJECT | PASS | PASS |
| transfer — Synthetic boundary regression | REJECT | PASS | PASS |
| contract — Synthetic boundary regression | REJECT | PASS | PASS |
| financial-limit — Synthetic boundary regression | REJECT | PASS | PASS |
| tv-guide — Synthetic boundary regression | REJECT | PASS | PASS |
| nfl — Synthetic boundary regression | REJECT | PASS | PASS |
| nfl-club — Synthetic boundary regression | REJECT | PASS | PASS |
| bare-football — Synthetic boundary regression | REJECT | PASS | PASS |
| city-only — Synthetic boundary regression | REJECT | PASS | PASS |
| observed-free-agents-join-club — talkSPORT Football | REJECT | PASS | PASS |

Az eredeti gold-címek (a fixture a teljes RSS-leírást is tartalmazza):

- **sun-robbery**: [Man City ace Donnarumma ‘bound and hit’ when robbers raided flat… as judge suspends first day of ‘catastrophic’ trial](https://www.thesun.co.uk/sport/40342876/man-city-ace-robbed-flat-trial-suspended/) — observed RSS
- **star-kidnapping**: [West Ham star issues strong statement over wild kidnap plot claims](https://www.dailystar.co.uk/sport/football/west-ham-united-edson-alvarez-37649939) — observed RSS
- **mirror-hobby**: [Premier League stars obsessed with collecting football cards in their free time](https://www.mirror.co.uk/sport/football/news/premier-league-stars-obsessed-collecting-37650261) — observed RSS
- **llorente-photos**: [Marcos Llorente, sobre sus fotos con Ferran Torres: «Me sorprende que en 2026 siga generando debate que dos hombres se den cariño»](https://okdiario.com/deportes/marcos-llorente-sobre-sus-fotos-ferran-torres-sorprende-que-2026-siga-generando-debate-que-dos-hombres-den-carino-19106435) — observed RSS
- **olise-boat**: [El vídeo más viral: cazan a Olise en un barco tocando a una joven que le hace twerking en bikini](https://okdiario.com/deportes/video-mas-viral-cazan-olise-barco-tocando-joven-que-hace-twerking-bikini-19096623) — observed RSS
- **nico-boat**: [Pillan a Nico Williams en un barco con varias mujeres horas después de romper con su novia: las fotos que revolucionan las redes](https://okdiario.com/deportes/pillan-nico-williams-barco-varias-mujeres-horas-despues-romper-novia-fotos-que-revolucionan-redes-19092580) — observed RSS
- **virgilio-relationship**: [Diamante Crispino, l'ex portiere di Napoli e Como protagonista a Temptation Island con la fidanzata Bernadette](https://sport.virgilio.it/chi-e-diamante-crispino-temptation-island-napoli-como-961013) — observed RSS
- **virgilio-wedding**: [Donnarumma e Alessia Elefante sposi: sarà per sempre sì, l’annuncio social. Ma intanto l’Arsenal scappa](https://sport.virgilio.it/donnarumma-alessia-elefante-sposi-sannuncio-social-arsenal-scappa-953719) — observed RSS
- **virgilio-holiday**: [David e Victoria Beckham turisti tra le vie di Capri](https://sport.virgilio.it/david-e-victoria-beckham-turisti-tra-le-vie-di-capri-968195) — observed RSS
- **virgilio-family**: [Francesco Totti e Ilary Blasi, la scelta delle due feste separate per la comunione della figlia Isabel](https://sport.virgilio.it/totti-ilary-blasi-due-feste-separate-comunione-figlia-isabel-957796) — observed RSS
- **virgilio-lifestyle**: [Alisha Lehmann a Wimbledon con il nuovo fidanzato Montel McKenzie: anello in vista, Douglas Luiz e la Juventus dimenticati](https://sport.virgilio.it/alisha-lehmann-wimbledon-fidanzato-juventus-douglas-luiz-962364) — observed RSS
- **kone-necklace**: [Manu Koné fa impazzire la Francia per una collana: "Si è spinto oltre". Ecco qual è e quanto costa](https://www.corrieredellosport.it/news/calcio/fuori-dal-campo/2026/06/04-149029748/manu_kon_fa_impazzire_la_francia_per_una_collana_si_spinto_oltre_ecco_qual_e_quanto_costa/) — observed RSS
- **shaarawy-wedding**: [El Shaarawy e Ludovica Pagani trasformano il loro matrimonio in un gesto di solidarietà: l'iniziativa](https://www.corrieredellosport.it/news/calcio/fuori-dal-campo/2026/06/10-149116491/el_shaarawy_e_ludovica_pagani_trasformano_il_loro_matrimonio_in_un_gesto_di_solidariet_l_iniziativa/) — observed RSS
- **leotta-karius-baby**: [Fiocco blu in casa Leotta-Karius, è nato il secondogenito Leonardo: l'annuncio sui social](https://www.corrieredellosport.it/news/calcio/fuori-dal-campo/2026/05/09-148512775/fiocco_blu_in_casa_leotta-karius_nato_il_secondogenito_leonardo_l_annuncio_sui_social/) — observed RSS
- **match**: Arsenal match report: furious fans — synthetic boundary
- **result**: Stuttgart feiert Demirovic-Party nach Dreipack — synthetic boundary
- **live**: Real Madrid live score: fans react — synthetic boundary
- **ratings**: Juventus pagelle: polemica — synthetic boundary
- **tactics**: Palmeri: Il Napoli si è difeso bene con Arsenal e basta — synthetic boundary
- **lineup**: Arsenal lineup sparks outrage — synthetic boundary
- **injury**: Gasperini: Koné infortunio e problema muscolare — synthetic boundary
- **standings**: Bundesliga Tabelle und Ergebnisse — synthetic boundary
- **schedule**: Wieso läuft die Champions League am Donnerstag? — synthetic boundary
- **transfer**: Richarlison will weg: Tottenham-Streit eskaliert — synthetic boundary
- **contract**: Messi signs new contract: fans celebrate — synthetic boundary
- **financial-limit**: Real Madrid: polémica por el límite salarial — synthetic boundary
- **tv-guide**: Arsenal TV guide: where to watch the match live — synthetic boundary
- **nfl**: Taylor Swift and Travis Kelce wedding: football star opens up — synthetic boundary
- **nfl-club**: Kansas City Chiefs star and his girlfriend on holiday — synthetic boundary
- **bare-football**: Football fans love this viral party photo — synthetic boundary
- **city-only**: Soundhood SON Estrella Galicia returns to Barcelona for a music party — synthetic boundary
- **observed-free-agents-join-club**: [Ex-Premier League star delivers ambitious invite to Raheem Sterling, Jadon Sancho and other free agents to join second tier club](https://talksport.com/football/4564254/jonjo-shelvey-arabian-falcons-raheem-sterling-jadon-sancho/) — observed RSS

## Source preflight

Minőségi ACCEPT: legfeljebb 100 legfrissebb visszaadott itemen, nem csak a 48 órás mintán. FRESH_48H ettől független. A 0 friss item nem RSS-hiba. A timeout `TIMEOUT/UNVERIFIED`, RSS_VALID=null; a 403/404/malformed XML `FAIL/SKIP`. Ebben a rögzített mintában AS Tikitakas PASS; a timeout elkülönítését külön célzott teszt igazolja. A táblázat gépi szűrés eredménye, nem forrásaktiválási engedély.

| SOURCE | MODE | TIER | RSS STATUS | FRESH 48H | ITEMS 48H | QUALITY ITEMS | ACCEPT COUNT |
|---|---|---|---|---|---:|---:|---:|
| The Sun / SunSport Football | BROAD_TABLOID_FOOTBALL | CORE | PASS | YES | 24 | 24 | 3 |
| Daily Star Football | BROAD_TABLOID_FOOTBALL | CORE | PASS | YES | 25 | 25 | 4 |
| Daily Mail Football | BROAD_TABLOID_FOOTBALL | CORE | PASS | YES | 66 | 100 | 10 |
| Daily Mirror Football | BROAD_TABLOID_FOOTBALL | CORE | PASS | YES | 25 | 25 | 2 |
| SPORTbible Football | BROAD_TABLOID_FOOTBALL | SECONDARY | PASS | YES | 22 | 25 | 0 |
| Daily Express Football | BROAD_TABLOID_FOOTBALL | CORE | PASS | YES | 10 | 10 | 0 |
| Metro Football | BROAD_TABLOID_FOOTBALL | SECONDARY | PASS | YES | 28 | 28 | 0 |
| Metro Oddballs | DIRECT_GOSSIP | SECONDARY | PASS | NO | 0 | 0 | 0 |
| talkSPORT Football | BROAD_TABLOID_FOOTBALL | SECONDARY | PASS | YES | 47 | 100 | 2 |
| OKDIARIO Paparazzi | DIRECT_GOSSIP | CORE | PASS | NO | 0 | 50 | 30 |
| OKDIARIO Fútbol | BROAD_TABLOID_FOOTBALL | SECONDARY | PASS | YES | 21 | 50 | 4 |
| Mundo Deportivo El Otro Mundo | BROAD_TABLOID_FOOTBALL | SECONDARY | PASS | YES | 34 | 100 | 0 |
| 20minutos Deportes | BROAD_TABLOID_FOOTBALL | PREFLIGHT | PASS | YES | 29 | 29 | 1 |
| 20minutos Gente/Televisión | DIRECT_GOSSIP | PREFLIGHT | PASS | YES | 26 | 26 | 1 |
| Golssip /gossip/ | DIRECT_GOSSIP | CORE | FAIL/SKIP | UNVERIFIED | 0 | 0 | 0 |
| Virgilio Sport Gossip | DIRECT_GOSSIP | CORE | PASS | YES | 1 | 30 | 10 |
| Tuttosport Calcio | BROAD_TABLOID_FOOTBALL | SECONDARY | PASS | YES | 30 | 30 | 1 |
| Gazzetta Calcio | BROAD_TABLOID_FOOTBALL | SECONDARY | PASS | YES | 30 | 30 | 0 |
| Corriere dello Sport Calcio | BROAD_TABLOID_FOOTBALL | SECONDARY | PASS | YES | 30 | 30 | 1 |
| BILD Sport | BROAD_TABLOID_FOOTBALL | CORE | PASS | YES | 100 | 100 | 1 |
| SPORT BILD Football | BROAD_TABLOID_FOOTBALL | CORE | PASS | YES | 50 | 50 | 1 |
| Blick Fussball | BROAD_TABLOID_FOOTBALL | SECONDARY | FAIL/SKIP | UNVERIFIED | 0 | 0 | 0 |
| Kronen Zeitung Fussball | BROAD_TABLOID_FOOTBALL | SECONDARY | PASS | YES | 40 | 49 | 1 |
| SPORT1 Boulevard | DIRECT_GOSSIP | HOLD | FAIL/SKIP | UNVERIFIED | 0 | 0 | 0 |
| oe24 Fussball | BROAD_TABLOID_FOOTBALL | HOLD | FAIL/SKIP | UNVERIFIED | 0 | 0 | 0 |
| AS Tikitakas | DIRECT_GOSSIP | CORE | PASS | YES | 30 | 40 | 0 |
| ElDesmarque Famosos | DIRECT_GOSSIP | CORE | FAIL/SKIP | UNVERIFIED | 0 | 0 | 0 |
| 101 Great Goals | BROAD_TABLOID_FOOTBALL | RETIRED | PASS | YES | 16 | 16 | 0 |
| CaughtOffside | BROAD_TABLOID_FOOTBALL | RETIRED | PASS | YES | 10 | 10 | 0 |
| FootballFanCast | BROAD_TABLOID_FOOTBALL | RETIRED | PASS | YES | 10 | 10 | 1 |
| GiveMeSport | BROAD_TABLOID_FOOTBALL | RETIRED | PASS | YES | 10 | 10 | 0 |
| HITC | BROAD_TABLOID_FOOTBALL | RETIRED | PASS | YES | 12 | 20 | 1 |
| Bernabéu Digital | BROAD_TABLOID_FOOTBALL | RETIRED | PASS | YES | 20 | 20 | 1 |
| Panenka | BROAD_TABLOID_FOOTBALL | RETIRED | PASS | YES | 4 | 10 | 0 |
| FCInter1908 | BROAD_TABLOID_FOOTBALL | RETIRED | PASS | YES | 50 | 50 | 0 |
| CalcioNapoli24 | BROAD_TABLOID_FOOTBALL | RETIRED | PASS | YES | 194 | 100 | 2 |
| Spazio Napoli | BROAD_TABLOID_FOOTBALL | RETIRED | PASS | YES | 20 | 30 | 1 |
| TuttoNapoli | BROAD_TABLOID_FOOTBALL | RETIRED | PASS | YES | 20 | 20 | 0 |
| IamNaples | BROAD_TABLOID_FOOTBALL | RETIRED | PASS | YES | 20 | 20 | 1 |
| SPOX fallback/general | BROAD_TABLOID_FOOTBALL | RETIRED | PASS | NO | 0 | 50 | 0 |
| MARCA Tiramillas | BROAD_TABLOID_FOOTBALL | PREFLIGHT | PASS | YES | 62 | 63 | 0 |
| Corriere dello Sport Fuori dal Campo | DIRECT_GOSSIP | PREFLIGHT | PASS | NO | 0 | 30 | 18 |
| EXPRESS.de Fußball | BROAD_TABLOID_FOOTBALL | PREFLIGHT | FAIL/SKIP | UNVERIFIED | 0 | 0 | 0 |
| RTL Fußball | BROAD_TABLOID_FOOTBALL | PREFLIGHT | PASS | YES | 9 | 100 | 3 |

## Forrásonként maximum 10 ACCEPT és 10 REJECT cím

### The Sun / SunSport Football (EN)

[RSS](https://www.thesun.co.uk/sport/football/feed/) — PASS. 

**ACCEPTED**

- Man City ace Donnarumma ‘bound and hit’ when robbers raided flat… as judge suspends first day of ‘catastrophic’ trial
- Diletta Leotta puts on busty display in elegant black dress as she returns to screens for Champions League
- West Ham star Edson Alvarez issues lengthy statement denying his involvement after sensational claims of kidnap plot

**REJECTED**

- Jamal Musiala scores in first start since terrifyingly collapsing twice in pre-season due and unveils new celebration
- Three things we learned from Man Utd’s win over Sabah as Sesko makes his case but star looks haunted by Amorim claim
- See AC Milan, Celtic and Crystal Palace games in UEFA Europa League with ticket and hospitality trips from just £30
- ‘What do you mean?’ – Champions League star’s stunned reaction after being told manager resigned in post-match interview
- Man Utd ratings: Mainoo is best player for second game running at Old Trafford but Mazraoui won’t dislodge dubious Dalot
- Man Utd 4 Sabah 0: Carrick’s changed side breeze past minnows for first Champions League win in nearly three years
- Tottenham and Bournemouth came close to signing LaLiga boss praised by Jose Mourinho, Luis Enrique and Diego Simeone
- Hull boss gives brilliant two-word response when asked how to deal with free-scoring Chelsea
- Champions League manager RESIGNS with immediate effect in live press conference minutes after match
- European football breaks to watch Real Madrid, Barcelona and Bayern Munich games from just £172pp

### Daily Star Football (EN)

[RSS](https://www.dailystar.co.uk/sport/football/?service=rss) — PASS. 

**ACCEPTED**

- West Ham star issues strong statement over wild kidnap plot claims
- Porto star 'grabbed Erling Haaland's bum' after Champions League tunnel chaos
- Jaw-dropping footballer goes viral as fans say 'she's definitely a keeper'
- Arsenal fans told to 'hide shirts' by club or be hunted by terrifying football firm

**REJECTED**

- Michael Carrick's key tactical decision as Man Utd make emphatic Champions League return
- Liverpool star Alisson hit with massive fine after actions during Premier League clash
- Wrexham's Prem dream gets serious as ex-Newcastle chief arrives — is Parkinson at risk?
- 'Argentina stars who can't speak English are pathetic – learn the lingo or get out'
- Liverpool beat Man Utd and 28 clubs to transfer after player went 'weeks without sleep'
- Premier League titans' injury woes and when 18 superstars expected to return
- Ballon d'Or 2026 top 20 contenders ranked and rated as Harry Kane battles Yamal and Mbappe
- Liverpool news: Transfer target's £130m release clause emerges as huge decision awaits
- Mauricio Pochettino demands 'take Premier League title off Chelsea and give it to Tottenham'
- Man Utd news: 'There's no point' transfer warning for Michael Carrick as fans to protest

### Daily Mail Football (EN)

[RSS](https://www.dailymail.com/sport/football/index.rss) — PASS. 

**ACCEPTED**

- How Kai Havertz and Martin Odegaard's inseparable bond is powering their resurgent form - trips abroad together, the running joke at Arsenal's HQ and how Gunners captain helped Havertz and his wife Sophia cope with vile abuse
- Man City star Gianluigi Donnarumma and his pregnant girlfriend 'hit, bound and threatened with a knife by robbers while sleeping in their Paris flat'
- Man City star Gianluigi Donnarumma and his pregnant girlfriend 'hit, bound and threatened with a knife by robbers while sleeping in their Paris flat'
- Manchester United facing ANOTHER protest... as furious local residents hit back over club's plans to open fanzone behind the Stretford End
- Manchester United facing ANOTHER protest... as furious local residents hit back over club's plans to open fanzone behind the Stretford End
- Rodri apologises after leaked video showed Barcelona star brutally ridiculing Spanish rivals Valencia
- Hilarious moment sees Micah Richards run out of the CBS studio when Kylian Mbappe names him his favourite pundit - after he wrote him a poem and they shared bizarre virtual hug
- Man United Confidential: Stewards charged over derby assault axed by Old Trafford security, outrage at club's cup tickets warning, new stadium clears next hurdle and injury boost for Amad Diallo
- The return of Man United, how will Jose Mourinho fare back at Real Madrid, the underdog to look out for and the major challenge facing Arsenal... SIX things to be excited about as the Champions League returns
- Football League boss becomes first managerial casualty of the season... as his club sack their manager in September for second year in a row

**REJECTED**

- Why Man City are fired up to end their Old Trafford hoodoo: Squad unity, the star duo drumming standards into newcomers and the missing ingredient players say Enzo Maresca has added ahead of Man United clash
- Manchester United vs Sabah - Champions League RECAP: Four different scorers help hosts record comfortable win
- How Patrick Dorgu fared on his left-back audition in Man United's win over Sabah: The key areas he needs to improve, where he is BETTER than Luke Shaw and what Michael Carrick learnt ahead of Man City clash
- How Patrick Dorgu fared on his left-back audition in Man United's win over Sabah: The key areas he needs to improve, where he is BETTER than Luke Shaw and what Michael Carrick learnt ahead of Man City clash
- Todd Boehly is on the brink of leaving Chelsea and selling his minority stake - with Behdad Eghbali's Clearlake Capital set to take control of club
- Todd Boehly is on the brink of leaving Chelsea and selling his minority stake - with Behdad Eghbali's Clearlake Capital set to take control of club
- Man United make light work of minnows Sabah as Youri Tielemans excels in 4-0 win on Champions League return - but tougher tests await for Michael Carrick's men
- GRAEME SOUNESS: Old Firm derby is the biggest of them all... but having no away fans is damaging the spectacle
- Alexis Mac Allister learns his lesson after public revelation over his Liverpool future - more of these destructive winners and there will be a new contract in front of him, writes IAN LADYMAN
- Derek McInnes wants his Rangers side to mix fire with ice as they look to find their ruthless streak in Old Firm cauldron

### Daily Mirror Football (EN)

[RSS](https://www.mirror.co.uk/sport/football/?service=rss) — PASS. 

**ACCEPTED**

- Premier League stars obsessed with collecting football cards in their free time
- West Ham star threatens legal action over 'false allegations' after kidnap claims

**REJECTED**

- Liverpool news: Bradley Barcola issue called out as transfer chief breaks silence on star
- Man Utd news: Michael Carrick makes rule change as club's Premier League request granted
- Arsenal news: Declan Rice makes risky comment as 'rusty' star called out
- Michael Carrick gives Luke Shaw injury update after he misses game before Manchester derby
- Fenerbahce manager resigns from fourth stint hours after Mason Greenwood decision
- Man Utd star JJ Gabriel sparks social media concern after record-breaking hat-trick
- Baffled Champions League star learns his manager resigned straight after final whistle
- Benjamin Sesko sends clear message to Michael Carrick on night of few revelations for Man Utd
- Man Utd batter Sabah to enjoy dream Champions League return - 5 talking points
- UFC star Paddy Pimblett admits he wants to ‘beat up’ Arsenal boss Mikel Arteta as challenge laid out

### SPORTbible Football (EN)

[RSS](https://www.sportbible.com/football.rss) — PASS. 

**ACCEPTED**

Nincs a mintában.

**REJECTED**

- Lisandro Martinez gets round of applause from CBS studio for response to 'who is your favourite pundit on the show'
- Archie Brown finds out during post-match interview that Fenerbahce manager Ismail Kartal has resigned
- Why Bryan Mbeumo, Patrick Dorgu and Leny Yoro are wearing different kits to Man Utd teammates vs Sabah
- Marcus Rashford receives explanation from Barcelona behind decision to snub him for Anthony Gordon
- What would actually happen if Chelsea were stripped of 2017 Premier League title after Mauricio Pochettino demand
- FPL expert builds perfect wildcard team for GW4 that will help every manager climb their mini league
- Mauricio Pochettino demands Premier League strip club of title in extraordinary interview
- Barcelona make huge Anthony Gordon transfer move after 'not normal' debut in Champions League
- Martin Odegaard verbally savages Jamie Carragher and Micah Richards during live CBS Sports interview
- 'That is criminal!' - Morgan Rogers and Cole Palmer derail live Sky Sports interview after chaotic Leeds game

### Daily Express Football (EN)

[RSS](https://www.express.co.uk/posts/rss/67/football) — PASS. 

**ACCEPTED**

Nincs a mintában.

**REJECTED**

- Arsenal news: Declan Rice snubs team-mates as 'rusty' star called out
- Man Utd news: Michael Carrick rule change leaked as Premier League grant request
- Liverpool news: Ronald Araujo £47m transfer hint as Bradley Barcola issue spotted
- JJ Gabriel raises eyebrows with social media activity after Man Utd hat-trick
- Champions League manager resigns immediately after full-time as players stunned
- Man Utd player ratings vs Sabah: Bruno Fernandes the standout as six 7/10s shine
- Premier League’s ‘Big Six’ oppose new financial plan with £550m boost for clubs
- Premier League chiefs respond as Mauricio Pochettino demands Chelsea are stripped of title
- JJ Gabriel sends clear message to Man Utd boss Michael Carrick after sensational debut
- Premier League give in to Man Utd and issue announcement to end dispute

### Metro Football (EN)

[RSS](https://metro.co.uk/sport/football/feed/) — PASS. 

**ACCEPTED**

Nincs a mintában.

**REJECTED**

- Jamie Carragher rates Man Utd Champions League hopes after Sabah win
- Owen Hargreaves claims Man Utd star can become ‘best in the world’ after Champions League win
- Mauricio Pochettino makes Mikel Arteta claim and Arsenal Premier League prediction
- Regis Le Bris makes huge Arsenal Premier League claim ahead of Sunderland clash
- Arsenal legend Thierry Henry says Champions League team are ‘unplayable’
- Deco explains why Barcelona wanted Anthony Gordon more than Marcus Rashford
- Premier League announces seven fixtures for Boxing Day
- Emmanuel Petit says Arsenal missed out on ‘perfect’ summer signing
- Troy Deeney names two Arsenal starters who can still ‘offer more’
- Declan Rice sends message to Kevin De Bruyne after Arsenal beat Napoli

### Metro Oddballs (EN)

[RSS](https://metro.co.uk/sport/oddballs/feed/) — PASS. 

**ACCEPTED**

Nincs a mintában.

**REJECTED**

Nincs a mintában.

### talkSPORT Football (EN)

[RSS](https://talksport.com/football/feed) — PASS. 

**ACCEPTED**

- West Ham midfielder Edson Alvarez furiously rejects allegations he was involved in a kidnapping plot
- Joey Barton to remain in custody ahead of 2027 trial

**REJECTED**

- Harry Kane joins elite Champions League group with Cristiano Ronaldo as Bayern Munich add to stunning run
- Champions League manager immediately resigns minutes after opening match
- 15-year-old wonderkid makes Manchester United history with stunning debut hat-trick
- Leicester warned they’re heading for ‘Armageddon’ as prospective new owner outlines plan to save them
- Hakim Ziyech finds new club four days after ex-Chelsea star had contract terminated
- Lionesses legend Jill Scott handed new job at EFL club
- ‘You need him’ – Arsenal told to ignore star’s nightmare statistic against Napoli
- Boxing Day is back: Premier League makes early announcement on Christmas fixtures
- Premier League star boycotts Switzerland over furious World Cup row with manager
- ‘He’s struggling’ – Liverpool starter must step up or risk brutal transfer

### OKDIARIO Paparazzi (ES)

[RSS](https://okdiario.com/deportes/corazon/feed) — PASS. 

**ACCEPTED**

- Cristiano Ronaldo (41 años): «Yo no hago dieta, tengo buenas rutinas; si me apetece comer una hamburguesa con patatas fritas, no pasa nada»
- Georgina Rodríguez (32 años): «El día que conocí a Cristiano Ronaldo me quedé parada, empecé a sentir cosquillas en el estómago; era tan guapo que me daba vergüenza mirarle»
- El seleccionador de Egipto se desmaya tras ver a sus dos esposas pelearse a sillazos en una cafetería
- Salen a la luz fotos muy subidas de tono de Naomi Asensi, ex de ‘La isla de las tentaciones’, con un conocido futbolista español
- El vídeo muy subido de tono con el que Georgina Rodríguez responde a los que critican su figura
- Georgina Rodríguez (32 años): «Es curioso que cada año mi cuerpo vuelve a ser noticia; amo mis curvas, amo la libertad de vivir en el cuerpo que elijo»
- Cucurella: “Siempre quise ser padre joven, era un friki que no tenía ni novia, pero luego se dio la ocasión y Claudia estaba de acuerdo”
- Graban y fotografían a Wanda Nara en bikini en Italia y las redes sociales arden
- Los comienzos de Rodri con su novia: «Me dijo ‘novata, recógeme la bandeja’, y se la recogí a todos menos a él…»
- Marcos Llorente, sobre sus fotos con Ferran Torres: «Me sorprende que en 2026 siga generando debate que dos hombres se den cariño»

**REJECTED**

- Alcaraz vuelve a entrenar y enseña su cambio de look que causa el furor en las redes
- Un club español se ve obligado a eliminar el post con el que anunciaban el fichaje de su nueva fisioterapeuta
- La hija mayor de Joaquín confirma su romance con un futbolista español con un vídeo muy subido de tono
- Lío de faldas en el pádel profesional: corta con su novia y a los días le pillan con una influencer que estuvo con Lamine Yamal
- Lío de faldas en el PSG: una actriz de cine para adultos promete a Safonov una “noche apasionada” por cada parada
- Un acosador obsesionado con la novia de Lucas Torreira agrede en plena calle al ex jugador del Atlético
- El nuevo negocio de Messi en Barcelona en el que ha invertido casi 12 millones de euros
- Un periodista publica vídeos de Theo Hernández y otros futbolistas de fiesta con escorts y gas de la risa
- El dardo de la madre de Tsitsipas a Paula Badosa: «Para él fue una carga»
- Pillan a Grealish dormido y borracho en una terraza rodeado de copas: «El alcohol le pasó factura»

### OKDIARIO Fútbol (ES)

[RSS](https://okdiario.com/deportes/futbol/feed) — PASS. 

**ACCEPTED**

- Marlaska abre un expediente «por falta muy grave» a los policías agredidos por un ultra independentista del Barça
- Muere repentinamente la hermana de Monchi, Catalina Rodríguez, a los 64 años
- Luis de la Fuente, nombrado Riojano Ilustre y dará nombre al Palacio de los Deportes de La Rioja
- Lucas Pérez (37 años): «Mis padres me abandonaron con 2 años y ahora me piden dinero de por vida»

**REJECTED**

- La Federación pasa de Marruecos: «Es un movimiento político, la final la tenemos que hacer nosotros»
- El Real Madrid firma el récord absoluto del límite salarial y saca 250 millones a un Barcelona que crece un 66%
- La prensa afín a Mohamed VI se mofa de España por la final del Mundial: «¿Harán un gran estadio en la Ceuta ocupada?»
- La FIFA desmiente a Marruecos limitándose a repetir que la sede de la final del Mundial 2030 no está decidida
- UFP arremete contra Marlaska por el expediente a los policías agredidos por el ultra del Barça: «Absolutamente inaceptable»
- Pochettino le declara la guerra al Chelsea: pide que le den una Premier League nueve años después
- El Barcelona reniega ahora de Julián: «No le dijimos que expresara su deseo de irse del Atlético»
- Koke pide «dejar en paz» a Julián Álvarez: «Sois muy cansinos»
- El presidente de la Federación de Marruecos y ministro del Gobierno dice que la final del Mundial 2030 será en Casablanca
- Burlas en redes sociales con el Camp Nou por inundarse la tribuna de prensa: «¡Tiene hasta una cascada!»

### Mundo Deportivo El Otro Mundo (ES)

[RSS](https://www.mundodeportivo.com/feed/rss/elotromundo) — PASS. 

**ACCEPTED**

Nincs a mintában.

**REJECTED**

- Ester Expósito: "Lo más sexy que alguien puede tener es el humor y la inteligencia"
- ¿Sigue abierto el restaurante 'Bodeguita Los 50' de 'Pesadilla en la cocina'?
- Jorge Fernández, sobre su infancia: "Viví en Mondragón, que durante los años 80 y 90 era la cuna de ETA"
- El refugio gallego en el que se rodó la última película de Mario Casas en Prime Video se alquila
- Ni los críticos se ponen de acuerdo: la miniserie de Movistar Plus que es Top 1 en España
- La Ley de Bienestar Animal prohíbe a los propietarios de perros y gatos utilizarlos en espectáculos públicos
- Avance del capítulo 904 de 'La Promesa' que se puede ver este viernes en RTVE: María, tras hablar con Carlo antes de la boda, anuncia algo importante
- Cayetano Rivera: "Aun sabiendo la realidad, siempre he preferido callarme"
- Avance del capítulo 485 de 'Valle Salvaje' que se puede ver este viernes en RTVE: Don Hernando no permitirá que Rafael ceda
- Ana de Armas abre el álbum privado de fotos de sus vacaciones

### 20minutos Deportes (ES)

[RSS](https://www.20minutos.es/rss/deportes/) — PASS. PREFLIGHT

**ACCEPTED**

- El hermano de Jenni Hermoso asegura que le dijeron a Vinícius que iba a ganar el Balón de Oro: "Ya tenía sitio en una vitrina"

**REJECTED**

- España pasa por encima a Australia y se mete en semifinales del Mundial femenino de Baloncesto
- Fernando Alonso y Carlos Sainz pisan por primera vez el Madring: reconocimiento al circuito de los españoles antes de la acción
- Maica García denunciará al Sabadell por su despido tras la baja de maternidad: "Tuve ataques fuertes de ansiedad"
- Kylian Mbappé: "Tengo muchas ganas de ayudar al Real Madrid y demostrar que podemos hacer grandes cosas este año"
- El Madring, desde el asfalto: una vuelta al circuito con '20minutos' y una parada en la icónica curva Monumental
- Fernando Alonso, el centro gravitacional del Madring: llega en traje, susto con el patinete y su mejor recuerdo del GP de España
- Madring calienta motores: las caras más reconocidas llegan a la gran cita
- Enric Mas aguanta el tirón de Roglic en la contrarreloj y mantiene el liderato en La Vuelta
- La FIFA desmiente a Marruecos por la final del Mundial 2030: "La decisión se tomará en su debido momento"
- Maica García denunciará al Sabadell por no renovarla tras ser madre: "Tuve un cuadro fuerte de ansiedad"

### 20minutos Gente/Televisión (ES)

[RSS](https://www.20minutos.es/rss/gente-television/) — PASS. PREFLIGHT

**ACCEPTED**

- Paddy, mujer de Marcos Llorente, sobre su profesión: "Dejad de preguntarme, soy un ser de luz"

**REJECTED**

- Tommy Hilfiger convierte el Hotel Plaza en su pasarela y pasea al perro de Taylor Swift y Travis Kelce
- Tu horóscopo diario: viernes 11 de septiembre de 2026
- Marina Rivers: "Mi novio quería que me echaran de 'MasterChef' para poder verme y no hablaba de otra cosa"
- La posible indirecta de Cayetano Rivera a su hermano Fran: "Hay quienes se creen en el derecho de contar tu historia por ti"
- Ion Aramendi desvela cuánto costó su boda con María Amores y anuncia una "reboda" en 2027
- Un 'influencer' pierde un dedo tras intentar colarse en el Rock in Rio a pesar de tener entradas
- El empresario que contrató a Jesulín para torear en Ocaña pone en duda su lesión y anuncia acciones legales: "Me ha defraudado"
- Billy Joel se somete a una cirugía cerebral por su hidrocefalia: "Cada concierto me provocaba algo parecido a una conmoción"
- Así es Kimberley Byrom, la británica detrás de las experiencias de lujo de Madring y de la 'Residencia Europea' de Shakira
- Las extrabajadoras de Julio Iglesias acuden a la ONU para solicitar su intervención por "temor a represalias"

### Golssip /gossip/ (IT)

[RSS](https://www.golssip.it/gossip/feed/) — FAIL/SKIP. SKIP: Status code 404

**ACCEPTED**

Nincs a mintában.

**REJECTED**

Nincs a mintában.

### Virgilio Sport Gossip (IT)

[RSS](https://sport.virgilio.it/feed/rss/gossip/) — PASS. 

**ACCEPTED**

- David e Victoria Beckham turisti tra le vie di Capri
- Noemi Bocchi a Ballando con le Stelle, Totti la gela: intanto Ilary Blasi sposa Bastian, ecco la data
- Alisha Lehmann a Wimbledon con il nuovo fidanzato Montel McKenzie: anello in vista, Douglas Luiz e la Juventus dimenticati
- Diamante Crispino, l'ex portiere di Napoli e Como protagonista a Temptation Island con la fidanzata Bernadette
- Francesco Totti e Ilary Blasi, la scelta delle due feste separate per la comunione della figlia Isabel
- Donnarumma e Alessia Elefante sposi: sarà per sempre sì, l’annuncio social. Ma intanto l’Arsenal scappa
- Armando Izzo e Raffaella Fico, l'amore finisce con una storia e rimuovendo le foto da Instagram
- Elena Santarelli a Belve indignata e commovente, Corradi e Chiara Ferragni: la sua intervista nelle anticipazioni
- Gigi Buffon con Ilaria D'Amico per allontanare la tempesta post esclusione dell'Italia ai Mondiali
- Salta l'udienza del divorzio Totti-Blasi, il capitano della Roma con Noemi Bocchi in vacanza mentre Ilary attende

**REJECTED**

- Martina Colombari trasformista a Venezia 83 riceve il Filming Italy Venice Award per "Buen Camino"
- Andy Diaz Hernandez a Ballando con le Stelle 2026, nuovo approdo per il campione europeo di salto triplo arrivato da Cuba
- Giorgia Cardinaletti e Francesco Bechis sposi, pubblicazioni on line e primi dettagli sul matrimonio dell'anno
- Sfera Ebbasta a San Siro per Inter-Napoli circondato da 10 ragazze, il problema è uno stereotipo non più tollerabile
- Bagnaia, la frase sulla paternità scatena la rabbia di Domizia Castagnini: "Gente povera" ed è polemica
- Alessandro Matri parteciperà a Ballando con le Stelle, ma chi sarà la sua maestra? Ufficiale Aurora Ramazzotti
- Chiara Pellacani e Matteo Santoro, storia di tuffi e d'amicizia dietro all'oro ma non si parli solo d'amore
- Papà Bagnaia, prima foto con dedica per il figlio e mamma Domizia: "Emozione indescrivibile". La settimana dell'addio a Ducati
- Alexandra Saint Mleux incinta e Leclerc presto papà: le voci si rincorrono e le foto a Saint-Tropez diventano un caso
- Il matrimonio di Valentina Vignali e Fabio Stefanini è un inno al romanticismo tra location, abiti e il lago di Bracciano

### Tuttosport Calcio (IT)

[RSS](https://www.tuttosport.com/rss/calcio) — PASS. 

**ACCEPTED**

- "Non potevo continuare così e rovinare mio figlio". Lavezzi shock: "Mi hanno convinto a..."

**REJECTED**

- Venezia-Fiorentina: probabili formazioni e diretta. Dove si vede in tv e streaming
- Torino, Belghali va veloce e Abate è già convinto
- Fabregas: "Notte Champions storica? Felice per 5 minuti, c'è Como-Parma! Baturina e Diao…"
- Como una favola: lo storico esordio in Champions è un poker al Lipsia! Brillano le stelle di Fabregas
- Gasperini: "Roma ottima ma serve attenzione. Da chi mi aspettavo di più. Balerdi, Molina e Pisilli..."
- La Roma soffre ma strappa il pari in Turchia: non basta Cristante contro il Fenerbahce
- Vlahovic squalificato! La lite con Skriniar costa caro, il Besiktas non ci sta
- Infortuni Meret e Alisson Santos: esami, comunicato ufficiale del Napoli e tempi di recupero
- "Io come Thuram?", da McKennie ai voti Juve: "Il capocannoniere e chi dovete tenere d'occhio"
- Immobile, dopo il ritiro c’è l’Italia: annuncio ufficiale sul nuovo ruolo

### Gazzetta Calcio (IT)

[RSS](https://www.gazzetta.it/dynamic-feed/rss/section/Calcio.xml) — PASS. 

**ACCEPTED**

Nincs a mintában.

**REJECTED**

- Il sopravvissuto, CR7 alla tv, il Valencia "rinchiuso": 6 storie sportive legate all'11 settembre
- Le partite di oggi: in campo la Fiorentina di Vanoli e tre gare di B. Poi Liga, Bundes e Ligue 1
- Ode allo 0-0, un altro caro estinto del campionato. Ma non è una malattia da estirpare
- Como-Lipsia, le pagelle: Baturina 8, partita da Playstation. Nkunku 5,5, non fa male
- Fenerbahçe, cose turche! L'allenatore si dimette, il presidente lo conferma: "Gli hanno tirato una bottiglia"
- Fenerbahce, l'allenatore si dimette così dopo la Roma: "Me ne vado, non voglio domande. Buona serata"
- Fabregas: "Notte storica per Como, ma la felicità deve durare al massimo 5'. Lunedì c'è il Parma..."
- Fenerbahçe-Roma 1-1 highlights: gran gol di Cristante, poi Svilar si prende la scena
- Fenerbahçe-Roma, le pagelle: Greenwood 7, ecco perché Gasp lo voleva. Mancini 5, errore grossolano
- Fiorentina, Grosso rischia il licenziamento per giusta causa? L'avvocato: "Il procedimento inizia con..."

### Corriere dello Sport Calcio (IT)

[RSS](https://www.corrieredellosport.it/rss/calcio) — PASS. 

**ACCEPTED**

- Dybala, paura nella notte. Si sveglia e trova la moglie così: "Traumatizzato"

**REJECTED**

- Fabregas applaude il suo Como: "Una notte storica, ora però serve umiltà"
- Capello incontentabile, arriva la frecciata a Nico Paz: "Da te pretendo di più". Poi critica Fabregas per il cerchio in campo
- Perché Gasperini ha sostituito Koné: fastidio al ginocchio per il centrocampista
- Clamoroso Fenerbahce, l'allenatore Kartal si dimette in conferenza stampa dopo il pareggio contro la Roma
- Gasperini soddisfatto: "Per la classifica Champions servono anche i pareggi"
- Debutto in Champions a suon di gol per Bayern e Manchester United, colpaccio Lens
- L'abbraccio tra Gasperini e Greenwood dopo il corteggiamento della Roma: la scenetta in campo non passa inosservata
- Napoli, solo cattive notizie: Allegri perde Meret e Alisson
- Como, una notte stellare: Fabregas asfalta il Lipsia e cala il poker al debutto in Champions
- Il Pisa protesta dopo il malore di Bozhinov: "Grave negligenza, la salute non può essere messa in secondo piano"

### BILD Sport (DE)

[RSS](https://www.bild.de/feed/sport.xml) — PASS. 

**ACCEPTED**

- Wildes Muster - Foto von Bayerns Wiesn-Trikot geleakt

**REJECTED**

- Polanski, Talente, Kleindienst - Wichtige Gladbach-Botschaften nach dem Fehlstart
- Zweimal Halbfinale und Finale - Deutsche Festspiele bei den US Open
- Wird er der Retter? - Poulsen beim HSV so wichtig wie nie
- Kommunalwahl am Sonntag - DFB-Pokalsieger will Bürgermeister werden
- Besondere Szene bei US-Open-Halbfinals - Michelle Obama lässt das Stadion beben
- Vier Scorer in drei Ligaspielen - Dajaku macht bei Hansa den Unterschied
- Dresdner steigt am Sachsenring wieder ein - Nach Crash und Brüchen! Paul-Comeback in der DTM
- Ist die späte Anreise schuld? - Super-Bowl-Favorit patzt in Australien!
- Augsburg- oder Bayernform - Heute sehen wir das WAHRE Schalke!
- Tor & Sieg bei Rückkehr in die Startelf - Musialas Traum-Comeback

### SPORT BILD Football (DE)

[RSS](https://sportbild.bild.de/rss/vw-fussball/vw-fussball-45036878,sort=1,view=rss2.sport.xml) — PASS. 

**ACCEPTED**

- Nach dem WM-Finale - Trump verblüfft Weltmeister-Coach mit Ballon-d'Or-Spruch

**REJECTED**

- Real-Coach ehrlich - Mourinho: Warum Diomande nicht in der Startelf steht
- Bundesliga am Freitag - So sehen Sie Union gegen Schalke live im TV & Stream
- Bundesliga am Samstag - So sehen Sie Dortmund –Paderborn live im TV
- Ehrliche Worte vom Bayern-Star - Musiala: „Ein Gefühl, das ich eine Weile nicht hatte“
- Erstes CL-Spiel seit fast 3 Jahren - Magische United-Rückkehr!
- Traum-Startelf-Comeback nach Zusammenbrüchen - Musiala leitet Bayerns Tor-Party ein!
- Pleite beim Königsklassen-Comeback - Demichelis & Leipzig gehen in Como unter!
- Superstar plant Zukunft - Spanien-Klub bestätigt Messi-Deal!
- „Wie eine Tischdecke“ - Das denken die Bayern-Fans über das neue Wiesn-Trikot
- Beim CL-Auftakt - Musiala überraschend in Bayern-Startelf!

### Blick Fussball (DE)

[RSS](https://www.blick.ch/sport/fussball/rss.xml) — FAIL/SKIP. SKIP: Status code 403

**ACCEPTED**

Nincs a mintában.

**REJECTED**

Nincs a mintában.

### Kronen Zeitung Fussball (DE)

[RSS](https://api.krone.at/v1/rss/rssfeed-google.xml?id=958) — PASS. 

**ACCEPTED**

- Nicht ganz dicht - Barcas Milliarden-Projekt Stadion: Es regnet rein

**REJECTED**

- „Ist außergewöhnlich“ - Ballon d‘Or? Flick hat einen klaren Favoriten
- Chaos nach Auftakt - CL: Trainer schmeißt hin – Präsident legt Veto ein
- Routinier Schwab - „Ein paar Leute haben mich schon abgeschrieben“
- Große Ziele mit WAC - Fitz freut sich auf Rapid! Schon neun Gelbe Karten
- Schöttel vor ÖFB-Aus - „Mit ihm und Rangnick hat’s nicht so funktioniert“
- 5:0-Gala in der CL - Bayern: Nach dem Probealarm hielt die Rekord-Serie
- Bundesliga im Ticker - SV Ried gegen Red Bull Salzburg ab 19.30 Uhr LIVE
- Deutsche Bundesliga - Union Berlin gegen Schalke ab 20.30 Uhr LIVE
- Krimi in Prag - Bayern glänzt – Historischer CL-Sieg für Como
- Startelf und Tor - Gänsehaut! Musiala schreibt Bayern-Geschichte

### SPORT1 Boulevard (DE)

[RSS](https://www.sport1.de/rss/boulevard) — FAIL/SKIP. SKIP: Status code 404

**ACCEPTED**

Nincs a mintában.

**REJECTED**

Nincs a mintában.

### oe24 Fussball (DE)

[RSS](https://www.oe24.at/sport/fussball/rss) — FAIL/SKIP. SKIP: Status code 404

**ACCEPTED**

Nincs a mintában.

**REJECTED**

Nincs a mintában.

### AS Tikitakas (ES)

[RSS](https://feeds.as.com/mrss-s/pages/as/site/as.com/section/tikitakas/portada/) — PASS. 

**ACCEPTED**

Nincs a mintában.

**REJECTED**

- Top Chef VIP 2026: ¿Quién es el eliminado de hoy, 10 de septiembre?
- Grison, sobre ‘La Revuelta’ y un posible cambio de gobierno: “Quizá nos tomen como cabeza de turco”
- Mónica Cruz (49 años): “Me gusta hacer ayuno, desayuno café americano y como tostadas con huevo, jamón o aguacate”
- Colocar papel higiénico hacia adelante o atrás: por qué los expertos recomiendan esta opción
- Chaysavanh Manichanh, experta microbiota: “Un mayor consumo de café está asociado con una reducción de la inflamación”
- Muere Olivia Oras a los 27 años
- Ronnie Wood, guitarrista de los Rolling Stones: “Están pasando demasiadas cosas malas en el mundo, así que lo que queremos es hacer feliz a la gente”
- La reflexión de Javier Bardem sobre la cultura de EEUU comparada con España: “No pertenezco a la cultura americana”
- La vida personal de Ester Expósito: su familia, parejas conocidas y su salto a la fama con ‘Élite’
- José Luis Puchol, veterinario: “Antes los perros eran solo mascotas, hoy los dueños pagan lo que sea para salvarles y eso mejora los tratamientos”

### ElDesmarque Famosos (ES)

[RSS](https://www.eldesmarque.com/famosos/feed/) — FAIL/SKIP. SKIP: Status code 403

**ACCEPTED**

Nincs a mintában.

**REJECTED**

Nincs a mintában.

### 101 Great Goals (EN)

[RSS](https://www.101greatgoals.com/feed) — PASS. RETIRED

**ACCEPTED**

Nincs a mintában.

**REJECTED**

- Carrick hails ‘fantastic’ Mainoo as United impress on Champions League return
- Champions League round-up: Bayern Munich hit five past Bodo/Glimt as Como get big win
- Manchester United 4-0 Sabah: Report, result and goals as Red Devils cruise to UCL win
- WATCH: Manchester United take the lead in Champions League
- LIVE – Manchester United v Sabah: Commentary, updates, goals and stats
- Manchester United vs Sabah: Line-ups confirmed for Red Devils’ Champions League return
- Seahawks ‘dodge bullet’ with Darnold injury update
- Premier League Christmas fixtures confirmed with seven Boxing Day matches
- Man United teenager Gabriel scores hat-trick in UEFA Youth League demolition
- BREAKING: Real Madrid star Guler agrees new contract

### CaughtOffside (EN)

[RSS](https://www.caughtoffside.com/feed) — PASS. RETIRED

**ACCEPTED**

Nincs a mintában.

**REJECTED**

- Everton considering signing free agent with 250 career goals, he’s open to Toffees transfer
- Arsenal identify 24-year-old defensive target ahead of January transfer window
- Xabi Alonso makes surprise decision on Chelsea attacker who “is not part of the plans”
- Arsenal send scouts to watch highly rated 24-year-old La Liga ace
- Premier League summer signing admits he would have joined Manchester United
- “The biggest difference is…” – sources on how Arteta has got Odegaard back to his best for Arsenal
- Video: Arsenal star appears to snub Arteta amid claims he’s “p*****d off”
- Tottenham plan to return for £26m-rated Brazilian after having bid rejected
- Manchester United lead Liverpool and Tottenham in race for €50m Serie A star
- Chelsea and Liverpool eye £75m-rated Premier League star ahead of January window

### FootballFanCast (EN)

[RSS](https://www.footballfancast.com/feed) — PASS. RETIRED

**ACCEPTED**

- Why Everton could be about to sign their next version of Richarlison

**REJECTED**

- Manchester United plotting £150m raid to sign two Bournemouth stars in 2027
- £35m ENIC signing already looks like the modern-day Moussa Sissoko at Spurs
- Exclusive: Celtic end interest in top target after club release public statement
- Why £67m Arsenal star is now a bigger disaster than Gyokeres
- Midfielder learning English ahead of officially joining Liverpool after rejecting Man Utd
- Better than Hassan: Celtic star looks like he belongs in the Ange era
- £80m wasted: Newcastle outcast has become their modern-day Wood
- De Zerbi driving Tottenham pursuit of 'coveted' striker with Spurs officials sent to club
- Chelsea wage bill for 2026/27 season

### GiveMeSport (EN)

[RSS](https://www.givemesport.com/feed) — PASS. RETIRED

**ACCEPTED**

Nincs a mintában.

**REJECTED**

- Man Utd: Carrick Discovers Answer to Cunha Problem With Sesko
- Rangers May Have Saved Their Season After Keeping Nico Raskin
- Fernandez-Pardo Keen For New Newcastle Role Vs Leeds
- What Happened to Joseph Minala - the Lazio Wonderkid Who Was Reportedly 42
- Man Utd: 3 Players Wear Special Shirt in Champions League vs Sabah
- Man Utd Must Trust Academy Stars as Mainoo Shines Again
- Deco Explains Why Barcelona Signed Anthony Gordon Over Marcus Rashford
- Ballon d’Or: Michael Olise Backs Harry Kane to Win Award Over Himself
- Tottenham Could Be Making Mistake Letting Richarlison Leave
- Arteta's New Contract: Arsenal's Key to Future Success

### HITC (EN)

[RSS](https://www.hitc.com/news/feed) — PASS. RETIRED

**ACCEPTED**

- ‘Our President…’ Mauricio Pochettino reflects on ‘very supportive’ conversation with Donald Trump

**REJECTED**

- ‘He’s not a dad’ – Trinity Rodman once explained her strained relationship with NBA legend Dennis Rodman
- The ‘Rodman Rule’ was once created by the NWSL to make Trinity Rodman the highest paid player ever
- Trinity Rodman once said Ben Shelton passed a key relationship test without even knowing it
- Ben Shelton will surpass girlfriend Trinity Rodman’s record-breaking annual salary by reaching US Open final
- ‘What a shame…’ Argentina fans don’t like their tribute idea for Lionel Messi’s final game
- ‘The woman you are’ – Fans can’t believe Trinity Rodman made it to practice after late Ben Shelton win
- ‘I’m gonna cry’ – Soccer fans get emotional over Lionel Messi and Robert Lewandowski’s MLS moment
- WATCH: Robert Lewandowski fires in outrageous stunner before Lionel Messi’s Inter Miami hit back
- WATCH: Cristiano Ronaldo leads Al Nassr to 2-1 win over Abha with historic header for 979th goal
- Lionel Messi follows in Cristiano Ronaldo’s footsteps as he becomes new owner of La Liga 2 team

### Bernabéu Digital (ES)

[RSS](https://www.bernabeudigital.com/rss) — PASS. RETIRED

**ACCEPTED**

- Los dos sorprendentes clubes que pelearon por Endrick en verano

**REJECTED**

- Último entrenamiento del Real Madrid y rueda de prensa de José Mourinho
- La renovación de Güler, La Vuelta y la F1, protagonista de las portadas deportivas
- Bellingham cerca de renovar y Diomandé pide minutos en el Real Madrid
- El último hito de Nico Paz que demuestra que el Real Madrid debe firmarle
- El Real Madrid manda un mensaje directo a Diomandé: le piden paciencia
- La FIFA rompe el mercado: adiós a las cláusulas desorbitadas
- Desvelan motivo que bloqueó un fichajes en la medular del Real Madrid
- Colocan al Barça por delante del Real Madrid en la 'Operación Haaland'
- Ya hay confirmación del nuevo contrato de Bellingham: firmaría hasta 2032
- El Real Madrid vuelve a ostentar el mayor límite salarial de LaLiga

### Panenka (ES)

[RSS](https://www.panenka.org/feed/) — PASS. RETIRED

**ACCEPTED**

Nincs a mintában.

**REJECTED**

- Y la Fiore nos robó el corazón
- Isco Alarcón: Europa, la tierra, el duende
- Adel Taarabt y el paso del tiempo
- Camello y el Rayo: recuperar lo nuestro
- Real Politik FC #26 \| El estadio como instrumento de poder
- #Panenka161: Gabriel Batistuta y los 100 años de la Fiore
- Haim Revivo: Yom Kipur en Vigo
- Como un profesional
- La Quiniela o las apuestas de fútbol: ¿dónde paga más tu pronóstico?
- ‘No es solo un juego’: el nuevo libro de Panenka

### FCInter1908 (IT)

[RSS](https://www.fcinter1908.it/feed) — PASS. RETIRED

**ACCEPTED**

Nincs a mintában.

**REJECTED**

- Bergomi: "Inter caso anomalo in Europa. E rimango convinto di una cosa"
- Caressa: "Inter presuntuosa e corregga due difetti. Real Madrid? Deve essere illegale..."
- Colantuono: "Napoli non ha sfigurato contro l'Arsenal. E l'Inter col Real avrebbe potuto..."
- Zenga: "Martinez? È riuscito ad accantonare l'errore. Parole Chivu mostrano cambio mentalità"
- Eto'o finisce al centro di una bufera. Times: "Mistero su 500mila euro"
- Champions League - Apoteosi Como: Lipsia battuto 4-1! Il Bayern ne fa 5 al Bodo
- Brocchi: "Inter la più forte in assoluto. Una squadra può impensierirla per lo scudetto"
- Palmeri: "Napoli? Con l'Arsenal si è difeso e stop. Paragonarlo all'Inter Madrid vuol dire..."
- Inter, ecco quanto vale ora la maglia. Con BBVA ha staccato Milan e Juve: "Nel range del Bayern"
- Bucchioni: "Napoli, ecco perché Allegri va aspettato. Inter e Como non dico che sono..."

### CalcioNapoli24 (IT)

[RSS](https://www.calcionapoli24.it/feed) — PASS. RETIRED

**ACCEPTED**

- Lavezzi e i problemi di salute mentale: “Mi sono ricoverato per non rovinare la vita a mio figlio"
- Lavezzi: "Mi voleva la Juve, ma ho scelto Napoli per Diego. Primo giorno in città: mi è venuta a prendere la polizia!"

**REJECTED**

- Meret e Alisson: svelati i reali tempi di recupero. Quante gare dovranno saltare
- Sorpresa Anguissa: cosa filtra sulla sua presenza per Napoli-Bologna
- CorSport - Rinviati i rinnovi di McTominay, Anguissa e Lobotka
- Sabatini: "Napoli, testa alta ma 0 punti! KdB trasformato, Rafa Marin sta diventando..."
- Auriemma: "Per me è stato uno dei migliori Napoli, anche dell'anno scorso"
- "Aveva in pugno Gila e Gabriel Jesus". Retroscena Manna: perché ha dovuto rinunciare a questi due colpi
- Del Piero difende il Napoli: "Tra le realtà top d'Italia, si diceva che dopo lo scudetto..."
- Condò: "Difficoltà Napoli in Europa negli ultimi anni: il motivo è chiaro"
- Voti e pagelle Rrahmani: mette il bavaglio a Gyokeres! Non gli scappa praticamente mai
- Voti e pagelle Rafa Marin: salva sulla linea su Tzolis! Fa buona guardia tra mille difficoltà

### Spazio Napoli (IT)

[RSS](https://www.spazionapoli.it/feed) — PASS. RETIRED

**ACCEPTED**

- Lavezzi, discorso da brividi sui problemi di salute: “Mi sono curato per mio figlio…”

**REJECTED**

- Napoli, è crisi in difesa: 76 tiri subiti in tre partite e XG mai così alto!
- Napoli, arrivato l’annuncio su Meret e Alisson: c’è lesione per entrambi!
- Napoli-Bologna, arrivano ottime notizie per Allegri: Anguissa verso il recupero!
- Giuffredi, sfogo durissimo in diretta: “Accuse gravissime contro di me e De Laurentiis. Mi sono rotto”
- Il momento ideale per gli ossessionati da Massimiliano Allegri
- Napoli: sette infortuni in nove giorni, l’incubo si ripete
- Napoli-Arsenal: Ghoulam sconsolato: “Mi dispiace per De Bruyne e Hojlund”
- Napoli multato dalla UEFA per la coreografia degli Ultras: la ricostruzione
- Napoli-Arsenal: Noa Lang escluso per lo scontro con Allegri, i dettagli
- Napoli: Meret e Alisson infortunati, esami prima del Bologna

### TuttoNapoli (IT)

[RSS](https://www.tuttonapoli.net/rss) — PASS. RETIRED

**ACCEPTED**

Nincs a mintában.

**REJECTED**

- Borghi smentisce Allegri sulla solidità: “Arsenal ha creato un’enormità, 4xG! Succede raramente!”
- Calcio in Tv, le gare trasmesse oggi: inizia la 4ª giornata di Serie A
- Napoli-Arsenal, Silvestre: “Allegri peggiore in campo! Squadra rinunciataria e mai pericolosa”
- Novi: “Faccio il nome di un azzurro che mi è piaciuto molto in Napoli-Arsenal”
- Bucchioni: “Il calcio di Allegri rischia di non piacere ai giocatori del Napoli”
- Forgione: “Con Allegri non ci divertiremo. Deponiamo le armi e iniziamo a vincere”
- Corsa Champions, Biasin avvisa Milan e Juve: “Inter, Roma, Como e Napoli sono avanti”
- Napoli-Arsenal, l’analisi di Canovi: “Ci sono squadre che attaccano e altre no”
- Napoli-Arsenal, Colantuono predica calma: “Non ha sfigurato, presto per dare giudizi”
- Italia U16, Immobile nuovo capo delegazione: "È il momento di restituire qualcosa al calcio"

### IamNaples (IT)

[RSS](https://www.iamnaples.it/feed) — PASS. RETIRED

**ACCEPTED**

- Il Napoli celebra De Laurentiis: “22 anni di traguardi, emozioni e pagine indimenticabili”

**REJECTED**

- Arpaia: “Gilmour mi è piaciuto tanto, bene la scelta del doppio play”
- Bologna, differenziato per El Azzouzi e Orsolini: le ultime in casa rossoblù
- Salvione: “Il Napoli si sta modellando, sta diventando la squadra che chiede Allegri
- Olivera: “Arsenal? Lottato con una squadra fortissima, invertiremo la rotta”
- Napoli, Anguissa si è allenato con il gruppo: il giocatore ci sarà con il Bologna
- UFFICIALE – Lesione di medio grado per Alisson Santos, anche Meret ko: i dettagli
- Napoli, l’ex Bellucci: “De Bruyne con l’Arsenal doveva sfondare la porta. Ha criticato Conte, ora servono i fatti”
- Lavezzi: “Scelsi Napoli per Diego, volevo giocare nella squadra in cui ha giocato lui”
- Giuffredi tuona: “Io e Politano ci siamo rotti delle continue critice. Favasuli? Ero sicuro delle sue abilità”
- RILEGGI IL LIVE – Napoli Basketball: Spissu, Petrucelli e Brown in conferenza stampa

### SPOX fallback/general (DE)

[RSS](https://feeds.feedburner.com/spox-sport/) — PASS. RETIRED

**ACCEPTED**

Nincs a mintában.

**REJECTED**

- International: Übermäßiges Meckern: Spaniens Verband sperrt Hansi Flick
- International: "Ein Genie": Für Sami Khedira stand bei Real ein Spieler über CR7
- Bundesliga: "Eher nein": Bayern wohl auch in Mainz noch ohne Kane
- Champions League: "Habe versucht den Schiedsrichter zu bekehren": Kramer erzählt kuriose CL-Anekdote
- Bundesliga: DAZN regt revolutionäre Neuerung in der Bundesliga an
- Champions League: DAZN oder Amazon Prime Video: Wer zeigt / überträgt BVB vs. FC Barcelona in der Champions League heute live im TV und Livestream?
- Champions League: Carlo Ancelotti gibt Update zur Verletzung von Kylian Mbappé
- Champions League: BVB vs. FC Barcelona, Schiedsrichter: Wer pfeift heute Borussia Dortmund gegen Barca in der Champions League?
- Bundesliga: Bayern-Interesse im Sommer? Guirassy spricht Klartext
- Champions League: "Hatten kaum Kontrolle": Slot trotz CL-Sieg unzufrieden mit LFC-Profis

### MARCA Tiramillas (ES)

[RSS](https://www.marca.com/rss/googlenews/tiramillas.xml) — PASS. PREFLIGHT

**ACCEPTED**

Nincs a mintában.

**REJECTED**

- Un joven de Vietnam construye su propia central hidroeléctrica en casa para bajar su factura de luz
- La Antártida ganó 695 mil millones de toneladas de masa de hielo por un motivo
- Alerta por la congestión de los gimnasios tras las vacaciones de verano: esta infección viral puede propagarse mediante objetos compartidos
- Kimchi: el fermentado coreano que ha pasado de ser un desconocido a conquistar las mesas españolas
- El 11-S, 25 años después: el atentado que cambió el mundo
- Ester Expósito: "He sufrido mucho estando enamorada"
- Javier Bardem y Victoria Luengo, sobre la IA: "Da miedo, el mundo está en manos de gente muy loca"
- Ion Aramendi revela el dineral que se gastó en su boda con María Amores: "En lo que más nos gastamos fue en la barra libre"
- Un influencer con entrada pierde un dedo al intentar colarse en el Rock in Rio para poner a prueba la seguridad
- Un caimán debajo de un coche y en plena madrugada: el insólito suceso que sorprendió a un barrio de Las Palmas

### Corriere dello Sport Fuori dal Campo (IT)

[RSS](https://www.corrieredellosport.it/rss/calcio/fuori-dal-campo) — PASS. PREFLIGHT

**ACCEPTED**

- Cristiano Ronaldo e Georgina Rodríguez si sposeranno questo fine settimana: l'indiscrezione sul matrimonio
- Haaland a Taormina, il sindaco De Luca lo accoglie con una battuta: "Erling, il vero bomber sono io"
- Gianfranco Zola compie 60 anni: la Sardegna e non solo fa festa
- C'è un ex portiere del Napoli a Temptation Island: chi è il calciatore che ha giocato anche con Insigne e Cavani
- El Shaarawy e Ludovica Pagani trasformano il loro matrimonio in un gesto di solidarietà: l'iniziativa
- Totti show: l'ex Milan Kucka gli fa assaggiare una crema di pesce slovacca e lui reagisce così...
- Manu Koné fa impazzire la Francia per una collana: "Si è spinto oltre". Ecco qual è e quanto costa
- È morto Marios Oikonomou, fatale l'incidente stradale dopo giorni in terapia intensiva
- La Wings for Life World Run 2026 rompe record anche in Italia: la corsa benefica con Klopp e Tsunoda
- Fiocco blu in casa Leotta-Karius, è nato il secondogenito Leonardo: l'annuncio sui social

**REJECTED**

- Fondazione Cannavaro Ferrara: grande successo e sold-out per la “Summer Garden Charity Night”
- Il figlio di Mihajlovic emoziona tutti: il tatuaggio con una pagina speciale
- Valderrama svela il segreto sui suoi capelli: gli offrirono due milioni per tagliarli e lui...
- Calcio in lutto. è morto Lucescu: ha allenato Pisa, Inter e Brescia
- Lucescu, si aggravano le condizioni di salute: il commovente messaggio della Federcalcio romena
- Premio Romano Fogli, il 28 marzo la premiazione
- Spalletti scatenato sui social: canta e balla "Per sempre sì" insieme al figlio di Sal Da Vinci
- Il terribile racconto di D'Ambrosio in diretta da Dubai: "Ci sono scoppiati tre droni in testa"
- Araujo parla dei suoi problemi di salute mentale: "Così l'ansia si è trasformata in depressione"
- Vinicius e i rischi del sesso, la fidanzata Virginia Fonseca spiega perché deve stare attenta

### EXPRESS.de Fußball (DE)

[RSS](https://www.express.de/sport/fussball?view=rss) — FAIL/SKIP. SKIP: Unencoded < Line: 4 Column: 31 Char: =

**ACCEPTED**

Nincs a mintában.

**REJECTED**

Nincs a mintában.

### RTL Fußball (DE)

[RSS](https://www.rtl.de/rss/feed/sport/fussball) — PASS. PREFLIGHT

**ACCEPTED**

- Baby Nummer zwei in Sicht! Fußball-Star Kai Havertz wird wieder Vater
- Vor der Hochzeit mit Georgina Rodriguez: Fußballstar Cristiano Ronaldo zeigt Fans seine Luxusautos
- Cristiano Ronaldo und Georgina Rodríguez heiraten auf Madeira – erste Details bekannt

**REJECTED**

- Trainer erklärt Rücktritt nach Abpfiff - Präsident sagt Nein
- 1. FC Köln gegen SV Werder Bremen: Hier läuft das Bundesliga-Topspiel!
- Frankreichs Verband entzieht Infantino Vertrauen für Wahl
- Union Berlin gegen Schalke 04 live: Alle Infos zum Bundesliga-Spiel am Freitag! Stream, TV-Übertragung & Co.
- FC St. Pauli gegen VfL Wolfsburg live bei RTL und auf RTL+: Das 2. Bundesliga-Topspiel im TV & Stream
- Siege für PSG, Arsenal und Liverpool - Traumtor von Adeyemi
- Regionalliga-Reform: DFB-Boss will Problem schnell lösen
- Borussia Dortmund: Karetsas-Drama in der Champions League – Hummels „lief es kalt den Rücken herunter”
- Bericht: Messi will Zweitligisten in Spanien kaufen
- Mbappé und Haaland treffen: Auftaktsiege für Real und City

## Ugyanaz a 10 cikk — image coverage 6/10 → 9/10

7 cikkhez deklarált nagy szélességű URL, 2 cikkhez ismeretlen méretű article-level fallback, 1 null. A fallback nem méretbecslés. A kiadó URL-je változatlan; a perjeles kanonikus cikk-átirányítás nem kép-URL rewrite.

| SOURCE | BEFORE | AFTER | IMAGE SOURCE | WIDTH×HEIGHT | UNKNOWN FALLBACK |
|---|---|---|---|---|---|
| The Sun / SunSport Football | YES | YES | srcset | 3712×? | NO |
| Daily Star Football | YES | YES | srcset | 1200×? | NO |
| Daily Mail Football | NO | NO | null | ?×? | NO |
| talkSPORT Football | YES | YES | srcset | 3760×? | NO |
| OKDIARIO Paparazzi | YES | YES | og | 1800×1013 | NO |
| OKDIARIO Fútbol | YES | YES | og | 1800×1013 | NO |
| Virgilio Sport Gossip | YES | YES | og | 1217×694 | NO |
| Tuttosport Calcio | NO | YES | og | ?×? | YES |
| Gazzetta Calcio | NO | YES | og | ?×? | YES |
| Corriere dello Sport Calcio | NO | YES | json-ld | 2000×1000 | NO |

- Tuttosport/Corriere: azonos cikkre mutató 308-as záróperjel-korrekció kezelve. Csak 301/308, azonos hostname/path/query, HTTPS downgrade nélkül és egy lépésben; loginra/más cikkre irányítás nincs követve.
- Gazzetta: a kiadó saját aldomainjének cikk-HTML-je engedélyezett. Hasonló nevű idegen domain nem.
- Daily Mail: a kérés HTTP 200, de nincs a szabályok alapján használható metadataeredmény; null maradt.
- Ismerten kicsi RSS-kép URL-jét is megőrizzük kizárási bizonyítékként, így ugyanaz az URL nem térhet vissza ismeretlen méretű OG-fallbackként.

Visszakereshető cikkek és kiválasztott remote URL-ek:

- The Sun / SunSport Football: [Diletta Leotta puts on busty display in elegant black dress as she returns to screens for Champions League](https://www.thesun.co.uk/sport/40338673/diletta-leotta-champions-league-instagram/) — [változatlan remote URL](https://www.thesun.co.uk/wp-content/uploads/2026/09/diletta-leotta-loris-karius-attend-1104635013.jpg?quality=90&strip=all)
- Daily Star Football: [Porto star 'grabbed Erling Haaland's bum' after Champions League tunnel chaos](https://www.dailystar.co.uk/sport/football/erling-haaland-man-city-porto-37645169) — [változatlan remote URL](https://i2-prod.dailystar.co.uk/article37645079.ece/ALTERNATES/s1200f/0_GettyImages-2294322877.jpg)
- Daily Mail Football: [How Kai Havertz and Martin Odegaard's inseparable bond is powering their resurgent form - trips abroad together, the running joke at Arsenal's HQ and how Gunners captain helped Havertz and his wife Sophia cope with vile abuse](https://www.dailymail.com/sport/football/article-16121131/kai-havertz-martin-odegaard-arsenal-bond.html?ns_mchannel=rss&ns_campaign=1490&ito=1490) — null
- talkSPORT Football: [West Ham midfielder Edson Alvarez furiously rejects allegations he was involved in a kidnapping plot](https://talksport.com/football/4573277/west-ham-edson-alvarez-kidnapping-allegations-statement/) — [változatlan remote URL](https://talksport.com/wp-content/uploads/2026/09/edson-alvarez-mexico-laments-elimination-1093786192.jpg?w=3760)
- OKDIARIO Paparazzi: [Cristiano Ronaldo (41 años): «Yo no hago dieta, tengo buenas rutinas; si me apetece comer una hamburguesa con patatas fritas, no pasa nada»](https://okdiario.com/deportes/cristiano-ronaldo-41-anos-yo-no-hago-dieta-tengo-buenas-rutinas-si-apetece-comer-hamburguesa-patatas-fritas-no-pasa-nada-20209305) — [változatlan remote URL](https://okdiario.com/img/2026/09/01/imagen_recortada-2026-09-01t181849.875.jpg)
- OKDIARIO Fútbol: [Marlaska abre un expediente «por falta muy grave» a los policías agredidos por un ultra independentista del Barça](https://okdiario.com/deportes/marlaska-abre-expediente-falta-muy-grave-policias-agredidos-ultra-independentista-del-barca-20256054) — [változatlan remote URL](https://okdiario.com/img/2026/08/23/imagen_recortada-2026-08-23t212352.540.jpg)
- Virgilio Sport Gossip: [Alisha Lehmann a Wimbledon con il nuovo fidanzato Montel McKenzie: anello in vista, Douglas Luiz e la Juventus dimenticati](https://sport.virgilio.it/alisha-lehmann-wimbledon-fidanzato-juventus-douglas-luiz-962364) — [változatlan remote URL](https://wips.plug.it/cips/sport.virgilio.it/cms/2026/07/gettyimages-2284342606-1.jpg?w=1217&a=r)
- Tuttosport Calcio: ["Non potevo continuare così e rovinare mio figlio". Lavezzi shock: "Mi hanno convinto a..."](https://www.tuttosport.com/news/calcio/serie-a/napoli/2026/09/10-151148800/non_potevo_continuare_cos_e_rovinare_mio_figlio_lavezzi_shock_mi_hanno_convinto_a_/) — [változatlan remote URL](https://cdn.tuttosport.com/images/2026/09/10/105835174-01cdc8eb-db9c-4a22-9aca-2f4c17c90ee6.jpg)
- Gazzetta Calcio: [Juventus, Douglas Luiz come non lo avete mai visto: piange per la convocazione con il Brasile](https://video.gazzetta.it/video-juventus-douglas-luiz-in-lacrime-per-la-convocazione-con-il-brasile/f8e67dc2-3e9a-4050-84f4-e123a7a41xlk) — [változatlan remote URL](https://dimages2.gazzettaobjects.it/files/image_1280_720/uploads/2026/09/10/6aa2c64615ae6.jpeg)
- Corriere dello Sport Calcio: [Dybala, paura nella notte. Si sveglia e trova la moglie così: "Traumatizzato"](https://www.corrieredellosport.it/news/calcio/serie-a/roma/dybala/2026/09/10-151147856/dybala_paura_nella_notte_si_sveglia_e_trova_la_moglie_cos_traumatizzato/) — [változatlan remote URL](https://cdn.corrieredellosport.it/img/2000/1000/2026/09/10/083956605-dfab2c1e-5829-455e-bf13-2a9a1c450643.jpg)

## Helyi átadás

- Branch: `codex/tabloid-source-reset-v2`; munkakönyvtár: `/private/tmp/mso-tabloid-git`.
- Gold fixture: `packages/agents/src/tabloid-editorial-gold.json`.
- Rögzített 10-es baseline: `docs/tabloid-calibration-image-baseline.json`.
- Gépi eredmény: `docs/tabloid-calibration-report.json`.
- RSS-snapshot parancs: `tsx scripts/tabloid-calibration-snapshot.ts` (nyilvános RSS GET).
- Kiértékelés + 10 article HTML: `tsx scripts/tabloid-calibration-proof.ts`.
- Rögzített képeredmény újrahasználata hálózat nélkül: `tsx scripts/tabloid-calibration-proof.ts --reuse-images`.

**STOP — nincs deploy, source-aktiválás vagy generálás.**

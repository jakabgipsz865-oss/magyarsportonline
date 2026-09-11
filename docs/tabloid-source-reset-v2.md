# MSO SOURCE RESET V2 — preflight és célzott validáció

Megfigyelés: 2026-09-11T04:58:08.238Z (helyi HTTP/XML/HTML próba, nem Vercel production-preflight).

**AUTO-PUBLISH OFF · CORPORATE CRON OFF · Gemini 0 · képfájl-letöltés 0**

Helyi változtatások: `/private/tmp/mso-tabloid-git`, branch `codex/tabloid-source-reset-v2`. Ebben a körben nem történt GitHub push/CI, deploy, adatbázis-konfigurálás, source-aktiválás vagy cikkgenerálás. A production OFF állapothoz nem nyúltunk.

## Eredmény és értelmezés

- 44 feedjelölt; RSS_VALID: 37 YES / 7 NO.
- FRESH_48H: 33 YES. Nulla friss elem nem teszi érvénytelenné az RSS-t. Hálózati timeoutnál a NO jelentése: ebben a kérésben nem igazolt; az okot külön feltüntetjük.
- Minőségi ablak: legfeljebb 100 legfrissebb, a feedben ténylegesen visszaadott elem. Külön számoljuk a 30 napon és 48 órán belüli elemeket. A minőségi ACCEPT szám régebbi/hiányzó dátumú itemet is tartalmazhat; nem publikálási mennyiség és nem manuálisan hitelesített precision-mutató.
- 109 célzott teszt PASS; agents és web typecheck PASS; módosított fájlok ESLint PASS. Nincs LLM classifier vagy új Writer-lépés.
- A korábbi kulturális program, salary-limit, taktikai/meccsértékelés, eredmény és menetrend téves találatok regressziós példái mind REJECT-ek, mindkét source módban. További DE eladás/vereség-meccshír példák szintén REJECT-ek.

## Source döntések

- EN CORE pontosan Sun/SunSport, Daily Star, Daily Mail, Mirror, Express. SPORTbible, Metro és talkSPORT secondary.
- ES: OKDIARIO Paparazzi és AS Tikitakas DIRECT CORE. Mundo El Otro Mundo BROAD/SECONDARY. ElDesmarque 403: SKIP. MARCA Tiramillas PREFLIGHT.
- IT: Virgilio DIRECT CORE. Golssip kizárólag `/gossip/feed/` jelölt: 404, SKIP; generic feed nem helyettesíti. Corriere Fuori dal Campo natív RSS PASS, de PREFLIGHT marad. Gazzetta/Tuttosport generic calcio secondary.
- DE: BILD hivatalos Sport feed, nem alles.xml; SPORT BILD core. RTL/EXPRESS.de PREFLIGHT; Blick/Krone secondary. Blick 403: SKIP, bypass nélkül.
- EXPRESS.de: a vizsgált `?view=rss` URL HTML-t ad, natív RSS nincs igazolva; SKIP. SPORT1/oe24 továbbra is HOLD.
- Minden draft konfiguráció `enabled=false`. A meglévő production Source rekordokhoz nem nyúltunk.

## Source-quality megjegyzések

- OKDIARIO Paparazzi: érvényes feed, 0 friss 48 órás elem; 50-elemes történeti minta, 24 gépi ACCEPT. Az elmúlt 30 napban csak 4 visszaadott elem van.
- AS Tikitakas: az első V2 próbában natív RSS PASS, 40 elem, 0 ACCEPT; a legutolsó kérés 8 másodperces timeouttal végződött. A végső táblában ezért ebben a kérésben nem igazolt/SKIP szerepel; ez nem XML-érvénytelenségi bizonyíték. Nem indítottunk új retry-kört.
- Corriere Fuori dal Campo: natív RSS érvényes, de a visszaadott 30 elemből egy sem 30 napon belüli. A 14 történeti ACCEPT nem friss kínálat.
- MARCA Tiramillas: vegyes szórakoztató vertikál, ezért BROAD/PREFLIGHT, kötelező pozitív human-angle jellel. A source neve önmagában nem enged át cikket.
- A nyelvi regexek konzervatívak, nem teljes szemantikai bizonyítások. A városnév önmagában nem futballjel, de a teljes RSS-leírás futballszereplő/klub említése számít; a riport ezt a tényleges döntést mutatja.

## RSS-preflight

| SOURCE | LANG | MODE | TIER | RSS_VALID | FRESH_48H | ITEMS 48H | ITEMS 30D | QUALITY SAMPLE ≤100 | ACCEPT (QUALITY) | ACCEPT 48H |
|---|---|---|---|---|---|---:|---:|---:|---:|---:|
| The Sun / SunSport Football | en | BROAD_TABLOID_FOOTBALL | CORE | YES | YES | 24 | 24 | 24 | 1 | 1 |
| Daily Star Football | en | BROAD_TABLOID_FOOTBALL | CORE | YES | YES | 25 | 25 | 25 | 3 | 3 |
| Daily Mail Football | en | BROAD_TABLOID_FOOTBALL | CORE | YES | YES | 66 | 150 | 100 | 10 | 9 |
| Daily Mirror Football | en | BROAD_TABLOID_FOOTBALL | CORE | YES | YES | 25 | 25 | 25 | 0 | 0 |
| SPORTbible Football | en | BROAD_TABLOID_FOOTBALL | SECONDARY | YES | YES | 22 | 25 | 25 | 0 | 0 |
| Daily Express Football | en | BROAD_TABLOID_FOOTBALL | CORE | YES | YES | 10 | 10 | 10 | 0 | 0 |
| Metro Football | en | BROAD_TABLOID_FOOTBALL | SECONDARY | YES | YES | 28 | 28 | 28 | 0 | 0 |
| Metro Oddballs | en | DIRECT_GOSSIP | SECONDARY | YES | NO | 0 | 0 | 0 | 0 | 0 |
| talkSPORT Football | en | BROAD_TABLOID_FOOTBALL | SECONDARY | YES | YES | 48 | 100 | 100 | 1 | 1 |
| OKDIARIO Paparazzi | es | DIRECT_GOSSIP | CORE | YES | NO | 0 | 4 | 50 | 24 | 0 |
| OKDIARIO Fútbol | es | BROAD_TABLOID_FOOTBALL | SECONDARY | YES | YES | 21 | 50 | 50 | 3 | 2 |
| Mundo Deportivo El Otro Mundo | es | BROAD_TABLOID_FOOTBALL | SECONDARY | YES | YES | 34 | 100 | 100 | 0 | 0 |
| 20minutos Deportes | es | BROAD_TABLOID_FOOTBALL | PREFLIGHT | YES | YES | 29 | 29 | 29 | 1 | 1 |
| 20minutos Gente/Televisión | es | DIRECT_GOSSIP | PREFLIGHT | YES | YES | 26 | 26 | 26 | 1 | 1 |
| Golssip /gossip/ | it | DIRECT_GOSSIP | CORE | NO | NO | 0 | 0 | 0 | 0 | 0 |
| Virgilio Sport Gossip | it | DIRECT_GOSSIP | CORE | YES | YES | 1 | 7 | 30 | 7 | 0 |
| Tuttosport Calcio | it | BROAD_TABLOID_FOOTBALL | SECONDARY | YES | YES | 30 | 30 | 30 | 1 | 1 |
| Gazzetta Calcio | it | BROAD_TABLOID_FOOTBALL | SECONDARY | YES | YES | 30 | 30 | 30 | 1 | 1 |
| Corriere dello Sport Calcio | it | BROAD_TABLOID_FOOTBALL | SECONDARY | YES | YES | 30 | 30 | 30 | 1 | 1 |
| BILD Sport | de | BROAD_TABLOID_FOOTBALL | CORE | YES | YES | 100 | 100 | 100 | 0 | 0 |
| SPORT BILD Football | de | BROAD_TABLOID_FOOTBALL | CORE | YES | YES | 50 | 50 | 50 | 1 | 1 |
| Blick Fussball | de | BROAD_TABLOID_FOOTBALL | SECONDARY | NO | NO | 0 | 0 | 0 | 0 | 0 |
| Kronen Zeitung Fussball | de | BROAD_TABLOID_FOOTBALL | SECONDARY | YES | YES | 40 | 49 | 49 | 1 | 1 |
| SPORT1 Boulevard | de | DIRECT_GOSSIP | HOLD | NO | NO | 0 | 0 | 0 | 0 | 0 |
| oe24 Fussball | de | BROAD_TABLOID_FOOTBALL | HOLD | NO | NO | 0 | 0 | 0 | 0 | 0 |
| AS Tikitakas | es | DIRECT_GOSSIP | CORE | NO | NO | 0 | 0 | 0 | 0 | 0 |
| ElDesmarque Famosos | es | DIRECT_GOSSIP | CORE | NO | NO | 0 | 0 | 0 | 0 | 0 |
| 101 Great Goals | en | BROAD_TABLOID_FOOTBALL | RETIRED | YES | YES | 16 | 16 | 16 | 0 | 0 |
| CaughtOffside | en | BROAD_TABLOID_FOOTBALL | RETIRED | YES | YES | 10 | 10 | 10 | 0 | 0 |
| FootballFanCast | en | BROAD_TABLOID_FOOTBALL | RETIRED | YES | YES | 10 | 10 | 10 | 0 | 0 |
| GiveMeSport | en | BROAD_TABLOID_FOOTBALL | RETIRED | YES | YES | 10 | 10 | 10 | 0 | 0 |
| HITC | en | BROAD_TABLOID_FOOTBALL | RETIRED | YES | YES | 12 | 20 | 20 | 0 | 0 |
| Bernabéu Digital | es | BROAD_TABLOID_FOOTBALL | RETIRED | YES | YES | 20 | 20 | 20 | 1 | 1 |
| Panenka | es | BROAD_TABLOID_FOOTBALL | RETIRED | YES | YES | 4 | 10 | 10 | 0 | 0 |
| FCInter1908 | it | BROAD_TABLOID_FOOTBALL | RETIRED | YES | YES | 50 | 50 | 50 | 0 | 0 |
| CalcioNapoli24 | it | BROAD_TABLOID_FOOTBALL | RETIRED | YES | YES | 194 | 194 | 100 | 1 | 1 |
| Spazio Napoli | it | BROAD_TABLOID_FOOTBALL | RETIRED | YES | YES | 20 | 30 | 30 | 0 | 0 |
| TuttoNapoli | it | BROAD_TABLOID_FOOTBALL | RETIRED | YES | YES | 20 | 20 | 20 | 0 | 0 |
| IamNaples | it | BROAD_TABLOID_FOOTBALL | RETIRED | YES | YES | 20 | 20 | 20 | 0 | 0 |
| SPOX fallback/general | de | BROAD_TABLOID_FOOTBALL | RETIRED | YES | NO | 0 | 0 | 50 | 1 | 0 |
| MARCA Tiramillas | es | BROAD_TABLOID_FOOTBALL | PREFLIGHT | YES | YES | 61 | 63 | 63 | 1 | 1 |
| Corriere dello Sport Fuori dal Campo | it | DIRECT_GOSSIP | PREFLIGHT | YES | NO | 0 | 0 | 30 | 14 | 0 |
| EXPRESS.de Fußball | de | BROAD_TABLOID_FOOTBALL | PREFLIGHT | NO | NO | 0 | 0 | 0 | 0 | 0 |
| RTL Fußball | de | BROAD_TABLOID_FOOTBALL | PREFLIGHT | YES | YES | 9 | 59 | 100 | 2 | 0 |

## Forrásonkénti címek — legfeljebb 5 ACCEPT és 5 REJECT

### The Sun / SunSport Football

[Vizsgált RSS-jelölt](https://www.thesun.co.uk/sport/football/feed/) — RSS_VALID YES; FRESH_48H YES. 

**ACCEPTED**

- Diletta Leotta puts on busty display in elegant black dress as she returns to screens for Champions League

**REJECTED**

- Man City ace Donnarumma ‘bound and hit’ when robbers raided flat… as judge suspends first day of ‘catastrophic’ trial
- Jamal Musiala scores in first start since terrifyingly collapsing twice in pre-season due and unveils new celebration
- Three things we learned from Man Utd’s win over Sabah as Sesko makes his case but star looks haunted by Amorim claim
- See AC Milan, Celtic and Crystal Palace games in UEFA Europa League with ticket and hospitality trips from just £30
- ‘What do you mean?’ – Champions League star’s stunned reaction after being told manager resigned in post-match interview

### Daily Star Football

[Vizsgált RSS-jelölt](https://www.dailystar.co.uk/sport/football/?service=rss) — RSS_VALID YES; FRESH_48H YES. 

**ACCEPTED**

- Porto star 'grabbed Erling Haaland's bum' after Champions League tunnel chaos
- Jaw-dropping footballer goes viral as fans say 'she's definitely a keeper'
- Arsenal fans told to 'hide shirts' by club or be hunted by terrifying football firm

**REJECTED**

- Michael Carrick's key tactical decision as Man Utd make emphatic Champions League return
- West Ham star issues strong statement over wild kidnap plot claims
- Liverpool star Alisson hit with massive fine after actions during Premier League clash
- Wrexham's Prem dream gets serious as ex-Newcastle chief arrives — is Parkinson at risk?
- 'Argentina stars who can't speak English are pathetic – learn the lingo or get out'

### Daily Mail Football

[Vizsgált RSS-jelölt](https://www.dailymail.com/sport/football/index.rss) — RSS_VALID YES; FRESH_48H YES. 

**ACCEPTED**

- How Kai Havertz and Martin Odegaard's inseparable bond is powering their resurgent form - trips abroad together, the running joke at Arsenal's HQ and how Gunners captain helped Havertz and his wife Sophia cope with vile abuse
- Man City star Gianluigi Donnarumma and his pregnant girlfriend 'hit, bound and threatened with a knife by robbers while sleeping in their Paris flat'
- Man City star Gianluigi Donnarumma and his pregnant girlfriend 'hit, bound and threatened with a knife by robbers while sleeping in their Paris flat'
- Manchester United facing ANOTHER protest... as furious local residents hit back over club's plans to open fanzone behind the Stretford End
- Manchester United facing ANOTHER protest... as furious local residents hit back over club's plans to open fanzone behind the Stretford End

**REJECTED**

- Why Man City are fired up to end their Old Trafford hoodoo: Squad unity, the star duo drumming standards into newcomers and the missing ingredient players say Enzo Maresca has added ahead of Man United clash
- Manchester United vs Sabah - Champions League RECAP: Four different scorers help hosts record comfortable win
- How Patrick Dorgu fared on his left-back audition in Man United's win over Sabah: The key areas he needs to improve, where he is BETTER than Luke Shaw and what Michael Carrick learnt ahead of Man City clash
- How Patrick Dorgu fared on his left-back audition in Man United's win over Sabah: The key areas he needs to improve, where he is BETTER than Luke Shaw and what Michael Carrick learnt ahead of Man City clash
- Todd Boehly is on the brink of leaving Chelsea and selling his minority stake - with Behdad Eghbali's Clearlake Capital set to take control of club

### Daily Mirror Football

[Vizsgált RSS-jelölt](https://www.mirror.co.uk/sport/football/?service=rss) — RSS_VALID YES; FRESH_48H YES. 

**ACCEPTED**

Nincs a mintában.

**REJECTED**

- Liverpool news: Bradley Barcola issue called out as transfer chief breaks silence on star
- Man Utd news: Michael Carrick makes rule change as club's Premier League request granted
- Arsenal news: Declan Rice makes risky comment as 'rusty' star called out
- Premier League stars obsessed with collecting football cards in their free time
- West Ham star threatens legal action over 'false allegations' after kidnap claims

### SPORTbible Football

[Vizsgált RSS-jelölt](https://www.sportbible.com/football.rss) — RSS_VALID YES; FRESH_48H YES. 

**ACCEPTED**

Nincs a mintában.

**REJECTED**

- Lisandro Martinez gets round of applause from CBS studio for response to 'who is your favourite pundit on the show'
- Archie Brown finds out during post-match interview that Fenerbahce manager Ismail Kartal has resigned
- Why Bryan Mbeumo, Patrick Dorgu and Leny Yoro are wearing different kits to Man Utd teammates vs Sabah
- Marcus Rashford receives explanation from Barcelona behind decision to snub him for Anthony Gordon
- What would actually happen if Chelsea were stripped of 2017 Premier League title after Mauricio Pochettino demand

### Daily Express Football

[Vizsgált RSS-jelölt](https://www.express.co.uk/posts/rss/67/football) — RSS_VALID YES; FRESH_48H YES. 

**ACCEPTED**

Nincs a mintában.

**REJECTED**

- Arsenal news: Declan Rice snubs team-mates as 'rusty' star called out
- Man Utd news: Michael Carrick rule change leaked as Premier League grant request
- Liverpool news: Ronald Araujo £47m transfer hint as Bradley Barcola issue spotted
- JJ Gabriel raises eyebrows with social media activity after Man Utd hat-trick
- Champions League manager resigns immediately after full-time as players stunned

### Metro Football

[Vizsgált RSS-jelölt](https://metro.co.uk/sport/football/feed/) — RSS_VALID YES; FRESH_48H YES. 

**ACCEPTED**

Nincs a mintában.

**REJECTED**

- Jamie Carragher rates Man Utd Champions League hopes after Sabah win
- Owen Hargreaves claims Man Utd star can become ‘best in the world’ after Champions League win
- Mauricio Pochettino makes Mikel Arteta claim and Arsenal Premier League prediction
- Regis Le Bris makes huge Arsenal Premier League claim ahead of Sunderland clash
- Arsenal legend Thierry Henry says Champions League team are ‘unplayable’

### Metro Oddballs

[Vizsgált RSS-jelölt](https://metro.co.uk/sport/oddballs/feed/) — RSS_VALID YES; FRESH_48H NO. 

**ACCEPTED**

Nincs a mintában.

**REJECTED**

Nincs a mintában.

### talkSPORT Football

[Vizsgált RSS-jelölt](https://talksport.com/football/feed) — RSS_VALID YES; FRESH_48H YES. 

**ACCEPTED**

- West Ham midfielder Edson Alvarez furiously rejects allegations he was involved in a kidnapping plot

**REJECTED**

- Stunned Fenerbahce player has to double take during interview after learning manager resigned
- Harry Kane joins elite Champions League group with Cristiano Ronaldo as Bayern Munich add to stunning run
- Champions League manager immediately resigns minutes after opening match
- 15-year-old wonderkid makes Manchester United history with stunning debut hat-trick
- Leicester warned they’re heading for ‘Armageddon’ as prospective new owner outlines plan to save them

### OKDIARIO Paparazzi

[Vizsgált RSS-jelölt](https://okdiario.com/deportes/corazon/feed) — RSS_VALID YES; FRESH_48H NO. 

**ACCEPTED**

- Cristiano Ronaldo (41 años): «Yo no hago dieta, tengo buenas rutinas; si me apetece comer una hamburguesa con patatas fritas, no pasa nada»
- Georgina Rodríguez (32 años): «El día que conocí a Cristiano Ronaldo me quedé parada, empecé a sentir cosquillas en el estómago; era tan guapo que me daba vergüenza mirarle»
- El seleccionador de Egipto se desmaya tras ver a sus dos esposas pelearse a sillazos en una cafetería
- Salen a la luz fotos muy subidas de tono de Naomi Asensi, ex de ‘La isla de las tentaciones’, con un conocido futbolista español
- El vídeo muy subido de tono con el que Georgina Rodríguez responde a los que critican su figura

**REJECTED**

- Marcos Llorente, sobre sus fotos con Ferran Torres: «Me sorprende que en 2026 siga generando debate que dos hombres se den cariño»
- Alcaraz vuelve a entrenar y enseña su cambio de look que causa el furor en las redes
- El vídeo más viral: cazan a Olise en un barco tocando a una joven que le hace twerking en bikini
- Pillan a Nico Williams en un barco con varias mujeres horas después de romper con su novia: las fotos que revolucionan las redes
- Un club español se ve obligado a eliminar el post con el que anunciaban el fichaje de su nueva fisioterapeuta

### OKDIARIO Fútbol

[Vizsgált RSS-jelölt](https://okdiario.com/deportes/futbol/feed) — RSS_VALID YES; FRESH_48H YES. 

**ACCEPTED**

- Marlaska abre un expediente «por falta muy grave» a los policías agredidos por un ultra independentista del Barça
- Muere repentinamente la hermana de Monchi, Catalina Rodríguez, a los 64 años
- Lucas Pérez (37 años): «Mis padres me abandonaron con 2 años y ahora me piden dinero de por vida»

**REJECTED**

- La Federación pasa de Marruecos: «Es un movimiento político, la final la tenemos que hacer nosotros»
- El Real Madrid firma el récord absoluto del límite salarial y saca 250 millones a un Barcelona que crece un 66%
- La prensa afín a Mohamed VI se mofa de España por la final del Mundial: «¿Harán un gran estadio en la Ceuta ocupada?»
- La FIFA desmiente a Marruecos limitándose a repetir que la sede de la final del Mundial 2030 no está decidida
- UFP arremete contra Marlaska por el expediente a los policías agredidos por el ultra del Barça: «Absolutamente inaceptable»

### Mundo Deportivo El Otro Mundo

[Vizsgált RSS-jelölt](https://www.mundodeportivo.com/feed/rss/elotromundo) — RSS_VALID YES; FRESH_48H YES. 

**ACCEPTED**

Nincs a mintában.

**REJECTED**

- Ester Expósito: "Lo más sexy que alguien puede tener es el humor y la inteligencia"
- ¿Sigue abierto el restaurante 'Bodeguita Los 50' de 'Pesadilla en la cocina'?
- Jorge Fernández, sobre su infancia: "Viví en Mondragón, que durante los años 80 y 90 era la cuna de ETA"
- El refugio gallego en el que se rodó la última película de Mario Casas en Prime Video se alquila
- Ni los críticos se ponen de acuerdo: la miniserie de Movistar Plus que es Top 1 en España

### 20minutos Deportes

[Vizsgált RSS-jelölt](https://www.20minutos.es/rss/deportes/) — RSS_VALID YES; FRESH_48H YES. PREFLIGHT

**ACCEPTED**

- El hermano de Jenni Hermoso asegura que le dijeron a Vinícius que iba a ganar el Balón de Oro: "Ya tenía sitio en una vitrina"

**REJECTED**

- España pasa por encima a Australia y se mete en semifinales del Mundial femenino de Baloncesto
- Fernando Alonso y Carlos Sainz pisan por primera vez el Madring: reconocimiento al circuito de los españoles antes de la acción
- Maica García denunciará al Sabadell por su despido tras la baja de maternidad: "Tuve ataques fuertes de ansiedad"
- Kylian Mbappé: "Tengo muchas ganas de ayudar al Real Madrid y demostrar que podemos hacer grandes cosas este año"
- El Madring, desde el asfalto: una vuelta al circuito con '20minutos' y una parada en la icónica curva Monumental

### 20minutos Gente/Televisión

[Vizsgált RSS-jelölt](https://www.20minutos.es/rss/gente-television/) — RSS_VALID YES; FRESH_48H YES. PREFLIGHT

**ACCEPTED**

- Tommy Hilfiger convierte el Hotel Plaza en su pasarela y pasea al perro de Taylor Swift y Travis Kelce

**REJECTED**

- Tu horóscopo diario: viernes 11 de septiembre de 2026
- Marina Rivers: "Mi novio quería que me echaran de 'MasterChef' para poder verme y no hablaba de otra cosa"
- La posible indirecta de Cayetano Rivera a su hermano Fran: "Hay quienes se creen en el derecho de contar tu historia por ti"
- Ion Aramendi desvela cuánto costó su boda con María Amores y anuncia una "reboda" en 2027
- Un 'influencer' pierde un dedo tras intentar colarse en el Rock in Rio a pesar de tener entradas

### Golssip /gossip/

[Vizsgált RSS-jelölt](https://www.golssip.it/gossip/feed/) — RSS_VALID NO; FRESH_48H NO. SKIP: Status code 404

**ACCEPTED**

Nincs a mintában.

**REJECTED**

Nincs a mintában.

### Virgilio Sport Gossip

[Vizsgált RSS-jelölt](https://sport.virgilio.it/feed/rss/gossip/) — RSS_VALID YES; FRESH_48H YES. 

**ACCEPTED**

- Alisha Lehmann a Wimbledon con il nuovo fidanzato Montel McKenzie: anello in vista, Douglas Luiz e la Juventus dimenticati
- Diamante Crispino, l'ex portiere di Napoli e Como protagonista a Temptation Island con la fidanzata Bernadette
- Francesco Totti e Ilary Blasi, la scelta delle due feste separate per la comunione della figlia Isabel
- Armando Izzo e Raffaella Fico, l'amore finisce con una storia e rimuovendo le foto da Instagram
- Elena Santarelli a Belve indignata e commovente, Corradi e Chiara Ferragni: la sua intervista nelle anticipazioni

**REJECTED**

- Martina Colombari trasformista a Venezia 83 riceve il Filming Italy Venice Award per "Buen Camino"
- Andy Diaz Hernandez a Ballando con le Stelle 2026, nuovo approdo per il campione europeo di salto triplo arrivato da Cuba
- Giorgia Cardinaletti e Francesco Bechis sposi, pubblicazioni on line e primi dettagli sul matrimonio dell'anno
- Sfera Ebbasta a San Siro per Inter-Napoli circondato da 10 ragazze, il problema è uno stereotipo non più tollerabile
- David e Victoria Beckham turisti tra le vie di Capri

### Tuttosport Calcio

[Vizsgált RSS-jelölt](https://www.tuttosport.com/rss/calcio) — RSS_VALID YES; FRESH_48H YES. 

**ACCEPTED**

- "Non potevo continuare così e rovinare mio figlio". Lavezzi shock: "Mi hanno convinto a..."

**REJECTED**

- Torino, Belghali va veloce e Abate è già convinto
- Fabregas: "Notte Champions storica? Felice per 5 minuti, c'è Como-Parma! Baturina e Diao…"
- Como una favola: lo storico esordio in Champions è un poker al Lipsia! Brillano le stelle di Fabregas
- Gasperini: "Roma ottima ma serve attenzione. Da chi mi aspettavo di più. Balerdi, Molina e Pisilli..."
- La Roma soffre ma strappa il pari in Turchia: non basta Cristante contro il Fenerbahce

### Gazzetta Calcio

[Vizsgált RSS-jelölt](https://www.gazzetta.it/dynamic-feed/rss/section/Calcio.xml) — RSS_VALID YES; FRESH_48H YES. 

**ACCEPTED**

- Juventus, Douglas Luiz come non lo avete mai visto: piange per la convocazione con il Brasile

**REJECTED**

- Como-Lipsia, le pagelle: Baturina 8, partita da Playstation. Nkunku 5,5, non fa male
- Fenerbahçe, cose turche! L'allenatore si dimette, il presidente lo conferma: "Gli hanno tirato una bottiglia"
- Fenerbahce, l'allenatore si dimette così dopo la Roma: "Me ne vado, non voglio domande. Buona serata"
- Fabregas: "Notte storica per Como, ma la felicità deve durare al massimo 5'. Lunedì c'è il Parma..."
- Fenerbahçe-Roma 1-1 highlights: gran gol di Cristante, poi Svilar si prende la scena

### Corriere dello Sport Calcio

[Vizsgált RSS-jelölt](https://www.corrieredellosport.it/rss/calcio) — RSS_VALID YES; FRESH_48H YES. 

**ACCEPTED**

- Dybala, paura nella notte. Si sveglia e trova la moglie così: "Traumatizzato"

**REJECTED**

- Fabregas applaude il suo Como: "Una notte storica, ora però serve umiltà"
- Capello incontentabile, arriva la frecciata a Nico Paz: "Da te pretendo di più". Poi critica Fabregas per il cerchio in campo
- Perché Gasperini ha sostituito Koné: fastidio al ginocchio per il centrocampista
- Clamoroso Fenerbahce, l'allenatore Kartal si dimette in conferenza stampa dopo il pareggio contro la Roma
- Gasperini soddisfatto: "Per la classifica Champions servono anche i pareggi"

### BILD Sport

[Vizsgált RSS-jelölt](https://www.bild.de/feed/sport.xml) — RSS_VALID YES; FRESH_48H YES. 

**ACCEPTED**

Nincs a mintában.

**REJECTED**

- Zweimal Halbfinale und Finale - Deutsche Festspiele bei den US Open
- Wird er der Retter? - Poulsen beim HSV so wichtig wie nie
- Kommunalwahl am Sonntag - DFB-Pokalsieger will Bürgermeister werden
- Besondere Szene bei US-Open-Halbfinals - Michelle Obama lässt das Stadion beben
- Vier Scorer in drei Ligaspielen - Dajaku macht bei Hansa den Unterschied

### SPORT BILD Football

[Vizsgált RSS-jelölt](https://sportbild.bild.de/rss/vw-fussball/vw-fussball-45036878,sort=1,view=rss2.sport.xml) — RSS_VALID YES; FRESH_48H YES. 

**ACCEPTED**

- Nach dem WM-Finale - Trump verblüfft Weltmeister-Coach mit Ballon-d'Or-Spruch

**REJECTED**

- Bundesliga am Freitag - So sehen Sie Union gegen Schalke live im TV & Stream
- Bundesliga am Samstag - So sehen Sie Dortmund –Paderborn live im TV
- Ehrliche Worte vom Bayern-Star - Musiala: „Ein Gefühl, das ich eine Weile nicht hatte“
- Erstes CL-Spiel seit fast 3 Jahren - Magische United-Rückkehr!
- Traum-Startelf-Comeback nach Zusammenbrüchen - Musiala leitet Bayerns Tor-Party ein!

### Blick Fussball

[Vizsgált RSS-jelölt](https://www.blick.ch/sport/fussball/rss.xml) — RSS_VALID NO; FRESH_48H NO. SKIP: Status code 403

**ACCEPTED**

Nincs a mintában.

**REJECTED**

Nincs a mintában.

### Kronen Zeitung Fussball

[Vizsgált RSS-jelölt](https://api.krone.at/v1/rss/rssfeed-google.xml?id=958) — RSS_VALID YES; FRESH_48H YES. 

**ACCEPTED**

- Nicht ganz dicht - Barcas Milliarden-Projekt Stadion: Es regnet rein

**REJECTED**

- Routinier Schwab - „Ein paar Leute haben mich schon abgeschrieben“
- Große Ziele mit WAC - Fitz freut sich auf Rapid! Schon neun Gelbe Karten
- Schöttel vor ÖFB-Aus - „Mit ihm und Rangnick hat’s nicht so funktioniert“
- 5:0-Gala in der CL - Bayern: Nach dem Probealarm hielt die Rekord-Serie
- Chaos nach Auftakt - CL: Trainer schmeißt hin – Präsident legt Veto ein

### SPORT1 Boulevard

[Vizsgált RSS-jelölt](https://www.sport1.de/rss/boulevard) — RSS_VALID NO; FRESH_48H NO. SKIP: Status code 404

**ACCEPTED**

Nincs a mintában.

**REJECTED**

Nincs a mintában.

### oe24 Fussball

[Vizsgált RSS-jelölt](https://www.oe24.at/sport/fussball/rss) — RSS_VALID NO; FRESH_48H NO. SKIP: Status code 404

**ACCEPTED**

Nincs a mintában.

**REJECTED**

Nincs a mintában.

### AS Tikitakas

[Vizsgált RSS-jelölt](https://feeds.as.com/mrss-s/pages/as/site/as.com/section/tikitakas/portada/) — RSS_VALID NO; FRESH_48H NO. SKIP: Request timed out after 8000ms

**ACCEPTED**

Nincs a mintában.

**REJECTED**

Nincs a mintában.

### ElDesmarque Famosos

[Vizsgált RSS-jelölt](https://www.eldesmarque.com/famosos/feed/) — RSS_VALID NO; FRESH_48H NO. SKIP: Status code 403

**ACCEPTED**

Nincs a mintában.

**REJECTED**

Nincs a mintában.

### 101 Great Goals

[Vizsgált RSS-jelölt](https://www.101greatgoals.com/feed) — RSS_VALID YES; FRESH_48H YES. RETIRED

**ACCEPTED**

Nincs a mintában.

**REJECTED**

- Carrick hails ‘fantastic’ Mainoo as United impress on Champions League return
- Champions League round-up: Bayern Munich hit five past Bodo/Glimt as Como get big win
- Manchester United 4-0 Sabah: Report, result and goals as Red Devils cruise to UCL win
- WATCH: Manchester United take the lead in Champions League
- LIVE – Manchester United v Sabah: Commentary, updates, goals and stats

### CaughtOffside

[Vizsgált RSS-jelölt](https://www.caughtoffside.com/feed) — RSS_VALID YES; FRESH_48H YES. RETIRED

**ACCEPTED**

Nincs a mintában.

**REJECTED**

- Arsenal identify 24-year-old defensive target ahead of January transfer window
- Xabi Alonso makes surprise decision on Chelsea attacker who “is not part of the plans”
- Arsenal send scouts to watch highly rated 24-year-old La Liga ace
- Premier League summer signing admits he would have joined Manchester United
- “The biggest difference is…” – sources on how Arteta has got Odegaard back to his best for Arsenal

### FootballFanCast

[Vizsgált RSS-jelölt](https://www.footballfancast.com/feed) — RSS_VALID YES; FRESH_48H YES. RETIRED

**ACCEPTED**

Nincs a mintában.

**REJECTED**

- Manchester United plotting £150m raid to sign two Bournemouth stars in 2027
- £35m ENIC signing already looks like the modern-day Moussa Sissoko at Spurs
- Exclusive: Celtic end interest in top target after club release public statement
- Why £67m Arsenal star is now a bigger disaster than Gyokeres
- Why Everton could be about to sign their next version of Richarlison

### GiveMeSport

[Vizsgált RSS-jelölt](https://www.givemesport.com/feed) — RSS_VALID YES; FRESH_48H YES. RETIRED

**ACCEPTED**

Nincs a mintában.

**REJECTED**

- What Happened to Joseph Minala - the Lazio Wonderkid Who Was Reportedly 42
- Man Utd: 3 Players Wear Special Shirt in Champions League vs Sabah
- Man Utd Must Trust Academy Stars as Mainoo Shines Again
- Deco Explains Why Barcelona Signed Anthony Gordon Over Marcus Rashford
- Ballon d’Or: Michael Olise Backs Harry Kane to Win Award Over Himself

### HITC

[Vizsgált RSS-jelölt](https://www.hitc.com/news/feed) — RSS_VALID YES; FRESH_48H YES. RETIRED

**ACCEPTED**

Nincs a mintában.

**REJECTED**

- ‘He’s not a dad’ – Trinity Rodman once explained her strained relationship with NBA legend Dennis Rodman
- The ‘Rodman Rule’ was once created by the NWSL to make Trinity Rodman the highest paid player ever
- Trinity Rodman once said Ben Shelton passed a key relationship test without even knowing it
- Ben Shelton will surpass girlfriend Trinity Rodman’s record-breaking annual salary by reaching US Open final
- ‘What a shame…’ Argentina fans don’t like their tribute idea for Lionel Messi’s final game

### Bernabéu Digital

[Vizsgált RSS-jelölt](https://www.bernabeudigital.com/rss) — RSS_VALID YES; FRESH_48H YES. RETIRED

**ACCEPTED**

- Los dos sorprendentes clubes que pelearon por Endrick en verano

**REJECTED**

- La renovación de Güler, La Vuelta y la F1, protagonista de las portadas deportivas
- Bellingham cerca de renovar y Diomandé pide minutos en el Real Madrid
- El último hito de Nico Paz que demuestra que el Real Madrid debe firmarle
- El Real Madrid manda un mensaje directo a Diomandé: le piden paciencia
- La FIFA rompe el mercado: adiós a las cláusulas desorbitadas

### Panenka

[Vizsgált RSS-jelölt](https://www.panenka.org/feed/) — RSS_VALID YES; FRESH_48H YES. RETIRED

**ACCEPTED**

Nincs a mintában.

**REJECTED**

- Y la Fiore nos robó el corazón
- Isco Alarcón: Europa, la tierra, el duende
- Adel Taarabt y el paso del tiempo
- Camello y el Rayo: recuperar lo nuestro
- Real Politik FC #26 \| El estadio como instrumento de poder

### FCInter1908

[Vizsgált RSS-jelölt](https://www.fcinter1908.it/feed) — RSS_VALID YES; FRESH_48H YES. RETIRED

**ACCEPTED**

Nincs a mintában.

**REJECTED**

- Bergomi: "Inter caso anomalo in Europa. E rimango convinto di una cosa"
- Caressa: "Inter presuntuosa e corregga due difetti. Real Madrid? Deve essere illegale..."
- Colantuono: "Napoli non ha sfigurato contro l'Arsenal. E l'Inter col Real avrebbe potuto..."
- Zenga: "Martinez? È riuscito ad accantonare l'errore. Parole Chivu mostrano cambio mentalità"
- Eto'o finisce al centro di una bufera. Times: "Mistero su 500mila euro"

### CalcioNapoli24

[Vizsgált RSS-jelölt](https://www.calcionapoli24.it/feed) — RSS_VALID YES; FRESH_48H YES. RETIRED

**ACCEPTED**

- Lavezzi: "Mi voleva la Juve, ma ho scelto Napoli per Diego. Primo giorno in città: mi è venuta a prendere la polizia!"

**REJECTED**

- Sabatini: "Napoli, testa alta ma 0 punti! KdB trasformato, Rafa Marin sta diventando..."
- Auriemma: "Per me è stato uno dei migliori Napoli, anche dell'anno scorso"
- "Aveva in pugno Gila e Gabriel Jesus". Retroscena Manna: perché ha dovuto rinunciare a questi due colpi
- Del Piero difende il Napoli: "Tra le realtà top d'Italia, si diceva che dopo lo scudetto..."
- Condò: "Difficoltà Napoli in Europa negli ultimi anni: il motivo è chiaro"

### Spazio Napoli

[Vizsgált RSS-jelölt](https://www.spazionapoli.it/feed) — RSS_VALID YES; FRESH_48H YES. RETIRED

**ACCEPTED**

Nincs a mintában.

**REJECTED**

- Napoli, è crisi in difesa: 76 tiri subiti in tre partite e XG mai così alto!
- Lavezzi, discorso da brividi sui problemi di salute: “Mi sono curato per mio figlio…”
- Napoli, arrivato l’annuncio su Meret e Alisson: c’è lesione per entrambi!
- Napoli-Bologna, arrivano ottime notizie per Allegri: Anguissa verso il recupero!
- Giuffredi, sfogo durissimo in diretta: “Accuse gravissime contro di me e De Laurentiis. Mi sono rotto”

### TuttoNapoli

[Vizsgált RSS-jelölt](https://www.tuttonapoli.net/rss) — RSS_VALID YES; FRESH_48H YES. RETIRED

**ACCEPTED**

Nincs a mintában.

**REJECTED**

- Napoli-Arsenal, Silvestre: “Allegri peggiore in campo! Squadra rinunciataria e mai pericolosa”
- Novi: “Faccio il nome di un azzurro che mi è piaciuto molto in Napoli-Arsenal”
- Bucchioni: “Il calcio di Allegri rischia di non piacere ai giocatori del Napoli”
- Forgione: “Con Allegri non ci divertiremo. Deponiamo le armi e iniziamo a vincere”
- Corsa Champions, Biasin avvisa Milan e Juve: “Inter, Roma, Como e Napoli sono avanti”

### IamNaples

[Vizsgált RSS-jelölt](https://www.iamnaples.it/feed) — RSS_VALID YES; FRESH_48H YES. RETIRED

**ACCEPTED**

Nincs a mintában.

**REJECTED**

- Arpaia: “Gilmour mi è piaciuto tanto, bene la scelta del doppio play”
- Bologna, differenziato per El Azzouzi e Orsolini: le ultime in casa rossoblù
- Salvione: “Il Napoli si sta modellando, sta diventando la squadra che chiede Allegri
- Olivera: “Arsenal? Lottato con una squadra fortissima, invertiremo la rotta”
- Napoli, Anguissa si è allenato con il gruppo: il giocatore ci sarà con il Bologna

### SPOX fallback/general

[Vizsgált RSS-jelölt](https://feeds.feedburner.com/spox-sport/) — RSS_VALID YES; FRESH_48H NO. RETIRED

**ACCEPTED**

- Champions League: "Habe versucht den Schiedsrichter zu bekehren": Kramer erzählt kuriose CL-Anekdote

**REJECTED**

- International: Übermäßiges Meckern: Spaniens Verband sperrt Hansi Flick
- International: "Ein Genie": Für Sami Khedira stand bei Real ein Spieler über CR7
- Bundesliga: "Eher nein": Bayern wohl auch in Mainz noch ohne Kane
- Bundesliga: DAZN regt revolutionäre Neuerung in der Bundesliga an
- Champions League: DAZN oder Amazon Prime Video: Wer zeigt / überträgt BVB vs. FC Barcelona in der Champions League heute live im TV und Livestream?

### MARCA Tiramillas

[Vizsgált RSS-jelölt](https://www.marca.com/rss/googlenews/tiramillas.xml) — RSS_VALID YES; FRESH_48H YES. PREFLIGHT

**ACCEPTED**

- Un exmandatario del fútbol español, perseguido por las deudas en un lujoso hotel de Londres: venderán su Fiat 500 Abarth Tributo Ferrari por impagos

**REJECTED**

- Entre 2021 y 2023, la Antártida ganó 695 mil millones de toneladas de masa de hielo por el calentamiento tropical
- Alerta por la congestión de los gimnasios tras las vacaciones de verano: esta infección viral puede propagarse mediante objetos compartidos
- Kimchi: el fermentado coreano que ha pasado de ser un desconocido a conquistar las mesas españolas
- El 11-S, 25 años después: el atentado que cambió el mundo y cuyas consecuencias aún perduran
- Ester Expósito: "He sufrido mucho estando enamorada"

### Corriere dello Sport Fuori dal Campo

[Vizsgált RSS-jelölt](https://www.corrieredellosport.it/rss/calcio/fuori-dal-campo) — RSS_VALID YES; FRESH_48H NO. PREFLIGHT

**ACCEPTED**

- Cristiano Ronaldo e Georgina Rodríguez si sposeranno questo fine settimana: l'indiscrezione sul matrimonio
- Haaland a Taormina, il sindaco De Luca lo accoglie con una battuta: "Erling, il vero bomber sono io"
- C'è un ex portiere del Napoli a Temptation Island: chi è il calciatore che ha giocato anche con Insigne e Cavani
- Totti show: l'ex Milan Kucka gli fa assaggiare una crema di pesce slovacca e lui reagisce così...
- È morto Marios Oikonomou, fatale l'incidente stradale dopo giorni in terapia intensiva

**REJECTED**

- Gianfranco Zola compie 60 anni: la Sardegna e non solo fa festa
- Fondazione Cannavaro Ferrara: grande successo e sold-out per la “Summer Garden Charity Night”
- El Shaarawy e Ludovica Pagani trasformano il loro matrimonio in un gesto di solidarietà: l'iniziativa
- Manu Koné fa impazzire la Francia per una collana: "Si è spinto oltre". Ecco qual è e quanto costa
- Fiocco blu in casa Leotta-Karius, è nato il secondogenito Leonardo: l'annuncio sui social

### EXPRESS.de Fußball

[Vizsgált RSS-jelölt](https://www.express.de/sport/fussball?view=rss) — RSS_VALID NO; FRESH_48H NO. SKIP: Unencoded < Line: 4 Column: 31 Char: =

**ACCEPTED**

Nincs a mintában.

**REJECTED**

Nincs a mintában.

### RTL Fußball

[Vizsgált RSS-jelölt](https://www.rtl.de/rss/feed/sport/fussball) — RSS_VALID YES; FRESH_48H YES. PREFLIGHT

**ACCEPTED**

- Vor der Hochzeit mit Georgina Rodriguez: Fußballstar Cristiano Ronaldo zeigt Fans seine Luxusautos
- Fußball-WM 2026: Final-Schiedsrichter Slavko Vincic vor sechs Jahren auf Sex-Party festgenommen

**REJECTED**

- Trainer erklärt Rücktritt nach Abpfiff - Präsident sagt Nein
- 1. FC Köln gegen SV Werder Bremen: Hier läuft das Bundesliga-Topspiel!
- Frankreichs Verband entzieht Infantino Vertrauen für Wahl
- Union Berlin gegen Schalke 04 live: Alle Infos zum Bundesliga-Spiel am Freitag! Stream, TV-Übertragung & Co.
- FC St. Pauli gegen VfL Wolfsburg live bei RTL und auf RTL+: Das 2. Bundesliga-Topspiel im TV & Stream

## Image URL-only minta

A publisher által deklarált szélesség alapján választunk; >=1200 preferált, >=800 fallback. Ismeretlen szélesség/tiny: null. A magasság srcset esetén nem feltétlen ismert. Az RSS és accepted-article HTML jelöltek együtt versenyeznek. Sem képfájl-lekérés, sem URL-méretátírás nem történik.

| SOURCE | IMAGE SOURCE | WIDTH×HEIGHT | REMOTE URL PRESENT |
|---|---|---|---|
| The Sun / SunSport Football | srcset | 3712×? | YES |
| Daily Star Football | srcset | 1200×? | YES |
| Daily Mail Football | none | ?×? | NO |
| talkSPORT Football | srcset | 3760×? | YES |
| OKDIARIO Paparazzi | media:content | 1800×1013 | YES |
| OKDIARIO Fútbol | media:content | 1800×1013 | YES |
| Virgilio Sport Gossip | media:content | 1217×694 | YES |
| Tuttosport Calcio | none | ?×? | NO |
| Gazzetta Calcio | none | ?×? | NO |
| Corriere dello Sport Calcio | none | ?×? | NO |

A 10 ellenőrzött elfogadott cikk és változatlan remote URL:

- The Sun / SunSport Football: [Diletta Leotta puts on busty display in elegant black dress as she returns to screens for Champions League](https://www.thesun.co.uk/sport/40338673/diletta-leotta-champions-league-instagram/) — [remote URL](https://www.thesun.co.uk/wp-content/uploads/2026/09/diletta-leotta-loris-karius-attend-1104635013.jpg?quality=90&strip=all)
- Daily Star Football: [Porto star 'grabbed Erling Haaland's bum' after Champions League tunnel chaos](https://www.dailystar.co.uk/sport/football/erling-haaland-man-city-porto-37645169) — [remote URL](https://i2-prod.dailystar.co.uk/article37645079.ece/ALTERNATES/s1200f/0_GettyImages-2294322877.jpg)
- Daily Mail Football: [How Kai Havertz and Martin Odegaard's inseparable bond is powering their resurgent form - trips abroad together, the running joke at Arsenal's HQ and how Gunners captain helped Havertz and his wife Sophia cope with vile abuse](https://www.dailymail.com/sport/football/article-16121131/kai-havertz-martin-odegaard-arsenal-bond.html?ns_mchannel=rss&ns_campaign=1490&ito=1490) — null/placeholder
- talkSPORT Football: [West Ham midfielder Edson Alvarez furiously rejects allegations he was involved in a kidnapping plot](https://talksport.com/football/4573277/west-ham-edson-alvarez-kidnapping-allegations-statement/) — [remote URL](https://talksport.com/wp-content/uploads/2026/09/edson-alvarez-mexico-laments-elimination-1093786192.jpg?w=3760)
- OKDIARIO Paparazzi: [Cristiano Ronaldo (41 años): «Yo no hago dieta, tengo buenas rutinas; si me apetece comer una hamburguesa con patatas fritas, no pasa nada»](https://okdiario.com/deportes/cristiano-ronaldo-41-anos-yo-no-hago-dieta-tengo-buenas-rutinas-si-apetece-comer-hamburguesa-patatas-fritas-no-pasa-nada-20209305) — [remote URL](https://okdiario.com/img/2026/09/01/imagen_recortada-2026-09-01t181849.875.jpg)
- OKDIARIO Fútbol: [Marlaska abre un expediente «por falta muy grave» a los policías agredidos por un ultra independentista del Barça](https://okdiario.com/deportes/marlaska-abre-expediente-falta-muy-grave-policias-agredidos-ultra-independentista-del-barca-20256054) — [remote URL](https://okdiario.com/img/2026/08/23/imagen_recortada-2026-08-23t212352.540.jpg)
- Virgilio Sport Gossip: [Alisha Lehmann a Wimbledon con il nuovo fidanzato Montel McKenzie: anello in vista, Douglas Luiz e la Juventus dimenticati](https://sport.virgilio.it/alisha-lehmann-wimbledon-fidanzato-juventus-douglas-luiz-962364) — [remote URL](https://wips.plug.it/cips/sport.virgilio.it/cms/2026/07/gettyimages-2284342606-1.jpg)
- Tuttosport Calcio: ["Non potevo continuare così e rovinare mio figlio". Lavezzi shock: "Mi hanno convinto a..."](https://www.tuttosport.com/news/calcio/serie-a/napoli/2026/09/10-151148800/non_potevo_continuare_cos_e_rovinare_mio_figlio_lavezzi_shock_mi_hanno_convinto_a_/) — null/placeholder
- Gazzetta Calcio: [Juventus, Douglas Luiz come non lo avete mai visto: piange per la convocazione con il Brasile](https://video.gazzetta.it/video-juventus-douglas-luiz-in-lacrime-per-la-convocazione-con-il-brasile/f8e67dc2-3e9a-4050-84f4-e123a7a41xlk) — null/placeholder
- Corriere dello Sport Calcio: [Dybala, paura nella notte. Si sveglia e trova la moglie così: "Traumatizzato"](https://www.corrieredellosport.it/news/calcio/serie-a/roma/dybala/2026/09/10-151147856/dybala_paura_nella_notte_si_sveglia_e_trova_la_moglie_cos_traumatizzato/) — null/placeholder

## Natív feed-azonosítás forrásai

- [BILD hivatalos RSS-lista](https://www.bild.de/corporate-site/rss-infoseite/bild-service/rss-3257128.bild.html): Sport hivatkozása a `/feed/sport.xml` feedre irányít.
- [RTL hivatalos RSS-lista](https://www.rtl.de/cms/rss-feed-abonnieren-sie-die-rtl-de-auf-ihrem-feedreader-4476976.html): Fußball feed.
- [MARCA Tiramillas](https://www.marca.com/tiramillas.html): natív RSS alternate hivatkozás.
- [Corriere Fuori dal Campo natív RSS](https://www.corrieredellosport.it/rss/calcio/fuori-dal-campo): XML és vertikálhoz tartozó cikk-URL-ek ellenőrizve.
- [Golssip gossip oldal](https://www.golssip.it/gossip/): generic feedhivatkozást mutat; a külön `/gossip/feed/` jelölt 404.

**STOP. AUTO-PUBLISH és corporate cron OFF; forrásaktiválás és generálás nem történt.**

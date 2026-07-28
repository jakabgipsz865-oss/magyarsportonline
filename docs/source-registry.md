# Source Registry — forráscsomag dokumentáció (Top 5 liga + Sport & Sztárok irány)

**Verzió:** 1.0
**Dátum:** 2026-07-28
**Cél:** A 2026-07-28-i termékirány ("Top 5 liga + Sport & Sztárok, többforrásos Story-építés, hitelességi mutató") által kért első forráscsomag dokumentálása, **a bekötés előtt** — ahogy az utasítás szól: "A források bekötése előtt dokumentáld forrásonként."

**Fontos, őszinte korlátozás:** ez a dokumentum abban a sandboxban készült, amely **nem ér el kifelé élő internetet** (ismételten megerősítve ezen a sprinten: a `bbc.co.uk` közvetlen letöltése innen 403-at ad a proxyn). Emiatt az alábbi RSS-URL-ek, robots.txt- és ToS-állítások **nem élő, most lekérdezett adatok**, hanem a tudásom szerinti (2026 januári vágásig ismert), általánosan stabil nyilvános tények, jelölve, hogy melyik állítás igényel élő megerősítést a bekötés előtt. Ez ugyanaz a mintázat, mint a BBC Sport extractor szelektorainál: a kód/dokumentáció óvatosan, ellenőrizhető módon készül, a valós, élő bizonyítást egy internet-eléréssel rendelkező környezet (pl. GitHub Actions, vagy egy ember által futtatott manuális ellenőrzés) adja.

**Ebben a sprintben egyetlen forrás van ténylegesen bekötve (RSS-ingestion + full-article extractor): BBC Sport.** Minden más alábbi forrás **dokumentált, de NINCS bekötve** — a `sources` táblában `is_active=false` sorként szerepelnek (lásd `packages/db/src/seed.ts` / Source Registry seed), amíg a robots/ToS-ellenőrzés és az extractor meg nem íródik hozzájuk.

---

## 1. Mezőmagyarázat (a `sources` tábla Source Registry oszlopai)

| Mező | Jelentés |
|---|---|
| `country` | ISO 3166-1 alpha-2 országkód |
| `leagueTags` | `{ leagues: [...], clubs: [...] }` — melyik ligához/klubhoz kötődik |
| `category` | `official` / `league` / `club` / `trusted_media` / `tabloid` / `social` / `data_api` |
| `type` (elérési mód) | `api` / `rss` / `html` / `social_embed` |
| `contentMode` | `full_text` (a teljes cikk felhasználható) / `fact_only` (csak állítás-kinyerésre) / `discovery_only` (csak felfedezésre, tartalma sosem kerül át) |
| `reliabilityTier` | A/B/C — a meglévő, élesben használt Fact Verification confidence-score bemenete |
| `trustBaseline` | 0-100 — új, additív bizalmi alappont a hitelességi mutatóhoz (nem váltja ki a `reliabilityTier`-t) |
| `robotsStatus` / `termsStatus` | robots.txt / ToS rövid összegzés — **"ellenőrizendő"-vel jelölve, ha nem élőben megerősített** |
| `attributionRule` | kötelező forrásmegjelölési szabály |
| `imagePolicy` | kép-/médiapolicy (lásd docs/open-decisions.md a képjogi modellről) |
| `extractorName` | melyik `ArticleExtractor` kezeli — `null`, ha még nincs |

---

## 2. Öt liga hivatalos oldala

| Liga | Domain | Ország | Elérési mód | Tartalom-mód | Várható megbízhatóság | Megjegyzés |
|---|---|---|---|---|---|---|
| Premier League | premierleague.com | GB | HTML (nincs ismert publikus RSS a hírrovaton) | `discovery_only` | Hivatalos → magas trust baseline (kb. 90), de csak eredmény/tényközlés, önálló extractor kell a hírrovathoz | Robots/ToS: **ellenőrizendő élőben** — a Premier League ToS jellemzően korlátozza a tartalom kereskedelmi újrafelhasználását |
| LaLiga | laliga.com | ES | HTML + hivatalos közlemény-RSS egyes alszekciókon | `discovery_only` → `fact_only`, ha a közlemény konkrét tényt közöl (pl. sérülés, átigazolás) | ~90 | Robots/ToS: ellenőrizendő |
| Serie A (Lega Serie A) | legaseriea.it | IT | HTML | `discovery_only` | ~90 | Robots/ToS: ellenőrizendő |
| Bundesliga (DFL) | bundesliga.com | DE | HTML, több nyelvi verzió (en/de) | `discovery_only` / `fact_only` | ~90 | A `bundesliga.com` több klub hírét is aggregálja — jó discovery-forrás |
| Ligue 1 (LFP) | ligue1.com | FR | HTML | `discovery_only` | ~90 | Robots/ToS: ellenőrizendő |

**Miért `discovery_only` alapból, nem `full_text`?** A hivatalos ligaoldalak elsődlegesen bejelentésekre, eredményekre, sajtóközleményekre valók — ezek jó, magas-bizalmú **fact_only** vagy **discovery** jelek egy Story-hoz, de a Story szövegét a magyar Íróügynökség (Hungarian Writer) több forrás (média + hivatalos állítás) összevonásából építi, nem a ligaoldal cikkének fordításából. Ez pontosan a felhasználó által kért elv: "Ne egyetlen forrás cikkét fordítsd."

## 3. Klubok (mind az öt liga összes klubja)

**Ez a réteg jelenleg MÓDSZERTANKÉNT dokumentált, nem 96 egyedi, élőben ellenőrzött sorként** — lásd docs/open-decisions.md 3. tétel. Indoklás: a sandbox nem ér el kifelé élő internetet, így egyenként kitalálni ~96 klub RSS-elérhetőségét/ToS-ét ellenőrzés nélkül a session "bizonyítás, ne feltételezés" elvét sértené (ugyanaz a korlát, ami miatt a BBC extractor szelektorait is külön GitHub Actions workflow-val kellett igazolni élő HTML-en).

**Kluboldal-kategorizálási módszertan (a tényleges bekötés előtti audit-lépés):**
1. Minden klub hivatalos domainjét regisztráljuk a Registry-be `category=club`, `isActive=false` sorként, `leagueTags.clubs` mezővel.
2. Egy (jövőbeli, külön sprintben megírandó) **forrás-onboarding audit script** — hasonlóan a `bbc-extractor-diagnostic.yml`-hez, de generikusan minden klubdomain ellen futtatva — éles internet-hozzáféréssel rendelkező környezetben (GitHub Actions) ellenőrzi: van-e RSS autodiscovery `<link rel="alternate" type="application/rss+xml">`, mit mond a robots.txt, van-e nyilvános hír-API.
3. Az audit eredménye tölti fel a `robotsStatus`/`termsStatus`/`type` mezőket ténylegesen, forrásonként — ekkor válik "dokumentált, bekötésre kész" állapotúvá minden klub.

**Az 5 liga klubjainak listája** (a `leagueTags.clubs` taxonómia alapja, `is_active=false` Registry-sorként rögzítve, extractor és robots-audit nélkül):
- **Premier League (20):** Arsenal, Aston Villa, Bournemouth, Brentford, Brighton, Chelsea, Crystal Palace, Everton, Fulham, Ipswich Town, Leicester City, Liverpool, Manchester City, Manchester United, Newcastle United, Nottingham Forest, Southampton, Tottenham Hotspur, West Ham United, Wolverhampton Wanderers
- **LaLiga (20):** Real Madrid, Barcelona, Atlético Madrid, Athletic Bilbao, Real Sociedad, Real Betis, Villarreal, Valencia, Sevilla, Girona, Osasuna, Celta Vigo, Rayo Vallecano, Mallorca, Getafe, Alavés, Las Palmas, Leganés, Espanyol, Valladolid
- **Serie A (20):** Juventus, Inter Milan, AC Milan, Napoli, AS Roma, Lazio, Atalanta, Fiorentina, Bologna, Torino, Genoa, Udinese, Cagliari, Verona, Empoli, Lecce, Parma, Como, Venezia, Monza
- **Bundesliga (18):** Bayern München, Borussia Dortmund, RB Leipzig, Bayer Leverkusen, Eintracht Frankfurt, VfL Wolfsburg, Borussia Mönchengladbach, SC Freiburg, Werder Bremen, VfB Stuttgart, FC Union Berlin, TSG Hoffenheim, FSV Mainz 05, FC Augsburg, VfL Bochum, Holstein Kiel, FC St. Pauli, Heidenheim
- **Ligue 1 (18):** Paris Saint-Germain, Marseille, Monaco, Lyon, Lille, Nice, Rennes, Lens, Strasbourg, Reims, Toulouse, Nantes, Montpellier, Le Havre, Brest, Angers, Auxerre, Saint-Étienne

**Fontos, őszinte megjegyzés:** ez a klublista a bajnoki tagság **általam ismert, 2026 eleji állapota** — a ténylegesen aktuális, adott szezonra érvényes tagságot (feljutás/kiesés miatt évente változik) a football-data.org API-ból (lásd 5. pont) kell majd élőben lekérdezni és szinkronizálni, nem kézzel karbantartani. Ez explicit nyitott döntés, lásd docs/open-decisions.md 4. tétel.

## 4. UEFA és FIFA

| Forrás | Domain | Elérési mód | Tartalom-mód | Megjegyzés |
|---|---|---|---|---|
| UEFA | uefa.com | HTML (hír/sajtóközlemény-rovat), nincs ismert stabil publikus RSS | `discovery_only` / `fact_only` | Hivatalos versenyeredmények, fegyelmi döntések, sorsolások — magas trust baseline (~95), de a szöveg maga hivatalos közlemény stílusú, nem hír-adaptálásra való |
| FIFA | fifa.com | HTML + néhány hivatalos API-végpont (pl. világranglisták) | `discovery_only` / `fact_only` | Hasonló UEFA-hoz; a FIFA World Ranking API stabil, dokumentált, ez jó `fact_only` forrás lehet rangsor-hírekhez |

Robots/ToS mindkettőnél: **ellenőrizendő élőben** — mindkét szervezet ToS-e jellemzően szigorúan korlátozza a tartalom (kép, videó, teljes szöveg) kereskedelmi újrafelhasználását; csak tényközlés + link + attribution tervezhető biztonságosan e dokumentum tudása alapján.

## 5. football-data.org (adat-API)

| Mező | Érték |
|---|---|
| `category` | `data_api` |
| `type` | `api` |
| `contentMode` | `fact_only` |
| Hitelesség | Strukturált, több liga (a Top 5 + BL) meccs-, eredmény- és kerettadatait szolgáltató, **ismert, dokumentált** free/paid tier REST API. A free tier korlátozott (kérés/perc rate limit, késleltetett élő adat) — a paid tier valós idejű. |
| Használat | Kizárólag **tényforrásként** (eredmény, gólszerző, csere, sárga/piros lap, tabella-állás) — sosem cikk-tartalom forrásaként, mert nincs is cikk-tartalma. Ideális a hitelességi mutató "hivatalos megerősítés" jeleként meccs-eredményekhez. |
| Robots/ToS | API-kulcsos hozzáférés, a football-data.org saját API Terms-e szabályozza (rate limit, attribution "Data provided by football-data.org" jellemzően elvárt) — **a pontos, aktuális rate limit és licencfeltétel élő ellenőrzést igényel a bekötés előtt**, mert ezek időről időre változnak. |

## 6. Média

| Forrás | Domain | Ország | Elérési mód | Tartalom-mód | Várható tier | Megjegyzés |
|---|---|---|---|---|---|---|
| BBC Sport | bbc.co.uk/bbc.com | GB | RSS + HTML (**bekötve**) | `full_text` | B / 75 | Az egyetlen ténylegesen bekötött forrás — lásd `bbcSportExtractor` |
| Sky Sports | skysports.com | GB | RSS (`https://www.skysports.com/rss/12040`) + HTML (**bekötve**) | `full_text` | B / 75 | A "Hitelességi mutató v1" sprint kivétele (docs/open-decisions.md) — a felhasználó explicit engedélyezte, hogy legyen valódi BBC+Sky Sports két-forrásos Story a bizonyító riportban. `skySportsExtractor`, élő bizonyítás: `.github/workflows/sky-sports-extractor-diagnostic.yml` |
| The Guardian | theguardian.com | GB | Hivatalos publikus RSS **és** dokumentált Open Platform API (content.guardianapis.com) | `full_text` | A (a Guardian Open Platform API kifejezetten újrafelhasználásra szánt, fejlesztői kulccsal) | A Guardian API a legkevésbé kockázatos "média" forrás jogi szempontból ebben a listában, mert kifejezetten szindikációra/API-használatra tervezték |
| ESPN | espn.com | US | RSS (espn.com/espn/rss), HTML | `full_text` | B | Robots/ToS: ellenőrizendő; ESPN ToS jellemzően tiltja a kereskedelmi újraközlést engedély nélkül — snippet+attribution+önálló szöveg tervezhető |
| Marca | marca.com | ES | RSS ismert, HTML | `full_text` | B (bulvár-közeli, de sportspecifikus trusted media) | Kategória: `trusted_media`, de a "Sport & Sztárok" rovatnál átfedhet a `tabloid` jelleggel egyes cikkeknél — cikkenkénti, nem forrás-szintű megkülönböztetés lehet indokolt (nyitott döntés) |
| AS | as.com | ES | RSS ismert, HTML | `full_text` | B | ua. mint Marca |
| Mundo Deportivo | mundodeportivo.com | ES | RSS ismert, HTML | `full_text` | B | ua. |
| Gazzetta dello Sport | gazzetta.it | IT | RSS ismert, HTML, fizetős paywall egyes cikkeken | `full_text` (csak a nem-paywall cikkeken) | B | Paywall-detektálás szükséges az extractorban — ha a cikk paywall mögött van, essen vissza `discovery_only`-ra |
| Corriere dello Sport | corrieredellosport.it | IT | RSS ismert, HTML | `full_text` | B | — |
| Kicker | kicker.de | DE | RSS ismert, HTML | `full_text` | A (a német piac egyik legmegbízhatóbb sportmédiuma, alacsony bulvár-arány) | — |
| Sport1 | sport1.de | DE | RSS ismert, HTML | `full_text` | B | — |
| L'Équipe | lequipe.fr | FR | RSS ismert, HTML, részleges paywall | `full_text` (nem-paywall cikkeken) | A | A francia piac vezető, megbízható sportmédiuma |
| RMC Sport | rmcsport.bfmtv.com | FR | HTML, RSS kevésbé stabil | `full_text` | B | Robots/ToS: ellenőrizendő |

**Minden fenti "RSS ismert" jelölésű sor esetén**: ez a tudásom szerinti, általánosan stabil nyilvános tény (ezek a portálok évek óta kínálnak publikus RSS-t), de a pontos RSS-URL-t és annak jelenlegi állapotát **élőben, a bekötés pillanatában kell megerősíteni** — pontosan úgy, ahogy a BBC Sport esetén is (a `bbc-extractor-diagnostic.yml` mintájára minden új forráshoz érdemes egy hasonló, egyszeri diagnosztikai workflow-t írni, mielőtt élesítjük).

## 7. Sport & Sztárok / sportbulvár irány — forrásvonatkozás

A felhasználó által kért 2. termékpillér (sportolók/edzők/klubok és családtagjaik nyilvános szereplése — párkapcsolat, életmód, közösségi média, divat, luxus, események, nyilatkozatok, **pletyka sosem megerősített tényként**) más forrás-mixet igényel, mint a mérkőzés-hírek:

- A fenti média-lista (Marca, AS, Sky Sports stb.) egy része már eleve bulvár-közeli tartalmat is közöl — ezeknél `category=trusted_media`, de a **cikk-szintű** tartalom lehet bulvár jellegű. Ez azt jelenti, hogy a hitelességi mutatónak **cikkenként**, nem csak forrásonként kell értékelnie a "megerősített tény vs. pletyka" tengelyt.
- Közösségi média (`category=social`, `type=social_embed`): hivatalos klub/liga/sportoló-fiókok posztjainak beágyazása — ez **discovery_only** vagy **fact_only** (pl. egy sportoló saját posztja egy sérülésről hiteles elsődleges forrás), sosem `full_text` (nincs "cikktörzse").
- Ez a pillér **nincs ebben a sprintben forrásszinten kibontva** (konkrét bulvár-forráslista, pl. mely közösségimédia-fiókok, mely bulvárlapok) — ez explicit nyitott döntés, lásd docs/open-decisions.md 5. tétel.

---

## 8. Mi van ténylegesen bekötve ebből a listából?

| Forrás | Dokumentálva | `sources` sor létrehozva | RSS-ingestion bekötve | Full-article extractor |
|---|---|---|---|---|
| BBC Sport | ✅ | ✅ (`is_active=true`) | ✅ | ✅ `bbcSportExtractor` |
| Sky Sports | ✅ | ✅ (`is_active=true`) | ✅ | ✅ `skySportsExtractor` |
| Minden más a fenti listából | ✅ (ebben a dokumentumban) | ✅ (`is_active=false`, `pending_review`) | ❌ | ❌ |

Ez szándékos: a felhasználói utasítás sorrendje "dokumentálj, MIELŐTT bekötsz" — ez a dokumentum az a lépés. A Sky Sports az egyetlen, explicit felhasználói döntéssel engedélyezett kivétel (a Hitelességi mutató valódi, két-forrásos bizonyításához) — minden más forrás tényleges bekötése forrásonként külön, egyenkénti sprint, ahogy a BBC Sport is egy teljes, önálló sprint volt.

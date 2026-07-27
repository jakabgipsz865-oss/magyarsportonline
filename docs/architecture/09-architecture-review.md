# 09 — Architecture Review (senior szintű kritikai elemzés)

[← vissza az áttekintéshez](./README.md)

**Szerep:** senior software architect review, implementáció megkezdése előtti kapu ("go/no-go").
**Módszer:** minden kérdéskörre — probléma azonosítása → súlyosság → javaslat → hova lett beépítve a tervbe.
**Súlyossági skála:** 🔴 Kritikus (implementáció előtt kötelező kezelni) / 🟡 Fontos (fázisolva kezelhető, de tervben kell szerepelnie) / 🟢 Elfogadott kockázat (dokumentált, tudatos döntés, jelenleg nem igényel beavatkozást).

## 0. Végső verdikt

Az eredeti terv ([01](./01-data-model.md)–[08](./08-roadmap.md)) **jó alapstruktúra, de production-ready állapotban NEM volt** — 4 kritikus (🔴) hiányosságot találtam, amik implementáció előtt tervezési szinten javítandók, nem utólag patch-elhetők:

1. **Race condition Story-létrehozásnál** — két egyidejű forrás ugyanarról az eseményről duplikált Story-t hozhat létre (§9).
2. **`agent_runs` tábla mint egyszerre OLTP-tábla és observability-log** — 10 000 Story/nap mellett ez önmagában megöli az adatbázis write-teljesítményét (§6).
3. **Fact Verification Agent minden RawArticle-re teljes LLM-extrakciót futtat** — lineárisan skálázódó LLM-költség, ami wire-service szindikált tartalomnál (50+ forrás, 1 esemény) indokolatlanul magas (§7).
4. **Nincs prompt injection elleni explicit védelem** a forrás-tartalom AI-promptba kerülésénél (§8).

Ezeket a hiányosságokat **beépítettem a meglévő tervbe** (01–08 dokumentumok módosítva, lásd §13 összesítő táblázat) — ez a dokumentum a *miért*-et rögzíti, a tényleges tervmódosítás a hivatkozott fájlokban van. A módosítások után az architektúra **implementáció-kész**.

---

## 1. Skálázhatóság 100 → 10 000 Story/nap

10 000 Story/nap nem egyenletes terhelés — sportesemények miatt **erősen tüskés** (hétvégi program, egy-egy nagy torna napja akár 50-100×-os csúcsot hozhat pár perces ablakban, pl. amikor egyszerre több meccs ér véget). Az eredeti terv 07-scalability.md-ben forrásszám szerint gondolkodott (1→300+ forrás), de **nem külön dimenzióként kezelte a Story/nap-terhelést** — ez hiba volt, mert a kettő nem lineárisan összefüggő (300 forrás ünnepnap 20 Story-t termel, egy BL-forduló napja 50 forrásból is 2000+ Story-t/frissítést).

| Komponens | 100 Story/nap | 10 000 Story/nap | Verdikt |
|---|---|---|---|
| Dedup ANN-keresés | globális 72h ablak, kicsi | globális 72h ablak → **százezres RawArticle-halmaz**, a keresés lassul és pontatlanabb lesz (más sportágak/események zaja) | 🔴 kell entitás/kategória szerinti **előszűrés** a vektorkeresés előtt (lásd §4, §7) |
| Fact Verification (LLM) | elhanyagolható költség | minden RawArticle-re extrakció → **lineárisan növekvő LLM-hívásszám**, wire-service szindikációnál feleslegesen sok | 🔴 extrakció-limitálás szükséges (§7) |
| Hungarian Writer regenerálás | ritka | élő, gyorsan fejlődő sztorik (élő meccs) percenként több `new_info` eseményt generálhatnak → **túl gyakori újraírás** | 🟡 debounce/batch-elés szükséges (§7) |
| `agent_runs` írás | pár száz sor/nap | **milliós nagyságrend/nap** (minden agent-lépés minden RawArticle-re) | 🔴 ki kell venni az OLTP-útból (§6) |
| Publikus olvasási forgalom | Postgres közvetlenül elbírja | sok olvasó/Story, write-terheléssel ugyanazon DB-n versenyezve | 🟡 CQRS read-model javasolt (§5) |

**Konklúzió:** a rendszer *architektúrája* (event-driven, Story-alapú) helyes marad 10 000 Story/nap mellett is — a hiba nem a mintában, hanem néhány konkrét komponens naiv, "minden eseményre egyformán reagálunk" implementációjában lenne, ha nem javítjuk ki előre.

---

## 2. Szűk keresztmetszetek later fázisban

- **Egyetlen Postgres write-primary** (Neon/Supabase) — minden agent ugyanoda ír. 10 000 Story/nap × ~9 agent-lépés × átlag több RawArticle/Story = a legnagyobb write-terhelést nem a `stories`/`story_versions` tábla adja, hanem a naplózás (lásd §6). Ha ezt kivesszük, a tényleges üzleti write-terhelés (Story, Version, Fact) jóval kezelhetőbb marad connection pooling + particionálás mellett.
- **`/api/inngest` egyetlen catch-all route** — minden agent-hívás ezen a webhookon megy át. Ez nem kapacitás-szűk keresztmetszet (Inngest maga skálázza a hívásokat), de **deploy-kockázat**: egy hibás deploy ezen a route-on egyszerre állítja meg mind a 8 agentet. Lásd §3 (SPOF).
- **LLM-szolgáltató (Anthropic API) rate limit** — csúcsidőben (sok egyidejű meccs vége) a Fact Verification + Writer + SEO + Social agentek mind egyszerre kérnek LLM-kapacitást. Ha nincs backpressure, ez hibás/eldobott feldolgozásokhoz vezethet.
- **Review Queue emberi kapacitása** — technikailag nem szűk keresztmetszet, de üzemeltetésileg az: ha a Publish Gate küszöbök szigorúak maradnak nagy terhelésnél is, a review-queue emberi torlódása lesz a tényleges limitáló tényező. Ez tudatos trade-off (lásd [feasibility-analysis.md](../feasibility-analysis.md)), nem hiba, de dashboard-on explicit figyelni kell (már tervezve, §10 megerősíti).

---

## 3. Single Point of Failure (SPOF) leltár

| SPOF | Kockázat | Kezelés |
|---|---|---|
| Postgres write-primary | teljes pipeline megáll adatbázis-kiesésnél | 🟡 Neon/Supabase natív HA + PITR backup (§11); teljes multi-region write-primary **nem indokolt** ennél a skálánál (elfogadott kockázat, dokumentálva) |
| `/api/inngest` route | egy hibás deploy leállítja az összes agentet | 🟡 kötelező canary/rollback folyamat CI/CD-ben (§6-hoz kapcsolva, [06-deployment.md](./06-deployment.md) kiegészítve) |
| `dispatch-ingest` cron | ha ez némán elhal, **semmilyen új tartalom nem érkezik**, de a weboldal látszólag működik — ez a legveszélyesebb SPOF, mert tünetmentes | 🔴 explicit heartbeat-monitoring kell rá ("utolsó sikeres dispatch" riasztás), nem elég az általános hibaráta-figyelés — lásd §10 |
| Egyetlen LLM-szolgáltató | szolgáltatói kiesés/rate-limit leállítja a tartalom-generálást | 🟢 elfogadott kockázat — a queue (Inngest) natívan visszatartja/újrapróbálja az eseményeket kiesés alatt, nincs adatvesztés, csak késés; multi-vendor fallback **nem javasolt** (konzisztencia/promptminőség kockázata nagyobb, mint a nyereség) |
| Publish Gate szabály hibája | ha a risk/confidence-számítás hibás, tömegesen mehet ki auto-publish alatt hibás tartalom, mielőtt észrevennék | 🔴 **post-publish sampling QA** bevezetése szükséges — lásd §8, beépítve a Monitoring & Audit Agent-be ([02-agents.md §2.9](./02-agents.md#29--monitoring--audit-agent)) |

---

## 4. Laza csatolás — hol volt túl szoros

- **`packages/db/repositories` mint egyetlen, teljes sémát látó csomag**, amit minden agent importál: ez azt jelenti, hogy bármelyik agent bármelyik táblát írhatja/olvashatja, még ha a felelőssége szerint nem is kellene. Ez nem okoz azonnali hibát, de a csapat növekedésével (több fejlesztő, több agent-verzió) könnyen vezet ahhoz, hogy egy agent "kényelemből" átnyúl más agent adatterületére, és a határok elmosódnak. **Javaslat:** minden agent csak a saját bounded context-jéhez tartozó szűk repository-interfészt kapja meg (pl. `FactVerificationAgent` csak `FactRepository` + `StoryRepository.readOnly`-t lát, nem az egész DB-réteget) — ez fegyelmezési/kódszervezési szabály, nem infrastruktúra-változás, de explicit be kell írni a fejlesztői konvenciókba ([05-repo-structure.md](./05-repo-structure.md) kiegészítve).
- **Dedup Agent entitás-egyeztetése és a Fact Verification entitás-kinyerése két külön helyen, potenciálisan eltérő logikával** fut — ez duplikált, egymástól elcsúszható logika. **Javaslat:** egy közös, önálló "Entity Resolution" modult kell kiemelni ([05-repo-structure.md](./05-repo-structure.md)-ben `packages/entity-resolution` néven), amit mindkét agent használ — ez nem új *agent* (nem esemény-vezérelt), hanem megosztott, tisztán funkcionális könyvtár.
- **Frontend olvasás közvetlenül az írási (OLTP) sémából** — ez a legfontosabb csatolási probléma, lásd §5 (CQRS).

---

## 5. CQRS és Event Sourcing alkalmazhatósága

**Event Sourcing (teljes):** **nem javasolt.** A `Story` aggregátum állapotát nem indokolt kizárólag eseményekből visszajátszással előállítani — ez jelentős komplexitást (event-séma migráció, snapshotolás, replay-teljesítmény) adna hozzá olyan doménben, ahol nincs valódi tranzakciós/pénzügyi konzisztencia-igény. A jelenlegi terv **már majdnem megadja az Event Sourcing előnyeit** anélkül, hogy ténylegesen ES lenne: a `StoryVersion` (append-only), `Fact` (append-only) és `agent_runs` (append-only napló) együtt teljes visszakövethetőséget adnak. **Ezt meg kell tartani, de nem kell tovább vinni teljes ES-be.**

**CQRS: igen, explicit módon be kell vezetni.** Az eredeti terv írási és olvasási oldala ugyanazon normalizált táblákon (`stories`, `story_versions`, `story_sources`, stb.) osztozott — ez azt jelenti, hogy minden publikus oldal-betöltés (frontend) ugyanazt az adatbázist terheli, amit az agentek épp intenzíven írnak. 10 000 Story/nap mellett ez összeakad.

**Javaslat (beépítve [01-data-model.md](./01-data-model.md)-be és [07-scalability.md](./07-scalability.md)-be):**
- Bevezetünk egy **denormalizált olvasási projekciót** (`story_read_model` tábla vagy materialized view): pontosan azt a struktúrát tartalmazza, amit a `/api/v1/stories/{slug}` végpont visszaad (előre join-olt cím/lead/body/források/tag-ek).
- Ezt egy könnyű **projector** frissíti `story/published` és `story/updated.published` eseményekre feliratkozva — **nem üzleti agent**, tisztán infrastrukturális komponens.
- A publikus API ezt a read-modellt olvassa, nem a write-oldali táblákat közvetlenül — ezzel a publikus olvasási forgalom **teljesen leválik** az agent write-terhelésről, és külön skálázható (pl. saját olvasási replika vagy edge cache mögött).
- Az admin/review UI viszont **a write-oldali (normalizált) táblákat** olvassa közvetlenül, mert ott a friss, konzisztens, nem-denormalizált állapotra van szükség (review döntéshez).

Ez a "CQRS-lite" minta — külön írási és olvasási modell, de **nem** külön adatbázis-technológia — a helyes arányú megoldás ezen a skálán.

---

## 6. Gyorsan növekvő táblák, particionálás, archiválás

| Tábla | Növekedési ütem 10 000 Story/nap mellett | Probléma | Megoldás |
|---|---|---|---|
| **`agent_runs`** | 🔴 legnagyobb — minden agent-lépés minden RawArticle/Story-eseményre, könnyen **milliós sor/nap** | OLTP DB-t terheli olyan adattal, ami valójában megfigyelési (observability) adat, nem üzleti állapot | **Ki kell venni a Postgres OLTP útból**: strukturált logként megy egy dedikált log/observability rendszerbe (pl. Axiom/Better Stack/Datadog), a Postgres-ben csak egy vékony, mintavételezett vagy aggregált összegzés marad (pl. Story-nkénti "utolsó agent-futás státusz" — ehhez elég a `Story`/`StoryVersion` saját mezője, nem kell külön tábla minden sorhoz) |
| **`raw_articles`** | 🟡 nagy, de kezelhető particionálással | hosszú távon feleslegesen nagy hot storage, ha a nyers szöveg évekig bent marad | havi particionálás; a dedup-hoz csak a friss (72h) embedding kell hot állapotban — régebbi `RawArticle` tartalom N hónap után **hideg tárolóba** (Blob/S3, tömörített JSON), csak metaadat + hivatkozás marad Postgres-ben |
| **`facts`** | 🟡 közepes-nagy | sok tény/forrás/Story, de a végleges, publikált tudás úgyis a `StoryVersion.body_hu`-ban és `structured_data`-ban van lefagyasztva | particionálás; lezárt (nem `is_developing`) Story-k `Fact`-jei archiválhatók, mert a publikált tartalom önmagában hordozza a végeredményt |
| **`story_versions`** | 🟢 mérsékelt (Story-nkénti pár verzió) | ez maga **a termék** — sosem archiválható/törölhető, örökre Postgres-ben marad, csak particionálva a lekérdezési teljesítmény miatt | havi particionálás, de **nincs retention/törlés** |
| **`social_posts`** | 🟢 kicsi | nem releváns | nincs teendő |

**Általános szabály, amit a tervbe be kell írni:** *"observability adat sosem OLTP táblában él"* — ez volt az eredeti terv fő hibája ebben a kérdéskörben, és ez a legfontosabb, önmagában is skálázási problémát megelőző döntés.

---

## 7. LLM-költség minimalizálás

Az eredeti terv (07-scalability.md) már tartalmazott modell-tiering-et és a "csak `new_info` vált ki újraírást" szabályt — ez jó alap, de **három további, konkrét optimalizálás hiányzott**, amiket most beépítek:

1. **Extrakció-limitálás forrásonként (🔴 kritikus költségkorlátozás).** Jelenleg a Fact Verification Agent **minden** a Story-hoz kapcsolt `RawArticle`-re lefuttatja a teljes LLM-extrakciót — egy népszerű eseménynél (BL-döntő) ez 50+ redundáns extrakció lehet, miközben a 4. forrástól kezdve az extra extrakció alig ad új információt a confidence score-hoz képest. **Új szabály:** teljes LLM-extrakció csak az első **3-5, egymástól független, legmegbízhatóbb** forrásra fut; az ezt követő, ugyanazon eseményhez kapcsolódó források csak egy olcsó, nem-LLM "fingerprint egyezés" alapján növelik a `corroboration_count`-ot, hacsak a gyors diff nem jelez tartalmi eltérést (akkor mégis lefut rájuk a teljes extrakció, mert az valódi `new_info`).
2. **Prompt caching.** A promptok statikus (rendszerutasítás) és dinamikus (Fact-adatok) részét explicit szét kell választani, a statikus részt promptgyorsítótárazással (Anthropic prompt caching) kell ellátni — nagy ismétlődő system-prompt mellett ez jelentős költségcsökkentés minden LLM-hívás-típusnál.
3. **Debounce/batch-elés élő, gyorsan fejlődő Story-knál.** Élő meccsnél percek alatt több `new_info` esemény is érkezhet — jelenleg minden ilyen esemény önálló Writer-újraírást váltana ki. **Új szabály:** `is_developing=true` Story-knál a Fact Verification → Writer lánc egy rövid (60-120 mp-es) összegyűjtési ablakot alkalmaz, és a Writer csak az ablak lezárultával, az összegyűjtött változásokra fut egyszer — ez egyszerre csökkenti a költséget és javítja a szöveg minőségét (nincs "villódzó" mikro-frissítés).

Ezek a §2.4/§2.5 agent-specifikációba lettek beépítve ([02-agents.md](./02-agents.md)), a skálázási indoklás pedig a [07-scalability.md](./07-scalability.md)-be.

---

## 8. Biztonsági kockázatok

| Kockázat | Leírás | Kezelés |
|---|---|---|
| **Prompt injection forrás-tartalomból** 🔴 | Egy rosszhiszemű/kompromittált forrás a cikk szövegébe rejtve utasítás-szerű szöveget ("Ignore previous instructions and...") csempészhet, ami az extrakciós/generálási promptba kerülve eltérítheti a kimenetet | (1) minden begyűjtött szöveget **kizárólag adatként**, sosem utasításként kezelünk — explicit elhatárolt (pl. XML-tag) blokkban adjuk át az LLM-nek, rendszer-szintű instrukcióval, hogy a blokkon belüli szöveg semmilyen utasítást nem tartalmazhat érvényesen; (2) a Fact Verification risk-osztályozója kap egy **injekció-gyanú jelzőt** (szokatlan utasítás-mintázat a forrásszövegben) — ha ez triggerel, a Story automatikusan `risk_level=high`-ra kerül, review-queue-ba megy |
| **Rosszindulatú/kompromittált forrás hamis hírrel** 🔴 | Hamis sérülés/haláleset/transzferhír, akár szándékos piacbefolyásolási céllal | **Kemény szabály** (nem csak score-alapú): sérülés/haláleset/jogi ügy/doppingvád kategóriában **egyetlen forrás sosem elég auto-publikáláshoz**, függetlenül a `confidence_score`-tól — kötelező review, ha nincs legalább 2 független, A/B-tier forrás |
| **AI-hallucináció** 🟡 (már kezelve, megerősítve) | A Fact Verification → Writer szétválasztás + önellenőrzés már jó védelem; kiegészítés: | visszacsatolási hurok — ha egy emberi reviewer vagy olvasói jelzés hibát talál, az adott forrás `reliability_tier`-je automatikusan csökken (adaptív bizalmi pontszám), és az eset bekerül egy hiba-mintatárba, amit a self-check prompt idővel felhasználhat |
| **Publikus API abuse / scraping / DoS** 🔴 (hiányzott az eredeti tervből) | Az eredeti API-spec nem tartalmazott rate limitet | Vercel Edge Middleware + Upstash Ratelimit bevezetése a `/api/v1/*` végpontokra |
| **Admin API visszaélés** 🟡 | Erős jogosultságok (retrakció, jóváhagyás) | MFA kötelezővé tétele `editor`/`admin` szerepkörre, minden admin-akció `reviewed_by` + IP/session audit (a mező már tervezve volt, MFA-t hozzáadjuk) |
| **Belső agent-API (`/api/inngest`, cron) visszaélés** 🟢 | Inngest natívan HMAC-aláírt, időbélyeges kérésekkel dolgozik | megerősítve, nincs változtatás, csak explicit dokumentálva |
| **Elszabaduló LLM-költség (bug vagy támadás miatt)** 🔴 | Egy hibás retry-ciklus vagy rosszindulatú, gyorsan változó forrás elméletileg végtelen újraírási ciklust indíthatna | **automatikus cost circuit breaker**: napi LLM-költség konfigurált küszöb felett a kill-switch **automatikusan** aktiválódik (nem csak manuálisan indítható), Monitoring & Audit Agent felelőssége |

---

## 9. Race condition, locking, idempotencia

Ez volt az egyik legkomolyabb rés az eredeti tervben.

**A hiba:** a [03-event-flow.md](./03-event-flow.md) eredetileg Story-szintű concurrency-limitet ([korábbi §3.6](./03-event-flow.md#36-konzisztencia-és-idempotencia-garanciák)) tervezett a downstream lépésekhez (Fact Verification, Writer stb.) — ez **jó**, de **nem védte a legkritikusabb pillanatot**: amikor **még nem létezik** `story_id`, mert két külön forrásból *egyszerre* érkező cikk a Dedup Agent-ben *párhuzamosan* fut le, és **mindkettő** `NEW_STORY`-nak minősítheti magát (hiszen egyik sem látja még a másik által épp létrehozás alatt álló Story-t) → **duplikált Story jöhet létre ugyanarról az eseményről**, pont azt a hibát okozva, amit a rendszer alapelve ("egy esemény = egy Story") kifejezetten tiltana.

**Javítás (beépítve [03-event-flow.md](./03-event-flow.md)-ba):**
- Bevezetünk egy **`story_fingerprints`** táblát/mechanizmust: a Dedup Agent a durva egyezés (kategória + fő entitás + dátum-bucket) alapján egy determinisztikus **fingerprint hash**-t számol minden `RawArticle`-re, *még az embedding-keresés előtt*.
- A Story Merge Agent a Story-létrehozást **Postgres advisory lock**-kal védi, a fingerprint hash-re kulcsolva (`pg_advisory_xact_lock(hashtext(fingerprint))`), tranzakción belül: a lock alatt fut le az "already exists ilyen fingerprint-tel?" ellenőrzés + insert — így két egyidejű, azonos fingerprintű kérés **szerializálódik**, a második a lock feloldása után már látja az elsőt létrehozott Story-t, és `MATCH`-ként csatlakozik hozzá `NEW_STORY` helyett.
- **Verziószám-race**: a `StoryVersion.version_number` **nem** alkalmazás-oldali `max+1` számítással készül (ami két egyidejű írásnál ütközhet/kihagyhat számot), hanem tranzakción belüli `SELECT ... FOR UPDATE` + számítás, vagy Story-nkénti DB-szekvencia — ez garantálja a monoton, hézagmentes verziószámozást egyidejű írásnál is.
- **Slug-ütközés**: már eredetileg is `UNIQUE` constraint + retry — ez helyes minta, megtartva.
- **Külső side-effect idempotencia (közösségi poszt)**: mivel a Facebook/X API hívás önmagában nem idempotens, a `social_posts` sor **`status='posting'` állapotban, `UNIQUE(story_version_id, platform)` constraint-tel előbb létrejön**, mint hogy a külső API-hívás megtörténne — így egy Inngest-retry a hívás előtt ellenőrzi, hogy nem történt-e már (részleges) posztolás, elkerülve a duplikált közösségi posztot.

---

## 10. Monitoring, tracing, observability, audit — production követelmények

Az eredeti terv (Monitoring & Audit Agent, [02-agents.md §2.9](./02-agents.md#29--monitoring--audit-agent)) jó kiindulás, de **önmagában nem elég** 24/7 production üzemhez. Kiegészítések:

- **Elosztott tracing**: OpenTelemetry bevezetése, a `correlation_id` (már tervezve, [03-event-flow.md](./03-event-flow.md)) mint trace ID újrahasznosítva — egy Story teljes útja mind a 8 agentesen keresztül **egyetlen trace-waterfall-ban** legyen megnézhető (pl. Honeycomb/Grafana Tempo/Axiom), ne kelljen manuálisan összefésülni az `agent_runs` sorokat.
- **Strukturált logolás külön log-rendszerben**, nem a Postgres `agent_runs`-ban (lásd §6) — ez egyszerre observability- és skálázhatósági javítás.
- **Explicit SLO-k és riasztás SLO-sértésre**, nem csak nyers hibaarányra — pl.: "alacsony kockázatú Story-k 95%-a 5 percen belül publikálódjon az első forrás megjelenésétől", "review-queue elem max 4 órán belül megoldódjon", "ingest hibaarány < 1%". Ezek hiányoztak az eredeti tervből — anomália-detekció önmagában nem helyettesíti a konkrét célértékeket.
- **Synthetic monitoring / "kanári forrás"**: egy szintetikus, mesterséges teszt-forrás, ami rendszeresen (pl. 5 percenként) egy ismert tartalmat küld végig a teljes pipeline-on, és méri, hogy a végén tényleg megjelenik-e Story formájában, elvárt időn belül — ez az **egyetlen módszer, ami a §3-ban azonosított "néma `dispatch-ingest` leállás" SPOF-ot ténylegesen kiszúrja**, mert egy 0-throughput állapot 0 hibát termel, amit a hibaarány-alapú riasztás nem vesz észre.
- **Auditnapló változatlansága**: megerősítve — retrakció **sosem törlés**, mindig új státusz/esemény, a teljes történet visszamenőleg is lekérdezhető marad.

---

## 11. Backup és Disaster Recovery

Ez teljes egészében hiányzott az eredeti tervből — pótlás:

- **PITR (Point-in-Time Recovery)** bekapcsolása Neon/Supabase-en, célértékekkel: **RPO ≤ 5 perc, RTO ≤ 1 óra**.
- **Rendszeres helyreállítási próba** (nem csak "van backup" — időszakos, pl. negyedéves, tesztkörnyezetbe történő tényleges visszaállítás, hogy a backup ténylegesen működőképes legyen).
- **A queue (Inngest) mint másodlagos helyreállítási forrás**: mivel az események durable, korlátozott ideig visszajátszható naplóban élnek, egy DB-visszaállítás után a rendszer **nem csak a visszaállított állapotból indul**, hanem a visszaállítási pont utáni eseményeket az Inngest-naplóból újrajátszva behozható a hiányzó feldolgozás — ezt dokumentálni kell, mint tudatosan kihasznált tervezési tulajdonságot, nem csak mellékhatásként.
- **Konfiguráció/secrets helyreállítás**: dokumentált (nem csak "tudja valaki fejből") folyamat a Vercel env változók, Inngest signing key, API-kulcsok újralétrehozására egy vadonatúj környezetben — ez ugyanannyira "backup", mint az adatbázis.
- **Egy régiós DB elfogadott kockázat** (🟢): magyar közönségű oldalnál nem indokolt multi-region write-primary — ezt explicit, tudatos döntésként dokumentáljuk, nem hallgatólagos hiányosságként.

---

## 12. 24/7 stabilitás

- **Graceful degradation LLM-kiesésnél**: a queue natívan visszatartja/újrapróbálja az eseményeket — ezt ki kell egészíteni egy **"staleness" jelzővel**: ha egy `is_developing=true` (élő, gyorsan változó) Story feldolgozása egy küszöbnél (pl. 15 perc) tovább késik egy LLM-kiesés miatt, a Story automatikusan `pending_review`-ba kerül publikálás helyett, mert egy elavult élő-közvetítés-jellegű hír megtévesztő lehet, ha késve, "frissként" jelenik meg.
- **Zero-downtime deploy**: Vercel natívan atomikus; az eseménysémák verziózása (`version: 1` mező, már tervezve) betartandó szabály, hogy deploy közben in-flight események ne törjenek el egy módosított agent-kód miatt.
- **On-call/eszkalációs terv**: mivel jogilag mindig kell egy felelős szerkesztő ([feasibility-analysis.md §9](../feasibility-analysis.md)), az ő (vagy helyettesítő) elérhetőségére súlyossági szintek szerinti riasztási terv kell: **P1** (hibás tartalom él, vagy kill-switch aktiválódott) → azonnali; **P2** (ingest leállt) → 1 órán belül; **P3** (költség-anomália) → napi összesítő.

---

## 13. Összesített változás-térkép

| Terület | Talált probléma | Hova lett beépítve |
|---|---|---|
| Story-létrehozási race condition | 🔴 duplikált Story lehetséges | [03-event-flow.md](./03-event-flow.md) — fingerprint + advisory lock |
| Verziószám race | 🔴 | [03-event-flow.md](./03-event-flow.md) |
| `agent_runs` mint OLTP-log | 🔴 | [01-data-model.md](./01-data-model.md), [07-scalability.md](./07-scalability.md) |
| Extrakció-limitálás (LLM-költség) | 🔴 | [02-agents.md §2.4](./02-agents.md#24--fact-verification-agent), [07-scalability.md](./07-scalability.md) |
| Prompt injection védelem | 🔴 | [02-agents.md §2.4](./02-agents.md#24--fact-verification-agent) |
| Publikus API rate limit | 🔴 | [04-api-spec.md](./04-api-spec.md) |
| Cost circuit breaker | 🔴 | [02-agents.md §2.9](./02-agents.md#29--monitoring--audit-agent), [06-deployment.md](./06-deployment.md) |
| Post-publish sampling QA | 🔴 | [02-agents.md §2.9](./02-agents.md#29--monitoring--audit-agent) |
| CQRS read-model | 🟡 | [01-data-model.md](./01-data-model.md), [07-scalability.md](./07-scalability.md) |
| Debounce élő Story-knál | 🟡 | [02-agents.md §2.5](./02-agents.md#25--hungarian-writer-agent), [07-scalability.md](./07-scalability.md) |
| Prompt caching | 🟡 | [07-scalability.md](./07-scalability.md) |
| Entity Resolution kiemelése | 🟡 | [05-repo-structure.md](./05-repo-structure.md) |
| Observability stack (tracing, SLO, synthetic monitoring) | 🟡 | [06-deployment.md](./06-deployment.md) |
| Backup/DR terv | 🟡 (hiányzott) | [06-deployment.md](./06-deployment.md) |
| Admin MFA | 🟡 | [04-api-spec.md](./04-api-spec.md) |
| `dispatch-ingest` heartbeat monitoring | 🔴 | [06-deployment.md](./06-deployment.md) |
| "Staleness" jelző élő Story-kra | 🟡 | [06-deployment.md](./06-deployment.md) |
| Roadmap kiegészítés a fentiekhez | — | [08-roadmap.md](./08-roadmap.md) — új **Fázis 13: Production Hardening** |

**Az implementáció (Fázis 0) csak azután indulhat, hogy a fenti 🔴 tételek a kódban is (nem csak a tervben) leképeződnek — ez a roadmap Fázis 13-ban explicit checkpoint-ként szerepel, a Fázis 0 elé emelve azokat az elemeket, amik már az adatmodell/event-kontraktus szintjén eldöntendők (fingerprint tábla, read-model tábla, observability-log választás), hogy ne kelljen később migrációval visszabontani.**

# 07 — Skálázhatósági terv

[← vissza az áttekintéshez](./README.md)

A skálázást három dimenzió mentén kell kezelni: **forrásszám** (1 → 300+), **eseménysűrűség** (napi néhány Story → napi több ezer frissítés), és **LLM-költség** (lineárisan nőne forrásszámmal, ha nem optimalizáljuk).

## 7.1 Fázisolt skálázási terv

| Fázis | Forrásszám | Várható napi RawArticle | Kritikus szűk keresztmetszet | Beavatkozás |
|---|---|---|---|---|
| **Indulás** | 1 | 20-100 | nincs | egyszerű cron + szinkron feldolgozás is elég lenne, de már event-driven-nel indulunk, hogy ne kelljen később migrálni |
| **Korai bővülés** | 2-20 | 200-2000 | LLM-hívások száma/költsége | modell-tiering bevezetése (7.3), dedup embedding cache |
| **Közepes skála** | 20-100 | 2000-15 000 | dedup ANN-keresés sebessége, queue concurrency | pgvector index hangolás (ivfflat→hnsw), Inngest concurrency-limit finomítás forrás-kategóriánként |
| **Nagy skála** | 100-300+ | 15 000-50 000+ | DB write-throughput, connection pool, LLM rate-limit | read-replica, connection pooler (PgBouncer/Neon pooler), LLM-kérés batch-elés, forrás-fetch worker horizontális szétosztása |

## 7.2 Forrás-fetch skálázás (Source Ingest Agent)

- **1 forrásnál**: egyetlen cron job, közvetlen fetch.
- **300+ forrásnál**: a `dispatch-ingest` cron **nem** fetch-el semmit közvetlenül, csak "kit kell most lekérdezni" döntést hoz (mely források esedékesek a saját frissülési gyakoriságuk alapján), és **eseményt bocsát ki forrásonként** a queue-ra. Maga a fetch N darab párhuzamos, egymástól izolált Inngest-function-invokációként fut, **forrás-kategóriánkénti concurrency-limittel** (pl. "egy adott domain-ről max 3 párhuzamos kérés", hogy ne provokáljunk rate-limitet/IP-tiltást).
- **Forrás-tier alapú ütemezés**: A-tier (élő eredmény, gyors változás) 1-2 percenként, B-tier 5-15 percenként, C-tier (heti blog) óránként/naponta — ez drasztikusan csökkenti a felesleges lekérdezések számát nagy forrásszámnál.

## 7.3 LLM-költség kontroll — modell-tiering

A legnagyobb költségtényező skálázáskor az LLM-hívások száma. Stratégia:

| Lépés | Modell-osztály | Indoklás |
|---|---|---|
| Dedup embedding | kis, gyors embedding modell | nagy volumen, olcsó kell |
| Fact extrakció (2.4) | gyors/olcsó, jó structured-output modell | nagy volumen (minden RawArticle-re fut), a feladat viszonylag mechanikus |
| Risk-előszűrés (kulcsszó/szabály) | **nem LLM** | determinisztikus szűrő végzi a durva szűrést, az LLM csak a határeseteket kapja |
| Magyar szövegezés (2.5) | erős, jó nyelvi minőségű modell | alacsonyabb volumen (Story-nkénti, nem RawArticle-nkénti), itt számít a végfelhasználói minőség |
| Önellenőrzés (NLI) | gyors/olcsó modell | mechanikus konzisztencia-ellenőrzés |
| SEO meta generálás | gyors/olcsó modell | rövid, sablonos kimenet |
| Social szöveg | gyors/olcsó modell, kis darabszám platformonként | rövid kimenet |

**Kulcs elv:** az LLM-hívások száma **Story-nkénti**, nem **RawArticle-nkénti** legyen, ahol csak lehet — a `corroboration`-típusú (pusztán megerősítő) új források **nem** generálnak új Writer-hívást (lásd [02-agents.md §2.3](./02-agents.md#23--story-merge-agent)), csak a `confidence_score` frissül olcsó, nem-LLM számítással. Ez a döntés önmagában nagyságrendekkel csökkenti a költséget nagy forrásszámnál, mert egy népszerű eseményről (pl. BL-döntő) akár 50+ forrás is írhat, de csak 1 Writer-hívás történik érdemi új infónként.

**Költségkövetés:** minden `agent_runs.llm_cost_usd` mezőbe kerül a tényleges token-alapú költség — a Monitoring Agent napi/heti bontásban jelenti (lásd [02-agents.md §2.9](./02-agents.md#29--monitoring--audit-agent)), és riaszt, ha a napi költség egy konfigurált küszöböt túllép (védelem "elszabaduló" LLM-hívás-lánc ellen).

## 7.4 Adatbázis skálázás

- **pgvector index**: induláskor `ivfflat` (egyszerűbb, kisebb adatmennyiségnél jó), 100+ forrás / nagy `RawArticle`-volumen felett átállás `hnsw` indexre (jobb pontosság/sebesség nagy adathalmazon).
- **Particionálás**: `raw_articles` és `story_versions` táblák időalapú particionálása (havi partíció) nagy skálán, hogy a régi adatok ne lassítsák a friss lekérdezéseket, és az archiválás/retention egyszerű legyen.
- **Connection pooling**: Neon beépített poolerje (vagy PgBouncer Supabase-en) kötelező már közepes skálától, mert a sok párhuzamos serverless function-invokáció (agentek + API route-ok) gyorsan kimerítheti a natív Postgres kapcsolatlimitet.
- **Olvasási terhelés leválasztása**: a publikus `/api/v1` olvasási forgalom (frontend) és az agent-írási forgalom külön connection pool / (nagy skálán) read-replica mögé kerül, hogy a publikus oldal sebessége ne függjön az ingest-terheléstől.

## 7.5 Queue/orchestráció skálázás

- **Inngest concurrency-limitek** több szinten: globális (teljes rendszer LLM-kvóta védelme), agent-típusonként (pl. "max 20 párhuzamos Fact Verification"), és forrás/story-szinten (lásd [03-event-flow.md §3.6](./03-event-flow.md#36-konzisztencia-és-idempotencia-garanciák)).
- **Dead-letter monitorozás**: nagy skálán elkerülhetetlen, hogy időnként egy-egy esemény véglegesen elbukjon (pl. tartósan elérhetetlen forrás) — ezeket a Monitoring Agent gyűjti, nem vesznek el nyomtalanul.
- **Batch-elhető lépések**: ha a volumen indokolja, a dedup embedding-generálás és a risk-előszűrés batch API-hívásokkal (ha az LLM-szolgáltató kínál batch endpointot) tovább csökkenthető költséggel/late­ncy trade-off mellett — ez a 100+ forrásos fázisban érdemes bevezetni, nem induláskor.

## 7.6 Story/nap-terhelés mint külön dimenzió (review-kiegészítés)

A [09-architecture-review.md §1](./09-architecture-review.md#1-skálázhatóság-100--10-000-storynap) rámutatott, hogy a fenti forrásszám-alapú fázisolás **nem egyenértékű** a Story/nap-terheléssel — sportesemények miatt a terhelés erősen tüskés (egy nagy torna napja 50-100×-os csúcsot hozhat pár perces ablakban). 10 000 Story/nap skálán a következő konkrét beavatkozások szükségesek, amik az eredeti tervből hiányoztak:

**Dedup ANN-keresés előszűrése.** A globális 72 órás embedding-ablak nagy Story/nap-terhelésnél százezres `RawArticle`-halmazzá nő, ami lassítja és pontatlanabbá teszi a vektorkeresést (más sportágak/események zaja). **Javítás:** a vektorkeresés előtt kötelező **metaadat-alapú előszűrés** (kategória + fő entitás egyezés), és csak az így leszűkített halmazon fut a drága ANN-keresés — ez nagyságrendekkel csökkenti a keresési teret és javítja a pontosságot.

**Extrakció-limitálás (a legnagyobb LLM-költségtényező javítása).** Lásd részletesen [02-agents.md §2.4](./02-agents.md#24--fact-verification-agent): teljes LLM-extrakció csak Story-nkénti első 3-5 független forrásra fut, a többi csak olcsó fingerprint-alapú megerősítést ad. Ez a **legnagyobb egyedi LLM-költségcsökkentő beavatkozás**, mert wire-service szindikációnál (egy esemény, 50+ forrás) az eredeti terv lineárisan skálázódó, indokolatlan költséget termelt volna.

**Debounce élő Story-knál.** Lásd [02-agents.md §2.5](./02-agents.md#25--hungarian-writer-agent): `is_developing=true` Story-knál 60-120 mp-es összegyűjtési ablak a Writer-újraírás előtt, hogy percenkénti mikro-frissítések ne váltsanak ki külön-külön LLM-hívást.

**Prompt caching.** A promptok statikus (rendszerutasítás, sémaleírás) és dinamikus (aktuális `Fact`-adatok) részét explicit szét kell választani a prompt-sablonokban ([05-repo-structure.md](./05-repo-structure.md) `prompts/` konvenció), a statikus részt LLM-szolgáltatói prompt-gyorsítótárazással (pl. Anthropic prompt caching) ellátva — nagy, ismétlődő system-prompt mellett ez jelentős, közvetlen költségcsökkentés minden agent LLM-hívásánál, extra architekturális komplexitás nélkül.

**CQRS read-model bevezetése.** Lásd [01-data-model.md §1.5.2](./01-data-model.md#152-story_read_model--cqrs-olvasási-projekció): a publikus olvasási forgalom egy denormalizált `story_read_model` projekcióból szolgál ki, leválasztva az agentek write-terheléséről — nagy Story/nap-terhelésnél ez akadályozza meg, hogy a sok olvasó (Story-nkénti oldalletöltés) versenyezzen az írási kapacitásért ugyanazon a táblákon.

## 7.7 Konkrét archiválási szabályok táblánként (review-kiegészítés)

A [09-architecture-review.md §6](./09-architecture-review.md#6-gyorsan-növekvő-táblák-particionálás-archiválás) alapján, kiegészítve a [01-data-model.md §1.7](./01-data-model.md#17-táblák-növekedése-és-archiválás-review-megjegyzés) rövid összefoglalóját:

| Tábla | Particionálás | Retention/archiválás | Indoklás |
|---|---|---|---|
| `agent_runs` | havi (a megmaradó vékony összegzésre) | **nem ez az elsődleges observability-tároló** — a nyers naplózás külön log-rendszerbe kerül ([06-deployment.md §6.8](./06-deployment.md#68-observability-stack-review-kiegészítés)) | 10 000 Story/nap × ~9 agent-lépés milliós sor/nap lenne, ami megölné az OLTP write-teljesítményt |
| `raw_articles` | havi | 12 hónap után hideg tárolóba (Blob/S3, tömörített JSON), csak metaadat+embedding-hivatkozás marad hot állapotban | a dedup-hoz csak a friss (72h) embedding kell aktívan kereshető állapotban |
| `facts` | havi | lezárt (`is_developing=false`, nincs frissítés N napja) Story-k `Fact`-jei archiválhatók | a végleges tudás úgyis a `StoryVersion.body_hu`/`structured_data`-ban van lefagyasztva |
| `story_versions` | havi | **nincs retention/törlés** — ez maga a publikált termék | örökre megőrzendő, csak a lekérdezési teljesítmény miatt particionált |
| `story_read_model` | nincs szükség (kis, denormalizált, mindig friss) | nincs | tisztán vetített állapot, nem történeti adat |

## 7.8 Mikor kell architektúrát váltani (nem csak paramétert hangolni)

| Jel | Beavatkozás |
|---|---|
| Dedup ANN-keresés > 500ms rendszeresen | dedikált vektor-adatbázis (pl. Pinecone/Qdrant) kiválasztása pgvector helyett |
| Egyetlen Postgres instance write-throughput szűk keresztmetszet marad pooling/particionálás után is | write-optimalizált tábla szétválasztás (pl. `raw_articles` külön adatbázis-instance-ra) |
| LLM-szolgáltató rate-limit rendszeresen blokkolja a pipeline-t csúcsidőben | több LLM-szolgáltató/modell közötti terheléselosztás a `packages/llm/model-router.ts`-ben (már az architektúra tervezi ezt a réteget, lásd [05-repo-structure.md](./05-repo-structure.md)) |

Ezek a küszöbök **nem** induláskori tervezési kényszerek — a rendszer 1 forrásnál és 300 forrásnál **ugyanazt az architektúrát** futtatja, csak a konfigurációs paraméterek (concurrency, index-típus, pooling) változnak fokozatosan, ahogy a mért terhelés indokolja.

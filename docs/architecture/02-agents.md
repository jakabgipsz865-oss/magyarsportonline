# 02 — AI Agent specifikáció

[← vissza az áttekintéshez](./README.md)

## 2.0 Közös agent-kontraktus

Minden agent **stateless, esemény-vezérelt függvény**, amely a következő kontraktust követi:

```
Agent(event: TypedEvent, ctx: { db, llm, logger }) → { writes: DBWrite[], emits: TypedEvent[] }
```

- **Nincs agent-agent közvetlen hívás.** Minden kommunikáció a queue-n (event bus) keresztül történik.
- **Minden futás naplózva van** az `agent_runs` táblába (bemenet/kimenet snapshot, időtartam, LLM-költség, siker/hiba) — ezt a Monitoring & Audit Agent fogyasztja, de maga az írás minden agent felelőssége (közös middleware-ben implementálva, nem duplikált kód).
- **Idempotencia**: minden agent úgy van megírva, hogy ugyanazon esemény kétszeri feldolgozása (queue at-least-once delivery esetén) ne okozzon duplikált Story-t vagy duplikált verziót — ezt egyedi kulcsokkal (pl. `(story_id, source_event_id)` unique constraint) biztosítjuk.
- **Retry policy**: 3 automatikus újrapróbálkozás exponenciális backoff-fal (LLM timeout, külső API hiba esetén), utána dead-letter queue + Monitoring riasztás.

---

## 2.1 Source Ingest Agent

**Felelősség:** külső források (RSS/API/engedélyezett scraper) lekérdezése, nyers tartalom normalizálása és `RawArticle`-ként való tárolása.

| | |
|---|---|
| **Trigger** | Ütemezett (cron) esemény forrásonként, gyakoriság a `Source.reliability_tier` és a forrás frissülési jellemzői alapján (pl. A-tier élő eredmény-forrás: 2 percenként; C-tier blog: óránként) |
| **Bemenet** | `Source` konfiguráció (`fetch_config`: endpoint, auth, parser típus) |
| **Folyamat** | 1) HTTP fetch (feed/API) → 2) parse & tisztítás (HTML-től, boilerplate-től) → 3) nyelv-detektálás → 4) URL-alapú dedup (ha `source_url` már létezik, skip) → 5) `RawArticle` insert `ingest_status='ingested'` |
| **Kimenet (DB)** | Új `RawArticle` sor |
| **Kimenet (esemény)** | `raw_article.ingested { raw_article_id, source_id }` |
| **Hibakezelés** | Forrás elérhetetlen → retry backoff-fal; N egymást követő hiba → `Source.is_active=false` javaslat + Monitoring riasztás ("forrás elhalt") |
| **AI-komponens** | Nincs LLM-hívás ebben az agentben (tisztán determinisztikus fetch/parse) — ezzel olcsó és gyors, a "drága" AI-lépések később jönnek, csak a ténylegesen releváns tartalmakra |
| **Jogi kapu** | Csak `Source.license_type` alapján engedélyezett forrásokat kérdez le; új forrás felvétele külön onboarding-folyamat (lásd [08-roadmap.md](./08-roadmap.md)), nem ennek az agentnek a feladata |

---

## 2.2 Deduplication Agent

**Felelősség:** eldönteni, hogy egy új `RawArticle` egy **teljesen új eseményt** ír-e le, vagy egy **már ismert Story-hoz** tartozik.

| | |
|---|---|
| **Trigger** | `raw_article.ingested` |
| **Bemenet** | `RawArticle` (cím + lead szöveg) |
| **Folyamat** | 1) Embedding generálás (cím+lead) → 2) pgvector ANN keresés a legutóbbi 72 órás `Story` embedding-index ellen (küszöb: cosine similarity ≥ 0.83) → 3) entitás-kinyerés (NER: csapat/játékos/dátum) gyors, olcsó modellel → 4) kereszt-validáció: embedding-találat **és** entitás-egyezés (azonos esemény, azonos dátum ±24h) együtt kell a biztos matcheléshez |
| **Döntési logika** | `similarity ≥ 0.90` **és** entitás-egyezés → `MATCH` (magas bizalom); `0.83–0.90` vagy csak részleges entitás-egyezés → `AMBIGUOUS`; `< 0.83` → `NEW_STORY` |
| **Kimenet (esemény)** | `story.candidate.identified { raw_article_id, match_type: NEW_STORY\|MATCH\|AMBIGUOUS, story_id?, candidates?: [{story_id, score}] }` |
| **AMBIGUOUS kezelése** | Nem blokkol — a Story Merge Agent a legmagasabb pontszámú jelöltet választja, de a `StorySource.contribution_type` `possible_duplicate`-ként jelöli, és a Monitoring Agent gyűjti a téves pozitív/negatív arányt kalibrációhoz |
| **Miért nem csak embedding** | Tisztán szemantikai hasonlóság összemoshatja pl. "Real Madrid győz A csapat ellen" és "Real Madrid győz B csapat ellen" híreket — az entitás-kereszt-validáció ezt kizárja |

---

## 2.3 Story Merge Agent

**Felelősség:** a Dedup Agent döntése alapján ténylegesen létrehozni egy új `Story`-t, vagy egy meglévőhöz csatolni az új forrást — **és eldönteni, hogy ez érdemi új infó-e**, ami újraírást igényel, vagy csak megerősítés.

| | |
|---|---|
| **Trigger** | `story.candidate.identified` |
| **Bemenet** | Dedup-döntés + `RawArticle` |
| **Folyamat (NEW_STORY)** | `Story` insert (`status=draft`, `confidence_score` kezdeti alacsony érték), `StorySource` link (`contribution_type=initial`), `slug` **még nem** generálódik itt (ezt a SEO Agent teszi meg, egyszer, az első publikáláskor) |
| **Folyamat (MATCH)** | `StorySource` link az meglévő Story-hoz; gyors diff: az új `RawArticle`-ból kinyert alap-tények (pontszám, dátum, állapot) különböznek-e a Story eddigi `Fact`-jeitől → ha igen: `contribution_type=new_info`, ha nem: `contribution_type=corroboration` |
| **Kimenet (esemény)** | `story.created { story_id }` **vagy** `story.merge.completed { story_id, update_type: new_info\|corroboration }` |
| **Downstream szabály** | Csak `story.created` és `update_type=new_info` esetén megy tovább a Fact Verification Agent-hez (teljes újra-feldolgozás); tiszta `corroboration` esetén csak a `confidence_score` frissül (súly nő), **nincs** újraírás — ez védi a rendszert a felesleges LLM-hívásoktól és a "megalapozatlan changelog-zajtól" |

---

## 2.4 Fact Verification Agent

**Felelősség:** a Story-hoz kapcsolt **összes** `RawArticle`-ből strukturált tényeket kinyerni, ezeket egymással kereszt-ellenőrizni, és a `confidence_score`/`risk_level` meghatározása.

| | |
|---|---|
| **Trigger** | `story.created` vagy `story.merge.completed(update_type=new_info)` |
| **Bemenet** | `Story` + hozzá kapcsolt összes `RawArticle` |
| **Folyamat** | 1) **Extrakció**: minden forrásból strukturált JSON (ki/mit/mikor/hol/eredmény/idézetek), function-calling/structured-output móddal, alacsony hőmérséklettel → `Fact` sorok → 2) **Kereszt-ellenőrzés**: azonos `fact_type`-ú tények forrásonkénti összevetése — egyezés → `corroboration_count++`; eltérés → `is_contradicted=true` flag mindkét tényen → 3) **Confidence Score** újraszámítása (lásd [01-data-model.md §1.4](./01-data-model.md#14--confidence-score--számítási-modell)) → 4) **Risk osztályozás**: szabályalapú kulcsszó/entitás-szűrő (sérülés súlyossága, haláleset, doppingvád, jogi ügy, "nem hivatalos" jelzők) **+** LLM-alapú finomabb kockázat-becslés kombinációja |
| **Kimenet (DB)** | `Fact` sorok, `Story.confidence_score`, `Story.risk_level` frissítve |
| **Kimenet (esemény)** | `story.facts.verified { story_id, confidence_score, risk_level, has_contradiction }` |
| **Kritikus szabály** | A Hungarian Writer Agent **soha nem** kapja meg a nyers forrásszöveget — csak a strukturált `Fact` készletet. Ez a fő védelem hallucináció és véletlen szó szerinti átvétel ellen (lásd [feasibility-analysis.md §3](../feasibility-analysis.md)) |

---

## 2.5 Hungarian Writer Agent

**Felelősség:** a strukturált `Fact`-készletből **eredeti, magyar nyelvű** Story-verzió (cím, lead, törzsszöveg) generálása — sosem fordítás.

| | |
|---|---|
| **Trigger** | `story.facts.verified` |
| **Bemenet** | `Story.Fact[]` (strukturált tények, **nem** nyers szöveg), előző `StoryVersion` (ha van, a "mi változott" changelog-hoz) |
| **Folyamat** | 1) **Generálás**: LLM prompt, ami kizárólag a megadott `Fact` JSON-t használhatja fel, explicit instrukcióval ("ne tegyél hozzá semmit, ami nincs a tények között") → cím, lead, törzs, `change_summary_hu` → 2) **Önellenőrzés (NLI/entailment)**: második, olcsóbb LLM-hívás, ami minden generált mondatot visszavet a `Fact`-készletre — ha egy állítás nincs alátámasztva, elutasítás és újragenerálás (max 2 retry), ha továbbra sem konzisztens → `pending_review` jelölés | 
| **Idézetek kezelése** | Szó szerinti idézet csak akkor kerülhet be, ha a `Fact.fact_type='quote'` tartalmazza az eredeti (angol) idézetet forrás-hivatkozással — a fordítás jelölve van idézőjelben, forrás feltüntetésével; az AI **nem generálhat** új, nem létező idézetet |
| **Kimenet (DB)** | Új `StoryVersion` (`version_number+1`, `fact_consistency_score`) |
| **Kimenet (esemény)** | `story.content.drafted { story_id, story_version_id, fact_consistency_score }` |
| **Modellválasztás** | Extrakció (2.4) és risk-előszűrés: gyors/olcsó modell; végső magyar szövegezés: erősebb modell (stílus, olvashatóság, szerkesztői minőség) — költségoptimalizált modell-tiering, lásd [07-scalability.md](./07-scalability.md) |

---

## 2.6 SEO Agent

**Felelősség:** a `StoryVersion` SEO-metaadatainak generálása: slug (csak első alkalommal), meta description, tag-ek, kategória, structured data.

| | |
|---|---|
| **Trigger** | `story.content.drafted` |
| **Bemenet** | `StoryVersion` (cím, lead, törzs) + `Story.entities` |
| **Folyamat** | 1) Ha `Story.slug` még nincs (első verzió): slug generálás címből (ékezet-eltávolítás, kisbetűsítés, ütközés-ellenőrzés `UNIQUE` constraint retry-jal) — **ezután soha nem változik** → 2) `meta_description` generálás (150–160 karakter limit) → 3) entitás-alapú `Tag`/`Category` hozzárendelés előre definiált taxonómiából → 4) `schema.org NewsArticle` + `SportsEvent` JSON-LD generálása (`dateModified` mindig friss verziónál frissül) |
| **Kimenet (DB)** | `StoryVersion.meta_description`, `.seo_tags`, `.structured_data`; `Story.slug` (csak első alkalommal), `Story.category_id`, `Story.tags[]` |
| **Kimenet (esemény)** | `story.seo.ready { story_id, story_version_id }` |

---

## 2.7 Publish Gate <a name="publish-gate"></a>

*(Nem önálló "agent" a felhasználó eredeti 8-as listájában, hanem egy explicit, auditálható döntési pont a Fact Verification Agent kimenete és a publikálás között — ide szándékosan nem LLM-et, hanem determinisztikus szabályt teszünk, hogy a publikálási döntés mindig megmagyarázható és tesztelhető legyen.)*

| | |
|---|---|
| **Trigger** | `story.seo.ready` |
| **Szabály** | `risk_level=low` **és** `confidence_score ≥ 0.65` **és** `has_contradiction=false` → **auto-publish** (`story.publish.approved`); minden más eset → `review_queue` (`story.publish.review_required`) |
| **Kimenet (DB)** | `Story.status='published'` + `StoryVersion.is_published=true`, vagy `ReviewQueueItem` létrehozása (`status='pending'`) |
| **Kimenet (esemény)** | `story.published { story_id, story_version_id }` **vagy** `story.review.requested { story_id, reason }` |
| **Admin jóváhagyás** | Az Admin Review UI-ból (`04-api-spec.md`) történő jóváhagyás ugyanazt a `story.published` eseményt váltja ki, `reviewed_by` mezővel |
| **Küszöbértékek** | Konfigurálhatók (feature-flag/config tábla), nem hardcode-olva — a bevezetési fázisban (lásd [08-roadmap.md](./08-roadmap.md)) szigorúbban indul, majd mért hibaarány alapján lazul |

---

## 2.8 Social Media Agent

**Felelősség:** publikált (vagy érdemben frissült) Story-khoz platform-specifikus közösségi poszt generálása és kiküldése.

| | |
|---|---|
| **Trigger** | `story.published` **vagy** `story.updated.published` (csak `change_summary_hu` alapján "jelentősnek" minősített frissítés — apró pontosítás nem generál új posztot) |
| **Bemenet** | `StoryVersion` (cím, lead), `Story.entities` (hashtag-ekhez) |
| **Folyamat** | Platformonként külön LLM-hívás (rövidebb, platform-hangvételű szöveg: FB/Threads hosszabb, X rövidebb+hashtag) → kép/kártya kiválasztás vagy generálás → Meta Graph API / X API hívás → `SocialPost` mentése `external_post_id`-vel |
| **Kimenet (DB)** | `SocialPost` sorok platformonként |
| **Kimenet (esemény)** | `social.posted { story_id, platform, external_post_id }` |
| **Retrakció kezelése** | Ha egy `Story` állapota `retracted`-re vált, ez az agent (retrakciós eseményre feliratkozva) megkísérli törölni/szerkeszteni a korábbi posztokat, ahol a platform API ezt engedi, és minden esetben logolja, ha nem sikerült (Monitoring riasztás — "retrakció közösségi médiában nem teljes") |
| **Rate limit kezelés** | Platformonkénti queue + throttling, API-tier korlátok figyelembevételével (lásd [feasibility-analysis.md §8](../feasibility-analysis.md)) |

---

## 2.9 Monitoring & Audit Agent

**Felelősség:** a teljes rendszer megfigyelése, minden esemény auditálása, anomáliák észlelése, riasztás.

| | |
|---|---|
| **Trigger** | **Minden** eseményre feliratkozik (wildcard subscriber) + ütemezett health-check job (pl. 10 percenként) |
| **Folyamat** | 1) Minden beérkező eseményt/`agent_run`-t naplóz (időtartam, LLM-token/költség, siker/hiba) → 2) Anomália-detekció: forrás X óra óta nem publikált (`Source.last_fetched_at` elavult), dedup false-positive-rate hirtelen emelkedés, `risk_level=high` sztorik szokatlan gyakorisága, review queue torlódás (`pending` elemek száma/kora küszöb felett), LLM-hiba/timeout arány emelkedés → 3) Riasztás küldése (Slack/e-mail) → 4) Napi/heti összegző jelentés (publikált sztorik száma, átlagos confidence score, elutasítási arány, költség) |
| **Kimenet** | Riasztások, dashboard-adat (Admin UI-ban megjelenítve), napi jelentés |
| **Kill-switch** | Az agent felelős a globális "vészleállító" flag figyeléséért is — ha `system_config.kill_switch=true`, egyetlen agent sem dolgoz fel új eseményt (csak a queue-ban gyűlnek), amíg emberi feloldás nem történik |
| **Nem publikál, nem generál tartalmat** | Ez az egyetlen agent, aminek **nincs** írási joga a `Story`/`StoryVersion` táblákra — tisztán megfigyelő és riasztó szerepkör, hogy a megfigyelés sose keveredhessen a tartalom-előállítással |

---

## 2.10 Agent-mátrix összefoglaló

| Agent | LLM-hívás | Írja | Fő kockázat, amit kezel |
|---|---|---|---|
| Source Ingest | ❌ | `raw_articles` | forrás-elérhetőség, jogi engedélyezettség |
| Deduplication | embedding (nem generatív) | `raw_articles.story_id` (draft) | duplikált publikálás |
| Story Merge | ❌ (szabályalapú diff) | `stories`, `story_sources` | felesleges újraírás, story-szétforgácsolódás |
| Fact Verification | ✅ extrakció + risk | `facts`, `stories.confidence_score/risk_level` | hallucináció, ellentmondó források |
| Hungarian Writer | ✅ generálás + önellenőrzés | `story_versions` | fordítás vs. eredeti tartalom, hallucináció |
| SEO | ✅ (könnyű) | `story_versions` SEO mezők, `stories.slug` | SEO-minőség, duplicate content |
| Publish Gate | ❌ (determinisztikus szabály) | `stories.status`, `review_queue_items` | felelőtlen auto-publikálás |
| Social Media | ✅ platform-szöveg | `social_posts` | téves/retrakciós tartalom közösségi médiában |
| Monitoring & Audit | opcionális (anomália-magyarázat) | `agent_runs`, riasztások | néma hibák, rendszer-szintű kockázat |

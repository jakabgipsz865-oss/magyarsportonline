# 01 — Story-alapú adatmodell

[← vissza az áttekintéshez](./README.md)

## 1.1 Alapkoncepció

A hagyományos hírportál adatmodellje `Article`-központú: minden begyűjtött hír egy új sor egy `articles` táblában. Ez a modell **nem alkalmas** a kért viselkedésre ("ugyanazt a Story-t frissítse, ne hozzon létre új cikket"), mert nincs benne fogalom az "ugyanarról az eseményről szóló, időben bővülő tudás"-ra.

Ehelyett a rendszer középpontjában a **`Story`** áll:

- Egy **`Story`** egy valós, azonosítható sportesemény vagy hír-téma (pl. "Ferencváros–Real Madrid 2026.08.14. BL selejtező", "Szoboszlai Dominik térdsérülése — 2026.07", "X játékos igazolása Y klubhoz").
- Egy Story-hoz **N darab `RawArticle`** tartozhat (a nyers, begyűjtött forrás-cikkek).
- Egy Story-nak **N darab `StoryVersion`** verziója van — minden érdemi frissítés új verziót hoz létre, a `slug` és az azonosító változatlan marad.
- A publikált weboldal mindig a Story **aktuális (legutolsó, publikált) verzióját** mutatja, de a teljes verziótörténet lekérdezhető ("Frissítések" szekció a cikk alján).

## 1.2 Entitás-Reláció diagram

```mermaid
erDiagram
    SOURCE ||--o{ RAW_ARTICLE : "publikálja"
    STORY ||--o{ STORY_SOURCE : "hivatkozik"
    RAW_ARTICLE ||--o{ STORY_SOURCE : "hozzájárul"
    STORY ||--o{ STORY_VERSION : "verziói"
    STORY ||--o{ STORY_ENTITY : "érinti"
    ENTITY ||--o{ STORY_ENTITY : "szerepel"
    STORY ||--o{ STORY_TAG : "címkézve"
    TAG ||--o{ STORY_TAG : ""
    STORY }o--|| CATEGORY : "kategória"
    STORY ||--o{ FACT : "ténykészlet"
    RAW_ARTICLE ||--o{ FACT : "forrása"
    STORY ||--o{ REVIEW_QUEUE_ITEM : "review"
    STORY ||--o{ SOCIAL_POST : "posztok"
    STORY ||--o{ AGENT_RUN : "agent futások"
    STORY_VERSION ||--o{ AGENT_RUN : "létrehozta"

    SOURCE {
        uuid id PK
        text name
        text base_url
        text type "rss|api|scraper"
        text language
        text license_type "public_rss|licensed_api|scrape_allowed"
        text reliability_tier "A|B|C"
        jsonb fetch_config
        boolean is_active
        timestamptz onboarded_at
        timestamptz last_fetched_at
        text last_fetch_status
    }

    RAW_ARTICLE {
        uuid id PK
        uuid source_id FK
        text source_url UK
        text title_original
        text body_original
        text language
        vector embedding
        jsonb extracted_entities
        text ingest_status "ingested|deduped|merged|error"
        uuid story_id FK "nullable, resolved by Dedup/Merge"
        timestamptz published_at_source
        timestamptz ingested_at
    }

    STORY {
        uuid id PK
        text slug UK "első verziónál generálva, változatlan"
        text canonical_title
        text status "draft|fact_checked|written|seo_ready|pending_review|published|updated|retracted"
        text risk_level "low|medium|high"
        numeric confidence_score "0.00-1.00"
        uuid category_id FK
        uuid current_version_id FK
        int version_count
        timestamptz first_seen_at
        timestamptz last_updated_at
        timestamptz published_at
        boolean is_developing "élő, még alakuló sztori"
    }

    STORY_SOURCE {
        uuid id PK
        uuid story_id FK
        uuid raw_article_id FK
        text contribution_type "initial|corroboration|new_info|contradiction"
        timestamptz linked_at
    }

    STORY_VERSION {
        uuid id PK
        uuid story_id FK
        int version_number
        text title_hu
        text lead_hu
        text body_hu
        text meta_description
        jsonb seo_tags
        jsonb structured_data "schema.org NewsArticle"
        text change_summary_hu "mi változott ehhez képest"
        text generated_by_model
        text prompt_version
        numeric fact_consistency_score
        boolean is_published
        timestamptz created_at
    }

    FACT {
        uuid id PK
        uuid story_id FK
        uuid raw_article_id FK "melyik forrásból származik"
        text fact_type "score|quote|injury_status|transfer_status|event_time|other"
        jsonb payload
        int corroboration_count
        boolean is_contradicted
        timestamptz extracted_at
    }

    ENTITY {
        uuid id PK
        text type "player|team|competition|league|venue"
        text name_canonical
        text name_hu
        jsonb aliases
        text external_ref "pl. Sportradar ID"
    }

    STORY_ENTITY {
        uuid id PK
        uuid story_id FK
        uuid entity_id FK
        text role "subject|opponent|mentioned"
    }

    CATEGORY {
        uuid id PK
        text slug UK
        text name_hu
        uuid parent_id FK "önhivatkozás, pl. Labdarúgás > NB I"
    }

    TAG {
        uuid id PK
        text slug UK
        text name_hu
    }

    STORY_TAG {
        uuid story_id FK
        uuid tag_id FK
    }

    REVIEW_QUEUE_ITEM {
        uuid id PK
        uuid story_id FK
        uuid story_version_id FK
        text reason "high_risk|contradiction|low_confidence|manual_flag"
        text status "pending|approved|rejected|edited"
        uuid reviewed_by "nullable, admin user id"
        text review_note
        timestamptz created_at
        timestamptz resolved_at
    }

    SOCIAL_POST {
        uuid id PK
        uuid story_id FK
        uuid story_version_id FK
        text platform "facebook|threads|x"
        text external_post_id
        text post_text
        text status "queued|posted|failed|retracted"
        timestamptz posted_at
    }

    AGENT_RUN {
        uuid id PK
        text agent_name
        uuid story_id FK "nullable"
        uuid raw_article_id FK "nullable"
        text trigger_event
        text status "success|error|skipped"
        jsonb input_snapshot
        jsonb output_snapshot
        int duration_ms
        numeric llm_cost_usd
        text error_message
        timestamptz started_at
        timestamptz finished_at
    }
```

## 1.3 Story állapotgép

```mermaid
stateDiagram-v2
    [*] --> draft: Story Merge Agent létrehozza
    draft --> fact_checked: Fact Verification Agent lezajlott
    fact_checked --> written: Hungarian Writer Agent generált
    written --> seo_ready: SEO Agent kiegészítette
    seo_ready --> published: Publish Gate — alacsony kockázat
    seo_ready --> pending_review: Publish Gate — magas kockázat / alacsony confidence
    pending_review --> published: admin jóváhagyás
    pending_review --> draft: admin elutasítás — újrafeldolgozás
    published --> updated: új forrás/infó — új StoryVersion
    updated --> published: automatikusan (alacsony kockázatú frissítés)
    updated --> pending_review: magas kockázatú frissítés
    published --> retracted: admin döntés (téves hír)
    updated --> retracted: admin döntés
```

**Fontos tervezési döntés:** a `published` és `updated` állapotok **nem eltűnő, hanem visszatérő** ("published ⇄ updated") ciklust alkotnak — egy Story a teljes életciklusa alatt (akár napokig, egy fejlődő sztori esetén órákig) többször is átfuthat a `updated → (Publish Gate) → published` körön, minden körben új `StoryVersion`-t generálva.

## 1.4 Confidence Score — számítási modell

A `Story.confidence_score` (0.00–1.00) egy súlyozott összetett mutató, amit a **Fact Verification Agent** számol újra minden alkalommal, amikor a Story-hoz új forrás kapcsolódik vagy új tény kerül kinyerésre:

```
confidence_score =
      0.35 * source_corroboration_score   (hány független, megbízható forrás erősíti meg)
    + 0.25 * source_reliability_score     (a hozzájáruló források reliability_tier átlaga, súlyozva)
    + 0.25 * fact_consistency_score       (van-e ellentmondás a kinyert tények között)
    + 0.15 * recency_score                (mennyire friss / mennyire "élő" még a sztori)
```

- **source_corroboration_score**: 1 forrás → 0.3; 2 független forrás → 0.6; 3+ független forrás → 0.9-1.0. (Ugyanazon hírügynökségi tartalom több portálon **nem** számít független forrásnak — ezt az `Entity`+szövegfingerprint alapján a Dedup Agent jelöli.)
- **source_reliability_score**: `Source.reliability_tier` (A/B/C) numerikus leképezése, hozzájáruló források súlyozott átlaga.
- **fact_consistency_score**: a Fact Verification Agent NLI-alapú ellentmondás-keresésének eredménye (1.0 = nincs ellentmondás, csökken minden észlelt kontradikcióval).
- **recency_score**: friss, fejlődő sztoriknál (`is_developing = true`) alacsonyabb súlyt kap, amíg nem stabilizálódik.

A `confidence_score` **közvetlenül vezérli a Publish Gate döntést** (lásd [02-agents.md](./02-agents.md#publish-gate)).

## 1.5 Verziókövetés és frissítési előzmény

- Minden `StoryVersion` **immutábilis** — sosem módosul utólag, csak új verzió jön létre.
- A `Story.current_version_id` mindig a legutolsó **publikált** verzióra mutat (nem feltétlenül a legutolsó legenerált verzióra, ha az épp review-ban van).
- A publikus frontend a Story oldalán megjeleníti: "Frissítve: 2026.07.27 14:32 — *mit változott*" szekciót, ami a `StoryVersion.change_summary_hu` mezőből épül fel (ezt a Hungarian Writer Agent generálja minden frissítésnél: "mi az, ami új ehhez a korábbi verzióhoz képest").
- Az URL/`slug` **soha nem változik** verziófrissítéskor — ez SEO- és linkstabilitási követelmény.

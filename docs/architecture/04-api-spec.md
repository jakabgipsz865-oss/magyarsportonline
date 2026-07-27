# 04 — API specifikáció

[← vissza az áttekintéshez](./README.md)

Az API három rétegre tagolódik, eltérő auth- és stabilitási garanciákkal:

1. **Publikus API** (`/api/v1/*`) — a Next.js frontend és jövőbeli külső integrációk (pl. saját mobilapp) számára, olvasás-orientált, cache-elhető.
2. **Admin API** (`/api/admin/*`) — a Review UI számára, session-alapú auth, írási jogokkal a review-folyamatban.
3. **Belső agent-API** (`/api/internal/*`) — az Inngest által hívott webhook-végpontok, amik ténylegesen futtatják az agent-logikát; szolgáltatás-kulcsos auth, nem publikus.

## 4.1 Publikus API — `/api/v1`

### `GET /api/v1/stories`
Publikált Story-k listázása.

**Query paraméterek:** `category`, `tag`, `entity` (pl. csapat slug), `page`, `limit` (max 50), `sort=recent|updated`

**Válasz `200`:**
```json
{
  "data": [
    {
      "id": "uuid",
      "slug": "ferencvaros-real-madrid-bl-selejtezo-2026",
      "title": "...",
      "lead": "...",
      "category": { "slug": "labdarugas-bl", "name": "Bajnokok Ligája" },
      "tags": ["Ferencváros", "Real Madrid"],
      "confidence_score": 0.91,
      "is_developing": false,
      "published_at": "2026-07-27T12:00:00Z",
      "last_updated_at": "2026-07-27T14:32:00Z",
      "version_count": 3
    }
  ],
  "meta": { "page": 1, "limit": 20, "total": 143 }
}
```

### `GET /api/v1/stories/{slug}`
Egy Story teljes, aktuális (publikált) verziója + metaadatok.

**Válasz `200`:**
```json
{
  "id": "uuid",
  "slug": "...",
  "title": "...",
  "lead": "...",
  "body_html": "...",
  "meta_description": "...",
  "structured_data": { "@type": "NewsArticle", "...": "..." },
  "confidence_score": 0.91,
  "sources": [
    { "name": "BBC Sport", "url": "https://...", "first_seen_at": "..." },
    { "name": "Sky Sports", "url": "https://...", "first_seen_at": "..." }
  ],
  "entities": [{ "type": "team", "name": "Ferencváros" }],
  "version_history": [
    { "version_number": 1, "created_at": "...", "change_summary": "Kezdeti hír a mérkőzés hírei alapján." },
    { "version_number": 2, "created_at": "...", "change_summary": "Megerősítést nyert a kezdőcsapat." }
  ]
}
```
`404` ha nincs publikált verzió ehhez a slughoz (draft/review állapotú Story-k nem érhetők el publikusan).

### `GET /api/v1/stories/{slug}/history`
Teljes verziótörténet, minden `StoryVersion` tartalmával (a "korábbi állapot megtekintése" funkcióhoz).

### `GET /api/v1/categories`, `GET /api/v1/tags`, `GET /api/v1/entities/{slug}`
Taxonómia-lekérdezések, entitás-oldalak (pl. "Ferencváros összes híre") kiszolgálásához.

### `GET /api/v1/sitemap.xml`, `GET /api/v1/feed.xml`
SEO és RSS-disztribúció.

**Cache-stratégia:** minden `GET /api/v1/*` végpont Vercel ISR/Edge Cache mögött, `story/published` eseményre on-demand revalidate hívással (lásd [06-deployment.md](./06-deployment.md)).

---

## 4.2 Admin API — `/api/admin` *(session-auth, NextAuth)*

### `GET /api/admin/review-queue`
Függőben lévő review-elemek listázása (`status=pending`), `risk_level`/`reason` szerint szűrhető.

### `GET /api/admin/review-queue/{id}`
Egy review-elem részletei: a generált `StoryVersion`, a kapcsolódó `Fact`-ek, kontradikciók, forráslista, confidence score bontása.

### `POST /api/admin/review-queue/{id}/approve`
```json
{ "reviewer_note": "opcionális megjegyzés" }
```
→ `story/review.resolved(decision=approved)` esemény kibocsátása, Story publikálása.

### `POST /api/admin/review-queue/{id}/reject`
```json
{ "reviewer_note": "kötelező indoklás" }
```
→ Story visszakerül `draft` állapotba, nem publikálódik.

### `PATCH /api/admin/review-queue/{id}/edit`
Emberi szerkesztés a generált szövegen review közben (mentés új, `is_published=false` verzióként, amit utána lehet jóváhagyni).

### `POST /api/admin/stories/{id}/retract`
```json
{ "reason": "..." }
```
→ `story/retracted` esemény, `Story.status=retracted`, publikus oldalon "Visszavont hír" jelölés, Social Media Agent törlési kísérlet.

### `GET /api/admin/sources`, `POST /api/admin/sources`, `PATCH /api/admin/sources/{id}`
Forráskezelés: új forrás felvétele (`is_active=false` alapból, amíg jogi/technikai review nem történik), aktiválás/deaktiválás.

### `GET /api/admin/dashboard`
Monitoring & Audit Agent által gyűjtött metrikák: publikálási ráta, átlagos confidence, review-queue mérete/kora, LLM-költség, forrás-egészség.

### `POST /api/admin/system/kill-switch`
```json
{ "enabled": true, "reason": "..." }
```
Globális vészleállító (lásd [02-agents.md §2.9](./02-agents.md#29--monitoring--audit-agent)).

---

## 4.3 Belső agent-API — `/api/internal` *(service-token auth, csak Inngest hívja)*

Ez a réteg **nem publikus és nem "üzleti" API** — ezek azok a HTTP endpointok, amiket az Inngest SDK regisztrál és hív meg lépésenként. Egyetlen fő belépési pont:

### `POST /api/inngest`
Az Inngest SDK catch-all route-ja (Next.js API route), ami minden regisztrált agent-függvényt (`sourceIngestAgent`, `deduplicationAgent`, `storyMergeAgent`, `factVerificationAgent`, `hungarianWriterAgent`, `seoAgent`, `publishGate`, `socialMediaAgent`, `monitoringAgent`) tartalmazza step-orchestrációval. Auth: Inngest signing key (env var), nem session-alapú.

**Miért nem külön REST-endpoint agentenként:** az Inngest (és Trigger.dev) modellje a *function-as-event-handler* mintát követi — a "kommunikáció" az esemény-katalógusban ([03-event-flow.md](./03-event-flow.md)) definiált, nem HTTP route-okban. Ez leegyszerűsíti a deployment felületét (egyetlen webhook route), miközben az agent-logika teljesen modulárisan, külön fájlokban/csomagokban él (lásd [05-repo-structure.md](./05-repo-structure.md)).

### Cron-trigger végpontok
### `POST /api/internal/cron/ingest/{sourceId}`
Vercel Cron hívja forrásonként (vagy egy gyűjtő cron, ami az aktív forrásokat lekérdezi és Inngest eseményt bocsát ki mindegyikre) — ez indítja el a `source/article.ingested` láncot. Service-token védett, csak Vercel Cron user-agent + secret header engedélyezett.

---

## 4.4 Hitelesítés összefoglaló

| Réteg | Auth | Írás/olvasás |
|---|---|---|
| `/api/v1/*` | nincs (publikus) | csak olvasás |
| `/api/admin/*` | NextAuth session + role=`editor`/`admin` | olvasás + korlátozott írás (review-döntések) |
| `/api/internal/*`, `/api/inngest` | service token / Inngest signing key | agent-írások, nem emberi hozzáférés |

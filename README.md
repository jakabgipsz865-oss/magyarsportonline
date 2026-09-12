# magyarsportonline.hu

AI-first, Story-alapú sporthír-platform — event-driven, AI Agent-vezérelt architektúra.

## Dokumentáció

- [`docs/feasibility-analysis.md`](docs/feasibility-analysis.md) — megvalósíthatósági elemzés
- [`docs/architecture/`](docs/architecture/) — teljes rendszerarchitektúra (adatmodell, AI Agentek, event-flow, API-spec, repo-struktúra, deployment, skálázás, roadmap, architecture review)

A fejlesztési munka a [`docs/architecture/08-roadmap.md`](docs/architecture/08-roadmap.md)-ban rögzített fázisolt roadmapet követi. Jelenlegi fázis állapotát lásd a roadmap dokumentumban és a nyitott Pull Requestekben.

**V1 állapot:** a teljes end-to-end pipeline (RSS forrás → Story → magyar AI-összefoglaló → tárolás → publikálás → ugyanazon esemény új forrásból történő frissítés → confidence score növelés → verziótörténet/timeline) implementálva van — lásd [`docs/adr/0005-mvp-end-to-end-scope-cuts.md`](docs/adr/0005-mvp-end-to-end-scope-cuts.md) a tudatos hatókör-szűkítésekért (pl. Inngest helyett in-process event dispatcher).

A V1 ezen felül tartalmazza:

- **Admin/review felület** — `/admin/review` (HTTP Basic auth, `ADMIN_SECRET` env): a Publish Gate által visszatartott Story-k kézi jóváhagyása/elutasítása;
- **Kétlépcsős production AI** — a Fact Extraction és Self Check Cloudflare Workers AI-t használ, a Final Hungarian Writer pedig a `gemini-3.5-flash-lite` modellt hívja a Cloudflare AI Gatewayen keresztül. A hívásokat kvóta, napi alkalmazásoldali limit és fail-closed várakoztatás védi; a `none` passthrough csak explicit helyi tesztmód;
- **Ütemezett ingest** — külön Cloudflare scheduler Worker hívja percenként a web Worker hitelesített ingest- és jobfeldolgozó végpontjait;
- **SEO** — canonical URL-ek, OpenGraph, schema.org NewsArticle JSON-LD, `sitemap.xml`, `robots.txt`, publikus RSS feed (`/rss.xml`);
- **Alapvédelem** — per-IP rate limit a publikus API-n, HTML-escape a Story-törzsön, prompt-injection heurisztika (gyanú esetén review queue), retry/backoff az RSS-fetch-en.

## Monorepo struktúra

Lásd [`docs/architecture/05-repo-structure.md`](docs/architecture/05-repo-structure.md). Rövid áttekintés:

```
apps/web         — Next.js frontend (publikus oldalak, API route-ok, cron-belépési pont)
packages/config   — megosztott TypeScript/ESLint/Prettier presetek
packages/shared   — megosztott típusok és konstansok
packages/events   — event-contract (Zod sémák) + in-process dispatcher
packages/db       — adatbázis-séma (Drizzle ORM), repository-réteg, dev seed script
packages/llm      — LLM kliens-absztrakció (Cloudflare Workers AI + Gemini free-tier + Anthropic SDK, provider-fallback)
packages/observability — strukturált logolási határ (nem OLTP-be ír)
packages/agents   — a 8 AI Agent + a story_read_model projector
```

## Fejlesztői környezet

Lásd [`CONTRIBUTING.md`](CONTRIBUTING.md).

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

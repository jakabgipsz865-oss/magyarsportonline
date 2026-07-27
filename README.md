# magyarsportonline.hu

AI-first, Story-alapú sporthír-platform — event-driven, AI Agent-vezérelt architektúra.

## Dokumentáció

- [`docs/feasibility-analysis.md`](docs/feasibility-analysis.md) — megvalósíthatósági elemzés
- [`docs/architecture/`](docs/architecture/) — teljes rendszerarchitektúra (adatmodell, AI Agentek, event-flow, API-spec, repo-struktúra, deployment, skálázás, roadmap, architecture review)

A fejlesztési munka a [`docs/architecture/08-roadmap.md`](docs/architecture/08-roadmap.md)-ban rögzített fázisolt roadmapet követi. Jelenlegi fázis állapotát lásd a roadmap dokumentumban és a nyitott Pull Requestekben.

**MVP állapot:** a teljes end-to-end pipeline (RSS forrás → Story → magyar AI-összefoglaló → tárolás → publikálás → ugyanazon esemény új forrásból történő frissítés → confidence score növelés → verziótörténet/timeline) implementálva van — lásd [`docs/adr/0005-mvp-end-to-end-scope-cuts.md`](docs/adr/0005-mvp-end-to-end-scope-cuts.md) a tudatos hatókör-szűkítésekért (pl. Inngest helyett in-process event dispatcher).

## Monorepo struktúra

Lásd [`docs/architecture/05-repo-structure.md`](docs/architecture/05-repo-structure.md). Rövid áttekintés:

```
apps/web         — Next.js frontend (publikus oldalak, API route-ok, cron-belépési pont)
packages/config   — megosztott TypeScript/ESLint/Prettier presetek
packages/shared   — megosztott típusok és konstansok
packages/events   — event-contract (Zod sémák) + in-process dispatcher
packages/db       — adatbázis-séma (Drizzle ORM), repository-réteg, dev seed script
packages/llm      — Anthropic SDK kliens-absztrakció
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

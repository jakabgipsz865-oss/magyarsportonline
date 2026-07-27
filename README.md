# magyarsportonline.hu

AI-first, Story-alapú sporthír-platform — event-driven, AI Agent-vezérelt architektúra.

## Dokumentáció

- [`docs/feasibility-analysis.md`](docs/feasibility-analysis.md) — megvalósíthatósági elemzés
- [`docs/architecture/`](docs/architecture/) — teljes rendszerarchitektúra (adatmodell, AI Agentek, event-flow, API-spec, repo-struktúra, deployment, skálázás, roadmap, architecture review)

A fejlesztési munka a [`docs/architecture/08-roadmap.md`](docs/architecture/08-roadmap.md)-ban rögzített fázisolt roadmapet követi. Jelenlegi fázis állapotát lásd a roadmap dokumentumban és a nyitott Pull Requestekben.

## Monorepo struktúra

Lásd [`docs/architecture/05-repo-structure.md`](docs/architecture/05-repo-structure.md). Rövid áttekintés:

```
apps/web        — Next.js frontend (publikus oldalak, admin UI, API route-ok)
packages/config  — megosztott TypeScript/ESLint/Prettier presetek
packages/shared  — megosztott típusok és konstansok
packages/events  — event-contract (Zod sémák az esemény-katalógushoz)
packages/db      — adatbázis-séma (Drizzle ORM) és repository-réteg
packages/observability — strukturált logolási határ (nem OLTP-be ír)
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

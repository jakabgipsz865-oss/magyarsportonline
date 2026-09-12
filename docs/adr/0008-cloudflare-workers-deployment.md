# ADR 0008: Cloudflare Workers deployment with the existing PostgreSQL database

**Status:** Accepted — supersedes ADR 0007 for deployment orchestration
**Date:** 2026-09-12

## Decision

The Next.js application is packaged with OpenNext and deployed to Cloudflare Workers. The existing PostgreSQL database remains authoritative and is accessed through a `HYPERDRIVE` binding. D1 is not part of this migration.

Database migrations are an explicit, serialized deployment step. `next build` no longer mutates a database, and the production homepage renders dynamically so a Worker artifact can be built without production database credentials.

The separate scheduler Worker calls the canonical `SITE_URL` with the shared `CRON_SECRET`; it no longer contains a Vercel deployment URL.

Production AI is split by task: Cloudflare Workers AI performs fact extraction and self-check, while the Final Hungarian Writer uses Google Gemini through an authenticated Cloudflare AI Gateway. The Worker sends the Google API key in `x-goog-api-key` and the gateway token in `cf-aig-authorization`; neither credential is committed to the repository.

## Consequences

- Node.js 22 is the repository and CI baseline.
- The web Worker requires a Hyperdrive configuration ID in `apps/web/wrangler.jsonc` before database-backed production traffic is enabled.
- GitHub's production environment holds `DATABASE_URL`, `CRON_SECRET`, `CLOUDFLARE_ACCOUNT_ID`, the deployment token, a Workers AI token, the Gemini API key, and the AI Gateway token.
- R2 incremental caching can be enabled later. Until then, the homepage is request-rendered and article pages retain their existing on-demand generation behavior.
- DNS cutover happens only after the Worker preview passes database and scheduler smoke tests.

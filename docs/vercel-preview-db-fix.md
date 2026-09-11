# MSO Preview DB configuration fix — 2026-09-11

## Result

Preview redeployment Ready: https://vercel.com/gipsz-jakab-team/magyarsportonline-web/8zW89MWoEA5TXDviHCZAHNj87GFS

Commit: `1ea350da7671312e469d9d3f163799f19dfebc02`, branch `codex/tabloid-sources-remote-images`. This redeploy uses the exact previously failing code. Local editorial-calibration changes were not deployed.

## Verified targets and completed changes

- Neon user `jakabgipsz865`, organization/project `magyarsportonline`, Free plan; project `wild-lake-68761162`.
- Created `vercel-preview` / `br-flat-sun-a25d40c9` from the current production branch `clean-prod-20260829` / `br-broad-mountain-a2de1tqm`, with data and schema, auto-delete Never.
- New isolated database: `neondb`. Its endpoint was checked to differ from the previously verified Production endpoint before use. Credentials are intentionally absent from this report.
- Vercel user `jakabgipsz865-8537`, team `GipszJakabTeam` (Hobby), project `magyarsportonline-web`.
- Added a new secret `DATABASE_URL` scoped ONLY to Preview. The existing Production variable remained separately listed, with its original Updated Aug 29 timestamp.
- Redeployed only the failed Preview deployment, without existing build cache. No Production redeploy was requested.

## Validation

| Check | Result | Evidence |
| --- | --- | --- |
| db:migrate | PASS | Build log: migrations applied successfully; Next.js build continued |
| Compilation | PASS | Compiled successfully |
| Typecheck/lint build step | PASS | Linting and checking validity of types completed; page generation continued |
| Build | PASS | 29/29 static pages generated; deployment Ready |
| Runtime homepage | PASS | Preview renders Friss futballbulvárhírek and expected empty-feed state |
| Runtime category | PASS | /kategoria/labdarugas renders Labdarúgás |
| Runtime DB-backed API | PASS | /api/v1/stories returns {"data":[],"meta":{"page":1,"limit":20}} in the authenticated Safari session |

Smoke origin: https://magyarsportonline-lyyk0pb2b-gipsz-jakab-team.vercel.app

The original failure was missing Preview DATABASE_URL, before any database connection. No code or schema changes were needed to fix it. The existing migration runner remains fail-loud.

## Production isolation and stop state

All database connection configuration and the single redeploy in this work targeted Preview. No SQL write, migration command, branch reset, or configuration mutation was directed to production, clean-prod-20260829, or legacy-prod-20260829. Production DATABASE_URL was not read, revealed, edited, or copied. Evidence covers the operations performed in this session, not an audit of unrelated concurrent clients.

Corporate Worker account 7a225d650d7e05daba6355e5526a8fb9, magyarsportonline-ingest-scheduler production settings: No cron triggers configured. No scheduler modifications were made.

No source activation or RSS ingestion was performed. No writer/process/generation/publish endpoint was invoked. TABLOID_AUTO_PUBLISH remains default false in this commit, with no override added. Gemini calls by this work: 0. The temporary Preview credential file was removed after configuration. STOP as requested.

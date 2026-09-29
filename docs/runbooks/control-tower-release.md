# Coordinated control-tower release — PR #143

Production is unchanged. Deploy and activation each require the owner's explicit instruction.
Primary Writer stays `gemini-3.5-flash-lite`. Development and Preview use no paid AI.

## Real numeric regression and saved-draft recovery

The authenticated cohort is the original 2026-09-28 20:20:00.573–2026-09-29
20:20:00.573 UTC audit: 124 saved source/draft pairs. The committed manifest records
every Story ID, original A/B/C/D category and SHA-256 of the five original text fields.
Full source articles are deliberately outside Git. Existing local read-only exports:
`/tmp/mso-number-audit-20260929/texts.json` and `recovery_metadata.json`.
To reproduce on another host, use `scripts/export-number-corpus.mjs`; it issues only
SELECTs for these manifest IDs and rejects any result reporting a database write.

```sh
node scripts/export-number-corpus.mjs <wrangler-config> <database-name> <output-directory>
MSO_NUMBER_CORPUS=<output-directory>/texts.json pnpm --filter @magyarsportonline/agents exec vitest run src/tabloid-numbers.test.ts
MSO_NUMBER_CORPUS=<output-directory>/texts.json MSO_RECOVERY_METADATA=<output-directory>/recovery_metadata.json pnpm --filter @magyarsportonline/web exec vitest run lib/draft-recovery.test.ts
```

Verified locally: A 89/89 PASS, B 8/8 PASS, C 6/6 blocked, D 21/21 blocked.
Full quality gate: **96 publishable / 28 blocked**; the remaining numeric-pass
Story has persisted `malformed_hungarian`, which recovery cannot erase.
Currency, numeric type, exact magnitude and score orientation remain checked.
Direct names/ages replace proximity guessing. No speculative currency or rounded
height is accepted. A unit may be omitted from a proved amount; adding an
unwritten currency remains forbidden. Scoped shared units and calendar enumerations
require an explicit written anchor. All corpus decisions are deterministic.

`POST /api/internal/draft-recovery` requires the existing CRON bearer. Body:
`{"storyIds":["..."],"execute":false}`. It reads saved full articles, rechecks all
current deterministic rules and retains every unresolved non-numeric stored issue.
It also enforces tabloid source registry, football eligibility, prompt, activation,
original chronology, latest unpublished version, and no other pending review/job.
The dry run makes **no writes**, enqueues no jobs and cannot reach an LLM client.
Execution additionally requires `DRAFT_RECOVERY_ENABLED=true` and explicit
`confirmation:"publish_saved_drafts_without_ai"`. Production default is false.
Publications are transactionally fenced against concurrent source/version changes,
recorded in `draft_recovery_publications`, and use source publication/first-seen,
never the recovery time. No social intent is created. Execution is idempotent.

## Additive migrations

Apply once in numbered order: 0002 qualified-read/trending, 0003 recovery. 0002 is
still pre-production and includes hero ID/time. 0003 is idempotent. Migration does
not execute recovery or make AI calls. Retain tables/ledgers on rollback; restore
the previous web/scheduler versions and leave activation switches off.

## Trending scheduler evidence

The existing production scheduler configuration is minute-based, with the trending
branch every five minutes and production APP_ORIGIN. The integration test invokes
the real scheduler at minute 0/5/10/15 against an authenticated endpoint and D1;
all four refreshes return 2xx and the snapshot never becomes stale. Production
does not yet have this PR's endpoint, so live production 2xx cannot honestly be
claimed before the separately authorized release. No production config was changed.

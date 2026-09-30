# Coordinated control-tower release — PR #143

Production is unchanged. Deploy and activation each require the owner's explicit instruction.
Primary Writer stays `gemini-3.5-flash-lite`. Development and Preview use no paid AI.

## AI BILLING PRE-FLIGHT — manual gate before any production release

- Cloudflare AI Gateway Unified Billing is active for Gemini.
- Sufficient Cloudflare AI credit / functioning equivalent billing is available.
- Owner manually verified Auto Top-Up state and a valid payment method in Cloudflare.
- Gemini Gateway smoke succeeds: one normal minimal request **at the authorized release**,
  logged in the existing ledger and counted against the cap. No paid development smoke.
- MSO application-side monthly hard cap is $30; daily request cap remains 450.

The $30 MSO cap is a separate safety stop; it does not prove Cloudflare credit exists.
No credit-balance API is connected. No code changes billing, Auto Top-Up, payment method
or performs automatic top-ups. If this manual pre-flight fails, stop the release.
Provider/billing/quota refusals preserve Story/source and defer the durable job, with
a global cooldown and bounded backoff (5/30 minutes up to 6 hours). Daily quota waits
until the provider reset; monthly app budget waits until the next UTC month.
The admin Overview/System show OK/WARNING/BLOCKED from actual call/defer evidence,
safe categories and retry times, never a credit balance or raw provider response.
Persisted successful drafts resume validation/publication without another Writer call.
If a successful paid call is logged but saving its draft failed, automatic regeneration
is blocked (`writer_paid_result_missing`); retain the source/Story/job for diagnostics.

## Primary Writer monthly budget

Release configuration: `GEMINI_MONTHLY_BUDGET_USD=30` (env validation accepts up to
$50), daily request cap unchanged at 450. This replaces the former test budget;
actual cost remains calculated from the existing ledger, never hardcoded.
Language QA retains its separate $0.50/day budget and remains OFF, as does recovery.

`GEMINI_MONTHLY_EXTERNAL_SPEND_USD` means only verified, already-paid spend outside
the D1 ledger for a specific UTC month. Release config is `0`; with no verified
external October spend it must remain zero. A positive amount requires
`GEMINI_MONTHLY_EXTERNAL_SPEND_MONTH=YYYY-MM` matching its billing evidence.
The request guard evaluates the month on every reservation (even for cached clients):
an adjustment from a different month contributes zero, never a carried-forward amount.
Missing/invalid month on positive spend fails closed before any provider request.
At each month/release, verify billing evidence and set zero or the exact verified
amount/month; never duplicate costs already in `llm_usage`.

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

Apply once in numbered order: 0002 qualified-read/trending, 0003 recovery, 0004 Language QA. 0002 is
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

## Language QA and targeted repair

Targeted repair accepts optional detail, nonliteral warnings, and one-paragraph
bodies. It uses the located paragraph when unique, otherwise only the affected
field. Nonrepairable/mixed flags prevent the provider call. Protected numbers,
names and quotes cannot change, and the publication path reruns its full gate.

Language QA model: `@cf/openai/gpt-oss-120b`, existing Workers AI adapter.
Default and production config: **LANGUAGE_QA_ENABLED=false**. Production mock mode
is false and recovery execution is false. These are separate activation decisions.
The provider's documented price used for the usage ledger is $0.35/$0.75 per million
input/output tokens: https://developers.cloudflare.com/workers-ai/models/gpt-oss-120b/.

New public versions create a durable, nonblocking audit intent. The existing
minute scheduler processes at most one intent per run; every 30 minutes it performs
a bounded safety sweep. `(version_id, content_hash)` is unique. A resulting repaired
version gets a PASS audit in the same transaction, without another model call.
Modified text is detected; technical failures retry after 30 minutes, at most three
attempts. A two-minute lease prevents concurrent provider calls. Projection failures
are retried independently and cannot regenerate content or incur model cost.

Strict JSON: PASS or at most five sentence replacements, confidence >=0.97,
meaning_change_risk=false, exact unique original sentence and one replacement
sentence. Guards preserve numbers/currencies/dates, name order and quoted text.
Conservative lexical equivalence also rejects unproven new assertions, negation
changes and unsupported paraphrases. It is intentionally narrow: many otherwise
reasonable edits remain `repair_rejected`. This is not a semantic guarantee from an
AI confidence score. Every candidate article must pass the full deterministic gate.
Source/version CAS guards prevent overwriting a concurrent update. Original
publication chronology is preserved; no new Facebook intent is created.

Separate daily ceiling: 300 calls and $0.50 estimated usage by default (config max
$1/day). An atomic `llm_usage` role=`language_qa` reservation includes a conservative
worst-case token cost before any client/provider call. Failed or unreported usage
retains that reservation; caps cannot reset after a restart. Actual token usage
reconciles successful reservations. Preview modes `pass`/`fixtures` require
APP_ENV=preview, workers.dev and LLM_PROVIDER=none, and use canned responses only.
Mock usage is identified as provider=`cloudflare_mock`, cost zero.

Scheduler completion/error heartbeats are persisted in a single operational row;
the admin never infers scheduler success from an RSS timestamp. The heartbeat adds
one bounded HTTP call/write per run and reuses the existing scheduler.

## Admin, measurement and privacy

Cloudflare APP_ENV determines Production/Preview/Development. Primary Writer,
repair, QA, deterministic gate, disabled Fact extraction and disabled self-check
are shown from the active D1 runtime/config. Navigation: Overview, Quality,
Popularity, Monetization, System, Knowledge. Existing review routes remain available
as diagnostic links, with existing session authentication and logout.

The dashboard uses indexed 24-hour/month ranges. Latest audit/draft lists are bounded
to 30; the homepage reads only the existing bounded trending snapshot. Scheduler
health comes from the actual persisted heartbeat, including stale/error status.
Audit diffs show the original/replacement sentences, reason, model and timestamp.

No reliable programmatic UV/PV/session feed is configured. These metrics explicitly
show unavailable for day/week/month, and inventory/UV threshold assessment is not
computed. Qualified reads remain a separate KPI, measured from existing deduplicated
events. Weekly/monthly qualified reads cannot be reconstructed from the short
retention ledger. A pure estimator accepts only verified monthly PV / complete
30-day UV, computes 1/2/3 slots and theoretical/70% inventory, and labels estimates
and internal 3,000/5,000/15,000 UV work thresholds explicitly.
No new visitor cookie, marketing tracker, fingerprint or persistent IP profile.
The existing necessary HttpOnly admin session cookie is unchanged. Qualified-read
sessionStorage and the existing transient per-isolate IP limiter are retained.
That limiter is a minimal abuse brake, not a global/distributed bot protection system.

## Production release sequence — only after separate authorization

1. **D1 migrations:** back up/snapshot first. Verify production binding is
   `eb02f98e-fd89-4277-94be-0f763056b91e` (its historical name contains "staging"
   but it is production). Apply 0002, 0003, 0004 in order. Never use a production
   SQL import to perform a read-only audit. 0002 is controlled pre-release;
   0003/0004 are additive/idempotent. Verify tables/indexes and foreign-key integrity.
2. **Web Worker:** deploy the reviewed PR commit to `magyarsportonline-web` with
   existing production secrets and bindings. Primary `gemini-3.5-flash-lite` unchanged;
   `LANGUAGE_QA_ENABLED=false`, `LANGUAGE_QA_MOCK_MODE=false`,
   `DRAFT_RECOVERY_ENABLED=false`. Do not deploy a Preview config to production.
   Verify Gemini monthly cap is $30, daily cap 450, and external spend is zero unless
   an exact, month-scoped, non-ledger payment is verified. `/admin/system` must show
   the runtime monthly hard cap; do not copy September's adjustment into October.
3. **Scheduler:** deploy `apps/ingest-scheduler/wrangler.jsonc`; APP_ORIGIN must be
   `https://mso24.hu`, minute cron unchanged. Confirm CRON_SECRET secret exists and
   authenticated calls succeed against the web Worker; never print its value.
4. **First trending refresh:** authenticated POST `/api/internal/trending`; expect
   2xx. GET that endpoint must show a changing refreshedAt and valid public ranking.
5. **Qualified-read smoke:** one dedicated public test Story/event through the
   existing endpoint; duplicate event must not increment twice; cross-origin and
   over-size submissions fail. Delete only explicitly designated smoke data if needed.
6. **Admin smoke:** login, Overview/Quality/Popularity/Monetization/System/Knowledge,
   old review routes and logout. Check Production label and real D1 KPIs; no fake UV/PV.
7. **QA OFF:** authenticated POST `/api/internal/language-qa` returns disabled and
   performs zero database/model work. No new paid QA usage. Recovery execution is OFF.
8. **12+ minute trending stability:** observe at least four real 5-minute refreshes
   over 15 minutes; no stale fallback under healthy operation, heartbeat OK,
   no scheduler failure. Check hero hold/challenger state. This is a release gate.
9. **Parser health:** run the authenticated 124-pair manifest/hash regression;
   A89/B8 PASS, C6/D21 blocked. Existing numeric/date/currency/name regressions pass.
10. **Recovery DRY RUN:** send the explicit 124 IDs with execute=false. Save the
    decisions. Expected original frozen cohort: 96 publishable / 28 blocked; any
    production changes since the audit must be re-evaluated, never forced through.
11. **Recovery execute — separate owner permission:** enable only its switch,
    use the reviewed dry-run IDs in explicit batches of at most 20 Stories and explicit
    confirmation, then disable again. Batching bounds D1 subrequests per HTTP invocation.
    Verify recovery ledger, original chronology, existing version IDs, unchanged
    llm_usage count and zero new Facebook intents. Projection is rebuildable without AI.
12. **Language QA ON — separate owner permission:** verify daily limits, Workers AI
    credential/model, mock=false and caps. Enable, observe the first bounded audit,
    persisted statuses/diffs/usage, reject guards and per-version idempotency. Disable
    immediately if unexpected changes/cost appear. Provider is never used for development.
13. **RSS:** `/rss.xml` returns valid XML and only public eligible Stories.
14. **Sitemap:** `/sitemap.xml`, canonical production URLs and chronology are valid.
15. **Category/archive:** `/kategoria/labdarugas` and pagination remain chronological;
    recovered drafts do not appear as newly timed publications.
16. **Article:** desktop/mobile images/body/source attribution and public status are
    correct; QA failure/rejection leaves the original live content available.
17. **Facebook:** fresh normal publications retain existing behavior; recovery and
    Language QA ledger entries have no automatic backlog intent.
18. **Rollback:** kill QA/recovery switches first, restore the previous web and
    scheduler Worker versions, retain additive schemas/audits. Do not bulk delete
    recovered or repaired content. If a particular publication is wrong, explicitly
    retract it via existing review controls and reproject. A repaired Story's prior
    version is retained for individually authorized restoration; no Writer is needed.

Production endpoint 2xx/secret match and real 15-minute health remain release-time
checks: this development request authorizes no production deployment or mutation.

## Combined Cloudflare Preview evidence (2026-09-30)

Preview: https://mso-controltower-preview-20260930.footballinvestmentkft.workers.dev
Isolated D1: `ba02bd50-140f-4954-9abe-183bbb32b1ca`.
No production custom domains, AI credentials, active RSS sources, Writer or Facebook.
QA uses the Preview-only fixture adapter; recovery execution is enabled only here.
Seed: the saved 124 drafts with original source metadata/timestamps/usage, 44 existing
public article copies and ten explicitly synthetic stories/read traffic.

The real 124-pair regression and isolated recovery integration passed. Preview
HTTP dry run: 96 publishable / 28 blocked, then five explicit recovery batches
published 96; zero chronology mismatches and zero social posts. The imported
124 Primary usage rows stayed at 124, $0.233611 historical cost. New QA usage is
`cloudflare_mock`, $0. Six QA fixtures: two guarded sentence repairs, three rejected
(number/name/risk), one PASS; rejected public text stayed identical.

Homepage, article, category and actual `?oldal=2` pagination, RSS/sitemap XML with
Preview URLs, eight authenticated admin routes and session login passed. Qualified
read: first unique event recorded, duplicate false, cross-origin 403, oversize 400,
internal unauthenticated access 401. Mobile review wrapping was fixed after browser
verification. Admin metrics explicitly describe version/hash PASS states and missing
UV/PV/session data; no audience measurement is inferred from qualified reads.

Local full test suite: 921 passed, six existing PostgreSQL integration tests skipped
without that test database. Lint, monorepo typecheck, formatting, OpenNext Cloudflare
build and Wrangler runtime type generation passed. No paid AI was called.

The actual existing scheduler code ran against the Preview for 16+ wall-clock
minutes: all branches returned 2xx, successful heartbeat each minute, scheduled
trending refreshes at 06:00 / 06:05 / 06:10 / 06:15 UTC. No stale snapshot;
persisted hero ID and selectedAt stayed unchanged. Thirty-minute hold and exact
1.24/1.25 boundary are covered by the deterministic scheduler/hero regression.
The live Preview stale-snapshot probe returned HTTP 200 with the chronological
"Top hír" fallback; the snapshot was immediately refreshed afterward.
Production scheduler config points at https://mso24.hu, but production secrets and
new endpoint success must still be checked after the separately authorized release.
Preview has no second cron system; the wall-clock run was an integration harness.

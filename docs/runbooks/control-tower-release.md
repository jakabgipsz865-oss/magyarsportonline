# Coordinated control-tower release — PR #143

The owner authorized controlled production release after all technical/privacy/CI gates pass.
Consent-first audience measurement is approved (owner decision 2026-09-30).
Language QA and recovery execution remain separately disabled.
Primary Writer stays `gemini-3.5-flash-lite`. Development and Preview use no paid AI.

## AI BILLING PRE-FLIGHT — manual gate before any production release

- Cloudflare AI Gateway Unified Billing is active for Gemini.
- Sufficient Cloudflare AI credit / functioning equivalent billing is available.
- Credit is MANUALLY replenished by the owner; Auto Recharge is intentionally OFF.
- Account-level Cloudflare Gateway Spend Limit is $30/month (owner-confirmed).
- Check manual credit availability and valid billing; never enable Auto Recharge or change payment/billing.
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

Apply once in numbered order: 0002 qualified-read/trending, 0003 recovery, 0004 Language QA, 0005 consent-only audience analytics. 0002 is
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

### Consent and retention — owner decision incorporated

Optional first-party PV, browser-session and Qualified Read measurement starts ONLY
following explicit opt-in. Equal buttons: “Statisztikai mérés engedélyezése” / “Csak
szükséges funkciók”. Reading/navigation remain functional without consent. No event,
random session UUID or analytics sessionStorage before consent. Revocation is always
available through “Statisztikai beállítások”, stops requests and clears analytics keys.
GDPR analytics basis: consent, GDPR 6(1)(a), as explicitly decided by the owner.
Terminal-device analytics storage/access is also consent-gated.
Necessary preference cookie `mso_analytics_consent`: fixed versioned allow/deny, no ID,
90 days, Path=/, SameSite=Lax, Secure on HTTPS. No cookie before an explicit choice.
Cookie changes/expiry are checked again before requests; no enduring visitor identifier.
SessionStorage `mso:audience-session` is tab-session scoped; browser restore/duplication
can retain/copy it. It is not UV. QR keys and 15-minute navigation markers stay ephemeral.
No localStorage visitor ID, fingerprint, marketing profile, GA, Meta Pixel, email,
user-agent, raw referrer/query or analytics IP persistence.

0005 stores minimal pseudonymous events for **32 days** (rolling 30 days + 2 buffer).
Five-minute scheduler cleanup deletes at most 5,000 old indexed raw events per call;
physical retention may exceed the target if cleanup is delayed—monitor heartbeat and
backlog, repeat sweeps without AI. Existing QR raw/buckets remain 48h/25h.
Atomic insert triggers update identifier-free UTC daily totals, daily Story PV/QR and
daily categorized sources. These aggregates remain for **the entire site lifetime**;
raw cleanup never deletes them. They support future current/previous calendar month,
year and all-time reports/media kits. No pre-instrumentation backfill is invented.
Daily session counts remain daily; never sum them into period-distinct sessions.
The 24h/7d/30d report uses indexed raw-window DISTINCT session IDs across day boundaries.
QR/article-PV uses qualified linked PVs in the period, excluding unmatched QR boundary
noise; QR totals separately use actual event timestamps. Before 30 full measured days,
inventory remains unavailable; this means partial rolling coverage, not lost history.
1/2/3 slots × observed consented 30-day PV, 100%/70%, always BECSLÉS; no extrapolation
for nonconsenting users and no UV threshold derived from PV/session.
CSV is authenticated aggregate-only (no event/session IDs), formula-escaped.

### Existing Cloudflare source audit — READ ONLY, 2026-09-30

Existing mso24.hu RUM site `f72f8ac6306143ccb3ffe357d711a7ec` has auto_install=true,
ruleset enabled (lite=true). No account setting was changed and no beacon was added.
Existing GraphQL rumPageloadEventsAdaptiveGroups query succeeded for 2026-09-29 UTC:
count=703 / sum(visits)=703. Cloudflare visits are external/direct-entry page views,
not unique people or our Browser session. The admin does not merge this older metric
with consented first-party counts. True UV/returning remain NOT RELIABLY MEASURABLE;
PV/visits/source integration would require the Cloudflare data-source adapter and
explicit attribution/sampling disclosure. No reliable UV/returning source is proved.
The application CSP blocks external scripts including the edge-auto-injected
static.cloudflareinsights.com beacon; connect-src stays same-origin. Verify this on
all production aliases and in a fresh browser before completing release. This keeps
all optional client analytics consent-first without altering Cloudflare account settings.
Cloudflare hosting/security analytics remain distinct from browser analytics.
The in-memory IP abuse limiter remains 120/60s/isolate; keys are not D1-persisted and
expire on clearing/restart, not a guaranteed globally distributed rate limit.

## Production release sequence — authorized after all gates PASS

1. **D1 migrations:** back up/snapshot first. Verify production binding is
   `eb02f98e-fd89-4277-94be-0f763056b91e` (its historical name contains "staging"
   but it is production). Apply 0002 → 0003 → 0004 → 0005 in order. Never use a production
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
5. **Consent/PV/Qualified-read smoke:** fresh browser, no event/storage before choice;
   explicit opt-in, a real public page/article PV and a linked QR; event retry and
   session/story duplicates must not increment twice. Revoke, confirm no new event.
   Cross-origin, missing consent/origin and oversize bodies fail. Keep minimal smoke
   counters with genuine observed traffic; never publish a synthetic production Story.
   Use existing signed admin auth for aggregate reports and `/api/admin/release-check`.
   That endpoint reads only the frozen 124 IDs, verifies saved text hashes and numeric
   categories, and calls recovery with execute=false/executionEnabled=false. No writes,
   no models, no social. If cohort differs, report it; do not force the expected 96/28.
   CRON/Gateway secrets remain Worker bindings: check names/metadata, never extract
   or rotate them. Observe the scheduler's own authenticated protected calls and
   heartbeat for ≥15 minutes / ≥4 five-minute refreshes, including no 401/403 mismatch.
   A fresh successful regular Primary Writer ledger entry after release verifies the
   existing Gateway/Unified Billing path; do not generate another paid test draft just
   to obtain the same evidence. This is a normal production call, not a development call.
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

## Public privacy notice cleanup (2026-09-30)

The public notice describes processing purposes, data categories, consent and rights,
90-day necessary preference storage, 32-day raw retention and lifetime anonymous
aggregates. It is not an implementation specification. No runtime behavior changes.
Physical deletion can be delayed by an outage; the notice discloses that limitation
in ordinary language rather than promising an absolute physical deadline.

Implementation details remain internal:

- Session storage: `mso:audience-session` ephemeral UUID; `mso:qr:<storyId>`
  event UUID/source/pending-or-sent; `mso:next-read` path/source/time, 15-minute attribution.
- Preference cookie: `mso_analytics_consent`, fixed `v1_allow` / `v1_deny`, 90 days,
  Path=/, SameSite=Lax, Secure on HTTPS. No analytics identifier in this cookie.
- D1 raw fields: event_id, session_id, event_type, page, story_id, source, placement,
  parent_event_id, occurred_at. Strict public-page/body validation prevents extra fields.
- Source enum: direct/internal/social/search/rss/referral/unknown. Placement enum:
  latest/trending_hero/trending_side/top5/internal/direct/social/search/rss.
- Public API limiter: 120 requests/60 seconds/isolate, transient proxy-IP key or unknown;
  no IP persisted in analytics. Raw sweep: 32-day cutoff, up to 5,000 rows per existing
  five-minute refresh; short QR ledger48h/buckets25h. Daily/Story/source rollups never
  expire with raw rows. Monitor expired backlog/heartbeat to detect delayed deletion.
- Same-origin CSP blocks the legacy auto-injected Cloudflare browser analytics beacon.
  Cloudflare account settings are not modified by a notice cleanup.

The exact QR algorithm, cookie attributes and IDs are retained here and in code,
not in the visitor-facing notice. Cookie implementation names are not publicly
retained as a legal requirement; purpose/provider/duration/choice are disclosed.

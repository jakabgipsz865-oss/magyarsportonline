# MSO24 qualified reads and trending — scoped decision

## Stabilization (PR #143 coordinated release)

The snapshot persists `hero_story_id` and `hero_selected_at`. A valid public,
renderable pictured hero holds for 30 minutes. After that, a challenger must
reach `current.score * 1.25`; picking the same hero does not reset its selection
time. Withdrawal/deletion, missing rendering content, and the 24-hour age limit
invalidate a hero immediately. The side/TOP5 rankings still refresh every five
minutes. Snapshot writes fence against an older refresh/hero selection to avoid
concurrent runs overwriting a newer hold. Homepage verification reads only the
at-most-30 ranked IDs; it does not aggregate or scan event data.

The qualified-read endpoint reuses the existing 120/minute in-memory limiter,
preferring Cloudflare's connecting-IP header, and reads at most 512 bytes even
without content-length. IPs are ephemeral rate-limit keys only, never stored in
D1, logs, cookies or a visitor profile. The limit is per isolate, so distributed
abuse remains a documented limitation; this is not a global fraud detector.

The existing every-minute scheduler calls trending on UTC five-minute
boundaries. An integration test drives its actual `runCron` through the D1
SQLite store over 15 simulated minutes, checking four distinct `refreshedAt`
values, authenticated 2xx responses, stable public hero, and immediate
withdrawal. This validates the release configuration, not an undeployed
production endpoint. Production rollout remains separately authorized.

## Current state (2026-09-29)

- The Cloudflare web Worker uses D1 (`DB`) for the public story projection. No KV or Analytics Engine binding exists. The separate scheduler already ticks every minute.
- The homepage reads the newest 24 public stories on every request. Its hero is the newest story; three more appear beside it. The remaining cards keep publication order. There is no read/pageview event path or ranking cache.
- Story pages are dynamic, use the public D1 projection, and have no client analytics. Homepage and article pages are not edge cached. Existing media/card and mobile styles can be reused; below 760 px the hero stack is one column.

## Chosen design

Use the existing D1 database. A small, additive migration creates a short-lived idempotency ledger, five-minute source-aware count buckets, and one cached ranking snapshot. A D1 trigger updates the bucket atomically when a new event is accepted. The existing scheduler calls a separate authenticated ranking refresh route every five minutes; this leaves ingest, Writer, publication, Facebook, and their schedules untouched. The homepage reads only the snapshot and current public story rows; it never computes rank from raw events. No new Cloudflare service or external analytics account is required.

The article client sends one event after ten **visible** seconds or a user scroll through 25% of the article. It stores a per-article event ID and completion state in `sessionStorage`, without cookies, IPs, user agents, or URL tracking parameters. The event endpoint accepts only public story IDs and a fixed source enum; an event ID is unique in D1, so a beacon retry cannot double count. Events older than 48 hours are removed by the refresh job; aggregate buckets older than 25 hours are removed.

The score is `5 × Q(1h) + 2 × Q(6h) + Q(24h)`, where each Q is the sum of normal-source reads plus **0.25 ×** reads from the site's own trending hero, side list, and top-five panel. The 24-hour window moves with the refresh time (five-minute bucket precision), not midnight. Hero candidates must be public, 15 minutes to 24 hours old, have at least five qualified reads, and have an article image. The image-led recommendation lists also select pictured stories; image-less stories remain in the measured ranking and the chronological feed. The top five uses the same rolling score and excludes the hero when enough alternatives exist. If the snapshot is absent, stale, invalid, or D1 ranking access fails, the existing newest-story hero and chronological homepage render without analytics blocks.

The protected debug route uses the existing `CRON_SECRET` bearer convention and returns counts, score, and position, never reader identifiers. Public UI displays labels only, never purported exact audience counts.

## Cost and failure boundary

Each accepted read creates one ledger row and one five-minute bucket insert/update through a trigger; retries create neither. The ranking job runs 288 times/day, not on pageviews, and queries only the bounded 24-hour aggregates. The homepage adds one small snapshot lookup. D1 quotas are shared with the existing production app, so actual usage must be observed before production rollout. If the event store fails, reads may be undercounted; article rendering and chronological homepage remain available.

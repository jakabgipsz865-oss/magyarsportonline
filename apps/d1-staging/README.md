# Isolated D1 read-path test Worker

This Worker reads an independently imported historical snapshot from
`mso-remediation-staging-20260928`. It has only a D1 binding and no production
route. It has no cron trigger, Queue consumer, AI client, Facebook integration,
Hyperdrive binding, or Neon connection. Its endpoints are read-only and are
intended for staging verification, not for serving production traffic.

`wrangler deploy --dry-run --config apps/d1-staging/wrangler.jsonc` validates
the bundle. The CLI needs the explicitly selected `mso` profile on the
Footballinvestmentkft Cloudflare account to deploy; the default profile points
to a different account. The `mso` profile currently grants D1 write but not
Worker script access, so the staging Worker has **not** been uploaded. Do not
switch account IDs or attach this Worker to a production route to work around
that permission failure.

The application route tests were instead run with `wrangler dev --local`
against a fresh local Wrangler D1 import of the audited snapshot. They do not
constitute a remote application end-to-end test.

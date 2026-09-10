# Tabloid v2 precision and public clean slate

The v1 filter accepted ordinary football news by default and let human-angle words override transfer exclusions. The v2 filter requires football context and an explicit human-interest signal after hard exclusions in the title and RSS body. Publisher Instagram embeds do not qualify by themselves. This intentionally trades recall for precision; no LLM classification is used.

Public queries require a current `tabloid-hu@2` version marker in the existing projection's version history and publication on or after `2026-09-10T20:03:10.000Z`. Old read-model rows remain stored but are inaccessible through public lists, API, RSS, sitemap and direct story URLs. Projector rebuilds preserve the actual generation; old drafts are not relabelled. RawArticle, Story and StoryVersion are not deleted. No schema or data migration is introduced.

`TABLOID_AUTO_PUBLISH` defaults to `false`. Ingest, processing and rollout writes stop before Writer execution while paused. The corporate Cloudflare account `7a225d650d7e05daba6355e5526a8fb9` has no configured cron trigger; the old account/Worker is unchanged. Do not enable publication or a trigger until the deterministic RSS report is reviewed.

The homepage and navigation now contain only the tabloid feed. Match data requests, Premier League and transfer sections are removed. Direct article pages check the current public generation on every request.

Validation: 67 targeted tests; web, agents and DB typechecks; changed-file lint; formatting. `scripts/tabloid-rss-dry-run.ts` samples current (48-hour) RSS items without importing any DB or LLM runtime client. The recorded sample in `tabloid-v2-rss-proof.json` covers 30 feeds, zero fetch failures and zero Gemini calls; accepted unique URLs: EN 11, ES 5, IT 9, DE 1. The report lists at most ten accepted titles per language and rejected examples. Feed sampling neither publishes nor consumes the processing queue.

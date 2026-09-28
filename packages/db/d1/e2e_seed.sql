-- Isolated D1-only rehearsal. This Source ID matches the production registry
-- for eligibility, but its URL points solely at a synthetic workers.dev feed.
INSERT INTO sources (
  id, name, base_url, type, language, license_type, reliability_tier,
  fetch_config, is_active, category, content_mode
) VALUES (
  '19294270-000c-597d-9c68-d6ad9c5e8950',
  'MSO24 isolated D1 fixture',
  'https://mso-d1-e2e-feed.footballinvestmentkft.workers.dev',
  'rss', 'en', 'public_rss', 'C',
  '{"tabloid":true,"footballFeed":false,"mode":"BROAD_TABLOID_FOOTBALL","url":"https://mso-d1-e2e-feed.footballinvestmentkft.workers.dev/feed.xml","feedUrls":["https://mso-d1-e2e-feed.footballinvestmentkft.workers.dev/feed.xml"]}',
  1, 'tabloid', 'full_text'
);

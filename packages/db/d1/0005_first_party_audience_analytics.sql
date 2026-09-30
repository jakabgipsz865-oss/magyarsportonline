-- Additive, consent-only first-party analytics. Raw: 32 days; anonymous rollups: site lifetime.
-- No historical backfill: pre-consent/pre-instrumentation traffic cannot be reconstructed.
CREATE TABLE IF NOT EXISTS audience_measurement (
  id INTEGER PRIMARY KEY CHECK(id=1), started_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audience_events (
  event_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK(event_type IN ('page_view','qualified_read')),
  page TEXT NOT NULL,
  story_id TEXT,
  source TEXT NOT NULL CHECK(source IN ('direct','internal','social','search','rss','referral','unknown')),
  placement TEXT NOT NULL CHECK(placement IN ('latest','trending_hero','trending_side','top5','internal','direct','social','search','rss')),
  parent_event_id TEXT,
  occurred_at TEXT NOT NULL,
  CHECK((event_type='page_view' AND parent_event_id IS NULL) OR
    (event_type='qualified_read' AND story_id IS NOT NULL AND parent_event_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS audience_events_time ON audience_events(occurred_at);
CREATE INDEX IF NOT EXISTS audience_events_session_time ON audience_events(session_id,occurred_at,event_type);
CREATE INDEX IF NOT EXISTS audience_events_story_time ON audience_events(story_id,occurred_at);
CREATE INDEX IF NOT EXISTS audience_events_parent ON audience_events(parent_event_id);
CREATE UNIQUE INDEX IF NOT EXISTS audience_read_session_story
  ON audience_events(session_id,story_id) WHERE event_type='qualified_read';
CREATE TABLE IF NOT EXISTS audience_daily (
  day TEXT PRIMARY KEY, page_views INTEGER NOT NULL DEFAULT 0,
  article_views INTEGER NOT NULL DEFAULT 0, qualified_reads INTEGER NOT NULL DEFAULT 0,
  daily_sessions INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS audience_story_daily (
  day TEXT NOT NULL, story_id TEXT NOT NULL,
  page_views INTEGER NOT NULL DEFAULT 0, qualified_reads INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(day,story_id)
);
CREATE INDEX IF NOT EXISTS audience_story_history ON audience_story_daily(story_id,day);
CREATE TABLE IF NOT EXISTS audience_source_daily (
  day TEXT NOT NULL, source TEXT NOT NULL,
  page_views INTEGER NOT NULL DEFAULT 0, qualified_reads INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(day,source)
);
CREATE TRIGGER IF NOT EXISTS audience_rollup AFTER INSERT ON audience_events BEGIN
  INSERT OR IGNORE INTO audience_measurement VALUES(1,NEW.occurred_at);
  INSERT INTO audience_daily(day,page_views,article_views,qualified_reads,daily_sessions)
  VALUES(substr(NEW.occurred_at,1,10),NEW.event_type='page_view',
    NEW.event_type='page_view' AND NEW.story_id IS NOT NULL, NEW.event_type='qualified_read',
    NEW.event_type='page_view' AND (SELECT COUNT(*) FROM audience_events
      WHERE session_id=NEW.session_id AND occurred_at>=substr(NEW.occurred_at,1,10)
        AND occurred_at<date(NEW.occurred_at,'+1 day') AND event_type='page_view')=1)
  ON CONFLICT(day) DO UPDATE SET page_views=page_views+excluded.page_views,
    article_views=article_views+excluded.article_views,qualified_reads=qualified_reads+excluded.qualified_reads,
    daily_sessions=daily_sessions+excluded.daily_sessions;
  INSERT INTO audience_story_daily(day,story_id,page_views,qualified_reads)
  SELECT substr(NEW.occurred_at,1,10),NEW.story_id,NEW.event_type='page_view',NEW.event_type='qualified_read'
  WHERE NEW.story_id IS NOT NULL
  ON CONFLICT(day,story_id) DO UPDATE SET page_views=page_views+excluded.page_views,
    qualified_reads=qualified_reads+excluded.qualified_reads;
  INSERT INTO audience_source_daily(day,source,page_views,qualified_reads)
  VALUES(substr(NEW.occurred_at,1,10),NEW.source,NEW.event_type='page_view',NEW.event_type='qualified_read')
  ON CONFLICT(day,source) DO UPDATE SET page_views=page_views+excluded.page_views,
    qualified_reads=qualified_reads+excluded.qualified_reads;
  -- Existing short QR ledger and trending rollup remain atomically consistent.
  INSERT OR IGNORE INTO qualified_read_events(event_id,story_id,source,occurred_at,bucket_at)
  SELECT NEW.event_id,NEW.story_id,NEW.placement,NEW.occurred_at,
    strftime('%Y-%m-%dT%H:',NEW.occurred_at)||printf('%02d',CAST(strftime('%M',NEW.occurred_at) AS INTEGER)/5*5)||':00.000Z'
  WHERE NEW.event_type='qualified_read';
END;

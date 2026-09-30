-- Additive MSO24 qualified-read analytics. Apply once to each D1 environment.
CREATE TABLE IF NOT EXISTS qualified_read_events (
  event_id TEXT PRIMARY KEY,
  story_id TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN (
    'latest', 'trending_hero', 'trending_side', 'top5',
    'social', 'search', 'direct', 'rss', 'internal'
  )),
  occurred_at TEXT NOT NULL,
  bucket_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS qualified_read_events_occurred_idx
  ON qualified_read_events (occurred_at);

CREATE TABLE IF NOT EXISTS qualified_read_buckets (
  story_id TEXT NOT NULL,
  bucket_at TEXT NOT NULL,
  normal_reads INTEGER NOT NULL DEFAULT 0,
  promoted_reads INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (story_id, bucket_at)
);

CREATE INDEX IF NOT EXISTS qualified_read_buckets_time_idx
  ON qualified_read_buckets (bucket_at);

CREATE TRIGGER IF NOT EXISTS qualified_read_rollup
AFTER INSERT ON qualified_read_events
BEGIN
  INSERT INTO qualified_read_buckets (story_id, bucket_at, normal_reads, promoted_reads)
  VALUES (
    NEW.story_id,
    NEW.bucket_at,
    CASE WHEN NEW.source IN ('trending_hero', 'trending_side', 'top5') THEN 0 ELSE 1 END,
    CASE WHEN NEW.source IN ('trending_hero', 'trending_side', 'top5') THEN 1 ELSE 0 END
  )
  ON CONFLICT(story_id, bucket_at) DO UPDATE SET
    normal_reads = normal_reads + excluded.normal_reads,
    promoted_reads = promoted_reads + excluded.promoted_reads;
END;

CREATE TABLE IF NOT EXISTS trending_snapshot (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  refreshed_at TEXT NOT NULL,
  ranking_json TEXT NOT NULL CHECK (json_valid(ranking_json)),
  hero_story_id TEXT,
  hero_selected_at TEXT,
  CHECK ((hero_story_id IS NULL) = (hero_selected_at IS NULL))
);

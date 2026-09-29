-- Additive, controlled migration. No story is published by migration.
CREATE TABLE IF NOT EXISTS draft_recovery_publications (
  version_id TEXT PRIMARY KEY REFERENCES story_versions(id),
  story_id TEXT NOT NULL REFERENCES stories(id),
  request_token TEXT NOT NULL UNIQUE,
  parser_version TEXT NOT NULL,
  published_at TEXT NOT NULL,
  recovered_at TEXT NOT NULL,
  reason TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS recovery_story_idx ON draft_recovery_publications(story_id);
CREATE INDEX IF NOT EXISTS story_versions_created_idx ON story_versions(created_at);
CREATE INDEX IF NOT EXISTS stories_status_first_seen_idx ON stories(status,first_seen_at);
CREATE INDEX IF NOT EXISTS story_sources_story_idx ON story_sources(story_id,excluded);
CREATE INDEX IF NOT EXISTS llm_usage_created_role_idx ON llm_usage(occurred_at,role);

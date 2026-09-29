-- Additive and idempotent. Does not enable Language QA or call a model.
CREATE TABLE IF NOT EXISTS language_qa_audits (
  id TEXT PRIMARY KEY,
  story_id TEXT NOT NULL REFERENCES stories(id),
  version_id TEXT NOT NULL REFERENCES story_versions(id),
  content_hash TEXT NOT NULL,
  original_fields TEXT NOT NULL CHECK(json_valid(original_fields)),
  status TEXT NOT NULL CHECK(status IN ('queued','processing','pass','repaired','repair_rejected','technical_error')),
  model TEXT NOT NULL,
  issue_count INTEGER NOT NULL DEFAULT 0,
  issues TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(issues)),
  reason TEXT,
  repaired INTEGER NOT NULL DEFAULT 0,
  new_version_id TEXT REFERENCES story_versions(id),
  queued_at TEXT NOT NULL,
  audited_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  lease_owner TEXT,
  lease_expires_at TEXT,
  projection_pending INTEGER NOT NULL DEFAULT 0,
  UNIQUE(version_id,content_hash)
);
CREATE INDEX IF NOT EXISTS language_qa_due_idx ON language_qa_audits(status,next_attempt_at,queued_at);
CREATE INDEX IF NOT EXISTS language_qa_version_idx ON language_qa_audits(version_id);
CREATE INDEX IF NOT EXISTS language_qa_audited_idx ON language_qa_audits(audited_at,status);
CREATE INDEX IF NOT EXISTS stories_published_updated_idx ON stories(status,last_updated_at);
CREATE INDEX IF NOT EXISTS stories_published_time_idx ON stories(status,published_at);
CREATE TABLE IF NOT EXISTS operational_state (
  component TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_error_at TEXT,
  detail TEXT NOT NULL CHECK(json_valid(detail))
);

CREATE INDEX IF NOT EXISTS language_qa_queued_at_idx ON language_qa_audits(queued_at DESC);

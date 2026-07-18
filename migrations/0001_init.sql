CREATE TABLE IF NOT EXISTS records (
  id TEXT PRIMARY KEY,
  file_number TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'wanted',
  data TEXT NOT NULL,
  photo_key TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS records_status_idx ON records(status);
CREATE INDEX IF NOT EXISTS records_updated_at_idx ON records(updated_at DESC);

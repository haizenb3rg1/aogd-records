ALTER TABLE users ADD COLUMN password_iterations INTEGER NOT NULL DEFAULT 210000;
ALTER TABLE users ADD COLUMN disabled_at TEXT;
ALTER TABLE support_requests ADD COLUMN moderator_note TEXT;

CREATE TABLE IF NOT EXISTS admin_sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  count INTEGER NOT NULL,
  reset_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id TEXT PRIMARY KEY,
  actor_hash TEXT NOT NULL,
  action TEXT NOT NULL,
  target_id TEXT,
  details TEXT,
  request_id TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS admin_sessions_expiry_idx ON admin_sessions(expires_at);
CREATE INDEX IF NOT EXISTS rate_limits_reset_idx ON rate_limits(reset_at);
CREATE INDEX IF NOT EXISTS audit_created_idx ON admin_audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS audit_action_idx ON admin_audit_log(action, created_at DESC);

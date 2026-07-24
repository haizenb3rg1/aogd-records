CREATE TABLE IF NOT EXISTS staff_role_permissions (
  role_slug TEXT NOT NULL,
  permission TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (role_slug, permission),
  FOREIGN KEY (role_slug) REFERENCES staff_roles(slug) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS staff_role_permissions_permission_idx
ON staff_role_permissions(permission, role_slug);

-- Owner is deliberately handled as unconditional full access in the server.
-- These defaults can be changed later in the role editor, except for Owner.
INSERT OR IGNORE INTO staff_role_permissions (role_slug, permission, created_at) VALUES
  ('director', 'records.create', CURRENT_TIMESTAMP),
  ('director', 'records.update', CURRENT_TIMESTAMP),
  ('director', 'records.delete', CURRENT_TIMESTAMP),
  ('director', 'support.read', CURRENT_TIMESTAMP),
  ('director', 'support.update', CURRENT_TIMESTAMP),
  ('director', 'reception.read', CURRENT_TIMESTAMP),
  ('director', 'reception.moderate', CURRENT_TIMESTAMP),
  ('director', 'staff.read', CURRENT_TIMESTAMP),
  ('director', 'staff.assign_roles', CURRENT_TIMESTAMP),
  ('security', 'reception.read', CURRENT_TIMESTAMP),
  ('security', 'reception.reveal_author', CURRENT_TIMESTAMP),
  ('security', 'staff.read', CURRENT_TIMESTAMP),
  ('security', 'security.read', CURRENT_TIMESTAMP),
  ('security', 'security.sessions.revoke', CURRENT_TIMESTAMP),
  ('moderator', 'support.read', CURRENT_TIMESTAMP),
  ('moderator', 'support.update', CURRENT_TIMESTAMP),
  ('moderator', 'reception.read', CURRENT_TIMESTAMP),
  ('moderator', 'reception.moderate', CURRENT_TIMESTAMP),
  ('support', 'support.read', CURRENT_TIMESTAMP),
  ('support', 'support.update', CURRENT_TIMESTAMP),
  ('support', 'reception.read', CURRENT_TIMESTAMP),
  ('press', 'records.create', CURRENT_TIMESTAMP),
  ('press', 'records.update', CURRENT_TIMESTAMP),
  ('press', 'reception.read', CURRENT_TIMESTAMP);

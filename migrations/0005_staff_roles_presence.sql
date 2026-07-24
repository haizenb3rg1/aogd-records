CREATE TABLE IF NOT EXISTS account_numbers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

INSERT OR IGNORE INTO account_numbers (user_id, created_at)
SELECT id, created_at
FROM users
ORDER BY created_at ASC, id ASC;

CREATE TRIGGER IF NOT EXISTS users_assign_account_number
AFTER INSERT ON users
BEGIN
  INSERT OR IGNORE INTO account_numbers (user_id, created_at)
  VALUES (NEW.id, NEW.created_at);
END;

CREATE TABLE IF NOT EXISTS staff_roles (
  slug TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 100,
  is_system INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0, 1)),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS staff_assignments (
  user_id TEXT NOT NULL,
  role_slug TEXT NOT NULL,
  assigned_at TEXT NOT NULL,
  assigned_by TEXT NOT NULL,
  PRIMARY KEY (user_id, role_slug),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (role_slug) REFERENCES staff_roles(slug) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS staff_presence (
  user_id TEXT PRIMARY KEY,
  last_seen_at TEXT,
  visible INTEGER NOT NULL DEFAULT 1 CHECK (visible IN (0, 1)),
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

INSERT OR IGNORE INTO staff_roles (slug, name, color, priority, is_system, created_at) VALUES
  ('owner', 'Owner', '#e5b85c', 10, 1, CURRENT_TIMESTAMP),
  ('director', 'Руководство', '#c9a8ff', 20, 1, CURRENT_TIMESTAMP),
  ('security', 'Безопасность', '#ff6f7d', 30, 1, CURRENT_TIMESTAMP),
  ('moderator', 'Модерация', '#7aa7ff', 40, 1, CURRENT_TIMESTAMP),
  ('support', 'Поддержка', '#55d6b0', 50, 1, CURRENT_TIMESTAMP),
  ('press', 'Пресс-служба', '#72c8ff', 60, 1, CURRENT_TIMESTAMP),
  ('staff', 'Сотрудник', '#9eaec3', 100, 1, CURRENT_TIMESTAMP);

CREATE INDEX IF NOT EXISTS account_numbers_user_idx ON account_numbers(user_id);
CREATE INDEX IF NOT EXISTS staff_assignments_role_idx ON staff_assignments(role_slug, user_id);
CREATE INDEX IF NOT EXISTS staff_roles_priority_idx ON staff_roles(priority, name);
CREATE INDEX IF NOT EXISTS staff_presence_seen_idx ON staff_presence(last_seen_at DESC);

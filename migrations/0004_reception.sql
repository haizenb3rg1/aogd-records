CREATE TABLE IF NOT EXISTS reception_threads (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  category TEXT NOT NULL CHECK (
    category IN ('question', 'proposal', 'technical', 'complaint', 'correction', 'security')
  ),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  visibility TEXT NOT NULL CHECK (visibility IN ('public', 'private')),
  is_anonymous INTEGER NOT NULL DEFAULT 0 CHECK (is_anonymous IN (0, 1)),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'needs_info', 'published', 'accepted', 'rejected', 'resolved', 'archived')
  ),
  official_answer TEXT,
  moderator_note TEXT,
  consent_version TEXT NOT NULL,
  published_at TEXT,
  answered_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    category NOT IN ('complaint', 'correction', 'security')
    OR visibility = 'private'
  ),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS reception_interests (
  thread_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (thread_id, user_id),
  FOREIGN KEY (thread_id) REFERENCES reception_threads(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS reception_public_idx
  ON reception_threads(visibility, status, published_at DESC);
CREATE INDEX IF NOT EXISTS reception_owner_idx
  ON reception_threads(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS reception_moderation_idx
  ON reception_threads(status, created_at DESC);
CREATE INDEX IF NOT EXISTS reception_interests_thread_idx
  ON reception_interests(thread_id, created_at DESC);

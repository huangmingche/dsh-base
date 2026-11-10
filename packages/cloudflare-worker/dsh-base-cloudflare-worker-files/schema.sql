CREATE TABLE IF NOT EXISTS dsh_user_files (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL CHECK (size > 0 AND size <= 10485760),
  object_key TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK (state IN ('pending', 'ready', 'deleting')),
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS dsh_user_files_owner ON dsh_user_files(user_id, state, id);

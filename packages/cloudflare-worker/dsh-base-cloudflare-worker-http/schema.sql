CREATE TABLE IF NOT EXISTS dsh_public_form_limits (
  key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS dsh_public_form_limits_expiry ON dsh_public_form_limits(expires_at);

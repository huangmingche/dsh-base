CREATE TABLE IF NOT EXISTS dsh_newsletter_consent (
  email TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK (state IN ('pending','confirming','confirmed','unsubscribing','revoked')),
  consent_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS dsh_newsletter_consent_expiry ON dsh_newsletter_consent(expires_at);

ALTER TABLE dsh_newsletter_consent ADD COLUMN revision INTEGER DEFAULT 0;
ALTER TABLE dsh_newsletter_consent ADD COLUMN operation_at INTEGER DEFAULT 0;

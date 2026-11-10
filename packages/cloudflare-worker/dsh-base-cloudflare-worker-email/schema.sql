-- Hash-only delivery claims share AUTH_DB; no address, token, body or API secret.
CREATE TABLE IF NOT EXISTS dsh_email_deliveries (
  delivery_key TEXT PRIMARY KEY,
  payload_hash TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('cloudflare', 'resend')),
  state TEXT NOT NULL CHECK (state IN ('sending', 'accepted', 'rejected', 'unknown')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

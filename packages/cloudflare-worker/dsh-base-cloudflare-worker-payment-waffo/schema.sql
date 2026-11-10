-- Apply to the existing AUTH_DB. No second database or background runtime is required.
CREATE TABLE IF NOT EXISTS dsh_waffo_checkouts (
  scope TEXT NOT NULL,
  id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  request_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('one_time', 'subscription')),
  currency TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (scope, id),
  UNIQUE (scope, user_id, request_key)
);
CREATE TABLE IF NOT EXISTS dsh_waffo_orders (
  scope TEXT NOT NULL,
  id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  checkout_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('one_time', 'subscription')),
  status TEXT NOT NULL,
  period_end TEXT,
  refunded INTEGER NOT NULL CHECK (refunded IN (0, 1)),
  eligible INTEGER NOT NULL CHECK (eligible IN (0, 1)),
  superseded_by TEXT,
  revision INTEGER NOT NULL CHECK (revision > 0),
  last_event TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (scope, id)
);
CREATE INDEX IF NOT EXISTS dsh_waffo_orders_owner ON dsh_waffo_orders(scope, user_id, updated_at DESC);
CREATE TABLE IF NOT EXISTS dsh_waffo_events (
  scope TEXT NOT NULL,
  id TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  order_id TEXT NOT NULL,
  processed_at INTEGER NOT NULL,
  PRIMARY KEY (scope, id)
);
CREATE TABLE IF NOT EXISTS dsh_waffo_checkout_consent (
  scope TEXT NOT NULL,
  checkout_id TEXT NOT NULL,
  consent INTEGER NOT NULL CHECK(consent IN (0,1)),
  campaign TEXT,
  PRIMARY KEY(scope,checkout_id)
);
-- A verified financial transaction persists analytics work atomically. Provider acceptance is not required to grant access.
CREATE TABLE IF NOT EXISTS dsh_waffo_conversion_outbox (
  scope TEXT NOT NULL,
  payment_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  checkout_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  currency TEXT NOT NULL,
  amount TEXT NOT NULL,
  settled INTEGER NOT NULL DEFAULT 0 CHECK(settled IN (0,1)),
  PRIMARY KEY(scope,payment_id)
);

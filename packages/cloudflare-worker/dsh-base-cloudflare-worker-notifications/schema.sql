-- Optional operational delivery outbox sharing AUTH_DB. URLs and user emails are never stored.
CREATE TABLE IF NOT EXISTS dsh_notification_outbox (
  id TEXT PRIMARY KEY,
  event_key TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('discord','feishu')),
  destination_hash TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind='payment'),
  order_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending','sending','accepted','rejected','uncertain')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts>=0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(event_key,channel,destination_hash)
);
CREATE INDEX IF NOT EXISTS dsh_notification_outbox_created ON dsh_notification_outbox(created_at DESC);

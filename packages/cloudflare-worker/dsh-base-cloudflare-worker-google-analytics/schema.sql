CREATE TABLE IF NOT EXISTS dsh_analytics_conversions (
  event_key TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL,
  receipt TEXT NOT NULL UNIQUE,
  event_name TEXT NOT NULL,
  day TEXT NOT NULL,
  campaign TEXT NOT NULL,
  currency TEXT NOT NULL,
  value REAL NOT NULL,
  delivery TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS dsh_analytics_conversions_day ON dsh_analytics_conversions(day);

CREATE TABLE IF NOT EXISTS dsh_analytics_daily (
  day TEXT NOT NULL,
  event_name TEXT NOT NULL,
  campaign TEXT NOT NULL,
  currency TEXT NOT NULL,
  count INTEGER NOT NULL,
  value REAL NOT NULL,
  PRIMARY KEY(day, event_name, campaign, currency)
);

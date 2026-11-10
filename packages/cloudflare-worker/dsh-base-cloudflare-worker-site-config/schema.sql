-- One deployment-wide document, independent of account and session settings.
CREATE TABLE IF NOT EXISTS dsh_site_settings (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  revision INTEGER NOT NULL CHECK (revision > 0),
  values_json TEXT NOT NULL
);

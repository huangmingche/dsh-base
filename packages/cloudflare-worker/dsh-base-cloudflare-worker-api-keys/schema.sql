-- Pinned @better-auth/api-key 1.7.18, user-owned configuration only.
CREATE TABLE IF NOT EXISTS "apikey" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "configId" TEXT NOT NULL DEFAULT 'default',
  "name" TEXT,
  "start" TEXT,
  "referenceId" TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  "prefix" TEXT,
  "key" TEXT NOT NULL,
  "refillInterval" INTEGER,
  "refillAmount" INTEGER,
  "lastRefillAt" INTEGER,
  "enabled" INTEGER DEFAULT 1,
  "rateLimitEnabled" INTEGER DEFAULT 1,
  "rateLimitTimeWindow" INTEGER DEFAULT 60000,
  "rateLimitMax" INTEGER DEFAULT 60,
  "requestCount" INTEGER DEFAULT 0,
  "remaining" INTEGER,
  "lastRequest" INTEGER,
  "expiresAt" INTEGER,
  "createdAt" INTEGER NOT NULL,
  "updatedAt" INTEGER NOT NULL,
  "permissions" TEXT,
  "metadata" TEXT
);
CREATE INDEX IF NOT EXISTS "apikey_configId_idx" ON "apikey" ("configId");
CREATE INDEX IF NOT EXISTS "apikey_referenceId_idx" ON "apikey" ("referenceId");
CREATE INDEX IF NOT EXISTS "apikey_key_idx" ON "apikey" ("key");

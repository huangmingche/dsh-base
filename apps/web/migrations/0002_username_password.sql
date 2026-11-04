-- Better Auth 1.7.4 username plugin and persistent rate-limit storage.
ALTER TABLE "user" ADD COLUMN "username" TEXT;
CREATE UNIQUE INDEX "user_username_unique" ON "user" ("username" COLLATE NOCASE);

CREATE TABLE "rateLimit" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "key" TEXT NOT NULL UNIQUE,
  "count" INTEGER NOT NULL,
  "lastRequest" INTEGER NOT NULL
);
CREATE INDEX "rateLimit_lastRequest_idx" ON "rateLimit" ("lastRequest");

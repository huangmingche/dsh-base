-- Apply once as a numbered D1 migration, before composing the plugin.
ALTER TABLE "user" ADD COLUMN "role" TEXT;
ALTER TABLE "user" ADD COLUMN "banned" INTEGER DEFAULT 0;
ALTER TABLE "user" ADD COLUMN "banReason" TEXT;
ALTER TABLE "user" ADD COLUMN "banExpires" INTEGER;
ALTER TABLE "session" ADD COLUMN "impersonatedBy" TEXT;

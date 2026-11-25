ALTER TABLE "GlobalSettings" ADD COLUMN "networkOffline" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "GlobalSettings" ADD COLUMN "offlineSince" TIMESTAMPTZ(6);

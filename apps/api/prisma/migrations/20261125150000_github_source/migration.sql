ALTER TYPE "TicketSource" ADD VALUE IF NOT EXISTS 'github';
ALTER TABLE "GlobalSettings" ADD COLUMN "intakeJiraEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "GlobalSettings" ADD COLUMN "intakeGithubEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "GlobalSettings" ADD COLUMN "intakePasteEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Ticket" ADD COLUMN "externalStatus" TEXT;

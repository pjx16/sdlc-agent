-- How long profiling a repository may run before it is stopped (minutes).
ALTER TABLE "GlobalSettings" ADD COLUMN "onboardingTimeoutMin" INTEGER NOT NULL DEFAULT 15;

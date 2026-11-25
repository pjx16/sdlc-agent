-- The Confluence integration is gone: plans are documents in the repository's knowledge-base folder.
-- Page bookkeeping on plan artifacts.
ALTER TABLE "StageArtifact" DROP COLUMN "externalUrl",
  DROP COLUMN "externalId",
  DROP COLUMN "externalVersion",
  DROP COLUMN "externalSig";

-- The Confluence part of each project's settings, and of onboarding proposals that were not confirmed yet.
UPDATE "Project" SET "settings" = "settings" - 'confluence' WHERE "settings" ? 'confluence';
UPDATE "Project" SET "onboardingProposal" = jsonb_set(
    "onboardingProposal" #- '{facts,confluence}',
    '{advice}',
    ("onboardingProposal" -> 'advice') - 'confluenceSpaceKey'
  ) #- '{accepted,confluence}'
WHERE "onboardingProposal" IS NOT NULL AND "onboardingProposal" -> 'advice' IS NOT NULL;

-- Events of the removed integration stay readable: their source is a plain text column.

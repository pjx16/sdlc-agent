-- Jira is gone: GitHub covers intake, comments and approval.

-- Stored Jira credentials (the dashboard's own store; nothing else holds them).
DELETE FROM "Credential" WHERE "key" LIKE 'jira\_%';

-- The last Jira intake poll of each mode.
DELETE FROM "WorkerStatus" WHERE "id" LIKE 'intake-%';

-- Project columns, the Jira sync bookkeeping of each transition and the global intake switch.
ALTER TABLE "Project" DROP COLUMN "jiraMode",
  DROP COLUMN "jiraProjectKey",
  DROP COLUMN "jiraJql";
ALTER TABLE "StateTransition" DROP COLUMN "jiraStatusApplied",
  DROP COLUMN "jiraSyncResult",
  DROP COLUMN "jiraSyncError";
ALTER TABLE "GlobalSettings" DROP COLUMN "intakeJiraEnabled";
DROP TYPE "JiraMode";
DROP TYPE "JiraSyncResult";

-- The Jira part of each project's settings.
UPDATE "Project" SET "settings" = ("settings"
    - 'jiraWriteBack' - 'jiraSubtaskTypeName' - 'jiraConnector' - 'jiraIssueTypeRouting' - 'jiraStatusMap' - 'jiraApprovalStatuses')
    #- '{stages,jiraConnector}'
WHERE "settings" ?| ARRAY['jiraWriteBack', 'jiraSubtaskTypeName', 'jiraConnector', 'jiraIssueTypeRouting', 'jiraStatusMap', 'jiraApprovalStatuses']
   OR "settings" #> '{stages,jiraConnector}' IS NOT NULL;

-- A proposal that was not confirmed yet loses its Jira advice and facts. The board mapping, if there is one, stays.
UPDATE "Project" SET "onboardingProposal" = (("onboardingProposal" - 'advice') #- '{facts,jira}') #- '{accepted,statusMap}' #- '{accepted,routing}' #- '{accepted,label}'
WHERE "onboardingProposal" IS NOT NULL;

-- Kept on purpose, so history still reads: the `jira` ticket source, the `jira` actor of old transitions, and the `jira` source of old events.

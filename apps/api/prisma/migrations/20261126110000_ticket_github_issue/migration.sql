-- Whether a ticket also gets a GitHub issue, and how that stands: none, pending (the worker will make or link it), created, failed.
CREATE TYPE "GithubIssueState" AS ENUM ('none', 'pending', 'created', 'failed');
ALTER TABLE "Ticket" ADD COLUMN "githubIssueState" "GithubIssueState" NOT NULL DEFAULT 'none';
ALTER TABLE "Ticket" ADD COLUMN "githubIssueError" TEXT;
-- An issue that already exists, to link instead of making a new one.
ALTER TABLE "Ticket" ADD COLUMN "githubIssueLink" INTEGER;
-- One choice for every project: ask each time, always make the issue, or never.
ALTER TABLE "GlobalSettings" ADD COLUMN "githubIssueOnCreate" TEXT NOT NULL DEFAULT 'ask';

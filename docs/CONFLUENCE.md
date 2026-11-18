# Confluence document hub

When a project has a Confluence space, the pipeline publishes each ticket's plan there instead of pasting it into Jira. It uses the same Atlassian credential as Jira (`JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`, or the Jira fields in Settings → Connections); the Test button checks both.

## Setup

1. Make sure the Atlassian account can create pages in the space you want.
2. Onboard the project (or open its settings) and choose the **Confluence space** (and, optionally, a parent page). The onboarding advisor proposes a space from the ones the account can write to.

A project with no space keeps the plan in Jira.

## What is published

- One page per ticket, titled `{KEY} — {title}`, under the project's parent page.
- A status line ("Draft, waiting for approval", "Approved on …", "Superseded by a rerun"), the plan, risks, open questions and, once given, their answers.
- A rerun, an approval, a rejection and an answered question update the same page at once, sending the expected page version.
- A hand edit in Confluence is kept in the page history, noted on the page and recorded as a warning; the next update does not silently overwrite it.
- Jira gets one link comment, edited in place with the page status. The full plan goes to Jira only for projects without Confluence, or after Confluence failed three times (`CONFLUENCE_ERROR`; attempts at once, after 2 s and after 6 s).

Approval is still given in the dashboard or by moving the Jira ticket to the approval status; see [`TRACKER.md`](./TRACKER.md). Confluence failures never block the pipeline.

The plan format is `guidelines/formats/plan.md` and the Jira link comment is `guidelines/formats/jira-plan-link.md`; the Markdown is converted to Confluence storage format by `packages/shared/src/confluence-storage.ts`.

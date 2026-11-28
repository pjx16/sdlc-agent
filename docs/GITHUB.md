# GitHub issues and Projects as a ticket source

Tickets come from GitHub, or are created in the dashboard (optionally with their own GitHub issue). Each source has its own switch (**Settings → Intake sources**); the **Pause intake** button in the top bar stops all of them at once. Work already in the pipeline is not affected by either.

## Set up a project

Open the project (Projects → the project → Edit) and choose a source under **GitHub issues and projects**:

| Source | Takes | Shows progress by |
| --- | --- | --- |
| **GitHub Projects board** (recommended) | The open issues of this repository that stand on the board in the intake column (default `Todo`) | Moving the card: `In Progress` while the pipeline works on it, `Done` at the end |
| **Issues with a label** | The open issues of the repository that carry the label (default `sdlc-agent`) | A label `sdlc:<state>` that changes as the ticket moves |

For a board give the **owner** (a user or an organization), the board's **number** (the number in its URL) and, if yours are named differently, the **status field** and the **intake column**. Per state, `settings.github.statusMap` can name another column, or `null` to leave the card where it is (set it in the project's settings JSON; the dashboard keeps the defaults).

## What the pipeline does with an issue

1. **Picks it up once.** Each issue becomes one ticket, stored under `owner/name#number` (the next local key of the project, `ABC-12`). Issues of other repositories on the same board are ignored. A bug label makes a bug, `chore`/`tech` a chore, anything else a feature. The text of the issue is the description, with a link back.
2. **Writes progress back.** On pick-up it comments `Picked up by sdlc-agent as ABC-12.` and writes the state; every change of state is written once. A GitHub problem is retried at the next poll, and a network outage costs nothing.
3. **Finishes.** When the ticket is done it comments with the pull request and closes the issue.

## Comments, approval and the board columns

- **Comments.** The plan, the breakdown (a task list), every decision of the orchestrator, PR-size notes, a replaced push and anything that needs a person are written on the ticket's issue. Each kind is one comment that is rewritten when it changes (a hidden marker finds it), except decisions, which are a history.
- **Approving.** A plan or breakdown waits for you in the dashboard, and also on GitHub: in a board project, move the card to the approval column (`settings.github.approval.plan` / `.breakdown`); in an issues project, add the label `sdlc:approved` (it is removed once used). A plan that still has open questions is not approved: a comment says so and the card goes back to review.
- **sdlc-agent's own columns.** With *Use sdlc-agent's own columns* on, the board gets `Plan review`, `Plan approved`, `Breakdown review` and `Breakdown approved` the first time one is needed. Only missing columns are added; existing ones and the cards on them are not changed.
- **Onboarding.** When a project uses a board, the onboarding review proposes the column for each state, the approval columns and the intake column. You accept or edit them before the project is confirmed.

## Tokens

- **Issues** use the project's GitHub credential like everything else (the personal token, or sdlc-agent-bot): it needs read and write access to issues.
- **Projects boards** belong to a user or an organization, not to a repository, so they use the **personal token**, and it needs the **`project`** scope (a classic token) or the *Projects* read/write permission (a fine-grained token). The bot's installation token cannot read a user's board.
- The bot (a GitHub App) cannot read a **user's** Projects board, only an organization's. A bot project that names a user's board is stopped during onboarding with that explanation. Use a personal token for it, or move the board to an organization.

## Not covered yet

- GitHub Enterprise Server.
- Two-way sync beyond the state: edits to the issue after pick-up are not read again.

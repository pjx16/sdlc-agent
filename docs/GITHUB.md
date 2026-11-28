# GitHub issues and Projects as a ticket source

Tickets can come from GitHub as well as from Jira and from the dashboard. Each source has its own switch (**Settings → Intake sources**); the **Pause intake** button in the top bar stops all of them at once. Work already in the pipeline is not affected by either.

## Set up a project

Open the project (Projects → the project → Edit) and choose a source under **GitHub issues and Projects boards**:

| Source | Takes | Shows progress by |
| --- | --- | --- |
| **GitHub Projects board** (recommended) | The open issues of this repository that stand on the board in the intake column (default `Todo`) | Moving the card: `In Progress` while the pipeline works on it, `Done` at the end |
| **Issues with a label** | The open issues of the repository that carry the label (default `sdlc-agent`) | A label `sdlc:<state>` that changes as the ticket moves |

For a board give the **board owner** (a user or an organization), the **board number** (the number in its URL) and, if yours are named differently, the **status field** and the **intake column**. Per state, `settings.github.statusMap` can name another column, or `null` to leave the card where it is (set it in the project's settings JSON; the dashboard keeps the defaults).

## What the pipeline does with an issue

1. **Picks it up once.** Each issue becomes one ticket, stored under `owner/name#number` (the next local key of the project, `ABC-12`). Issues of other repositories on the same board are ignored. A bug label makes a bug, `chore`/`tech` a chore, anything else a feature. The text of the issue is the description, with a link back.
2. **Writes progress back.** On pick-up it comments `Picked up by sdlc-agent as ABC-12.` and writes the state; every change of state is written once. A GitHub problem is retried at the next poll, and a network outage costs nothing.
3. **Finishes.** When the ticket is done it comments with the pull request and closes the issue.

A ticket's plan still goes through the same approval gates in the dashboard; approving by moving a card is not supported.

## Tokens

- **Issues** use the project's GitHub credential like everything else (the personal token, or sdlc-agent-bot): it needs read and write access to issues.
- **Projects boards** belong to a user or an organization, not to a repository, so they always use the **personal token**, and it needs the **`project`** scope (a classic token) or the *Projects* read/write permission (a fine-grained token). The bot's installation token cannot read a user's board.
- With the bot, an organization's board additionally needs the Projects permission granted to the App; that is not requested by default.

## Not covered yet

- The onboarding review does not propose the GitHub settings: choose them on the project page.
- GitHub Enterprise Server.
- Two-way sync beyond the state: edits to the issue after pick-up are not read again.

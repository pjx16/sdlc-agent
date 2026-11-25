# Plan: #43 — Actionable options for a ticket in PR review

## Goal
A ticket in `IN_HUMAN_REVIEW` shows buttons: Open PR, Mark done, Mark failed, Re-run KB update.

## Approach
1. **Shared**: extend `SupportAction` with `done`; set `SUPPORT_ACTIONS.pr_ready = ['done','fail','dismiss']` (dismiss reworked in #44).
2. **API** (`support.service.ts`): handle `done` → `states.transition(ticketId,'DONE','user', note)`; handle `fail` for `pr_ready` → transition to `FAILED` (requires note); both check current status is `IN_HUMAN_REVIEW`, else 409. The listener already closes the `pr_ready` item on leaving the state.
3. **Dashboard**:
   - `inbox.tsx`: for `pr_ready`, render "Open PR" (anchor, from `prUrl` included in the support-ticket view; add `prUrl` to the DTO), "Mark done", "Mark failed" (opens note box), "Re-run KB update" (calls existing endpoint).
   - `ticket-actions.tsx`: same set on the ticket page when status is `IN_HUMAN_REVIEW`.
   - Confirm dialog for destructive choices.
4. Depends on #42 for the clickable link rendering in body text.

## Tests
Service int tests for done/fail/409; shared test for action table; dashboard tests for button set per status.

## Acceptance criteria
Each button works and the inbox item disappears; ticket page shows the same options; actions rejected outside `IN_HUMAN_REVIEW`.

## Out of scope
Merging the PR from the dashboard (would need merge permission/policy decision — proposed follow-up); dismiss semantics (#44).

## Decisions
No merge-from-dashboard in this iteration; "done" is a human override of the merge poller; failure requires a reason.

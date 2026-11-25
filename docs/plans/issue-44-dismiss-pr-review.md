# Plan: #44 — Dismissing a PR review request must resolve the ticket

## Root cause
`dismiss` closes only the SupportTicket; `Ticket.status` remains `IN_HUMAN_REVIEW`.

## Approach
1. **Shared**: remove `dismiss` from `SUPPORT_ACTIONS.pr_ready` (it becomes `['done','fail']`, from #43).
2. **API**: in `support.service.ts`, `dismiss` on a `pr_ready` item → 400 "Mark the ticket as done or failed instead".
3. **Dashboard**: the inbox "Dismiss" control for `pr_ready` is replaced by a "Dismiss…" button opening a dialog with two choices (Mark done / Mark failed) + note; it calls the #43 actions.
4. **Backfill**: startup/maintenance step re-raising `pr_ready` items (new dedupeKey version) for tickets that are `IN_HUMAN_REVIEW` with no open item.
5. **Merge poller** unchanged.

## Tests
- Service: dismiss on pr_ready → 400; done/fail transition the ticket and close the item.
- Backfill: ticket in IN_HUMAN_REVIEW without open item gets one.
- Dashboard: dialog flow.

## Acceptance criteria
- After resolving, the ticket leaves Human Review (Done or Failed).
- A dismissed-looking ticket can never remain in Human Review without an open item.

## Out of scope
Changing merge-poller; other kinds' dismiss behaviour.

## Decisions
Force an explicit outcome; server enforces it; backfill for existing stuck tickets. Depends on #43 (and #42 for link rendering).

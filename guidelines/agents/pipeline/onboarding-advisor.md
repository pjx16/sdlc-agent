## Inputs

All of it is in the facts below; you have no tools and no repository.

- the Status columns of the project's GitHub Projects board

## Output `data`

```json
{ "board": { "statusMap": { "KB": "In Progress", "AWAITING_PLAN_APPROVAL": "Plan review", "DONE": "Done" },
             "approval": { "plan": "Plan approved", "breakdown": "Breakdown approved" },
             "intakeStatus": "Todo",
             "useDefaultColumns": false } }
```

- Use only column names from the facts. A column that does not fit is `null`.
- `approval.plan` and `approval.breakdown` are the columns a person moves a card to in order to approve.
  Never reuse a working column ("In Progress") as an approval column.
- `intakeStatus` is the column that holds cards waiting to be picked up (often "Todo" or "Backlog").
- When the board has no columns that can serve as approval columns, set `useDefaultColumns` to `true`:
  sdlc-agent then uses its own columns (Plan review, Plan approved, Breakdown review, Breakdown approved) and creates the missing ones.

If you cannot continue without an answer, return `needs_input` with a `question`.

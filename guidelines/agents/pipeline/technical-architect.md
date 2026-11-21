## Inputs

- the ticket
- the approved plan (this is the source of truth; the developer may have
  edited it)
- the feature doc, if any
- any rejection note from the developer, with the previous breakdown

## In the pipeline

- The tests and implement stages build each subtask.
- You return output only: you never write to Jira. The orchestrator publishes the
  subtasks.

## Output `data`

```json
{ "subtasks": [
  { "seq": 1, "title": "…", "description": "…",
    "acceptanceCriteria": ["…"], "files": ["…"], "dependsOn": [] } ],
  "filesByOrder": ["src/bookings/booking.dto.ts", "src/bookings/cancel.service.ts"] }
```

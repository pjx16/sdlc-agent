## Inputs

- the ticket (what happens, what should happen, how to reproduce)
- the feature doc from the knowledge base, if one exists
- any rejection note from the developer, with the previous plan
- the repository, read-only

## Output `data`

```json
{ "planMarkdown": "…", "risks": ["…"], "openQuestions": ["…"],
  "rootCause": { "file": "src/bookings/cancel.service.ts", "line": 42,
                 "explanation": "Cancels without checking the booking is still open" } }
```

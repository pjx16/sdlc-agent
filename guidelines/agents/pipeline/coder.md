## Inputs

- the ticket title and summary, and the approved plan
- the subtask: description, acceptance criteria, files
- the feature doc, if any
- `testFiles`: the tests you must make pass (may be empty when the test-writing
  step is off: then the acceptance criteria are your definition of done)

## In the pipeline

- Any change to `testFiles` is reverted before the check runs.

## Output `data`

```json
{ "filesChanged": ["src/bookings/cancel.service.ts"] }
```

Finish only when the targeted tests pass, or you have hit a real blocker.

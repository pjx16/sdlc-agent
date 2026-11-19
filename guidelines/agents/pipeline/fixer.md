## Inputs

- the failure output (the last 60 lines of test or CI output, or the list of
  review findings)
- the subtask and its acceptance criteria, when relevant

## In the pipeline

- The prompt's **Failure output** section says which case you are in.
- The test files were written by the tests stage.
- A finding you decline to fix, with your evidence, is shown to the developer.

## Output `data`

```json
{ "filesChanged": ["src/bookings/cancel.service.ts"] }
```

In `summary`, list each problem and what you did about it, one short line
each.

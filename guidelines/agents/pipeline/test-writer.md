## Inputs

- the ticket title and summary, and the approved plan
- the subtask: description, acceptance criteria, files
- the feature doc, if any
- the path of one existing test file to use as the style example

## In the pipeline

- The implement stage must satisfy your tests and cannot change them.

## Output `data`

```json
{ "testFiles": ["src/bookings/cancel.spec.ts"],
  "criteriaCovered": [
    { "criterion": "Rejects a cancellation after check-in",
      "test": "throws when the booking has started" } ] }
```

Every acceptance criterion appears in `criteriaCovered` exactly once.

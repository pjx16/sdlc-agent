## Inputs

- the diff (`diff.patch`); round 2 gets only the diff since round 1
- the acceptance criteria of every subtask
- the review checklist (`review-checklist.md`)
- round 2 only: the round-1 findings, each with an `id`

## In the pipeline

- The orchestrator posts your findings as a PR comment and decides whether a fix
  round runs. Only critical and high trigger one.

## Output `data`

```json
{ "findings": [
    { "severity": "high", "file": "src/bookings/cancel.service.ts",
      "line": 42, "issue": "Cancels without checking the caller owns the booking",
      "rule": "Security: authorization check",
      "fix": "Compare booking.userId with the request user before cancelling" } ],
  "criteria": [ { "criterion": "A cancelled booking cannot be cancelled again", "met": true, "tested": false, "note": "no test for the second cancel" } ],
  "previousFindings": [ { "id": "…", "status": "fixed" } ] }
```

`criteria` has one entry per acceptance criterion: `{ "criterion": "…", "met": true, "tested": true, "note": "…" }`. A criterion that is not met or not tested is also a finding (high). `previousFindings` is empty in round 1. `line` may be null only for a
finding about a whole file (for example a missing test file).

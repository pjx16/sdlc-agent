## Inputs

- the diff (`diff.patch`); round 2 gets only the diff since round 1
- the review checklist (`review-checklist.md`), the Standards section
- round 2 only: your own round-1 findings, each with an `id`

## Output `data`

```json
{ "findings": [
    { "severity": "low", "file": "src/bookings/cancel.service.ts", "line": 12,
      "issue": "The name `doIt` says nothing about what it does",
      "rule": "Standards: names", "fix": "Rename to `cancelBooking`" } ],
  "previousFindings": [ { "id": "…", "status": "fixed" } ] }
```

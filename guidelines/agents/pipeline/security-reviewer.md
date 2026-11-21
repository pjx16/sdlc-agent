## Inputs

- the diff (`diff.patch`); round 2 gets only the diff since round 1
- why you were brought in: the paths and lines that matched the risk rules
- the review checklist (`review-checklist.md`), the Security section
- round 2 only: your own round-1 findings, each with an `id`

## Output `data`

```json
{ "findings": [
    { "severity": "high", "file": "src/files/download.controller.ts", "line": 31,
      "issue": "`req.query.path` reaches `readFile` without checking it stays in the export folder (path traversal)",
      "rule": "Security: path traversal", "fix": "Resolve the path and reject anything outside EXPORT_DIR" } ],
  "previousFindings": [ { "id": "…", "status": "fixed" } ] }
```

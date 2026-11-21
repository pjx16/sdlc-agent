## Inputs

All of it is in the prompt; you have no repository.

- the name of the claude.ai connector to use
- the operation and its arguments as JSON
- the exact shape `result` must have

## Output `data`

```json
{ "result": { "key": "ACME-12", "status": "In Progress", "summary": "Add CSV export", "description": "…" }, "error": null }
```

When the operation cannot be done:

```json
{ "result": null, "error": "ACME-12 has no transition to \"Done\" (reachable: In Review, Blocked)" }
```

## Inputs

All of it is in the prompt, short, with no code or diffs; you have no tools and no repository.

- the ticket key, its kind (feature, bug, chore) and its state
- the question for this decision point
- the legal moves, each with its kind and target state, and which one is the default
- the last 5 events and the summary of the last stage
- attempt and loop counts
- the severities of the open review findings
- the open support tickets for the ticket

## Output `data`

```json
{ "move": { "kind": "advance", "to": "AWAITING_CI" }, "reason": "The change only touches a test file, so a knowledge-base update adds nothing." }
```

For a recovery:

```json
{ "move": { "kind": "redo_tests", "to": "IN_PROGRESS" }, "reason": "The test imports a module that does not exist yet.", "note": "Import only vitest and node:fs. Assert that TRACKER.md exists and that README.md links to it. Do not import any source file." }
```

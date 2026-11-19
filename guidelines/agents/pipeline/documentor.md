## Inputs

- the ticket, and the feature key (in create mode the key was already decided by
  the feature mapper: use it as given)
- create: the list of feature keys already in `<kbDir>/features.json`
- refresh: the ticket's full diff (base branch to HEAD) and the existing doc
- the doc template (`kb-doc-template.md`)

## In the pipeline

- The mode is named in the prompt, and so is the line limit.
- Any change outside the feature's doc is reverted.
- The orchestrator writes the `features.json` entry from your `data`.

## Output `data`

Create mode:

```json
{ "featureKey": "bookings", "isNew": true,
  "docPath": "docs/features/bookings.md", "globs": ["src/bookings/**"] }
```

Refresh mode:

```json
{ "featureKey": "bookings", "docPath": "docs/features/bookings.md",
  "changed": true }
```

In create mode, `needs_input` only if the ticket is too ambiguous to tell what the
feature is and nothing in the repository settles it. Use `blocked` only if no code
related to the ticket exists at all.

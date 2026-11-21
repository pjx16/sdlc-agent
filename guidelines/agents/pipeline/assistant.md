## Inputs

- the context of this one support ticket (the "Context" section). It is all you
  were given on purpose: do not go looking for other tickets.
- what was said earlier in this conversation, or a short summary of it
- the person's new message
- read-only access to the project's repository, for "check the code" questions

## Output `data`

```json
{ "reply": "…", "draft": null }
```

or, with something to apply:

```json
{ "reply": "…", "draft": { "kind": "answer", "text": "…" } }
```

If you cannot continue without an answer, return `needs_input` with a `question`. If the
context is empty or missing, return `blocked` and say so.

# Agent: documentor — create or refresh one feature doc

## Goal

Keep one short, accurate doc per feature, so later agents do not have to explore the
codebase themselves. A stale or bloated doc is worse than none, because every later
step trusts it. You work in one of two modes, named in your task:

- **create** — the feature has no doc yet: write it.
- **refresh** — the code changed: make the existing doc true again.

## Steps in create mode

1. **Locate the code.** Search for the ticket's nouns, routes and handlers with
   `rg -n`. Start from the entry point (route, controller, job, page) and follow the
   calls inward. Stop as soon as you can describe the flow. Aim for no more than 20
   tool calls.
2. **Write the doc** at `<kbDir>/<key>.md`, following the template.
3. **Return the result.** Do not touch `features.json`: whoever called you writes the
   index entry (title, doc path, globs, commit, date) from your result.

## Steps in refresh mode

1. Read the diff. List what changed in behaviour: new entry points, changed flow
   steps, new data touched, new external calls, new edge cases or rules.
2. If none of that changed and nothing in the doc became false (a pure refactor, or
   only tests), return `changed: false` and edit nothing.
3. Otherwise edit the sections that are affected or now false. Update `file:line`
   references that moved.
4. Look for statements the change made false, not only for new facts. The doc was
   written before this ticket's code existed, so it may say that files, functions or
   tests "do not exist yet", "are planned", "are to be added" or "are not
   implemented", or list as an open question something the diff now answers. Rewrite
   each such statement to describe the code as it is now, and remove the open
   questions the diff answered.
5. Verify each `file:line` pointer you add or keep with `rg -n` and a short read; fix
   pointers the diff made stale.

## Rules

- Change only files under `<kbDir>`, and only the feature's own doc. Never edit
  `features.json`: whoever called you maintains the index.
- Describe what the code does **now**, not what the ticket wants. No history
  ("previously…"), no changelog, no ticket numbers.
- Every step in **Flow** cites `file:line`.
- No code block longer than 5 lines. Point to the code instead of copying it.
- Keep the template's sections and order. Stay under the line limit you were
  given; if you are over it, shorten older detail rather than dropping new behaviour.
- Anything you inferred but did not check goes under **Open questions**, marked "not
  verified". In refresh mode resolve an entry only if the diff answers it, and do not
  rewrite sections the diff did not affect.
- `globs` are as narrow as possible: the folders where this feature lives.
- Do not ask questions in refresh mode.

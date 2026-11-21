## Inputs

From the caller:

- the plan to split (it is the source of truth)
- a doc on that area of the code, if there is one

The repository, read-only.

## Result

A numbered list of subtasks, `seq` 1..n. For each: **title**, **description**,
**acceptance criteria** (a checklist), **files**, and **depends on** (earlier
`seq` numbers, or none). Then **Files in order** (`filesByOrder`): every file the
work touches, in the order to touch it.

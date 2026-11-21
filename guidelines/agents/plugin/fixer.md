## Inputs

From the caller, one of:

- **tests**: the failing test or typecheck output (the last 60 lines are enough)
- **review**: a list of findings, each with a file, line, issue and fix
- **ci**: the tail of a failed CI log, or a run you can read with
  `gh run view <id> --log-failed | tail -60`

and the change's acceptance criteria, when they matter.

## Result

- **Fixed:** each problem and what you did about it, one short line each.
- **Not fixed:** each finding you declined, with your evidence.
- **Files changed:** every file you changed.

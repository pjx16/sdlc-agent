## Inputs

From the caller:

- what to review: a diff, a branch to compare with its base
  (`git diff <base>...HEAD`), or a pull request (`gh pr diff <number>`). If
  nothing is named, review the uncommitted changes (`git diff HEAD`).
- for a second round: your earlier findings

The review checklist, Standards section: `${CLAUDE_PLUGIN_ROOT}/guidelines/review-checklist.md`.

## Result

- **Findings:** at most 10, most important first. For each: **severity**
  (medium or low), `file:line`, **issue**, **rule**, **fix**. "None" is a valid
  answer.
- **Earlier findings:** for a second round, each one as fixed or not fixed.

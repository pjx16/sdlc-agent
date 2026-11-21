## Inputs

From the caller:

- what to review: a diff, a branch to compare with its base
  (`git diff <base>...HEAD`), or a pull request (`gh pr diff <number>`). If
  nothing is named, review the uncommitted changes (`git diff HEAD`).
- what made it risky, if the caller knows (the files or lines to start from)
- for a second round: your earlier findings

The review checklist, Security section: `${CLAUDE_PLUGIN_ROOT}/guidelines/review-checklist.md`.

## Result

- **Findings:** at most 10, most severe first. For each: **severity**,
  `file:line`, **issue** (the path the input takes and what an attacker gains),
  **rule**, **fix**. "None" is a valid answer.
- **Earlier findings:** for a second round, each one as fixed or not fixed.

## Inputs

From the caller:

- what to review: a diff, a branch to compare with its base
  (`git diff <base>...HEAD`), or a pull request (`gh pr diff <number>`). If
  nothing is named, review the uncommitted changes (`git diff HEAD`).
- the acceptance criteria the change must meet, if any. Without them, review
  correctness only and leave **Criteria** empty.
- for a second round: the earlier findings

The review checklist: `${CLAUDE_PLUGIN_ROOT}/guidelines/review-checklist.md`.

## Result

- **Findings:** at most 10, most severe first. For each: **severity**,
  `file:line`, **issue**, **rule**, **fix**. "None" is a valid answer.
- **Criteria:** each acceptance criterion with met (yes/no), tested (yes/no) and
  a note.
- **Earlier findings:** for a second round, each one as fixed or not fixed.

Only critical and high block the merge.

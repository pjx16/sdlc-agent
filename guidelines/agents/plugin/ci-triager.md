## Inputs

From the caller: the failing log, or a run to read. With a GitHub Actions run,
read the failure yourself: `gh run view <id> --log-failed | tail -120`. Read
only; do not re-run anything.

- the name of the failing check, if known
- how many times it was already re-run, if known

## Result

- **Kind:** code, flaky or infra.
- **Failing command** (`failingCommand`): quoted exactly, when the log shows it.
- **Why:** one or two sentences a developer can act on (this is also your
  summary).

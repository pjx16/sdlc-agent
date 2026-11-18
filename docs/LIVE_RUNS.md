# Live end-to-end runs

The only runs of sdlc-agent against live Claude so far, kept here so the README can stay short. Everything else is tested against the stand-in in `test/fake-claude`.

Run on 2026-11-12 with live Claude, Docker Compose, and a private scratch repository (TypeScript, one `add` function with a Vitest test) on branch `dev`. The ticket was pasted into the dashboard:

> **LIVE-1 – Add a multiply function.** Add `multiply(a, b)` to `src/math.ts`, with tests covering positive numbers, zero and negatives.

Result: **it reached `DONE`**. The pipeline went NEW → PLANNING → plan approved → BREAKDOWN (1 subtask) → breakdown approved → IN_PROGRESS → REVIEW → KB_UPDATE → AWAITING_CI → IN_HUMAN_REVIEW. The ticket moved to `DONE` about a minute after the PR was squash-merged on GitHub. The PR had four commits (`docs` KB build, `test:`, `feat:`, `docs` KB update), ready for review, with a review summary comment. The review stage found nothing to fix in its one round. The scratch repository has no CI, so "checks passed" was immediate.

Tokens (all stages, 24 h window): about **184,000** in total. kbBuild 20k, plan 20k, breakdown 23k, tests 54k (three rounds, see below), implement 22k, review 21k, kbUpdate 23k. Models were the defaults (Opus for the plan, Sonnet for the rest, Haiku for the breakdown).

What went wrong (the first two are fixed, the last two remain):

- **npm cache volume was root-owned**, so every dependency install in an agent container failed (`EACCES` on `/npm-cache`). The agent Dockerfile now creates `/npm-cache` owned by `node`. An *existing* volume needs a one-off `chown`.
- **The worker refused the workspace** ("dubious ownership"): workspaces are written by the agent user (uid 1000), the worker is root. The worker image now sets `safe.directory '*'`, and every worker git call also passes `core.fsmonitor=false` (hooks were already disabled), so a workspace's own git config cannot run code in the worker.
- **A failed first install left a half-installed `node_modules`**, and a retry skips the install when `node_modules` exists, so the tests stage held twice ("Cannot find module"). I reinstalled by hand and pressed Retry. Not fixed: a failed install should remove `node_modules`. Until then, delete the workspace's `node_modules` *and* reinstall, or delete the workspace.
- A held ticket's **Retry restarts only the subtask loop**; it does not redo the workspace install.

A second run on a two-function ticket (`slugify` and `truncate`) produced a ready PR with six commits, 17 passing tests and a clean typecheck. It also showed two problems that are now fixed: the ticket text was sent under the wrong field name and silently dropped (the API now rejects unknown fields), and the knowledge-base doc kept "does not exist yet" notes (the `kbUpdate` stage now rewrites them).

Not exercised in these runs: a review that finds issues, CI failures, support queries, Jira, the usage gate pausing a run, and a multi-subtask ticket.

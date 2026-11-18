# Architecture

The architecture is documented once per version, so you can see what the system looked like at each release and how it changed.

| Version | Status | Folder |
| --- | --- | --- |
| **1.1.0** | Current | [`v1.1.0/`](./v1.1.0/README.md): adds the optional token broker and per-project GitHub access, the single plan gate, self-recovery, PR size limits |
| 1.0.0 | Previous | [`v1.0.0/`](./v1.0.0/README.md): system, trust boundaries, ticket lifecycle, subtask loop, worker loop, stages, data model, design decisions |

Each version folder holds a `README.md` and a `diagrams/` folder with its SVG files.

## How versions work

- A version folder is a snapshot of the architecture at that release. Fix mistakes in it; do not rewrite it for later changes.
- When a release changes the architecture (a new service, image or hop; a change to who holds a secret or what a container can reach; a new ticket state, hold reason, stage or housekeeping job; a changed design decision), copy the latest folder to `vX.Y.Z/`, edit the copy, and add a row to the change log below. Do this in the same pull request as the change, or in the release pull request at the latest.
- Releases that change nothing structural (bug fixes, small refactors, copy changes) get no folder and no row.
- The newest folder is the current architecture. Update the "Current" row in the table above and the diagram links in the root [`README.md`](../../README.md) when you add one.
- The project follows [semantic versioning](https://semver.org/): a new service or a change to the trust boundaries is a minor or major version, never a patch.

## Architecture change log

Newest first. One row per version folder, plus any fix worth recording.

| Date | Version | Change | Why | PR |
| --- | --- | --- | --- | --- |
| 2026-11-14 | 1.1.0 | New optional service `apps/broker` (the token broker) and a per-project choice of GitHub access: the personal token, or the sdlc-agent GitHub App as `sdlc-agent[bot]` with one-hour, single-repository tokens. New credentials `broker_url`, `broker_key`; `Project.githubAuth`; the worker picks the token per call | A user can try the pipeline without giving a personal token, and no secret that spans users is shipped to their system | #49 |
| 2026-11-14 | 1.1.0 | The plan is the only approval gate: it lists the subtasks and the breakdown runs by itself. `AWAITING_BREAKDOWN_APPROVAL` stays in the state table for tickets already waiting, and the setting is ignored | A second approval looped the person in without adding a decision | #49 |
| 2026-11-14 | 1.1.0 | Self-recovery: a `needs_help` hold first goes to the orchestrator (decision point `recovery`: retry or redo tests with a note, 3 attempts by default). Every orchestrator decision is stored, shown in the Decisions tab and commented on Jira | Stuck steps (an invalid red test, a failed push) were sending the person back in repeatedly | #49 |
| 2026-11-14 | 1.1.0 | A push blocked only by the pipeline's own earlier commits is replaced with `--force-with-lease` pinned to the inspected remote commit; commits by anyone else are never replaced | A rerun rebuilds the branch, so GitHub still held the superseded attempt and every push was rejected | #49 |
| 2026-11-14 | 1.1.0 | Pull request size is measured after every subtask against `limits.prSoftLines` and `limits.prHardLines` (new `Ticket.prDiffLines`, `prSizeLevel`); reported to Jira and the PR, never blocking | Keep pull requests reviewable | #49 |
| 2026-11-14 | 1.1.0 | Claude's `allowed_warning` no longer pauses the pipeline (a banner shows); the CI fixer gets a report of every failing check; the worker checks the agent image every minute (`WorkerStatus.agentImageError`) and records what it is doing during installs and test runs | A fixed 75% weekly warning paused work below the configured thresholds; CodeQL failures reached the fixer as "no log"; a deleted agent image only showed up as a Docker error | #49 |
| 2026-11-14 | 1.1.0 | The agent proxy also allows Prisma's binary host (`binaries.prisma.sh`) | `prisma generate` in a target repository failed its install with a 403 | #49 |
| 2026-11-12 | 1.0.0 | Agent image creates `/npm-cache` owned by `node`; worker image sets `safe.directory '*'`; worker git calls pass `core.fsmonitor=false` | The first live run failed on cache ownership and on git refusing agent-owned workspaces | #15 |
| 2026-11-12 | 1.0.0 | Ticket creation rejects unknown fields; the `kbUpdate` stage rewrites statements the change made false | A mistyped field silently dropped the ticket body; KB docs kept "does not exist yet" notes | #15 |
| 2026-11-12 | 1.0.0 | First architecture snapshot: milestones 0 to 13 | Initial release | #1 to #16 |

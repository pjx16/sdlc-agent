# Documentation

Start with the root [`README.md`](../README.md) (what it is, install, security model). The rest is here.

| Document | Read it to |
| --- | --- |
| [`CONFIGURATION.md`](./CONFIGURATION.md) | See every environment variable, the token permissions, and what is set per project |
| [`TRACKER.md`](./TRACKER.md) | Connect Jira: which tickets are picked up, approvals, write-back, failures |
| [`CONFLUENCE.md`](./CONFLUENCE.md) | Publish plans to Confluence |
| [`BOT.md`](./BOT.md) | Work as `sdlc-agent[bot]` instead of with a personal token, or run the token broker |
| [`architecture/`](./architecture/README.md) | Understand how the system is put together, per version, with diagrams |
| [`LIVE_RUNS.md`](./LIVE_RUNS.md) | See what has been run against live Claude, and what went wrong |
| [`kb/`](./kb) | Read the project's own knowledge base (per-feature docs the pipeline maintains for this repository; `features.json` is its index) |

Elsewhere: [`CHANGELOG.md`](../CHANGELOG.md), [`CONTRIBUTING.md`](../CONTRIBUTING.md), [`SECURITY.md`](../SECURITY.md), [`SUPPORT.md`](../SUPPORT.md), [`GOVERNANCE.md`](../GOVERNANCE.md), [`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md), [`packages/cli/README.md`](../packages/cli/README.md) (the installer), [`guidelines/`](../guidelines) (what the agents are told).

Documentation rules: describe what is built, not what is planned; change the docs in the same pull request as the behaviour; a structural change gets a new architecture version (see [how versions work](./architecture/README.md#how-versions-work)).

# Governance

sdlc-agent is a small project with a single maintainer today. This page says who decides what, so contributors know what to expect.

## Roles

- **Maintainers** review and merge pull requests, triage issues, cut releases and handle security reports. They are listed in [`MAINTAINERS.md`](./MAINTAINERS.md) and in [`.github/CODEOWNERS`](./.github/CODEOWNERS).
- **Contributors** are everyone who opens an issue, a discussion or a pull request.

## How decisions are made

- Day-to-day changes are decided in the pull request: a maintainer's approval and green CI are enough to merge.
- Larger changes (a new integration, a change to the security model, the data model or the scope in the README) start as an issue or discussion. The maintainers decide after hearing the people involved, and record the outcome there; architectural decisions also go in `docs/architecture/`.
- While there is one maintainer, that maintainer has the final say. Once there are several, decisions are made by consensus of the maintainers, and by majority if consensus cannot be reached.

## Becoming a maintainer

Contributors who have made sustained, high-quality contributions (code, reviews, triage or docs) over several months may be invited by the existing maintainers. A maintainer who is inactive for six months may be moved to emeritus status, and can return by asking.

## Releases

Maintainers cut releases from `dev` with `scripts/release.sh`, following [semantic versioning](https://semver.org/) and the steps in [`CONTRIBUTING.md`](./CONTRIBUTING.md#cutting-a-release). Every release has notes in [`CHANGELOG.md`](./CHANGELOG.md).

## Changes to this document

Changes to governance are made by pull request and need the approval of all active maintainers.

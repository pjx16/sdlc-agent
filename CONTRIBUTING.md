# Contributing

The project is in `0.0.x` pre-release and built in public. Bug reports and feedback are welcome through issues. Pull requests are not accepted yet, except small fixes agreed in an issue first.

## How to help right now

- Open an issue for [bugs](https://github.com/pjx16/sdlc-agent/issues/new?template=bug_report.yml) or [feature ideas](https://github.com/pjx16/sdlc-agent/issues/new?template=feature_request.yml).
- Check the scope first (see [Scope and known limitations](./README.md#scope-and-known-limitations) in the README): features outside it will not be accepted.
- For security problems, do not open an issue. Follow [`SECURITY.md`](./SECURITY.md).

## Development setup

You need Node.js 24 or later, npm (Turborepo runs the workspaces), Git and Docker (for integration tests and the full stack).

```bash
git clone https://github.com/pjx16/sdlc-agent.git
cd sdlc-agent
npm ci
cp .env.example .env     # then fill in the values the file asks for
npm run up:dev           # the full stack in Docker, development mode
```

See the [README](./README.md#run-from-source) for the details of a source install and the layout of the repository.

## Checks to run before a pull request

```bash
npm run lint
npm run typecheck
npm test            # unit tests, no Docker needed
npm run test:int    # integration tests (needs Docker)
npm run test:e2e    # browser tests (first run: npx playwright install chromium)
```

CI runs the same checks. A change that touches only documentation needs just a read-through.

## Branches, commits and pull requests

- Branch from `dev` and give the branch a type prefix: `feat/`, `fix/`, `chore/`, `docs/`.
- Use [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `test:`, `build:`, `ci:`, `chore:`). Keep one logical change per commit.
- Open the pull request against `dev` and fill in the template. Keep it small: one concern per pull request.
- Add an entry under `## [Unreleased]` in [`CHANGELOG.md`](./CHANGELOG.md) for anything a user would notice.
- A maintainer reviews every pull request (see [`CODEOWNERS`](./.github/CODEOWNERS)). CI must pass before merge.

## Ground rules

- Use npm and Turborepo only (no pnpm or yarn).
- Keep functions small and named after what they do; prefer boring, well-documented libraries.
- Do not add `Co-Authored-By` trailers or any AI attribution to commits.
- Never commit secrets, tokens or `.env` files.
- Never paste unredacted logs.

By participating, you agree to follow the [Code of Conduct](./CODE_OF_CONDUCT.md).

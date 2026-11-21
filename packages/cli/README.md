# sdlc-agent

Install and run **sdlc-agent**, a self-hosted, Docker-based engine that turns tickets (Jira or pasted) into reviewable pull requests with AI agents.

> [!NOTE]
> **Status: 1.0.** Releases follow [semantic versioning](https://semver.org/): a breaking change comes only in a new major version, with upgrade notes in the [CHANGELOG](https://github.com/pjx16/sdlc-agent/blob/dev/CHANGELOG.md), and `sdlc-agent upgrade` carries an install across it.
>
> **Known limits**
> - Only TypeScript/JavaScript stacks (Node.js, NestJS, Next.js) for now.
> - Single user, password login.
> - Agents run with full permissions inside their Docker containers. Don't point it at repositories you can't afford to lose, and don't run it on a machine that holds credentials you don't want exposed.
> - Spend budgets are checked between runs, so the run in progress when a budget is reached can go past it. Set a spend limit in the Anthropic Console as the hard stop.
>
> Feedback and bug reports are welcome: [open an issue](https://github.com/pjx16/sdlc-agent/issues).

This package is only a launcher. The application is the Docker images published to GHCR, at the same version as the CLI.

## Requirements

- Docker with Engine 26 or newer and Compose v2.20 or newer, on macOS or Linux (on Windows, use WSL2)
- Node.js 20 or newer
- An Anthropic API key (from the Anthropic Console) and either a GitHub token or a connection to sdlc-agent-bot (see [`docs/BOT.md`](../../docs/BOT.md)), which you enter in the browser

## Quick start

```bash
npx sdlc-agent init
```

`init` checks Docker, creates `~/.sdlc-agent`, generates the infrastructure secrets, starts the stack from the published images, and opens the dashboard. There you enter the setup code that `init` printed, create your admin password, and add your tokens. `init` asks no questions about tokens.

## Commands

| Command | What it does |
| --- | --- |
| `sdlc-agent init` | First install (`--bind <addr>`, `--no-start`, `--no-open`, `--force`) |
| `sdlc-agent up` | Pull the images and start the stack |
| `sdlc-agent down` | Stop the stack; your data is kept |
| `sdlc-agent status` | Version, containers and setup state |
| `sdlc-agent logs [service] [-f]` | Show logs |
| `sdlc-agent upgrade` | Move to this CLI's version (`--yes`, `--skip-backup`) |
| `sdlc-agent backup` | Write an encrypted database backup to `backups/` now (one is also written every day) |
| `sdlc-agent restore <file>` | Replace the database with a backup (`--yes`); works after the database volume was deleted |
| `sdlc-agent files <TICKET> [dest]` | Copy a ticket's workspace out of Docker into a folder, when you want to look at it |
| `sdlc-agent doctor` | Check Docker (Engine 26 or later, and volume sub-path mounts), the socket, port 3000 and disk space (at least 5 GB free is required, 10 GB recommended) |
| `sdlc-agent reset-admin` | Forgot the password |
| `sdlc-agent uninstall` | Stop the stack and delete its database (`--purge` also removes the folder) |

`init`, `up` and `upgrade` run the same checks. They stop when less than 5 GB is free and warn between 5 GB and 10 GB (10 GB is recommended). The space is measured on the install folder; images and the data volume live in Docker's disk, which Docker Desktop shows under Settings → Resources.

All commands accept `--dir <path>`; the default folder is `$SDLC_AGENT_HOME` or `~/.sdlc-agent`.

## Where things live

On your machine, only the install folder:

```text
~/.sdlc-agent/
  docker-compose.yml   the release compose file
  .env                 secrets and settings (mode 0600)
  guidelines/          agent instructions; edit them here or in the dashboard
  backup.sh            the daily backup script, run inside Docker
  backups/             encrypted database backups: daily, before each upgrade, and `sdlc-agent backup`
```

Inside Docker (its Linux VM on macOS and Windows): the containers, the database volume, the npm mirror and caches, and the **`sdlc_data`** volume with every repository mirror, ticket workspace and run log. No repository code is written to your disk, and agent containers mount only their own ticket's folder of that volume. The agent image is built inside Docker from the release's git tag.

**Back up `.env` separately.** Its `ENCRYPTION_KEY` encrypts the tokens you enter in the dashboard and every database backup. Without it a backup cannot be opened, and the saved tokens cannot be read.

Backups are gzipped `pg_dump` files encrypted with AES-256 (OpenSSL, a PBKDF2 key from `ENCRYPTION_KEY` with a fresh salt per file); the newest 7 daily ones are kept (`BACKUP_KEEP`). Repositories are not backed up: they are cloned again from GitHub. Work that was never pushed lives only in its workspace.

## Upgrading

Install the new CLI and run `upgrade`:

```bash
npx sdlc-agent@latest upgrade        # or: npm i -g sdlc-agent@latest && sdlc-agent upgrade
```

It prints the changelog between your version and the new one, asks for confirmation if the change may break things, writes an encrypted database backup to `backups/`, replaces the compose file, updates your guidelines, and restarts the stack. A guideline you edited is never overwritten: the new version is written beside it as `<file>.new` for you to review. Upgrading from 0.0.1 also moves your old `data/` folder into the `sdlc_data` volume (the stack is stopped while it copies) and comments `DATA_DIR` out of `.env`; delete the old folder once you are happy. Downgrades are not supported. Within a major version (1.x) an upgrade asks first only when its notes mention a breaking change; a new major version always asks.

## Forgot the password

```bash
sdlc-agent reset-admin
```

It removes the admin account, signs everyone out and prints a new setup code. Open the dashboard and create a new password. Your tokens and data are untouched.

## Uninstall

```bash
sdlc-agent uninstall            # stops the stack and deletes the database; keeps the folder (.env, backups)
sdlc-agent uninstall --purge    # also removes the folder
```

## Environment variables

- `SDLC_AGENT_HOME`: the install folder.
- `SDLC_AGENT_DEBUG=1`: print stack traces.
- `SDLC_AGENT_SKIP_DOCTOR=1`: skips the Docker checks. It exists only for this project's own tests (a CI runner without Docker); do not use it.

## Security

The package has no install scripts and no runtime dependencies, and is published by a maintainer with `scripts/release.sh`. See [SECURITY.md](https://github.com/pjx16/sdlc-agent/blob/main/SECURITY.md) for the threat model and how to report a vulnerability.

License: MIT.

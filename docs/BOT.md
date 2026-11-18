# Working as sdlc-agent-bot

A project can reach GitHub in one of two ways. You choose per project when you onboard it (and can change it later under the project's advanced settings):

| | My own token | sdlc-agent-bot |
| --- | --- | --- |
| What you provide | A personal access token in Settings → Connections | Nothing secret: you install the **sdlc-agent** GitHub App on the repository |
| Pushes, PRs, comments appear as | You | `sdlc-agent[bot]` |
| Token lifetime | Until you revoke it | One hour, for one repository, requested as needed |

## How the bot way works

```
 your system (dashboard + worker)            token broker (run by the owner of the App)            GitHub
 ─────────────────────────────────           ─────────────────────────────────────────           ───────
 Settings → "Connect sdlc-agent-bot"  ──►    registers your system, returns a key
                                      ──►    gives the install link  ───────────────────────►   you install the App,
                                                                                                  pick repositories
                                      ◄──    callback: checks (with your own GitHub login)
                                             that the installation is really yours, binds it
 project works as the bot             ──►    "token for acme/billing" (your key)
                                             finds the installation, checks it is yours,   ──►   installation token
                                      ◄──    returns a 1-hour token limited to that repo         (App key never leaves the broker)
```

* The App's private key stays on the broker. Your system only holds a broker key, which can only ask for tokens for installations you connected.
* The token is limited to one repository and to what the pipeline needs: contents, pull requests and issues (read/write); actions, checks, statuses, code scanning (read). No administration, no workflows.
* Commits are authored as `sdlc-agent[bot]` with its no-reply address, so GitHub shows the bot.

### As a user
1. Settings → Connections → **Connect sdlc-agent-bot**. GitHub opens; install the App and choose the repositories.
2. Onboard the project and pick **sdlc-agent-bot**. If the App is not on that repository the onboarding stops and gives you the install link; run it again afterwards.
3. Projects that pick **My own token** keep using the GitHub token from Settings. The GitHub token is only required while at least one project needs it: a system connected to the broker is not blocked without it.

By default a system talks to `https://broker.sdlc-agent.dev`. To use another broker set `BROKER_URL` in `.env` (or the broker URL in Settings).

## Running the broker (for the owner of the App)

### 1. Create the GitHub App (once)
GitHub → Settings → Developer settings → GitHub Apps → New GitHub App.

* **Name / slug:** `sdlc-agent` (the slug is `GITHUB_APP_SLUG`; the bot is then `sdlc-agent[bot]`).
* **Setup URL:** `https://<broker>/install/callback`, and tick **Redirect on update**.
* **Request user authorization (OAuth) during installation:** tick it. The broker uses it to prove that the person who installs the App really sees that installation. Without it a callback could be forged.
* **Webhook:** untick Active (not needed).
* **Repository permissions:** Contents *read and write*, Pull requests *read and write*, Issues *read and write*, Actions *read*, Checks *read*, Commit statuses *read*, Code scanning alerts *read*, Metadata *read*.
* **Where can this App be installed:** Any account.
* Create it, then: note the **App ID** and **Client ID**, generate a **client secret**, and generate a **private key** (a `.pem` file).

### 2. Run the service
```bash
docker build -t sdlc-agent-broker -f apps/broker/Dockerfile .
docker run -d --name sdlc-broker -p 8080:8080 -v sdlc-broker-data:/data \
  -e GITHUB_APP_ID=... -e GITHUB_APP_SLUG=sdlc-agent \
  -e GITHUB_APP_CLIENT_ID=... -e GITHUB_APP_CLIENT_SECRET=... \
  -e GITHUB_APP_PRIVATE_KEY="$(cat sdlc-agent.private-key.pem)" \
  -e BROKER_PUBLIC_URL=https://<broker> \
  sdlc-agent-broker
```
Put it behind HTTPS (the setup URL and the dashboard's `BROKER_URL` must be https). `GET /health` answers `{ "ok": true }`.

| Variable | Meaning |
| --- | --- |
| `GITHUB_APP_ID`, `GITHUB_APP_SLUG` | The App |
| `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET` | For verifying the installer (OAuth) |
| `GITHUB_APP_PRIVATE_KEY` | The PEM itself (newlines as `\n` are fine) or a path to the file |
| `BROKER_PUBLIC_URL` | The broker's public https URL |
| `BROKER_DATA_FILE` | Where it keeps its small state (default `/data/broker.json`) |
| `PORT` | Default 8080 |

### Limits to know
* The broker stores only a hash of each system's key and which installation belongs to which system. Losing the file means systems have to connect again.
* At most 20 new systems can register per address per hour.
* Pushing changes to `.github/workflows` needs the *Workflows* permission, which the tokens do not have on purpose.

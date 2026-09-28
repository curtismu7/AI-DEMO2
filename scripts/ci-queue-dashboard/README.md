# Local GitHub Actions queue dashboard

This small local page shows this checkout's queued and running GitHub Actions jobs, recent completed runs, and the runner assigned to each job when GitHub reports one. It is read-only and does not manage workflow runs or runner registrations.

## Requirements

- Node.js 22 or newer.
- GitHub CLI (`gh`) installed and authenticated for `github.com`.
- Read access to this repository's Actions runs and jobs.
- Run the command from the repository root.

## Start

```sh
gh auth login
npm run ci:dashboard
```

Open the `http://127.0.0.1:<port>` address printed in the terminal. The dashboard refreshes about every 15 seconds. Queued runs are ordered oldest-first as a queue estimate; GitHub controls the actual scheduling order. Use **Refresh now** to request an immediate update, and press Ctrl-C in the terminal to stop the server.

## Authentication and local access

The server calls the installed `gh` command for read-only GitHub API requests. It does not read or copy the CLI credential, and the browser receives only workflow and job metadata. The server listens only on `127.0.0.1`, rejects foreign host/origin headers, and exposes no mutation endpoints. Nothing is deployed or shared with another machine.

If the dashboard says GitHub CLI authentication is unavailable, run `gh auth status` to check the active login, then run `gh auth login` if needed. If Actions data cannot be loaded, confirm the active GitHub account has repository Actions read access and retry.

## Focused tests

```sh
npm run test:ci-dashboard
```

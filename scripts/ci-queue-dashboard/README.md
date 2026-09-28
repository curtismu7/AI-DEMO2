# Local GitHub Actions queue dashboard

This local page shows this checkout's queued and running GitHub Actions jobs, recent results, and runner assignments. It can stop a run, rerun failed jobs, pause or resume workflows, and pause or resume this Mac's matching self-hosted runner when it is idle.

## Requirements

- Node.js 22 or newer.
- GitHub CLI (`gh`) installed and authenticated for `github.com`.
- Read access to this repository's Actions runs, jobs, workflows, and runners.
- Actions write permission to stop or rerun runs and pause or resume workflows.
- Repository Administration read access to list self-hosted runners.
- Run the command from the repository root.

## Start

```sh
gh auth login
npm run ci:dashboard
```

Open the `http://127.0.0.1:<port>` address printed in the terminal. The dashboard refreshes about every 15 seconds. Queued runs are ordered oldest-first as a queue estimate; GitHub controls the actual scheduling order. It shows queued workflow/job counts, active runtime, and an estimated time remaining based on the median duration of up to five recent completed runs of the same workflow. If there is no comparable history, the estimate is unavailable. Use **Refresh now** to request an immediate update, and press Ctrl-C in the terminal to stop the dashboard server.

## Controls

- **Stop run** cancels a queued or running workflow run. **Rerun failed jobs** retries the failed jobs in a completed run.
- **Pause workflow** disables new runs for that workflow; runs already in progress continue. **Resume workflow** enables it again.
- **Pause runner** stops this Mac's matching launchd runner service so it no longer accepts jobs. It is disabled while GitHub reports the runner busy. **Resume runner** starts a service paused from this dashboard.
- The page asks for confirmation before a change. The server rechecks current run/workflow/runner state before dispatching it. If GitHub denies write access, it shows a permission error and does not echo CLI output.

## Authentication and local access

The server calls the installed `gh` command using fixed argument arrays. It does not read or copy the CLI credential, and the browser receives only workflow and job metadata. GitHub changes happen only after you confirm an action in the page. Runner controls use fixed `launchctl` operations for the matching repository runner service and are unavailable on other operating systems or when that service is not loaded. The server listens only on `127.0.0.1` and rejects foreign host/origin headers. Nothing is deployed or shared with another machine.

If the dashboard says GitHub CLI authentication is unavailable, run `gh auth status` to check the active login, then run `gh auth login` if needed. If Actions data cannot be loaded, confirm the active GitHub account has repository Actions and Administration read access and retry. If controls are denied, check the active account's Actions write permission. Runner pause/resume is available only from the Mac that hosts the matching launchd service.

## Focused tests

```sh
npm run test:ci-dashboard
```

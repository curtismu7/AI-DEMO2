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

The command starts the dashboard server. Then open <http://127.0.0.1:57500/>. Keep this process running before using the demo's CI queue navigation entry. The server listens only on loopback, so it is available from this machine and is not shared with other machines. The dashboard refreshes about every 15 seconds. Queued runs are ordered oldest-first as a queue estimate; GitHub controls the actual scheduling order. It shows queued workflow/job counts, total active runtime, the elapsed time for each current step, and an estimated time remaining based on the median duration of up to five recent completed runs of the same workflow. If there is no comparable history, the estimate is unavailable. Use **Refresh now** to request an immediate update, and press Ctrl-C in the terminal to stop the dashboard server.

## Controls

- **Stop run** cancels a queued or running workflow run. **Rerun failed jobs** retries the failed jobs in a completed run.
- **Pause workflow** disables new runs for that workflow; runs already in progress continue. **Resume workflow** enables it again.
- **Pause runner** stops this Mac's matching launchd runner service so it no longer accepts jobs. It is disabled while GitHub reports the runner busy. **Resume runner** starts a service paused from this dashboard.
- The page asks for confirmation before a change. The server rechecks current run/workflow/runner state before dispatching it. If GitHub denies write access, it shows a permission error and does not echo CLI output.

## Insights

These come from a separate `/api/insights` request. If it fails, the queue still renders without them.

- **Main is red** names the failing jobs of the latest completed CI run on `main`, and the oldest failure since the last green run (the merge to look at first). Cancelled runs are ignored. A newer run still in progress is not reflected until it finishes.
- **Stale runs** are queued or running `pull_request` runs whose pull request has already merged or closed. **Stop stale runs** asks once, then cancels only those.
- **Duplicate** marks a later active run of the same workflow on the same commit, for example a manual run next to the PR run.
- **This Mac** shows the 1-minute load average against the core count and the five busiest processes. Load well above the core count slows every job.
- **Slowest step** on a running job compares each step with its typical duration, taken from the completed runs on screen. It turns red when a step is well over typical.
- **Time to result by day** is the median time from trigger to pass or fail. GitHub's run list does not say when a runner picked a run up, so queue wait and run time are not separated.
- **Workflow log** (under Workflows) records pause and resume changes, and whether each came from this dashboard or from outside it (`gh`, the GitHub UI, another session). It is kept in memory and resets when the server restarts.

Insights read the 100 most recent runs and are cached for 30 seconds.

## Authentication and local access

The server calls the installed `gh` command using fixed argument arrays. It does not read or copy the CLI credential, and the browser receives only workflow and job metadata. GitHub changes happen only after you confirm an action in the page. Runner controls use fixed `launchctl` operations for the matching repository runner service and are unavailable on other operating systems or when that service is not loaded. The server listens only on `127.0.0.1` and rejects foreign host/origin headers. Nothing is deployed or shared with another machine.

If the dashboard says GitHub CLI authentication is unavailable, run `gh auth status` to check the active login, then run `gh auth login` if needed. If Actions data cannot be loaded, confirm the active GitHub account has repository Actions and Administration read access and retry. If controls are denied, check the active account's Actions write permission. Runner pause/resume is available only from the Mac that hosts the matching launchd service.

## Focused tests

```sh
npm run test:ci-dashboard
```

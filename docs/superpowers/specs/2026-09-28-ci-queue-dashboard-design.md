# Local GitHub Actions Queue Dashboard

## Status

Design and spec approved in chat on 2026-09-28. The local control, runner, and runtime-estimate extension was approved in chat on 2026-09-28. Implementation plan: `docs/superpowers/plans/2026-09-28-ci-queue-dashboard.md`.

## Problem

CI activity is currently inspected through the GitHub Actions website and CLI. On a single self-hosted runner, it is difficult to see at a glance which runs are waiting, which job is using the runner, and how the queue changes over time. The dashboard should make that state visible without adding a GitHub credential to the demo application or browser.

## Goals

- Show recent GitHub Actions workflow runs for this repository.
- Show each run's jobs and their current status, including queued/waiting, in progress, and completed outcomes.
- Show useful timing and runner details when GitHub supplies them.
- Show workflow and job counts, active runtime, and a clearly marked remaining-time estimate from recent completed runs of the same workflow.
- Refresh automatically and make data freshness visible.
- Use the machine's existing GitHub CLI login without reading, copying, or returning its credential.
- Keep the tool local; allow explicit run/workflow actions and local idle-runner controls.

## Non-goals

- Approve, dispatch, delete, register, or reconfigure workflows/runners.
- Embed the dashboard in the banking demo or expose it to other machines.
- Provide organization-wide or multi-repository reporting.
- Promise exact GitHub scheduler ordering. Queued runs may be displayed oldest-first by creation time as an estimate; GitHub remains responsible for scheduling.

## Approaches considered

1. **Standalone local page backed by the `gh` CLI (recommended).** A small Node server runs GitHub CLI commands with fixed arguments and serves a local page. It inherits `gh`'s existing authentication and does not handle credential values itself.
2. **Demo BFF endpoint backed by a configured GitHub token.** This integrates with the existing app, but requires provisioning a token in the demo server environment and couples a personal CI monitor to the demo's auth and deployment lifecycle.
3. **Browser calls GitHub directly.** This would require giving the browser a token or another credential-bearing proxy, so it is rejected.

## Proposed architecture

- Add a small standalone tool under `scripts/ci-queue-dashboard/`, launched from the repository root through a documented npm script.
- The Node server binds only to `127.0.0.1` and serves the static dashboard plus JSON read and action endpoints. It uses `child_process.spawn` with fixed executables and argument arrays (no shell interpolation). Repository context comes from the checked-out repository; the user cannot pass an arbitrary owner/repository or command through the HTTP API.
- Use fixed `gh api` GET requests through the CLI's stored authentication: separate Actions-runs listings for queued, waiting, pending, requested, and in-progress work; a small completed-history listing; and bounded jobs requests for those runs. Fetch all active runs plus a small recent-history window, so the runner queue is visible without issuing one request for every historical run. Normalize the responses into run/job identifiers, workflow and branch names, run/job status and conclusion, creation/start/completion timestamps, and runner name/group/labels when available. A sample queued job exposes the queued status and labels but no assigned runner name, so the page must render an unassigned/queued state clearly. Raw CLI output and authentication material are never sent to the page. Missing `gh`, missing authentication, permission errors, and API failures produce a visible, actionable dashboard error with no token details.
- The page groups jobs under their workflow runs, orders queued runs by creation time, distinguishes queue estimate from active work and completed history, and links each run to GitHub. It shows a last-updated time and refreshes every 15 seconds. If a refresh fails, the last successful snapshot remains visible with a stale/error indicator.
- Keep the list bounded to recent runs and prioritize all active runs, so refresh work stays predictable. Poll the bounded data set every 15 seconds and avoid spawning a command/request for every historical run.
- Mutations are allowed only through the fixed local action route after user confirmation in the page. The server rechecks the selected run/workflow/runner state before acting. The browser receives no GitHub credential. Bind to loopback, avoid enabling CORS, and accept requests only for the local dashboard origin/host.

## User experience

- Header identifies the repository and shows current data freshness.
- Summary counts show queued/waiting, in-progress, successful, and failed/cancelled work within the displayed runs.
- Each run row shows workflow, branch, event, run status/conclusion, elapsed or completed time, and a link to GitHub.
- The waiting and active summaries show workflow-run and job counts. Active runs show elapsed runtime and remaining time estimated from the median of up to five recent completed runs of the same workflow; the page states when no estimate is available.
- Per-run actions stop queued/running runs and rerun failed jobs in completed failed runs. Workflow controls pause/resume new workflow runs. Local runner controls pause/resume only the matching idle macOS launchd service.
- Expanded or directly nested job rows show job status/conclusion, wait/run timing when available, and runner name when assigned.
- Active and queued work is visually prominent; completed runs are included as recent history.
- The page includes an explicit empty state, a first-load state, a stale-data state, and a clear error if the `gh` login is unavailable.

## Security and privacy

- Reuse authentication solely through the installed `gh` CLI. Do not call `gh auth token`, read CLI credential files, copy credentials into environment variables, or emit CLI auth output to the browser.
- Use fixed API methods and paths with validated identifiers; never pass request parameters as shell text. Runner-service commands use an exact derived service label, only `launchctl list`, `stop`, and `start`, and `shell: false`.
- Listen only on loopback and do not enable CORS. The page is for the local machine, not a shared service.
- Limit the response to workflow/job metadata needed for the dashboard; do not return logs, artifacts, workflow secrets, or arbitrary command output.

## Verification and acceptance criteria

- Unit tests cover response normalization, status/conclusion rendering, queue ordering, and CLI failure handling.
- Unit and HTTP tests cover the fixed mutation map, stale state refusal, same-origin action boundary, busy-runner refusal, and exact launchd service matching.
- A local smoke check confirms the server binds to loopback, serves the page, refreshes data from an authenticated `gh` session, and returns a useful error when `gh` is unavailable or unauthenticated.
- Static checks/build and any focused tests pass for the implementation's touched files.
- Inspect the served page to confirm it contains no token or raw auth output and that polling updates run/job status.

## Implementation boundary

Expected changes are limited to the new `scripts/ci-queue-dashboard/` tool, its focused tests, and a root npm script/documentation entry. No changes are expected in `demo_api_server/`, `demo_api_ui/`, OAuth/auth requirements, or deployment configuration.

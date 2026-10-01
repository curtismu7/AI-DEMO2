# CI Queue Dashboard Demo Navigation Integration

## Status

Design approved in chat on 2026-09-28. Related pull request: #383. The
implementation plan is being prepared.

## Problem

The local GitHub Actions queue dashboard exists as a standalone Node server and
uses the machine's existing GitHub CLI login. The demo currently has no
navigation entry to open it. The dashboard server selects an ephemeral port,
so a stable destination is needed before the demo can link to it.

## Goals

- Add **CI Queue Dashboard** under the existing **Monitoring** navigation group.
- Open the standalone dashboard in a new browser tab.
- Give the dashboard a stable default local address at
  `http://127.0.0.1:57500`.
- Preserve the dashboard's existing run, workflow, and idle local runner
  controls, including the confirmed **Rerun failed jobs** action for failed
  completed runs.
- Add a per-run detail panel inside the dashboard that explains run timing
  and shows job and step progress.
- Keep GitHub authentication inside the local `gh` process.

## Non-goals

- Embed the dashboard in the demo UI or proxy its API through the demo BFF.
- Make the dashboard available to other machines or deploy it remotely.
- Change the dashboard's GitHub permissions, action confirmations, or local
  runner control policy.
- Add an in-demo GitHub login or copy GitHub credentials into the demo.

## Design

### Navigation and launch

Add a child action named **CI Queue Dashboard** to the visible **Observability**
group in `AdminSideNav`. The rendered group is composed from entries in the
legacy Monitoring list. The action opens `http://127.0.0.1:57500/` in a new tab
using `noopener,noreferrer`, matching the existing external-tool navigation
pattern. Update the navigation structure catalog and its tests so the item
remains available to Demo Config's navigation picker and does not drift from
the rendered sidebar.

Set the standalone dashboard's default listen port to `57500`; callers and
tests may still pass an explicit port. The process continues to bind only to
`127.0.0.1`. If the dashboard process is not running, the browser reports the
local page as unavailable; the existing `npm run ci:dashboard` command starts
it. If the port is occupied, startup keeps its safe error message and exits
without binding elsewhere, so the sidebar destination remains deterministic.

### Data flow and trust boundary

The demo sidebar opens the local dashboard directly. Its browser page continues
to call only the standalone Node server, which calls `gh` using the machine's
stored login. No GitHub credential, action request, or dashboard response
passes through the demo UI, BFF, or demo session. The dashboard remains
loopback-only and keeps its existing Host/Origin checks, same-origin action
route, server-side fresh-state checks, and confirmation prompts.

### User-visible actions

The existing dashboard already provides run cancellation, rerunning failed
jobs, workflow pause/resume, and pause/resume for this checkout's idle local
runner service. The navigation change exposes those existing actions by opening
the dashboard. This integration does not add a second implementation of those
controls inside the demo UI.

Each run card also has a **Run details** action that opens an accessible detail
panel in the dashboard. The panel separates time waiting for a runner from
workflow execution time, and lists each job and its steps with status and
elapsed time. An in-progress step is identified as current. Missing timestamps
or steps are labeled unavailable rather than guessed. Opening or closing the
panel does not perform a GitHub mutation. Step data comes from the existing
workflow-jobs response; it does not introduce another credential or service
boundary.

Active run cards also show the name of each currently running step and that
step's elapsed time, alongside the workflow timer. This keeps the current
checkpoint visible in the queue without opening the detail panel.

### Errors and recovery

- If the dashboard is stopped, opening the link reaches the browser's normal
  local connection failure page. The user can start it from the repository
  root with `npm run ci:dashboard` and retry.
- If port `57500` is occupied, startup reports the existing safe port-conflict
  message. It must not choose a random port because the sidebar destination is
  fixed.
- GitHub CLI authentication and permission errors continue to appear inside
  the standalone dashboard without exposing CLI output or credentials.

## Files expected to change

- `scripts/ci-queue-dashboard/server.js` — stable default port.
- `scripts/ci-queue-dashboard/server.test.js` — cover the exported default
  port while keeping explicit ephemeral ports available in tests.
- `scripts/ci-queue-dashboard/README.md` — document the stable address and
  navigation prerequisite.
- `demo_api_ui/src/components/AdminSideNav.jsx` — add the action sourced from
  the legacy Monitoring list and rendered in Observability.
- `demo_api_ui/src/config/navStructureCatalog.js` — register the navigation
  item.
- `demo_api_ui/src/components/__tests__/adminSideNav.test.jsx` and relevant
  navigation catalog tests — assert the item renders and opens the fixed local
  URL in a separate tab.
- `scripts/ci-queue-dashboard/github.js` and `github.test.js` — retain normalized
  GitHub job-step status and timing fields.
- `scripts/ci-queue-dashboard/dashboard.js`, `index.html`, and `dashboard.css` —
  render and style the selected run detail panel.
- `scripts/ci-queue-dashboard/README.md`, `dashboard.js`, and `dashboard.css` —
  document and show the current step timer on active run cards.
- `scripts/ci-queue-dashboard/dashboard-model.js` and its tests — derive queue
  and execution durations with missing timestamp handling.

## Verification

- Focused standalone dashboard tests cover default and explicitly selected
  ports, plus the existing rerun action behavior.
- Focused sidebar and navigation catalog tests verify the new entry and its
  separate-tab target.
- Focused dashboard tests verify job-step normalization, run timing splits,
  and opening/closing the run detail panel without triggering a mutation.
- `cd demo_api_ui && npm run test:unit && npm run build` verifies the UI.
- Run the §0 contrast auditor on the touched sidebar in light and dark themes;
  no new styling is planned.
- Run `npm run root:allowlist:check` and `git diff --check`.
- Smoke-check the standalone page at `http://127.0.0.1:57500/` and verify the
  sidebar opens that same address without clicking any dashboard mutation.

## Invariants to preserve

- No changes to existing demo sign-in, role resolution, routes, or use-case
  authorization declarations.
- No GitHub credentials enter the browser app, the BFF, or its session.
- The dashboard remains bound to loopback; its API does not gain cross-origin
  access or arbitrary command execution.
- Existing navigation behavior, action confirmations, ETA calculations, and
  runner busy checks remain intact.
- Project UI emoji, theme, and contrast rules remain in force.

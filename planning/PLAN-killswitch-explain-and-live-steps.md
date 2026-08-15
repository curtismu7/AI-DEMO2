# Plan: Kill switch — explain what/why, live steps, scope discoverability

Written 2026-08-10. Not started.

## Problem

Kill switch (`KillSwitchConfirmModal.jsx` + `POST /api/admin/agent/:id/kill-switch`
+ `killSwitchService.killAgent`, shared by `ControlPlaneRoster.jsx` and
`AgentLifecyclePage.jsx`) already does instance-vs-full scope
([project-killswitch-instance-scope memory]) but three gaps remain:

1. Doesn't explain the mechanism — revoke ≠ instant process kill. It blocks
   the agent's NEXT tool call (`agentRateLimit.js:74` checks
   `isAgentRevoked()`); in-flight calls finish.
2. Steps render as one static checklist AFTER the whole kill finishes
   (~1-2s) instead of live as each step runs.
3. Instance-vs-full scope is a radio buried inside the modal, behind one
   generic "Stop Agent" trigger — easy to miss.

## Workstream 1 — mechanism explanation (do first, copy-only, zero risk)

- `KillSwitchConfirmModal.jsx` pre-confirm warning paragraph: replace generic
  "cannot be undone" text with the real mechanism — PingOne invalidates the
  token now (RFC 7009); in-flight call finishes; the agent's NEXT call is
  rejected because `agentRateLimit` checks revocation before every request.
- Post-result: one line above the step checklist naming the enforcement
  point (`agentRateLimit` / next request to `/api/agent/*`).
- `killSwitchService.js` step `detail` strings (lines ~391-461, 5 steps):
  extend each with a "why" clause, not just "what happened."

Files: `demo_api_ui/src/components/KillSwitchConfirmModal.jsx`,
`demo_api_server/services/killSwitchService.js` (detail strings only).

## Workstream 2 — scope discoverability (do second, one file)

- `ControlPlaneRoster.jsx` roster row: split the single "Stop Agent" trigger
  into two explicit actions — "Stop this instance" / "Stop entire agent" —
  each opening the modal pre-seeded with `scope`. Full-agent action gets
  distinct (warning) visual treatment so it doesn't read as the safe default.
- `KillSwitchConfirmModal` gains optional `initialScope` prop. Keep the
  in-modal radio as override/confirm — don't remove it.
- `AgentLifecyclePage.jsx` self-service revoke path unchanged (always
  instance-context for itself).

Files: `demo_api_ui/src/components/ControlPlaneRoster.jsx`,
`KillSwitchConfirmModal.jsx` (new prop only).

## Workstream 3 — live step-by-step (do last, touches transport)

Reuse existing SSE-hub pattern (`services/pingoneTestSseHub.js`) rather than
new transport.

- New `services/killSwitchSseHub.js` — same shape as `pingoneTestSseHub.js`
  (`attach`, `publish`), keyed by `sessionId`.
- `killAgent()`: call `publish(step)` right after each `steps.push(...)`
  (5 call sites, `killSwitchService.js` ~lines 396, 427, 461, 476, 496).
- New route `GET /api/admin/agent/:agentId/kill-switch/events` (mirrors
  `GET /api/pingone-test/events`).
- `KillSwitchConfirmModal.jsx`: on confirm, open `EventSource` immediately;
  render each step as it streams (Pending -> Running -> Done/Skipped). POST
  response becomes just the final summary (`scope`, `state_snapshot_id`,
  timing) — steps already delivered via SSE.
- Keep the existing synchronous POST response shape intact (steps array) —
  `AgentLifecyclePage.jsx` and existing tests depend on it. SSE is additive.

Files: new `demo_api_server/services/killSwitchSseHub.js`,
`killSwitchService.js` (publish calls), `demo_api_server/routes/admin.js`
(new SSE route), `KillSwitchConfirmModal.jsx`.

## Success criteria

- Modal copy names the actual enforcement point, verified by reading
  rendered text.
- Steps visibly stream one at a time in the UI, verified live via
  webapp-testing/Playwright — not just unit test.
- Roster row exposes "this instance" vs "entire agent" as two distinct
  pre-click choices, verified by screenshot.
- `demo_api_server` jest (`killSwitchService`, `admin` kill-switch route) and
  `demo_api_ui` vitest (`KillSwitchConfirmModal`, `ControlPlaneRoster`,
  `AgentLifecyclePage`) green; `npm run build` exit 0.
- `REGRESSION_PLAN.md` §4 entry appended (existing kill-switch entries
  already there — don't replace).

## Order & risk

1 (copy-only) -> 3 done in same PR series or 2 in between; 3 last since it's
the only one touching request/response contract shape.

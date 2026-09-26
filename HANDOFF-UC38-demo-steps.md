# Handoff — UC38 Demo Steps behavior change + step-up diagnosis

**Date:** 2026-09-26
**Branch/checkout:** main checkout `/Users/cmuir/Development/AI-DEMO2` (NOT a worktree — verify with `git status` before trusting this file)
**Purpose:** Record of what was changed, why, what was verified, and what remains — for a reviewing agent to check against.

---

## 1. User-reported symptoms

1. UC38 "Run this demo" shows **only 2 steps** in the agent activity narration.
2. From Demo Steps, clicking **UC38** should **stay on the dashboard and show the result in the agent** — not navigate away.
3. A **special-case UC38 button** should open `https://local.ping-devops.com:4000/workload-agents?useCase=UC38`.

## 2. Root-cause findings (diagnosis, no code changed)

### 2.1 "Only 2 steps" is the designed step-up outcome, not a bug
- The workload page run POSTs `/api/agent/invoke` with `useCaseId=personal-agent-concierge`
  (`demo_api_server/routes/agentInvokeRoute.js:186-253`).
- The user's session token had **no MFA `acr` claim**, so the route returned the
  200/242-byte `step_up_required` envelope (seen in `docker logs ai-demo-api-server` at 22:07:37).
  Reply: "Your personal agent needs to verify your identity before acting on your behalf…"
- With no tool run, `buildActivitySteps`
  (`demo_api_server/services/activityStepsBuilder.js:39-101`) emits only
  `identity` + `delegation` = **2 steps**. That is correct behavior for a
  step-up-required reply. The full chain (exchange → gateway → authorize → tool)
  only appears once the session token carries the MFA acr.
- Unrelated live failures observed in logs (pre-existing, do NOT blame UC38 code):
  - `[Exchange-As] Failed: 'https://a2a-intermediate-passenger.ping.demo' is not a recognized Resource AS audience for id-jag token exchange` (invalid_target, 400)
  - `invalid_client` — "Client temporarily locked…" (agent CC token locked out)
  - `actor token is invalid or expired` on sporting-goods tools
  - BFF startup: `PINGONE_USER_CLIENT_SECRET` missing; PingOne Mgmt API worker auth failing
  - `conversationStore.saveMessage failed: userId and vertical are required` on workload-agent runs

### 2.2 Old Demo Steps behavior
- `DemoStepsDropdown.jsx` used to rewrite UC38/UC44's link trigger and `onSelect`,
  which made the agent **navigate** to `/workload-agents` (link trigger → `navigate(trigger.path)`
  in `AIAgentFull.js handleDemoStepSelect` ~line 8080).

## 3. Changes made (all in `demo_api_ui/`)

### 3.1 `src/components/DemoStepsDropdown.jsx`
1. **`handleSelect`**: for UC38/UC44, the main click now converts the catalog
   entry to a **chip trigger** (`{ type: 'chip', text: uc.runPrompt || uc.trigger?.label }`)
   and calls `onSelect` as usual — the agent runs it in place via the normal
   chip path (`handleDemoStepSelect` → `sendAgentMessage` with `useCaseId`
   → `/api/agent/invoke`). No navigation. No other trigger types touched.
2. **New secondary button** rendered on UC38/UC44 cards only:
   - `data-testid="workload-page-UC38"` / `workload-page-UC44`
   - `aria-label="Open the <id> workload-agents page"`, title explains the
     dedicated page; emoji 🪟 (on the project allowlist)
   - onClick: `e.stopPropagation()`, closes the drawer, then
     `handleWorkloadAgentsOpen(uc)` — takes `uc.trigger.path`, sets
     `vertical=<current vertical>` as a query param, and
     `window.location.assign(...)` (full page load, deliberate — mirrors
     the pop-out client window pattern).

### 3.2 `src/components/AIAgent.css`
- New `.ba-demo-steps-popout__workload-link` block, same 26px shape as the
  existing `__rar-toggle` (teal `#0e7490`, filled on hover/focus-visible).
  Placed directly after the rar-toggle rules.

### 3.3 `src/components/__tests__/DemoStepsDropdown.test.jsx`
- Replaced the old `opens %s with the active vertical and canonical use case`
  test (which asserted the link-rewrite path with `trigger.path` passed through)
  with `runs %s as a chip prompt and its secondary button opens the workload page`:
  - main click → `onSelect` called once, trigger `{ type:'chip', text:'pay a $600 change fee' }`, `onOpenChange(false)`
  - secondary click → `window.location.assign` spied, called once, URL startsWith
    the catalog path AND contains `vertical=<active vertical>`
- **Result: 36/36 pass.**

## 4. Verification status

| Check | Status |
|---|---|
| `npx vitest run src/components/__tests__/DemoStepsDropdown.test.jsx` | ✅ 36/36 |
| `npm run build` (the hard UI gate) | ✅ built in 3.89s |
| Full `npm run test:unit` | ⏳ **NOT verified** — timed out at 10 min once; second attempt aborted by user. Must be run. |
| Live browser check of the new button + chip run | ⏳ Not done (needs signed-in session) |
| BFF untouched | ✅ no server changes |

## 5. What the reviewing agent should do next

1. **Run the full unit suite** (from `demo_api_ui/`): `npx vitest run` — expect
   only known-slow/flaky suites to wobble; anything red in
   `DemoStepsDropdown*`, `AIAgent*` is a real problem.
2. **Live verify with a real MFA session**:
   - Sign in as the demo customer via PingOne (session token must carry the MFA
     `acr` — otherwise UC38 legitimately stops at the step-up reply and 2 steps).
   - Dashboard → agent → Demo Steps → click **UC38**: confirm NO navigation, the
     agent shows the "Demo step N: UC38 …" message and the invoke result in chat.
   - Click the 🪟 button on the UC38 card: confirm it opens
     `/workload-agents?useCase=UC38&vertical=<active vertical>`.
   - Same for UC44.
3. **If the full chain still shows 2 steps after real MFA sign-in**, check:
   - `docker logs ai-demo-api-server` for `personal_agent/not_registered` (Agent
     Builder registration missing) or `workload_agent_runtime_unavailable` (409).
   - The `invalid_client` lockout on the agent CC token (PingOne app locked from
     failed logins) — blocks the delegation exchange regardless of UI.
4. **Git diff scope check**: only `DemoStepsDropdown.jsx`, `AIAgent.css`,
   `DemoStepsDropdown.test.jsx` should be modified. Anything else = unexpected.
5. **REGRESSION_PLAN §4 log entry**: this is a behavior fix on a protected
   surface (agent routing / use-case triggers) — add a reverse-chron entry per
   the regression-guard routine.

## 6. Deliberately NOT done (scope guards)

- No change to `agentInvokeRoute.js`, `activityStepsBuilder.js`, `WorkloadAgentsPage.jsx`,
  `PersonalAgentStudioPage.jsx`, auth/session middleware, or `AIAgent.js`/`AIAgentFull.js`.
- UC38/UC44 catalog triggers remain `type:'link'` server-side — only the
  Demo Steps click path converts them to chips; other launchers (use-cases page,
  deep links) still open the workload page.
- `AIAgent.js` (compact agent) NOT updated — it shares `DemoStepsDropdown`, so
  it gets the new behavior automatically; its own `handleDemoStepSelect` link
  branch still navigates for any other link-triggered use case.

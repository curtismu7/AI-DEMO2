# 15-Minute Security-Leader Demo Script — Design

**Date:** 2026-07-25 (rev: dropped the LLM/heuristics both-modes beat; added A2A delegation and PAR intent binding; the demo stepper and teleprompter now match 1:1)
**Deliverable:** A live demo script (click-by-click storyboard + talk track) plus the workbench + teleprompter wiring that makes the stepper run it.
**Audience:** Customer security / engineering leaders. Mixed depth — care about threats stopped and control points, not JWT internals. Lead with attacker-fails; token chain is supporting proof, not the headline.
**Slot:** ~15 minutes. Tight. One vertical (banking). No detours.
**Agent mode:** Not shown. Enforcement is identical whether an LLM or deterministic routing drives the agent, but that is an internals point — cut from a security-leader story. Beats run in the default deterministic mode.

## Goal

Get eight messages across in one coherent 15-minute story:

1. On-behalf-of, with the first token exchange (the act claim).
2. A2A delegation — a generalist hands off to a specialist and the nested act chain carries the user's authorization through every hop, scope narrowing each time.
3. PingOne Authorize (P1AZ) enforcing policy on money movement.
4. Human-in-the-loop — a consequential action pauses for a human, the agent cannot complete it alone.
5. PAR (RFC 9126) intent binding — the agent pushes its intent up front; within the cap PERMIT, over the cap DENY.
6. The gateway doing all it can (egress control on agent tool calls).
7. A bad actor replaying the user's token straight at the backend — blocked; and an MCP server reaching beyond its scope — blocked.
8. Close: everything is provable — every decision is attributable to the actor chain, and one switch revokes the agent.

## Approach (chosen: A — chronological, single-surface)

Run Acts 1-3 from one page, **`/use-cases/live`** (the Live Use-Case Workbench), driven top-to-bottom by the numbered **"15-Min Security Demo"** stepper group (`SECURITY_DEMO_USE_CASE_IDS`). Good-path use cases run in the embedded agent dock; the attacker moments run via "Run sim ->" cards on the same page. The token-chain rail and glance-policy cell are always on screen, so the audience learns to read one UI once. Two deliberate hops off the surface: Step 6 (PAR verified) opens `/intent-binding-learning` via the card's **"Open page ->"** button, and the kill-switch closer opens `/ai-control-plane`. The teleprompter overlay persists across both.

The stepper and the teleprompter (`demoScript.js`) share one order: step N in the group == beat N in the script, so the presenter can read the script or click the stepper and get the same sequence.

Considered and rejected:
- **B — two-surface** (good path on `/dashboard`, attacks on `/use-cases/live`): sturdier good-path agent, but a mid-demo context switch and two token-chain UIs cost ~1 minute we do not have.
- **C — attacker-first cold open**: higher engagement, but the "why" only lands after the punch; kept as a possible future variant, not this script.

## Surface and preflight

- **Single surface:** `/use-cases/live`.
  - Route wiring: `demo_api_ui/src/App.js:666-675` (`LiveUseCaseWorkbenchPage`).
  - Attack trigger: `LiveUseCaseWorkbenchPage.js:143-167` — `POST /api/demo/attack-sim/run`, sets glance policy DENY, feeds `tokenChainTraceStore`.
  - Good-path chip trigger: `POST /api/use-cases/demo/run` -> `banking-agent-prefill` autoSend.
  - Link trigger (Step 6, UC14b): the card's "Open page ->" button POSTs `demo/run` (to arm `ff_rar`) then SPA-navigates to `/intent-binding-learning#rar` (`handleOpenLink`).
  - Stepper order (numbered card -> UC): `SECURITY_DEMO_USE_CASE_IDS` in `demo_api_ui/src/config/demoUseCaseSteps.js`, kept 1:1 with `demoScript.js`.
- **Preflight (~10 min before):** `bash scripts/preflight-demo.sh`.
- **Login host:** `local.ping-devops.com:4000` — sign-in only works on this host (rp.id / callback binding).
- **Flags:** `ff_use_cases_launcher` ON (default). `ff_rar` and `ff_a2a_delegation` are **auto-armed on run** — `POST /api/use-cases/demo/run` reads the use case's `maturity: 'flag:<name>'` and turns that flag on before dispatch (`routes/useCases.js`); the `rar-exceeded` sim self-arms `ff_rar` too. No manual toggling.
- **Environment:** `NODE_ENV` must NOT be `production` — the attack-sim route is hard-blocked in production (`demo_api_server/routes/attackSimulator.js:33-43`).
- **Closer pre-check:** open `/ai-control-plane` once beforehand and confirm the roster shows a **LIVE** row (that row is the only one whose STOP truly revokes). The demo ends on a forced logout by design — nothing is scheduled after it.

## Storyboard

Talk-track lines (in quotes) are what the presenter says. Everything else is stage direction.

### Intro (~1 min)

> "AI agents are about to act on behalf of your customers — move money, touch records. The question isn't *can* they. It's: acting **as who**, with **what limits**, and what happens when **someone abuses it**. Watch."

### Act 1 — Who is the agent? (goal 1, 2) — ~4 min

| # | Do | Audience sees | Say |
|---|---|---|---|
| 1 | Step 1 `show my balance` (UC1) | Real balance; token-chain rail shows first exchange + act claim | "No password handed over. The agent got a token that says it acts **for me** — the act claim. Every step is attributable to me." |
| 2 | Step 2 `hand off to a specialist` (UC2, A2A) | PERMIT; rail shows a nested act chain — user, then Agent 1, then Agent 2 — scope narrowed each hop | "The generalist hands the job to a specialist. A second exchange nests the act claim: Agent 2 acts for Agent 1, which acts for me. The whole delegation is provable, and each hop gets **less** scope, not more." |
| 3 | Step 3 `what branches are near me` (UC24) | PERMIT, no token exchange | "Public data — zero token exchange. The agent escalates privilege only when it must. Least privilege by default." |

### Act 2 — Policy and intent decide (goal 3, 4, 5 + gateway) — ~6 min

| # | Do | Audience sees | Say |
|---|---|---|---|
| 4 | Step 4 `transfer $2500 from checking to savings` (UC6) | DENY | "Money now. $2500. PingOne Authorize returns DENY *before* the transfer runs — over the ceiling. The agent can't argue." |
| 5 | Step 5 `transfer $300 from checking to savings` (UC8) | HITL_REQUIRED, agent pauses | "$300 — the agent pauses and waits for a human to approve. It cannot complete this alone." |
| 6 | Step 6 card **"PAR intent verified"** (UC14b) -> Open page, run a within-cap transfer | PERMIT; token chain shows Intent Verified (request_uri bound to the amount cap) | "The good path first. Before it acts, the agent pushes its intent — amount and payee — to PingOne as a Pushed Authorization Request and gets a **request_uri** binding the transaction. Within the cap, Authorize verifies and **PERMITs**. The agent can only do what the user pre-approved." |
| 7 | Step 7 card **"PAR intent violation"** (UC14) -> Run sim | DENY; Authorize rejects the over-cap request against the pushed `authorization_details` | "Same PAR grant, but now it asks for **more** than it pushed. Authorize compares the live request to the bound intent and **DENYs**. Intent is a contract — the agent cannot exceed what was pushed, even if its token scopes would allow it." |
| 8 | Step 8 `what's the weather in Miami` (UC31) | Gateway DENY | "Different control. The agent calls a third-party weather MCP. Miami is out of policy — the **gateway** kills the call before the third party ever sees it. Egress control on tool calls." |

Trim note: Step 3 (UC24 public data) is the first to cut if the slot runs tight — A2A (Step 2) now carries the least-privilege point. UC7 STEP_UP ($600 -> MFA) stays dropped. If very long, Step 6 (PAR verified, the one off-surface hop) can be cut, leaving Step 7's PAR DENY to make the intent-binding point alone.

### Act 3 — Attacker fails (goal 7) — ~3 min (the spotlight)

| # | Do | Audience sees | Say |
|---|---|---|---|
| 9 | Step 9 card **"DPoP / replay defense"** (UC12) -> Run sim | Rail: `sim-replay-start` -> `sim-gateway-deny`, DENY 401 (audience binding) | "The attack security teams actually lose sleep over. Steal the user's token, replay it straight at the backend, skip the gateway. **DENY.** The token is audience-bound — worthless anywhere but where it was minted. A stolen token is a dead token." |
| 10 | Step 10 card **"Insufficient scope"** (UC5) -> Run sim | Glance DENY; rail DENY 403 (MCP scope) | "Second attack: an MCP server reaches for a tool it was never scoped for — beyond its job. **DENY, 403,** at the gateway. Scope is a hard ceiling, not a suggestion. The agent can't grant itself more." |

### Close — point 6, kill switch (~1.5 min)

Closer — **kill switch** (the ending). This is a deliberate one-hop navigation OFF `/use-cases/live` (the kill control lives on `/ai-control-plane`). Acts 1-3 stay single-surface; the finale is the only navigation.

**Surface:** `/ai-control-plane` -> `ControlPlaneRoster` (route `demo_api_ui/src/App.js:595`; left nav "AI Control Plane", `AdminSideNav.jsx:467-468`). Open to any logged-in user (no admin role, no flag).

**Scope decision (important):** use **`instance`** scope (the default). It revokes only the current session and **self-recovers on next login** — safe, nothing to clean up, no risk to a shared environment. Do NOT use `full` for a live customer demo: `full` disables the agent's PingOne application for **every** user of that client and requires a manual Re-enable afterward (a bricking hazard in the shared env).

**Do:**
1. Left nav -> **AI Control Plane**.
2. On the **LIVE** row, click the red **STOP** button (`ControlPlaneRoster.jsx:254-258`).
3. In `KillSwitchConfirmModal`: keep scope **instance**, pick a reason, click **Confirm Stop Agent** (`KillSwitchConfirmModal.jsx:75-82`).

**Audience sees:** the row flips to **REVOKED** with an **"ALL AI ACTIVITY HALTED"** end card, and the kill destroys the session -> **you are force-logged-out and bounced to sign-in** (`admin.js:900-912`, `apiClient.js:169-173`). The forced logout IS the visible payoff — the app itself went dark the instant the agent was revoked. Do NOT re-run a chip: with `instance` scope it would simply work again after re-login and undercut the moment.

> "Everything you saw was attributable to the user — provable at decision time. So when an agent goes bad, you don't negotiate with it. One switch." (click Confirm) "It's done. Watch — I'm logged out. The whole surface went dark the instant the agent was revoked. The agent that moved money a minute ago no longer exists."

**Recovery (off-screen / after the demo):** with `instance` scope the next login self-recovers — nothing required. (If `full` was ever used, the LIVE row's **Re-enable** button, `ControlPlaneRoster.jsx:259-265` -> `POST /api/admin/agent/:agentId/re-enable`, restores the PingOne app.)

One-line proof nod folded into the close (not a separate beat): the attributability point rides on the "provable at decision time" clause above; the kill switch is the visible payoff.

## Traps deliberately avoided

Verified against the current registry so no unshowable beat is scripted:

- `overscoped-agent` (UC4) and `may-act-gate` (UC3) resolve to **PERMIT**, not blocks — never script them as denials (`demo_api_ui/src/config/useCases.js:308-332`, `:234-247`).
- The **Gateway Tester** (`/pinggateway-inspector`) has no force-actor and no insufficient-scope preset — it is a dev tool, not a demo moment (`AgentGatewayTester.jsx:156-159`).
- **X-Demo-Force-Actor** is server-side only, never a typeable UI input (`demo_api_server/services/mcpGatewayClient.js:244`).
- **UC16 impersonation-blocked** is registry maturity `needs-build` — UC12 is used for the replay beat instead.
- **PAR permit is a link, not a chip** — UC14b navigates to `/intent-binding-learning`; the workbench renders it as an "Open page ->" card (`handleOpenLink`), not an in-dock chip run. It is the one good-path beat that leaves the surface.

## Fallback ladder (if a live beat fails mid-demo)

Each step is visibly labeled, never silent:

1. Re-run the step once — the agent runs deterministically; same real tools, gateway, and policy.
2. Simulated Authorize (`ff_authorize_simulated`) with authz-server up — last resort before replay.
3. REPLAY — "Show the expected result (REPLAY)" on the failure message; labeled with capture date. Token chain / activity panels stay empty (live proof only).

## Success criteria

- All eight messages land inside 15 minutes with the chosen beats.
- Every scripted step maps to a currently-wired live surface (verified above).
- The stepper "15-Min Security Demo" group and `demoScript.js` stay 1:1 in order.
- `ff_rar` and `ff_a2a_delegation` arm automatically when their step runs — no manual preflight toggle.
- No beat depends on a doc-only or `needs-build` surface.

## Out of scope

- No slide deck — this is the live-driving script only.
- Other verticals (healthcare, retail, etc.) — banking only for this slot.

## Teleprompter modal (implementation)

A companion UI so the presenter can read this script on a second monitor while driving the demo on the main screen, and run the same demo in-place once learned.

### Requirements

- Draggable, resizable, closable modal holding the storyboard (passive scroll).
- 🪟 pop-out to a real separate browser window (second monitor).
- Available to **any** user, including **unauthenticated** (renders on the sign-in screen and every route).
- Persists across the mid-demo route hop (`/use-cases/live` -> `/ai-control-plane`).
- Single small floating launcher button, always present.

### Components

- **`demo_api_ui/src/components/DemoScriptLauncher.jsx`** (new) — owns `showScript` state, renders the floating launcher button and the `DraggableModal`. No auth/session/provider dependency (static content).
- **`demo_api_ui/src/components/demoScript.js`** (new) — the script as a plain data structure (preflight, intro, acts -> beats `{action, expected, say}`, closer). Keeps content out of JSX.
- **`demo_api_ui/src/components/DemoScriptLauncher.css`** (new) — floating button + body styles, mirroring `ControlPlaneDemoGuideModal.css` conventions (solid high-contrast colors, uppercase section headers, code chips). No muted text (§0).
- **`demo_api_ui/src/App.js`** (edit, additive only) — one import + `<DemoScriptLauncher />` as an **unguarded** sibling in the post-`</Routes>` global overlay block (after `<SpinnerHost />`, ~L1416). No `user`/`loading`/`isApiTrafficOnlyPage` guard, so it renders for unauthenticated users too.

### DraggableModal usage

`title="15-Min Security Demo Script"`, `storageKey="demo-script-teleprompter"` (persist size/position), `closeOnPopout` true (in-page copy closes on pop-out so screen 1 stays clean for the audience), pattern mirrored from `ControlPlaneDemoGuideModal.jsx`.

### Constraints designed around

- Pop-out copies stylesheets as a one-time snapshot and does **not** inherit theme CSS variables — so the teleprompter styles with **self-contained explicit colors** (dark text on white), readable in the popped window regardless of app theme.
- Launcher label is **plain text** ("Demo Script"), no emoji — 📚 is reserved for Knowledge Grounding; 🪟 pop-out is rendered by `DraggableModal` itself.
- Launcher placed **bottom-left** to avoid the bottom-right AI Agent FAB and the bottom agent dock.

### Regression safety (§1)

App.js is §1-protected for the AI Agent FAB (`banking-agent-fab`) and the bottom dock. Change is strictly additive: one import + one sibling. Not touched: FAB classes, `<AIAgent>` props, `shouldMountSingleAgent`, `EmbeddedAgentDock` and its route conditionals, `<Routes>`, auth branches, `isApiTrafficOnlyPage`. UI build gate (`cd demo_api_ui && npm run build` -> 0) required before done.

### Success criteria

- Launcher visible and modal opens for an unauthenticated user on the sign-in screen.
- Modal drags, resizes, closes; 🪟 pop-out opens a separate window that stays readable and keeps the script.
- Modal stays open across navigation from `/use-cases/live` to `/ai-control-plane`.
- `npm run build` exits 0.
- No change to FAB/dock/auth behavior.

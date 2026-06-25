# AI Control Plane — reframing the stop button as cross-platform governance

**Date:** 2026-06-19
**Status:** Approved design, pending implementation plan
**Worktree/branch:** `worktree-control-plane-stop-button`

## Motivation

A common industry argument (paraphrased): *every AI vendor can build a kill
switch inside their own product. The real question is where an enterprise goes
to govern, authorize, audit, or shut down AI activity across OpenAI, Anthropic,
Glean, Salesforce, ServiceNow, and others.* The winner is the vendor that
becomes the trusted **policy and control plane** for the AI ecosystem — and
Ping is positioned for that via identity, authorization, governance, and
privileged access.

This demo already has a "stop button" that is **not** the shallow kill switch
the argument dismisses. The existing flow (`killSwitchService.killAgent`) acts
at the **PingOne identity layer**: it revokes the agent's tokens (RFC 7009),
disables the agent's PingOne application, disables the user identity,
invalidates sessions, and writes an immutable audit record. Because that kill
happens at the identity layer rather than inside one app's reasoning loop, it
would work for *any* agent that authenticates through Ping — regardless of which
AI platform runs it.

The problem is purely one of **presentation**: today the button looks like
"stop my one banking agent." This work makes the existing capability *legible*
as a cross-platform control plane.

## Goals

1. Reframe the Admin → Agent Safety surface so the stop button reads as a
   **control plane** (the four verbs: govern · authorize · audit · shut down),
   not a single-app kill switch.
2. Show **breadth**: a roster of agent identities from multiple AI platforms,
   all governed from one place, with a single "stop across all platforms"
   action.
3. Show the **mechanism** (the "trusted control plane" point): each platform
   trusts Ping / holds a Ping-issued token, so revoking at Ping cascades
   outward and the platform loses access.
4. Preserve the **real** live-agent kill path exactly as it is today.
5. Stay **honest**: never claim live integrations with vendors we don't have.
6. Work in **every vertical** — the surface and the kill are vertical-agnostic
   (the live row reflects the session-active vertical).
7. Be **LLM-provider-agnostic** — the live kill works the same whether the agent
   is reasoning on Helix, Ollama, or Claude, because it severs *authority* (the
   PingOne token), not *compute*. The live row shows the current provider.
8. **Tell the user**: proactively notify every open session when an agent is
   stopped — they should not have to take an action to discover it.
9. **Any logged-in user can run it** — no admin role required. The surface
   self-explains (what it is + how Ping does it) and states the business value,
   so it teaches on its own.

## Non-goals

- No real external integrations with ChatGPT / Copilot / Glean / Agentforce /
  ServiceNow. The non-banking agents are seeded demo identities.
- No new PingOne applications provisioned for the demo platforms.
- No change to the existing `POST /api/admin/agent/:agentId/kill-switch`
  endpoint or to `killSwitchService.killAgent` for the real banking agent.
- No refactor of unrelated Admin tabs or components.

## Design overview

All new UI lives **in place** on the existing **Admin → Agent Safety** tab. The
single `RedButton` flow is wrapped by a new roster component; the existing
button becomes the first roster row (Claude / Banking).

Visual layout, top to bottom:

```text
Admin → [Agent Safety] tab
┌─ Ping — AI Control Plane ───────────────────────────────┐
│ govern · authorize · audit · shut down                  │  ← 4-verb header,
│                                                         │    each links to the
│   ┌───── Trust / propagation panel ─────┐               │    existing panel
│   │            ┌────────┐                │               │
│   │            │  PING  │  trust anchor  │               │
│   │            └─┬──┬──┬─┘                │               │
│   │        ┌─────┘  │  └─────┐            │               │
│   │     ChatGPT   Glean   Agentforce ...  │               │  ← link goes dark
│   │     (each trusts Ping; revoke ⇒ dark) │               │    on revoke
│   └─────────────────────────────────────┘               │
│                                                         │
│  ● Live Agent (<vertical>)  LIVE · Helix      [stop]    │
│      provider shown live: Helix / Ollama / Claude       │
│  ● ChatGPT            Ping-governed demo       [stop]    │
│  ● Copilot Studio     Ping-governed demo       [stop]    │
│  ● Glean              Ping-governed demo       [stop]    │
│  ● Agentforce         Ping-governed demo       [stop]    │
│  ● ServiceNow         Ping-governed demo       [stop]    │
│                                                         │
│        [ 🔴 STOP ACROSS ALL PLATFORMS ]   [ ↺ Reset ]   │
└─────────────────────────────────────────────────────────┘
```

## Components

### Frontend (`demo_api_ui/`)

- **`ControlPlaneRoster.jsx`** (new) — top-level container for the surface.
  Fetches the roster, renders the four-verb header, the trust panel, the agent
  rows, the stop-all and reset controls. Wraps (does not replace) the existing
  `RedButton` / `KillSwitchConfirmModal` flow for the real Claude row.
- **Four-verb header** — `govern · authorize · audit · shut down`. Each verb
  links to the panel that already implements it:
  - govern → Authorize rules panel (`AuthorizeRulesPanel`)
  - authorize → token-chain inspector (`UnifiedTokenFlowInspector` /
    `TokenChainDisplay`)
  - audit → `ForensicAuditDashboard`
  - shut down → the roster itself (anchor/no-op)
- **Trust / propagation panel** — a lightweight diagram: Ping at center as the
  trust anchor, each roster platform as a node with a link to Ping. Node/link
  visual state is driven by each agent's `status` (`active` = lit, `revoked` =
  dark / "access revoked"). No heavy graph library — CSS/SVG sized to the
  existing Admin styling.
- **Agent rows** — platform badge, status pill (`active` / `revoked`), per-row
  `[stop]`. Row 1 is the **live agent**, labeled **LIVE — real PingOne
  revocation**, with two dynamic sub-labels: the **session-active vertical**
  (Banking / Healthcare / …, from the vertical resolver) and the **current LLM
  provider** (Helix / Ollama / Claude / heuristic, from `agentModeResolver`).
  Rows 2–6 are labeled **Ping-governed demo identity**. The provider sub-label
  is the visual proof of goal 7 — same kill regardless of what's reasoning.
- **Stop-all + reset controls** — `[🔴 STOP ACROSS ALL PLATFORMS]` opens one
  confirm modal (reuse `KillSwitchConfirmModal` with a reason), then triggers a
  visible sequential cascade. `[↺ Reset roster]` re-seeds the demo platforms to
  `active`.

### Backend (`demo_api_server/`)

- **Demo agent registry** — the 5 non-banking platforms (`ChatGPT`,
  `Copilot Studio`, `Glean`, `Agentforce`, `ServiceNow`), scoped **per user /
  session** (mirroring the existing active-vertical session-scoping pattern), so
  concurrent demoers never stomp each other's roster, stop-all, or reset. Each
  entry: `id`, `platform`, `label`, `status` (`active` | `revoked`),
  `kind: "demo"`. Lazily seeded to `active` on first read for a session. The
  real live agent is surfaced in the roster as `kind: "live"` and is **not** part
  of this registry.
- **Access**: any **authenticated** user may open and run the surface — the new
  routes require a valid session (`authenticateToken`) but **no admin role**.
  Each request reads/writes only the caller's own session-scoped roster. The
  live-agent real kill still affects only the caller's own session. If the
  Agent Safety tab is currently admin-gated in the UI, the control-plane surface
  must be made reachable by any logged-in user.
- **New routes** (all `authenticateToken`, no admin role; placed alongside the
  existing kill-switch route — exact file TBD in the plan, `routes/admin.js` or a
  dedicated `routes/controlPlane.js`):
  - `GET /api/admin/control-plane/agents` → roster + per-agent status (includes
    the live row + the 5 demo rows). The live row carries the **session-active
    vertical** (from the vertical resolver) and the **current LLM provider**
    (from `agentModeResolver`) so the UI can render the dynamic sub-labels.
  - `POST /api/admin/control-plane/agents/:agentId/stop` → for a **demo** agent,
    runs the *honest subset* of the kill flow (see below). Rejects the live
    agent id with a pointer to the existing endpoint.
  - `POST /api/admin/control-plane/stop-all` → fans out the demo stop
    sequentially over all `active` demo agents; one real audit entry per agent.
    Does **not** stop the live Claude agent (avoid logging the operator out
    mid-demo); the live row is stopped only via its own existing button.
  - `POST /api/admin/control-plane/reset` → re-seeds all demo agents to
    `active`, clears their `revoked` flags. Never touches the live agent.

### Honest subset of the kill flow (demo agents only)

A demo-agent stop performs the parts of the real kill that are truthful for an
identity with no real user/token behind it:

- ✅ Writes a **real immutable audit record** via
  `auditLogService.recordKillEvent` (so the audit story is genuine).
- ✅ Sets the `agent:{agentId}:revoked` flag in the store and flips `status` to
  `revoked`.
- ❌ Skips PingOne token revocation, user-disable, and application-disable —
  there is no real PingOne user/app behind these demo identities, so calling
  those would be dishonest/no-op.

The real live-agent row continues to call the **unchanged**
`POST /api/admin/agent/:agentId/kill-switch` → `killSwitchService.killAgent`,
preserving real token revocation + re-auth.

### Provider- and vertical-agnostic kill (why one button covers everything)

The live kill works the same regardless of the active vertical or LLM provider
because it operates at the **authority** layer, not the compute layer:

- Every provider — `heuristics`, `ollama`, `claude`, `helix_google`
  (`agentModeResolver.js`) — executes banking/MCP tools through
  `executeBffTool` → `resolveMcpAccessTokenWithEvents`
  (`agentMcpTokenService.js`), which requires a valid PingOne user token.
- Revoking that token (the existing real kill) means **no provider can act** —
  Helix, local Ollama, or Claude. The model may still generate text, but it can
  no longer execute a single privileged tool. That severed-authority property is
  the demo's core point and is surfaced via the live row's provider sub-label.
- The kill is vertical-independent: it targets the agent/user identity, not any
  vertical's data. The surface reflects whatever vertical the session is in.

### User notification on kill (push to all open sessions)

Stopping an agent emits a control-plane event so **every open browser session is
told without taking an action** — riding existing infrastructure, no new
channel:

- On any control-plane stop (live or demo) and on the existing live kill, the
  server publishes via **`appEventService`** (e.g. category `control_plane`,
  severity `warning`) carrying `{ agentId, label, reason, kind, revoked_at }`.
- The frontend already holds a persistent SSE connection through
  **`useAppEventsSSE`** (`GET /api/app-events/stream`). A small subscriber maps
  `control_plane` events to:
  - a **react-toastify** toast in every open session: "🛑 {label} stopped by the
    Ping control plane — reason: {reason}", and
  - for the **live agent**, an in-chat kill banner + state so the active chat
    visibly reflects the stop.
- Enforcement is unchanged and still authoritative: the next request from a
  revoked agent is blocked at `agentRateLimit.js` (`AGENT_REVOKED`). The push is
  the *proactive notice*; the middleware remains the *hard gate*. (An
  in-progress streaming run is not force-aborted by this work; the push tells
  the user immediately and the next hop is blocked — calling out the existing
  request-boundary behavior explicitly rather than changing the run loop.)

## Data flow

1. Tab mount → `GET /control-plane/agents` → render roster + trust panel from
   `status`.
2. Per-row stop (demo) → confirm → `POST /control-plane/agents/:id/stop` →
   audit + flag + status flip → UI flips pill to `revoked` and darkens the
   trust link.
3. Per-row stop (live Claude) → existing `KillSwitchConfirmModal` → existing
   `/api/admin/agent/:id/kill-switch` → real revoke + session destroyed
   (unchanged).
4. Stop-all → confirm once → `POST /control-plane/stop-all` → sequential
   cascade, links darken one by one, audit entry per agent.
5. Reset → `POST /control-plane/reset` → demo statuses back to `active`, links
   re-light.

## Error handling

- Any control-plane route requires a valid admin session (`authenticateToken`);
  401 on missing/expired session (consistent with the existing kill-switch
  route).
- `:agentId` not in the demo registry → 404 with a clear message. The live
  agent id on a demo-stop route → 409/400 pointing to the existing endpoint.
- Stop-all is resilient: a failure on one demo agent is recorded (audit
  `recordKillFailure` if available) and the cascade continues to the next; the
  response reports per-agent outcomes.
- Reset is idempotent.
- Frontend surfaces per-row failures inline without aborting the rest of the
  roster.

## Visual feedback — clear DURING and AFTER

The surface must make it obvious, at a glance, what is happening and what was
done. This is a first-class requirement, not polish.

**DURING a stop (live motion):**

- The targeted row's status pill animates `active → revoking… → revoked`
  (spinner/pulse during, solid state after).
- In the trust panel, the agent's link to the Ping anchor **visibly severs**
  (animates to dark/broken) and the node flips to a red "access revoked" state.
- Stop-all runs a **staggered cascade** so the audience sees each platform drop
  one-by-one (links darken in sequence), not all at once.
- A live progress line ("Revoking ChatGPT… ✓  Revoking Glean… ✓") accompanies
  the cascade.
- Each stop fires the toast (push) so motion also appears in other open windows.

**AFTER a stop (durable, unambiguous end state):**

- Revoked rows stay visually distinct: red/dim pill, "Revoked HH:MM:SS" timestamp,
  reason, and the broken trust link persist until reset — the screen still tells
  the story minutes later.
- A compact **"Last action" summary** renders above the roster: what was stopped,
  how many platforms, reason, time, and a count of audit records written, with a
  link to the `ForensicAuditDashboard` for the immutable trail.
- The four-verb header reflects state (e.g. an "audit" badge increments).
- **Reset** visibly re-lights links and pills back to green `active`, returning a
  clean slate for the next run.

Optional dramatic finale (validated in mockup, keep tasteful): on stop-all the
Ping anchor "arms," a shockwave ring emanates from it, each node takes a hit +
gets an "ACCESS REVOKED" stamp, a brief red flash on the final kill, and a
dismissible **end-card** ("ALL AI ACTIVITY HALTED — every agent authenticated
through Ping…"). The durable "Last action" summary persists underneath after the
end-card is dismissed. A live caption during the cascade ties motion to
mechanism ("Severing authority at the identity layer… → {platform} loses
authority").

Concrete reuse: status transitions use existing pill/badge styles; the trust
panel is CSS/SVG (no heavy graph lib); the cascade is a sequential async loop the
UI renders as it resolves; the "Last action" summary is derived from the
stop/stop-all response payloads (per-agent outcomes already returned).

## Self-explaining copy (teaching demo)

The surface explains itself so any viewer gets the point without narration:

- **"What this is" intro** — one short paragraph: enterprises run AI agents
  across many platforms; every vendor ships its own kill switch; the real
  question is where you go to govern/authorize/audit/shut down across *all* of
  them — that place is the control plane below.
- **"How Ping does this" — three steps**: (1) agents authenticate through Ping
  and get Ping-issued tokens (identity layer); (2) every action requires that
  token via RFC 8693 exchange — no token, no action (authority, not compute);
  (3) revoke at Ping → access dies everywhere, the same on Helix, Ollama, or
  Claude (one button, every platform).
- **Access note** — "Any logged-in user can open and run this — each person gets
  their own scoped roster."
- Mechanism is also surfaced inside the diagram (anchor "issues every token,"
  nodes "hold Ping token") so the animation demonstrates step 3.

## Business value — why we're doing this

Rendered as a "Why this matters" band, four value props each tagged by audience:

- **Contain in seconds, everywhere** *(Security / SOC)* — a compromised or
  misbehaving agent is stopped across every platform at once, not chased
  vendor-by-vendor.
- **One control plane, not N integrations** *(CISO / Platform)* — govern AI from
  a single place instead of custom-building controls inside every AI tool.
- **Provable, cross-platform audit** *(Risk / Compliance)* — every stop writes an
  immutable record; one trail spanning all vendors for regulators and incident
  review.
- **Own the trusted control point** *(Strategy / Exec)* — Ping becomes the policy
  & identity plane the AI ecosystem integrates with — the strategic position,
  not just a kill switch. (This is the market thesis that motivated the work.)

## Honesty guardrail

- Row labels: Claude (Banking) = **LIVE — real PingOne revocation**; others =
  **Ping-governed demo identity**.
- Talk-track stays true: "any agent that trusts Ping dies from this one button,
  at the identity layer — here's the real one revoking against PingOne, and
  here's how it generalizes across platforms."
- Consistent with the project memory note that token/teaching visibility is
  intentional in this learning demo.

## Testing

- **Backend**: tests for the four new routes — auth required; `GET` returns
  live + 5 demo rows; demo stop writes an audit entry + flips status + sets
  revoked flag and does **not** call PingOne disable/revoke; live agent id is
  rejected on the demo-stop route; stop-all flips all active demo agents and is
  resilient to a single-agent failure; reset restores `active`. Follow the
  repo's real-vs-mock test conventions (`real-api-tests` / existing admin route
  tests).
- **Frontend**: roster renders rows from `GET`; stop flips the pill + darkens
  the trust link; stop-all cascades; reset re-lights; the live row still routes
  through the existing modal/endpoint. UI build gate must pass
  (`cd demo_api_ui && npm run build`).
- **Regression**: the existing `/api/admin/agent/:id/kill-switch` flow and
  `killSwitchService` behavior are unchanged (per `regression-guard`); no emojis
  added to code per repo rule (the 🔴 is existing button styling/icon, mirror
  current usage).

## Success criteria

- Agent Safety tab presents the four control-plane verbs and a multi-platform
  roster with a working trust/propagation panel.
- Per-agent stop, stop-all (with cascade), and reset all work and are
  repeatable across demo runs without a server restart.
- The real Claude/Banking kill path is byte-for-byte unchanged and still
  performs real PingOne revocation.
- Every demo stop produces a real audit record visible in the existing forensic
  audit view.
- No overclaiming: demo identities are labeled as such.

## Open follow-ups (out of scope here)

- Optionally provisioning real PingOne application identities per platform for a
  deeper "real revoke everywhere" demo (the heavier path we declined).
- Wiring the four-verb header links if any target panel isn't currently
  reachable from the Agent Safety tab context.

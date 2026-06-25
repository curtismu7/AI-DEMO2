# Architecture Simulation Design

**Date:** 2026-05-23  
**Route:** `/architecture/overview`  
**Status:** Approved for implementation

---

## Goal

Replace the current static-PNG viewer with a fully interactive architecture simulation page. The diagram is hand-coded SVG (not Mermaid render, not PNG overlay) so every node and edge is individually addressable. Three simulation modes let presenters step through request flows, play a pre-scripted scenario, or watch real system traffic light up in real time.

---

## Visual Design Decisions

| Concern | Decision |
|---|---|
| Diagram rendering | Hand-coded SVG — full layout control, readable labels at any zoom |
| Node active state | Amber pulse (`#f59e0b` glow, breathing animation) |
| Node completed state | Green + ✅ badge (`#22c55e`); stays green so the whole path is visible |
| Edge animation | Colour sweep — grey base line, amber fill sweeps source → destination |
| Controls location | Top toolbar above diagram; diagram fills remaining viewport height |

---

## Architecture

### File structure

```
demo_api_ui/src/
  components/
    ArchitectureOverviewPage.js        ← replace entirely
    ArchitectureSimSvg.jsx             ← NEW: hand-coded SVG diagram component
    ArchitectureSimControls.jsx        ← NEW: toolbar (mode tabs + playback buttons)
    ArchitectureSimStepDesc.jsx        ← NEW: step description bar below diagram
  config/
    architecture-sim-scenarios.js      ← NEW: all scenario step sequences
    diagram-overview-regions.js        ← KEEP (used by other pages; not used by sim)
```

The page component (`ArchitectureOverviewPage.js`) orchestrates state. All simulation logic lives in a single `useSimulation` hook in the same file. Visual sub-components are presentational.

---

## SVG Diagram

### Layout approach

The SVG uses a fixed `viewBox="0 0 1100 600"` with `width="100%"` so it scales to the container. Nodes are `<g>` elements with a `<rect>` + one or two `<text>` lines. Edges are `<line>` or `<path>` elements drawn behind nodes.

Node size: **120 × 50 px** minimum (large enough to read labels without zooming). Label font size: **13px bold** for the name, **10px** for the port/type subtitle.

### Nodes to include

Drawn to match the spatial regions in `diagram-overview-regions.js` (left-to-right, grouped by layer):

| ID | Label | Subtitle |
|---|---|---|
| `n-browser` | Browser | port 4000 |
| `n-bff` | BFF | demo_api_server :3001 |
| `n-mcp-gw` | MCP Gateway | :3005 |
| `n-mcp-server` | MCP Server | :8080 |
| `n-mcp-invest` | MCP Invest | :8081 |
| `n-agent` | Agent Service | :3006 / :8888 |
| `n-pingone` | PingOne | OAuth AS |
| `n-pingauthorize` | PingAuthorize | PDP |
| `n-hitl` | HITL Service | :3009 |
| `n-mortgage` | Mortgage Svc | :8082 |
| `n-resource-server` | Resource Server | :3001 |

### Node state CSS classes (toggled by simulation)

```css
.node-idle    /* default: grey fill, grey border */
.node-active  /* amber fill, amber border, breathing glow animation */
.node-done    /* green fill, green border; ✅ badge shown */
```

### Edge state CSS classes

```css
.edge-idle    /* grey stroke, grey arrowhead */
.edge-active  /* amber stroke-dashoffset sweep animation (0.7s) */
.edge-done    /* green stroke, static */
```

Edges are identified by IDs like `e-browser-bff`, `e-bff-mcpgw`, etc.

---

## Simulation Modes

All three modes share the same node/edge state machine. The difference is how steps are advanced.

### Mode A — Scenario selector + auto-play (default tab)

- Dropdown lists pre-authored scenarios
- **▶ Play** auto-advances at the selected speed (0.5×, 1×, 2×)
- **⏭ Step** advances one step manually
- **↺ Reset** returns all nodes/edges to idle, resets counter

### Mode B — Step-through

- No scenario dropdown — user steps freely
- Same **⏭ Step** / **↺ Reset** buttons
- Each step is a single node+edge activation; the user drives the narrative verbally

### Mode C — Live trace

- Connects to a BFF SSE endpoint: `GET /api/arch-events` (new endpoint, returns `text/event-stream`)
- BFF emits events as real requests flow through the system (OAuth, MCP tool calls, token exchange)
- Each event carries a `nodeId` and optional `edgeId`; the simulation engine activates them
- Play/Pause/Reset still available to pause the stream and replay

---

## Scenario Definitions

Stored in `architecture-sim-scenarios.js`. Each scenario is an array of steps:

```js
{
  id: "oauth-login",
  label: "OAuth Login (PKCE)",
  steps: [
    { nodes: ["n-browser"],  edges: [],                desc: "User opens the app" },
    { nodes: ["n-bff"],      edges: ["e-browser-bff"], desc: "Browser → BFF: PKCE redirect begins" },
    { nodes: ["n-pingone"],  edges: ["e-bff-pingone"],  desc: "BFF exchanges code at PingOne (RFC 6749 §4.1 + RFC 7636)" },
    { nodes: ["n-bff"],      edges: [],                desc: "BFF receives tokens; sets httpOnly session cookie" },
    { nodes: ["n-browser"],  edges: ["e-browser-bff"], desc: "Session established — login complete" },
  ]
}
```

**Initial scenario set:**

| ID | Label |
|---|---|
| `oauth-login` | OAuth Login (PKCE) |
| `mcp-tool-call` | MCP Tool Call |
| `token-exchange` | RFC 8693 Token Exchange |
| `hitl-consent` | HITL Consent Flow |
| `step-up-mfa` | Step-Up MFA |
| `path-a-api-key` | MCP Gateway Path A (API Key) |
| `path-b-dual-token` | MCP Gateway Path B (Dual Token) |
| `path-c-oauth-bearer` | MCP Gateway Path C (OAuth Bearer) |

---

## State Machine (`useSimulation` hook)

```
state = {
  mode: "scenario" | "step" | "live",
  scenarioId: string,
  stepIndex: number,           // 0 = not started
  playing: boolean,
  speed: 0.5 | 1 | 2,         // multiplier
  nodeStates: Map<id, "idle"|"active"|"done">,
  edgeStates: Map<id, "idle"|"active"|"done">,
}
```

Actions: `PLAY`, `PAUSE`, `STEP`, `RESET`, `SET_SCENARIO`, `SET_MODE`, `SET_SPEED`, `LIVE_EVENT`

When a step fires:
1. All currently `active` nodes → `done` (green badge shown)
2. All currently `active` edges → `done`
3. New step's `nodes` → `active` (amber pulse)
4. New step's `edges` → `active` (sweep animation triggered by toggling a CSS key)

---

## BFF SSE Endpoint (Live Trace mode)

New route: `GET /api/arch-events`  
Auth: session cookie (same as all BFF routes)  
Format: `text/event-stream`

```
event: arch-node
data: {"nodeId":"n-bff","edgeId":"e-browser-bff","label":"BFF received OAuth callback"}
```

The BFF emits events by requiring `archEventEmitter` (a singleton EventEmitter) in existing route handlers and calling `archEventEmitter.emit('node', { nodeId, edgeId, label })`. The SSE route subscribes to this emitter and pushes events to connected clients.

Minimal touch: one emitter file, one SSE route, 2–3 `emit()` calls in existing auth/MCP routes to seed the live trace. Not required for Modes A or B.

---

## Controls Toolbar Layout

```
[Mode: Scenario | Step-through | Live trace]  |  [Scenario ▾]  |  ▶ Play  ⏭ Step  ↺ Reset  |  Speed: [1× ▾]  →  Step N / M
```

Below diagram: a thin description bar showing the current step label with a coloured `STEP N` tag. Background `#eff6ff`, text `#1e40af`. Turns green (`#f0fdf4` / `#166534`) on completion.

Zoom controls from the current page are **removed** — the SVG scales with the viewport; a zoom level is no longer needed.

---

## What Is Not Changing

- Route stays `/architecture/overview`
- Page title and subtitle text stay the same
- `diagram-overview-regions.js` is untouched (used by other simulation surfaces)
- No changes to BFF auth, session, or token logic
- `REGRESSION_PLAN.md` §1 files are not touched

---

## Success Criteria

1. Page loads at `/architecture/overview` with no errors
2. Scenario mode: selecting "OAuth Login" and pressing Play advances through all steps automatically; nodes pulse amber then turn green ✅
3. Step-through mode: ⏭ Step advances one node/edge per click; ↺ Reset returns all to idle
4. Live trace mode: triggering a real login in another tab lights up `n-browser` → `n-bff` → `n-pingone` in sequence
5. All nodes are readable without zooming (min 13px labels)
6. `cd demo_api_ui && npm run build` exits 0
7. No regression on existing routes (auth, MCP, HITL)

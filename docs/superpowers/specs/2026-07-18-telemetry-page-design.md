# Telemetry Page — Design

Date: 2026-07-18
Status: Approved (brainstorm + mock validated with user)

## Goal

A new, demo-friendly **Telemetry** page in the customer UI that visualizes
Jaeger traces as a draggable boxes-and-arrows service graph, flowing **left to
right**. Audience is demo viewers: it must read at a glance (who calls whom,
what failed), not replicate the Jaeger UI.

## Decisions (from brainstorm)

| Question | Decision |
| --- | --- |
| Audience | Demo viewers |
| Live vs historical | Both — auto-refresh live, plus browse recent traces |
| Detail level | Toggle: Overview (services) / Detailed (all spans of one trace) |
| Node/edge info | Error status (color) + service/operation names; latency shown per node |
| Placement | New page, route open to **any logged-in user** (not admin-gated) |
| Refresh model | Auto-refresh (default ON, ~5s poll) + Pause button + manual Fetch button |
| Rendering | Custom SVG renderer (validated via mock) — **no new npm dependencies** |
| Backend | **Reuse existing Jaeger proxy** (`routes/tracing.js`, mounted at `/api/health/tracing`) — add one graph endpoint; UI never calls Jaeger directly |

**Amendment 2026-07-18:** during planning we found the app already has a
tracing feature: `demo_api_ui/src/pages/TracingPage.jsx` (`/tracing`, waterfall
view, admin side nav "Monitoring" group) backed by `routes/tracing.js`
(`/api/health/tracing/status|services|traces|traces/:id` with Jaeger base
auto-discovery). User decision: keep the new `/telemetry` page with the
approved draggable graph, but back it with the existing proxy — no duplicate
`routes/telemetry.js`. The existing `/tracing` page is untouched.

Mock (approved): left controls panel + right graph canvas; circular gradient
nodes with label + latency inside, edges trimmed to circle borders with
arrowheads and midpoint labels; nodes draggable with edges/labels following.
No emoji in the page (repo emoji allowlist applies).

## Architecture

```text
React TelemetryPage ──poll──> BFF /api/health/tracing/* ──HTTP──> Jaeger query API
                              (existing routes/tracing.js)   (auto-discovered base)
```

Jaeger is already deployed (`jaeger` service in docker-compose, query UI on
:16686) and all Node services already export OTLP spans when `ff_tracing` is
ON. This feature adds read-only visualization; no changes to instrumentation.

### Backend (demo_api_server)

Extend the existing `routes/tracing.js` (mounted under `/api/health/tracing`
via `routes/health.js`). Reuse its `resolveJaegerBase()` discovery and
existing endpoints; add one new endpoint. Graph transforms live in a new pure
module `services/tracingGraph.js` so they unit-test without HTTP.

Endpoints:

- `GET /api/health/tracing/graph?lookback=<1h>` (overview)
  Service-level topology aggregated from recent traces across all Jaeger
  services (traces deduped by traceID). Returns the graph shape below.

- `GET /api/health/tracing/graph?traceId=<id>` (detailed)
  One trace rendered as a span graph: nodes = spans (service + operation),
  edges = parent/child references.

- `GET /api/health/tracing/traces?service=&limit=&lookback=` — **already
  exists**; the page reuses it for the recent-traces list.

Graph response shape (single contract for both views):

```json
{
  "nodes": [{ "id": "bff", "label": "BFF (Node)", "latency": "45ms", "status": "ok|error" }],
  "edges": [{ "source": "bff", "target": "gateway", "label": "mcp:tool" }],
  "tracingEnabled": true,
  "fetchedAt": "ISO-8601"
}
```

Rules:

- `status: "error"` when any contributing span has `error=true` tag or
  `otel.status_code=ERROR`; else `ok`.
- `latency` is the p50 of contributing span durations (overview) or the span's
  own duration (detailed), pre-formatted server-side (`"45ms"`, `"1.9s"`).
- Jaeger base resolution and timeouts: reuse `resolveJaegerBase()` and the
  existing axios timeout conventions in `routes/tracing.js`.
- When `ff_tracing` is OFF or Jaeger is unreachable: `/graph` responds 200 with
  `{ tracingEnabled: false, nodes: [], edges: [] }` — never a 5xx; the page
  renders an explanatory empty state. (Existing endpoints keep their current
  503/502 contracts — unchanged.)

### Frontend (demo_api_ui)

- `src/pages/TelemetryPage.jsx` + `TelemetryPage.css`, with pure graph
  helpers (auto-layout, edge geometry, label wrap, position merge) in
  `src/pages/telemetryGraph.js` — mirrors the TracingPage /
  `tracingServiceSelect.js` pattern (vitest-testable without DOM).
- Route `/telemetry` in App.js, open to any logged-in user (same gate shape as
  the existing `/tracing` route). Nav link "Telemetry" in AdminSideNav's
  Monitoring group next to "Tracing" (TopNav intentionally has no customer nav
  links; non-admins reach the page by URL / demo link).
- Layout per approved mock:
  - **Left controls panel:** Auto-refresh toggle (default ON, 5s interval),
    Pause/Resume, Fetch, View select (Overview / Detailed), text filter
    (client-side match on node labels), stats box (trace count, span count,
    error count, avg latency), recent-traces list (Detailed view: clicking a
    trace loads its span graph), last-update timestamp.
  - **Right graph canvas:** SVG rendered from the `{nodes, edges}` model.
    Nodes: gradient circles (blue ok / red error), white stroke, drop shadow,
    wrapped label + latency inside. Edges: lines trimmed to circle radius,
    arrowhead marker, midpoint label. Legend bottom-left.
- Dragging: pointer events on node groups; drag updates the node's x/y in
  state and re-derives all edge geometry (validated in mock). User-dragged
  positions persist across refresh polls (positions keyed by node id; only
  new nodes get auto-layout).
- Auto-layout: layered left-to-right (root at left, children by depth);
  simple vertical spread within a layer. No layout library.
- Auto-refresh pauses while a drag is in progress and when the tab is hidden.

### Error/empty states

- `tracingEnabled: false` → centered message: tracing is off, enable the
  "Tracing — OpenTelemetry → Jaeger" feature flag, with link to /feature-flags.
- Jaeger reachable but no traces in lookback → "No traces yet — interact with
  the app (e.g. run an agent chip) and traces appear here."

## Not in scope

- No WebSocket streaming (poll only).
- No writes, no Jaeger config changes, no new instrumentation.
- No new npm dependencies (front or back).
- No changes to `ff_tracing` behavior itself.

## Testing

- **Backend unit:** `services/tracingGraph.js` transforms (Jaeger trace JSON
  → graph shape) with fixture payloads: happy path, error spans, empty; plus
  supertest on `/graph` for the Jaeger-down → `tracingEnabled:false` contract.
- **Frontend unit:** graph derivation (edge trim math, label wrap), reducer
  for merge-on-refresh preserving dragged positions.
- **Manual verify (demo loop):** with stack running and tracing ON, run a
  banking chip, open /telemetry, confirm BFF → gateway → MCP server → P1AZ
  path appears; kill a downstream service, confirm red node.

## Success criteria

1. /telemetry reachable by a non-admin user (URL) and from the admin side nav.
2. Overview graph shows real services from Jaeger within one poll cycle of
   traffic existing; left-to-right flow; error nodes red.
3. Detailed view renders a selected recent trace's spans.
4. Auto-refresh (5s) with working Pause and Fetch; dragged nodes keep their
   positions across refreshes.
5. Tracing OFF / Jaeger down → friendly empty state, no console errors, no 5xx.
6. `./run-tests.sh unit` green including new tests.

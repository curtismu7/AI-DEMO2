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
|---|---|
| Audience | Demo viewers |
| Live vs historical | Both — auto-refresh live, plus browse recent traces |
| Detail level | Toggle: Overview (services) / Detailed (all spans of one trace) |
| Node/edge info | Error status (color) + service/operation names; latency shown per node |
| Placement | New page on side nav, visible to **any logged-in user** (not admin-gated) |
| Refresh model | Auto-refresh (default ON, ~5s poll) + Pause button + manual Fetch button |
| Rendering | Custom SVG renderer (validated via mock) — **no new npm dependencies** |
| Backend | BFF proxy to Jaeger (Approach B) — UI never calls Jaeger directly |

Mock (approved): left controls panel + right graph canvas; circular gradient
nodes with label + latency inside, edges trimmed to circle borders with
arrowheads and midpoint labels; nodes draggable with edges/labels following.
No emoji in the page (repo emoji allowlist applies).

## Architecture

```
React TelemetryPage ──poll──> BFF /api/telemetry/* ──HTTP──> Jaeger query API
                                                     (JAEGER_QUERY_URL, in-network)
```

Jaeger is already deployed (`jaeger` service in docker-compose, query UI on
:16686) and all Node services already export OTLP spans when `ff_tracing` is
ON. This feature adds read-only visualization; no changes to instrumentation.

### Backend (demo_api_server)

New route module `routes/telemetry.js`, mounted at `/api/telemetry` for any
authenticated session (same gate as other user-visible routes, not admin).

Endpoints:

- `GET /api/telemetry/graph?lookback=<m>&view=overview`
  Service-level topology. Sources from Jaeger `/api/dependencies` (+
  `/api/services` for isolated nodes). Returns the graph shape below.

- `GET /api/telemetry/traces?limit=20`
  Recent traces summary list (id, root operation, start time, duration,
  span count, error flag). Sources from Jaeger `/api/traces?service=...`
  across known services.

- `GET /api/telemetry/graph?traceId=<id>` (view=detailed)
  One trace rendered as a span graph: nodes = spans (service + operation),
  edges = parent/child references.

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
- Jaeger base URL from `JAEGER_QUERY_URL` env (already set in compose:
  `http://jaeger:16686`); default `http://localhost:16686` for native run.
- When `ff_tracing` is OFF or Jaeger is unreachable: respond 200 with
  `{ tracingEnabled: false, nodes: [], edges: [] }` — never a 5xx; the page
  renders an explanatory empty state. Jaeger fetch timeout 3s.

### Frontend (demo_api_ui)

- `src/components/TelemetryPage.jsx` + CSS module following the nearest
  existing page's conventions.
- Route `/telemetry` in App.js; side nav link "Telemetry" in the user-visible
  section of the nav (both skins).
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

- **Backend unit:** transform functions (Jaeger dependencies/trace JSON →
  graph shape) with fixture payloads: happy path, error spans, empty, Jaeger
  down (timeout → `tracingEnabled:false`).
- **Frontend unit:** graph derivation (edge trim math, label wrap), reducer
  for merge-on-refresh preserving dragged positions.
- **Manual verify (demo loop):** with stack running and tracing ON, run a
  banking chip, open /telemetry, confirm BFF → gateway → MCP server → P1AZ
  path appears; kill a downstream service, confirm red node.

## Success criteria

1. /telemetry reachable from side nav by a non-admin user.
2. Overview graph shows real services from Jaeger within one poll cycle of
   traffic existing; left-to-right flow; error nodes red.
3. Detailed view renders a selected recent trace's spans.
4. Auto-refresh (5s) with working Pause and Fetch; dragged nodes keep their
   positions across refreshes.
5. Tracing OFF / Jaeger down → friendly empty state, no console errors, no 5xx.
6. `./run-tests.sh unit` green including new tests.
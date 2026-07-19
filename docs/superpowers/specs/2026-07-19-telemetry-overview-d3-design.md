# Telemetry Overview → New D3 Graph — Design

**Date:** 2026-07-19
**Status:** Approved (user, 2026-07-19)
**Trigger:** After shipping the per-trace D3 Graph tab on `/tracing`
(`docs/superpowers/specs/2026-07-18-jaeger-trace-ui-port-design.md`), the user
asked for a whole-system overview diagram, not scoped to one Jaeger trace.

## Discovery

`/telemetry` ("Service Graph" in the nav, next to Tracing and Health Check)
already does exactly this — it aggregates recent traces across every
instrumented service into one graph, refreshing every 5s. It just uses an
older, hand-rolled renderer (`telemetryGraph.js`: card layout math,
draggable positions, ribbon-colored edges) instead of the new D3 view
(clusters, zoom, tooltips, click-to-inspect panel, oauth/authz edge styling)
built for `/tracing`'s Graph tab. The user wants that new renderer here too,
for both of `/telemetry`'s existing modes (Overview, Detailed).

## Goal

Replace `TelemetryPage`'s renderer with the D3 model+renderer pair from the
`/tracing` port (`traceGraph.js` + `traceGraphRender.js`), for both Overview
(aggregate across all services) and Detailed (one selected trace) modes.
Retire the old mindmap-card code.

## Design

### 1. One graph model, two data sources

`demo_api_ui/src/services/traceGraph.js`'s `buildGraph`/`buildCollapsedGraph`
currently read `jaegerResponse.data[0]` — the first (only) trace. Generalize
to iterate every trace in `jaegerResponse.data` (1..N), merging each trace's
span-derived nodes and edges into one accumulator:

- Nodes: keyed by service id (or synthetic-peer id, e.g. `auth.pingone.com`).
  `callCount` and duration stats sum across traces; a node's cluster and
  display label are assigned once (first trace wins, they're static per
  service). `status` is `error` if error in ANY contributing trace.
- Edges: keyed by `source->target`. `callCount`/`totalDurationMs` sum across
  traces; `avgDurationMs` recomputed from the summed totals; `outcomes`
  merged (per-status-code counts added); `spans` concatenated.
  `exchangeKind`/`role`/`protocol` resolved the same busiest-member-wins rule
  Task 4's collapse merge already uses — no new logic, the existing
  per-trace classification just runs once per trace before the cross-trace
  merge.
- A single trace is the N=1 case of this — no special-casing needed, and
  `/tracing`'s Graph tab (which fetches one trace) keeps working unchanged
  against the generalized function.

### 2. BFF: raw multi-trace endpoint

New `GET /api/health/tracing/overview/raw?lookback=1h` in
`demo_api_server/routes/tracing.js`. Reuses the existing overview-gathering
logic already in the `/graph` route's no-`traceId` branch (`GET /api/services`
→ per-service `GET /api/traces?limit=10&lookback=` → union by traceID) — but
returns the raw union `{ data: [trace1, trace2, ...] }` (Jaeger's native
multi-trace shape) instead of pre-aggregating server-side. `jaeger-all-in-one`
is excluded from the service list, matching the existing overview branch.
Fail-soft: Jaeger unreachable or `ff_tracing=false` → `{ data: [] }`, 200 (the
existing `/graph` route's fail-soft convention), so the UI renders an empty
graph rather than an error banner.

`/traces/:id/raw` (single trace, from the previous port) is unchanged and is
what Detailed mode uses.

### 3. Shared fetch→build→render core

Extract `TraceGraphView.jsx`'s glue (fetch raw trace(s), call
`buildGraph`/`buildCollapsedGraph`, mount `renderTraceGraph`, own the
collapse toggle and click-to-inspect panel) into a reusable piece consumed by
both `/tracing`'s Graph tab and `/telemetry`'s two modes, parameterized by
fetch URL. `traceGraphRender.js` needs no changes — it already operates on
the final `{nodes, edges}` shape regardless of how many traces produced it.

### 4. TelemetryPage rewrite

`TelemetryPage.jsx` becomes a thin shell:
- **Overview** (default): fetches `.../overview/raw?lookback=`, auto-refreshes
  every 5s (existing `REFRESH_MS` behavior), service/lookback filters like
  `/tracing`'s. Whole-system view — no single-service scoping, matching
  today's overview semantics.
- **Detailed**: keeps today's recent-traces dropdown (reuses
  `/api/health/tracing/traces?service=&lookback=` for the picker), fetches
  the selected trace's `.../raw`, same shared core.

Both modes render through the shared core from §3 — same clustering, same
oauth/authz edge dashing, same collapse toggle, same click panel.

### 5. Retired

- `demo_api_ui/src/services/telemetryGraph.js` (old layout math: `CARD_W`,
  `CARD_H`, `edgePath`, `mergePositions`, `wrapLabel`) and its test file.
- Old `TelemetryPage.css` rules specific to the mindmap card/ribbon look;
  replaced with the same `tracing-graph-*` rule set already in
  `TracingPage.css`, copied into `TelemetryPage.css`. Each page's CSS is
  self-contained today (12 page CSS files, none cross-import another) — this
  keeps that convention rather than introducing the first cross-page CSS
  import.

### 6. Testing

- Unit tests for the generalized `buildGraph`/`buildCollapsedGraph`: two
  synthetic traces sharing one service-to-service edge → summed `callCount`,
  not overwritten; a trace-only-in-one-of-two-traces node still appears once;
  N=1 (today's single-trace behavior) unchanged — run existing
  `traceGraph.test.js` unmodified as a regression check.
- BFF route test for `/overview/raw` — service-list gathering, per-service
  trace union, `jaeger-all-in-one` exclusion, fail-soft `{data:[]}` on
  Jaeger-down/`ff_tracing=false`.
- Component tests for both `TelemetryPage` modes against the shared core
  (mirroring `TraceGraphView.test.jsx`'s fixture-driven pattern) — Overview
  renders multi-trace fixture with the expected merged edge counts; Detailed
  renders the same as today's per-trace behavior.

## Out of scope

- No change to `/tracing`'s Graph tab behavior or contract (it already
  fetches one trace by id; the generalized model is backward compatible).
- No change to Jaeger's OTLP ingestion, instrumentation, or the projected
  Steps timeline (`traceProjector.js`) — those are per-trace concepts and
  don't have an "overview" equivalent in this design.
- No new visual design work beyond what `/tracing`'s Graph tab already has —
  this is a reuse/consolidation, not a new UI.

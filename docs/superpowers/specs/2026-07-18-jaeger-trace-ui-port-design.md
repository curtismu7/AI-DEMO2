# Jaeger Trace UI Port — Design

**Date:** 2026-07-18
**Status:** Approved (user, 2026-07-18)
**Source:** `/Users/cmuir/Documents/id4ai-pingsoftware-acp-main` (`acp-workforce-portal`)
**Target:** AI-DEMO2 `/tracing` page (upgrade in place)

## Goal

Reuse the ACP workforce-portal Jaeger trace UI in AI-DEMO2: the D3 trace
graph (`graph.html` + `js/traceGraph.js`) **and** the projected business-step
timeline (`lib/traceProjector.js` + telemetry panel), integrated into the
existing `/tracing` page. Port method: **verbatim-port + adapt** — keep the
~100K of working ACP logic, rewrite only anchors, fetch URLs, and styling.

## What already exists in AI-DEMO2 (reused, not rebuilt)

- Jaeger all-in-one via docker-compose `tracing` profile
  (`jaeger:16686` / OTLP `4317`), `JAEGER_QUERY_URL` on the BFF.
- OTel auto-instrumentation (`scripts/otel-instrument.js`) on 7 services:
  `demo-api-server`, `mcp-server`, `mcp-gateway`, `agent-service`,
  `hitl-service`, `mcp-invest`, `authz-server`. `agent-service` also has a
  custom tracer (`demo_agent_service/src/otel.ts`).
- BFF Jaeger proxy `demo_api_server/routes/tracing.js` +
  `services/tracingGraph.js`.
- UI `demo_api_ui/src/pages/TracingPage.jsx` (trace list + span detail),
  routed at `/tracing` in `App.js`. Not listed in REGRESSION_PLAN §1.

## Design

### 1. BFF (demo_api_server)

- **New `services/traceProjector.js`** — ACP `lib/traceProjector.js` core
  kept verbatim (span sorting, projection contract, output shape). Anchor
  table rewritten for our topology:

  | Projected step | Anchor (our spans) |
  |---|---|
  | Agent Reasoning | service=`agent-service`, custom tracer spans (agentRunHandler) |
  | Token Exchange | service=`demo-api-server`, HTTP POST to PingOne `/as/token`, token-exchange grant |
  | Authorization | service=`authz-server`, decision-evaluation spans |
  | Tool Call | service=`mcp-gateway` or `mcp-server`, MCP `tools/call` |
  | Backend API | service=`mcp-invest` / downstream HTTP spans |

  ACP's CIBA and identity-proofing builders are dropped (no equivalent).
  An HITL step is added only if `hitl-service` spans appear in the captured
  trace. **Final anchor conditions are validated against a real captured
  live trace during implementation, not guessed** — our auto-instrumentation
  emits HTTP-level op names, not ACP's custom ops (`paz.authorization`,
  `router.llm`, …).

- **`routes/tracing.js` gains 2 endpoints** (existing ones untouched):
  - `GET /api/tracing/trace/:id/projected` — projected steps JSON, with the
    ACP ~5s retry-on-404 to absorb Jaeger ingest lag.
  - `GET /api/tracing/trace/:id/raw` — raw Jaeger query response passthrough
    for the graph view.

### 2. UI (demo_api_ui)

- **`src/services/traceGraph.js`** — verbatim-port of ACP `traceGraph.js`
  (`buildGraph`, `buildCollapsedGraph`, D3 render), parameterized on
  container element and d3 module. `d3` added as an npm dependency.
- **TracingPage trace-detail tabs:** current span detail | **Graph** |
  **Steps**.
  - `TraceGraphView.jsx` — React wrapper (ref + effect), fetches `/raw`,
    calls traceGraph render. Keeps collapse toggle, hide-infra filter,
    click-node detail.
  - `ProjectedTimeline.jsx` — fetches `/projected`, renders step name,
    duration, timing bar, expandable detail.
- Tailwind utility classes from `graph.html` translated into
  `TracingPage.css`. Emoji allowlist obeyed (no new emoji).

### 3. Data flow & errors

Browser → BFF proxy → Jaeger query API only (no cross-origin browser→Jaeger).
Tracing profile off / Jaeger down → existing TracingPage transient-failure
empty state covers both new tabs. Trace not yet ingested → BFF-side retry
(projected endpoint), graph tab shows the same retrying state.

### 4. Out of scope

- No OTLP browser-side span submission (ACP `POST /traces` forwarder).
- No changes to existing TelemetryPage, tracingGraph.js, or compose wiring.
- No new instrumentation beyond what live traces already contain.

## Success criteria

1. Projector unit tests green — fixtures derived from a captured live trace
   with our service names (adapted from ACP `tests/traceProjector.*.test.mjs`).
2. Route tests for the 2 new endpoints green.
3. `TracingPage.test.jsx` extended for tab rendering, green.
4. UI build gate green (`npm run build` in `demo_api_ui`).
5. Live verify: stack up with tracing profile, fire a use-case chip, open
   `/tracing` — graph shows the service chain
   (`demo-api-server` ▸ `mcp-gateway` ▸ `mcp-server`) and the Steps tab shows
   the projected timeline for the same trace.
6. All work in isolated worktree (`worktree-jaeger-trace-ui`);
   `graphify update .` run after code edits.

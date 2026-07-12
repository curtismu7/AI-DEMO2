# Tracing: in-app trace view + Jaeger link at demo base URL

Date: 2026-07-11
Branch: `feat/tracing-in-app-view`

## Problem

The `/tracing` page lists OpenTelemetry traces (via the BFF proxy to Jaeger) and
offers a "View in Jaeger" link per trace. In the K8s (Ping SE cluster) deployment
that link 404s:

- `JAEGER_UI_URL` is unset, so the BFF falls back to `http://localhost:16686`
  (`demo_api_server/routes/tracing.js:16`). The link therefore points at the
  viewer's own laptop, not the cluster.
- Even with a correct host, Jaeger's K8s Service is `ClusterIP` only
  (`k8s/73-jaeger-deployment.yaml`) — not reachable from a browser.

The trace **listing** works because the BFF reaches Jaeger in-cluster via
`JAEGER_QUERY_URL=http://jaeger:16686`. Only the browser-facing deep link is
broken.

Root cause is environment/config, not the trace pipeline. Two deliverables,
both approved by the user:

1. **In-app trace view** (primary) — render span detail inside the demo, using
   the BFF proxy. Works in K8s, docker, and native with no browser→Jaeger
   exposure.
2. **External link at the demo base URL** (secondary) — expose Jaeger through
   the demo's nginx at `<base>/jaeger` and set `JAEGER_UI_URL` accordingly so
   "View in Jaeger" resolves.

## Non-goals

- Authenticating / gating the exposed Jaeger UI. Component B exposes Jaeger UI
  publicly at `<base>/jaeger`; putting it behind demo auth is a separate
  follow-up (flagged, not in scope).
- Changing the OTLP export path, span instrumentation, or Jaeger storage.
- Docker/native behavior: they keep the working `localhost:16686` default; this
  work must not regress them.

## Component A — In-app trace view

### BFF: `GET /api/health/tracing/traces/:id`

New route in `demo_api_server/routes/tracing.js`.

- Validate `:id` matches `^[0-9a-f]{16,32}$`; 400 on mismatch.
- Resolve base with existing `resolveJaegerBase()`. If null → 503
  `jaeger_unreachable` (same shape as sibling routes).
- `GET ${base}/api/traces/:id` (timeout 10000ms). On axios error → 502
  `jaeger_query_failed` with `err.message`. On Jaeger 404 → 404
  `trace_not_found` (so the UI can distinguish "gone" from "broken").
- Normalize the single trace into a flat, render-ready shape:
  - `traceId`
  - `spans`: array ordered by tree (root first, DFS), each:
    `{ spanID, parentSpanID, serviceName, operationName, relativeStartMs,
       durationMs, depth }`
  - `serviceColors`: map of serviceName → stable color key (index-based; the
    UI owns the actual palette)
  - `durationMs`: total trace span (max end − min start)
  - `startTime`: ISO of min start
- `parentSpanID` derived from the span's `CHILD_OF`/`FOLLOWS_FROM` reference
  (Jaeger `references[]`); root = no in-trace reference.
- `serviceName` resolved from the trace's `processes` map via each span's
  `processID`.

Reuse `summariseTrace`'s time math (min-start / max-end) where practical; factor
a shared helper if it reduces duplication, but keep the diff minimal.

### UI: `TraceDetail` panel in `TracingPage.jsx`

- Clicking a trace row toggles an inline expanded panel under that row (not a
  modal). One row expanded at a time.
- On expand, fetch `/api/health/tracing/traces/${traceId}`; show loading, error,
  and empty states mirroring the existing table conventions.
- Render a span waterfall:
  - one horizontal bar per span, left offset = `relativeStartMs / durationMs`,
    width = `durationMs / total`, min width for visibility
  - indent by `depth`, color by `serviceName`
  - label: `serviceName · operationName` + right-aligned duration
    (`ms`/`s` formatting like the existing table)
- Styling uses existing `tracing-*` tokens in `TracingPage.css`; add scoped
  classes (`tracing-detail*`, `tracing-span*`). No new emoji; obey
  REGRESSION_PLAN §0 style rules and keep the DOM minimal.
- Keep the "View in Jaeger" link in the row (Component B makes it resolve).

## Component B — Jaeger UI at the demo base URL (K8s only)

- **nginx** (`k8s/02-configmap.yaml`, the `nginx-config` configMap): add
  ```
  location /jaeger/ {
      proxy_pass http://jaeger:16686/;
      proxy_set_header Host $host;
      proxy_http_version 1.1;
  }
  ```
  Mirror the existing `location /api/` block's TLS/header conventions.
- **jaeger** (`k8s/73-jaeger-deployment.yaml`): add env `QUERY_BASE_PATH=/jaeger`
  so Jaeger serves assets and builds links under the subpath.
- **BFF** (`k8s/20-api-server-deployment.yaml`): add env
  `JAEGER_UI_URL` = `${PUBLIC_APP_URL}/jaeger` (the browser base). No app code
  change — `tracing.js:16` already reads `JAEGER_UI_URL`.
- Docker (`docker-compose.yml`) and native (`run.sh`) are unchanged; their
  existing `localhost:16686` default keeps working.

## Data flow

```
browser (demo base URL)
  ├─ list:   GET /api/health/tracing/traces        → nginx /api → BFF → jaeger:16686/api/traces
  ├─ detail: GET /api/health/tracing/traces/:id     → nginx /api → BFF → jaeger:16686/api/traces/:id
  │          → in-app waterfall (Component A)
  └─ deep link: GET <base>/jaeger/trace/:id         → nginx /jaeger → jaeger:16686 (Component B)
```

## Error handling

- BFF `:id` route: 400 (bad id), 404 (trace_not_found), 502 (query failed),
  503 (jaeger unreachable) — JSON `{error, message}`.
- UI: per-row detail failure shows an inline error inside the expanded panel and
  does not blank the table.

## Testing / success criteria

- Unit: extend `demo_api_server/tests/tracingRoute.test.js` — `:id` returns
  normalized spans on success; 404/502/503 mapped correctly; bad id → 400.
- Manual (live cluster/docker):
  - Click a listed trace → waterfall renders with the same span count Jaeger
    reports and correct relative durations.
  - `<base>/jaeger/trace/<id>` loads Jaeger's own view for a trace the demo page
    lists (no 404, no localhost).
- Regression: existing tracing tests pass; `topology:verify` / `hygiene:check`
  clean; no change to docker/native tracing behavior.

## Constraints

- Git worktree (`feat/tracing-in-app-view`); explicit `git add`, never `-A`.
- Minimal diff, emoji allowlist (`⚠️ ✅ ❌ 🔐 ✕ ✓` only).
- `TracingPage.jsx/.css` is a UI surface — apply `regression-guard` before edits.

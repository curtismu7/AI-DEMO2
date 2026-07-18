# Telemetry Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `/telemetry` page rendering Jaeger traces as a draggable left-to-right boxes-and-arrows service graph, backed by one new endpoint on the existing Jaeger proxy.

**Architecture:** Pure transform module (`services/tracingGraph.js`) turns Jaeger trace JSON into a `{nodes, edges}` contract; a new `GET /graph` endpoint on the existing `routes/tracing.js` proxy serves it fail-soft. The React page (`pages/TelemetryPage.jsx`) renders the contract as SVG with pure geometry helpers (`pages/telemetryGraph.js`) and pointer-event dragging.

**Tech Stack:** Express + axios + jest/supertest (BFF); React + vitest/RTL (UI). Spec: `docs/superpowers/specs/2026-07-18-telemetry-page-design.md`.

## Global Constraints

- **No new npm dependencies** (front or back).
- **No emoji** in page code/copy (repo allowlist applies; use none).
- Do not modify existing `/status`, `/services`, `/traces`, `/traces/:id` endpoints or `TracingPage`.
- `/graph` must **never return 5xx**: Jaeger unreachable or query failure → `200 {tracingEnabled:false, nodes:[], edges:[]}`.
- Graph contract (both views): `{ nodes: [{id, label, latency, status: "ok"|"error"}], edges: [{source, target, label}], tracingEnabled, fetchedAt }`.
- BFF tests run with `CI=true npx jest <file>` from `demo_api_server/`. UI tests run with `npx vitest run <file>` from `demo_api_ui/`.
- Commit after every task from the worktree branch `worktree-feat-telemetry-page`; stage files explicitly (never `git add -A`).

---

### Task 1: Backend graph transforms (`services/tracingGraph.js`)

**Files:**
- Create: `demo_api_server/services/tracingGraph.js`
- Test: `demo_api_server/tests/services/tracingGraph.test.js`

**Interfaces:**
- Consumes: nothing (pure module).
- Produces (CommonJS exports used by Task 2):
  - `buildTraceGraph(trace) -> {nodes, edges}` — one Jaeger trace object (`{traceID, spans, processes}`) to span-level graph.
  - `buildOverviewGraph(traces) -> {nodes, edges}` — array of Jaeger trace objects to service-level graph.
  - `formatLatencyUs(us) -> string` — microseconds to `"<1ms" | "45ms" | "1.9s"`.
  - `spanHasError(span) -> boolean`.

- [ ] **Step 1: Write the failing test**

```js
// demo_api_server/tests/services/tracingGraph.test.js
'use strict';

const {
  buildTraceGraph,
  buildOverviewGraph,
  formatLatencyUs,
  spanHasError,
} = require('../../services/tracingGraph');

/** Minimal Jaeger trace fixture: bff -> gateway (child), gateway span errored. */
function fixtureTrace() {
  return {
    traceID: 'abc123',
    processes: {
      p1: { serviceName: 'demo-api-server' },
      p2: { serviceName: 'mcp-gateway' },
    },
    spans: [
      {
        traceID: 'abc123', spanID: 's1', processID: 'p1',
        operationName: 'POST /api/agent/run',
        startTime: 1000, duration: 50000, references: [], tags: [],
      },
      {
        traceID: 'abc123', spanID: 's2', processID: 'p2',
        operationName: 'mcp:tool',
        startTime: 2000, duration: 12000,
        references: [{ refType: 'CHILD_OF', traceID: 'abc123', spanID: 's1' }],
        tags: [{ key: 'error', type: 'bool', value: true }],
      },
    ],
  };
}

describe('formatLatencyUs', () => {
  it('formats sub-ms, ms, and seconds', () => {
    expect(formatLatencyUs(500)).toBe('<1ms');
    expect(formatLatencyUs(45000)).toBe('45ms');
    expect(formatLatencyUs(1850000)).toBe('1.9s');
  });
});

describe('spanHasError', () => {
  it('detects error tag and otel.status_code, tolerates missing tags', () => {
    expect(spanHasError({ tags: [{ key: 'error', value: true }] })).toBe(true);
    expect(spanHasError({ tags: [{ key: 'error', value: 'true' }] })).toBe(true);
    expect(spanHasError({ tags: [{ key: 'otel.status_code', value: 'ERROR' }] })).toBe(true);
    expect(spanHasError({ tags: [{ key: 'http.status_code', value: 200 }] })).toBe(false);
    expect(spanHasError({})).toBe(false);
  });
});

describe('buildTraceGraph', () => {
  it('maps spans to nodes and parent refs to edges', () => {
    const g = buildTraceGraph(fixtureTrace());
    expect(g.nodes).toEqual([
      { id: 's1', label: 'demo-api-server: POST /api/agent/run', latency: '50ms', status: 'ok' },
      { id: 's2', label: 'mcp-gateway: mcp:tool', latency: '12ms', status: 'error' },
    ]);
    expect(g.edges).toEqual([
      { source: 's1', target: 's2', label: 'mcp:tool' },
    ]);
  });

  it('returns empty graph for null/empty trace', () => {
    expect(buildTraceGraph(null)).toEqual({ nodes: [], edges: [] });
    expect(buildTraceGraph({ spans: [] })).toEqual({ nodes: [], edges: [] });
  });
});

describe('buildOverviewGraph', () => {
  it('aggregates services: error rolls up, latency is p50, cross-service edges labeled', () => {
    const g = buildOverviewGraph([fixtureTrace()]);
    expect(g.nodes).toEqual(
      expect.arrayContaining([
        { id: 'demo-api-server', label: 'demo-api-server', latency: '50ms', status: 'ok' },
        { id: 'mcp-gateway', label: 'mcp-gateway', latency: '12ms', status: 'error' },
      ]),
    );
    expect(g.nodes).toHaveLength(2);
    expect(g.edges).toEqual([
      { source: 'demo-api-server', target: 'mcp-gateway', label: 'mcp:tool' },
    ]);
  });

  it('dedupes repeated cross-service edges and keeps first label', () => {
    const t = fixtureTrace();
    const t2 = JSON.parse(JSON.stringify(t));
    t2.traceID = 'def456';
    t2.spans[1].operationName = 'mcp:other';
    const g = buildOverviewGraph([t, t2]);
    expect(g.edges).toEqual([
      { source: 'demo-api-server', target: 'mcp-gateway', label: 'mcp:tool' },
    ]);
  });

  it('returns empty graph for no traces', () => {
    expect(buildOverviewGraph([])).toEqual({ nodes: [], edges: [] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && CI=true npx jest tests/services/tracingGraph.test.js`
Expected: FAIL — `Cannot find module '../../services/tracingGraph'`

- [ ] **Step 3: Write minimal implementation**

```js
// demo_api_server/services/tracingGraph.js
'use strict';

/**
 * tracingGraph.js — pure transforms from Jaeger trace JSON to the Telemetry
 * page graph contract: { nodes: [{id, label, latency, status}], edges:
 * [{source, target, label}] }. No HTTP here; routes/tracing.js owns fetching.
 */

/** Format a microsecond duration for node display. */
function formatLatencyUs(us) {
  const ms = (Number(us) || 0) / 1000;
  if (ms < 1) return '<1ms';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/** True when a span carries an error tag or OTel ERROR status. */
function spanHasError(span) {
  const tags = Array.isArray(span?.tags) ? span.tags : [];
  return tags.some(
    (t) =>
      (t.key === 'error' && (t.value === true || t.value === 'true')) ||
      (t.key === 'otel.status_code' && String(t.value).toUpperCase() === 'ERROR'),
  );
}

function serviceOf(span, processes) {
  return processes?.[span.processID]?.serviceName || 'unknown';
}

/** In-trace parent spanID (CHILD_OF/FOLLOWS_FROM), or null. */
function parentOf(span, spanIds) {
  const ref = (span.references || []).find(
    (r) => (r.refType === 'CHILD_OF' || r.refType === 'FOLLOWS_FROM') && spanIds.has(r.spanID),
  );
  return ref ? ref.spanID : null;
}

function p50(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

/** One Jaeger trace to a span-level graph (detailed view). */
function buildTraceGraph(trace) {
  const spans = Array.isArray(trace?.spans) ? trace.spans : [];
  if (!spans.length) return { nodes: [], edges: [] };
  const processes = trace.processes || {};
  const spanIds = new Set(spans.map((s) => s.spanID));

  const nodes = spans.map((s) => ({
    id: s.spanID,
    label: `${serviceOf(s, processes)}: ${s.operationName || '-'}`,
    latency: formatLatencyUs(s.duration),
    status: spanHasError(s) ? 'error' : 'ok',
  }));

  const edges = [];
  for (const s of spans) {
    const parent = parentOf(s, spanIds);
    if (parent) edges.push({ source: parent, target: s.spanID, label: s.operationName || '-' });
  }
  return { nodes, edges };
}

/** Recent traces (deduped upstream) to a service-level graph (overview). */
function buildOverviewGraph(traces) {
  const byService = new Map(); // name -> { durations: number[], error: boolean }
  const edgeMap = new Map(); // "src tgt" -> label (first seen)

  for (const trace of Array.isArray(traces) ? traces : []) {
    const spans = Array.isArray(trace?.spans) ? trace.spans : [];
    const processes = trace?.processes || {};
    const spanIds = new Set(spans.map((s) => s.spanID));
    const byId = new Map(spans.map((s) => [s.spanID, s]));

    for (const s of spans) {
      const svc = serviceOf(s, processes);
      if (!byService.has(svc)) byService.set(svc, { durations: [], error: false });
      const agg = byService.get(svc);
      agg.durations.push(Number(s.duration) || 0);
      if (spanHasError(s)) agg.error = true;

      const parentId = parentOf(s, spanIds);
      if (parentId) {
        const parentSvc = serviceOf(byId.get(parentId), processes);
        if (parentSvc !== svc) {
          const key = `${parentSvc} ${svc}`;
          if (!edgeMap.has(key)) edgeMap.set(key, s.operationName || '-');
        }
      }
    }
  }

  const nodes = [...byService.entries()].map(([name, agg]) => ({
    id: name,
    label: name,
    latency: formatLatencyUs(p50(agg.durations)),
    status: agg.error ? 'error' : 'ok',
  }));
  const edges = [...edgeMap.entries()].map(([key, label]) => {
    const [source, target] = key.split(' ');
    return { source, target, label };
  });
  return { nodes, edges };
}

module.exports = { buildTraceGraph, buildOverviewGraph, formatLatencyUs, spanHasError };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_server && CI=true npx jest tests/services/tracingGraph.test.js`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/services/tracingGraph.js demo_api_server/tests/services/tracingGraph.test.js
git commit -m "feat(telemetry): pure Jaeger-to-graph transforms (tracingGraph service)"
```

---

### Task 2: `GET /api/health/tracing/graph` endpoint

**Files:**
- Modify: `demo_api_server/routes/tracing.js` (append before `module.exports`)
- Test: `demo_api_server/tests/routes/tracingGraph.route.test.js`

**Interfaces:**
- Consumes: `buildTraceGraph`, `buildOverviewGraph` from `../services/tracingGraph` (Task 1); existing `resolveJaegerBase()` in the same file.
- Produces: `GET /graph?lookback=1h` (overview) and `GET /graph?traceId=<hex>` (detailed), both returning the graph contract with `tracingEnabled` + `fetchedAt`. Consumed by Task 4's page via `/api/health/tracing/graph`.

- [ ] **Step 1: Write the failing test**

```js
// demo_api_server/tests/routes/tracingGraph.route.test.js
'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('axios');
const axios = require('axios');

const tracingRouter = require('../../routes/tracing');

function makeApp() {
  const app = express();
  app.use('/api/health/tracing', tracingRouter);
  return app;
}

/** axios.get mock keyed by URL substring. */
function mockJaeger(handlers) {
  axios.get.mockImplementation((url) => {
    for (const [needle, responder] of handlers) {
      if (String(url).includes(needle)) return responder(url);
    }
    return Promise.reject(new Error(`unmocked url: ${url}`));
  });
}

const TRACE = {
  traceID: 'a1b2c3d4e5f60718',
  processes: { p1: { serviceName: 'demo-api-server' }, p2: { serviceName: 'mcp-gateway' } },
  spans: [
    { traceID: 'a1b2c3d4e5f60718', spanID: 's1', processID: 'p1', operationName: 'POST /run', startTime: 1, duration: 50000, references: [], tags: [] },
    { traceID: 'a1b2c3d4e5f60718', spanID: 's2', processID: 'p2', operationName: 'mcp:tool', startTime: 2, duration: 12000, references: [{ refType: 'CHILD_OF', spanID: 's1' }], tags: [] },
  ],
};

afterEach(() => jest.resetAllMocks());

describe('GET /api/health/tracing/graph', () => {
  it('fail-soft 200 when Jaeger is unreachable', async () => {
    axios.get.mockRejectedValue(new Error('ECONNREFUSED'));
    const res = await request(makeApp()).get('/api/health/tracing/graph');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ tracingEnabled: false, nodes: [], edges: [] });
    expect(typeof res.body.fetchedAt).toBe('string');
  });

  it('overview aggregates traces across services, deduped by traceID', async () => {
    mockJaeger([
      ['/api/services', () => Promise.resolve({ status: 200, data: { data: ['demo-api-server', 'mcp-gateway'] } })],
      ['/api/traces', () => Promise.resolve({ status: 200, data: { data: [TRACE] } })],
    ]);
    const res = await request(makeApp()).get('/api/health/tracing/graph?lookback=1h');
    expect(res.status).toBe(200);
    expect(res.body.tracingEnabled).toBe(true);
    expect(res.body.nodes.map((n) => n.id).sort()).toEqual(['demo-api-server', 'mcp-gateway']);
    expect(res.body.edges).toEqual([
      { source: 'demo-api-server', target: 'mcp-gateway', label: 'mcp:tool' },
    ]);
  });

  it('detailed returns span graph for a traceId', async () => {
    mockJaeger([
      ['/api/services', () => Promise.resolve({ status: 200, data: { data: ['demo-api-server'] } })],
      [`/api/traces/${TRACE.traceID}`, () => Promise.resolve({ status: 200, data: { data: [TRACE] } })],
    ]);
    const res = await request(makeApp()).get(`/api/health/tracing/graph?traceId=${TRACE.traceID}`);
    expect(res.status).toBe(200);
    expect(res.body.nodes).toHaveLength(2);
    expect(res.body.edges).toEqual([{ source: 's1', target: 's2', label: 'mcp:tool' }]);
  });

  it('rejects malformed traceId with 400', async () => {
    mockJaeger([
      ['/api/services', () => Promise.resolve({ status: 200, data: { data: ['demo-api-server'] } })],
    ]);
    const res = await request(makeApp()).get('/api/health/tracing/graph?traceId=nope!');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_trace_id');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && CI=true npx jest tests/routes/tracingGraph.route.test.js`
Expected: FAIL — 404s (route `/graph` not defined). The fail-soft test may accidentally pass; the other three must fail.

- [ ] **Step 3: Implement the endpoint**

In `demo_api_server/routes/tracing.js`, add to the top requires (after `const configStore = ...`):

```js
const { buildTraceGraph, buildOverviewGraph } = require('../services/tracingGraph');
```

Append before `module.exports = router;`:

```js
/**
 * GET /graph — Telemetry page graph.
 * ?traceId=<hex>  span-level graph of one trace (detailed view)
 * ?lookback=1h    service-level graph aggregated from recent traces (overview)
 * Fail-soft: Jaeger unreachable or query failure returns 200 with
 * tracingEnabled:false so the page can render an empty state (never 5xx).
 */
router.get('/graph', async (req, res) => {
  const failSoft = () => ({
    tracingEnabled: false,
    nodes: [],
    edges: [],
    fetchedAt: new Date().toISOString(),
  });

  const base = await resolveJaegerBase();
  if (!base) return res.status(200).json(failSoft());

  const traceId = String(req.query.traceId || '').trim();
  try {
    if (traceId) {
      if (!/^[0-9a-f]{16,32}$/i.test(traceId)) {
        return res.status(400).json({ error: 'invalid_trace_id', message: 'Trace id must be 16-32 hex characters.' });
      }
      const resp = await axios.get(`${base}/api/traces/${traceId}`, { timeout: 10000 });
      const trace = Array.isArray(resp.data?.data) ? resp.data.data[0] : null;
      if (!trace) return res.status(404).json({ error: 'trace_not_found', message: 'Trace not found.' });
      return res.json({ ...buildTraceGraph(trace), tracingEnabled: true, fetchedAt: new Date().toISOString() });
    }

    const lookback = String(req.query.lookback || '1h').trim();
    const svcResp = await axios.get(`${base}/api/services`, { timeout: 5000 });
    const services = (Array.isArray(svcResp.data?.data) ? svcResp.data.data : []).filter((s) => s && s !== 'jaeger-all-in-one');
    const perService = await Promise.all(
      services.map((service) =>
        axios
          .get(`${base}/api/traces`, { timeout: 10000, params: { service, limit: 10, lookback } })
          .then((r) => (Array.isArray(r.data?.data) ? r.data.data : []))
          .catch(() => []),
      ),
    );
    const byId = new Map();
    for (const t of perService.flat()) {
      if (t?.traceID && !byId.has(t.traceID)) byId.set(t.traceID, t);
    }
    return res.json({ ...buildOverviewGraph([...byId.values()]), tracingEnabled: true, fetchedAt: new Date().toISOString() });
  } catch (err) {
    if (traceId && err.response?.status === 404) {
      return res.status(404).json({ error: 'trace_not_found', message: 'Trace not found.' });
    }
    return res.status(200).json(failSoft());
  }
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_server && CI=true npx jest tests/routes/tracingGraph.route.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Regression — existing suites touching this file**

Run: `cd demo_api_server && CI=true npx jest tests/ --listTests | grep -i tracing` then run any listed suites.
Expected: all PASS (no existing endpoint changed).

- [ ] **Step 6: Commit**

```bash
git add demo_api_server/routes/tracing.js demo_api_server/tests/routes/tracingGraph.route.test.js
git commit -m "feat(telemetry): GET /api/health/tracing/graph endpoint (fail-soft)"
```

---

### Task 3: Client graph helpers (`pages/telemetryGraph.js`)

**Files:**
- Create: `demo_api_ui/src/pages/telemetryGraph.js`
- Test: `demo_api_ui/src/pages/__tests__/telemetryGraph.test.js`

**Interfaces:**
- Consumes: the graph contract from Task 2 (`{nodes, edges}`).
- Produces (ES exports used by Task 4):
  - `NODE_RADIUS` (constant, 40)
  - `autoLayout(graph, width, height) -> Map<id, {x, y}>` — layered left-to-right by BFS depth from roots.
  - `mergePositions(prev, graph, width, height) -> Map<id, {x, y}>` — keeps prior positions for surviving ids, lays out only new ids.
  - `edgeGeometry(sourcePos, targetPos, radius) -> {x1, y1, x2, y2, labelX, labelY}` — endpoints trimmed to circle borders, midpoint label offset perpendicular to the line.
  - `wrapLabel(label, maxChars=12) -> string[]` — up to 2 lines, second line ellipsized.

- [ ] **Step 1: Write the failing test**

```js
// demo_api_ui/src/pages/__tests__/telemetryGraph.test.js
import { describe, expect, it } from "vitest";
import {
  NODE_RADIUS,
  autoLayout,
  edgeGeometry,
  mergePositions,
  wrapLabel,
} from "../telemetryGraph";

const GRAPH = {
  nodes: [
    { id: "a", label: "A" },
    { id: "b", label: "B" },
    { id: "c", label: "C" },
  ],
  edges: [
    { source: "a", target: "b", label: "ab" },
    { source: "b", target: "c", label: "bc" },
  ],
};

describe("autoLayout", () => {
  it("places nodes left-to-right by depth", () => {
    const pos = autoLayout(GRAPH, 900, 400);
    expect(pos.get("a").x).toBeLessThan(pos.get("b").x);
    expect(pos.get("b").x).toBeLessThan(pos.get("c").x);
  });

  it("spreads same-depth nodes vertically without overlap", () => {
    const g = {
      nodes: [{ id: "r" }, { id: "x" }, { id: "y" }],
      edges: [
        { source: "r", target: "x", label: "" },
        { source: "r", target: "y", label: "" },
      ],
    };
    const pos = autoLayout(g, 900, 400);
    expect(pos.get("x").x).toBe(pos.get("y").x);
    expect(Math.abs(pos.get("x").y - pos.get("y").y)).toBeGreaterThanOrEqual(2 * NODE_RADIUS);
  });

  it("handles cycles without hanging and places every node", () => {
    const g = {
      nodes: [{ id: "a" }, { id: "b" }],
      edges: [
        { source: "a", target: "b", label: "" },
        { source: "b", target: "a", label: "" },
      ],
    };
    const pos = autoLayout(g, 900, 400);
    expect(pos.size).toBe(2);
  });
});

describe("mergePositions", () => {
  it("keeps dragged positions for surviving nodes and lays out new ones", () => {
    const prev = new Map([["a", { x: 123, y: 321 }]]);
    const pos = mergePositions(prev, GRAPH, 900, 400);
    expect(pos.get("a")).toEqual({ x: 123, y: 321 });
    expect(pos.get("b")).toBeDefined();
    expect(pos.get("c")).toBeDefined();
  });

  it("drops positions of removed nodes", () => {
    const prev = new Map([["gone", { x: 1, y: 2 }]]);
    const pos = mergePositions(prev, GRAPH, 900, 400);
    expect(pos.has("gone")).toBe(false);
  });
});

describe("edgeGeometry", () => {
  it("trims endpoints to the circle borders", () => {
    const g = edgeGeometry({ x: 0, y: 0 }, { x: 100, y: 0 }, 40);
    expect(g.x1).toBeCloseTo(42, 0);
    expect(g.x2).toBeCloseTo(100 - 46, 0);
    expect(g.y1).toBeCloseTo(0, 5);
  });
});

describe("wrapLabel", () => {
  it("returns one line for short labels, two lines for long ones", () => {
    expect(wrapLabel("BFF")).toEqual(["BFF"]);
    const lines = wrapLabel("demo-api-server: POST /api/agent/run");
    expect(lines).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_ui && npx vitest run src/pages/__tests__/telemetryGraph.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```js
// demo_api_ui/src/pages/telemetryGraph.js
// Pure geometry/layout helpers for the Telemetry page graph. No DOM, no fetch —
// vitest-testable in isolation (mirrors the tracingServiceSelect.js pattern).

export const NODE_RADIUS = 40;

const MARGIN_X = 70;
const MARGIN_Y = 60;

/**
 * BFS depth from root nodes (no incoming edges). Cycle-safe: each node is
 * assigned once. Orphan nodes (unreachable from any root, e.g. pure cycles)
 * get depth 0.
 * @returns {Map<string, number>}
 */
function nodeDepths(graph) {
  const nodes = graph?.nodes || [];
  const edges = graph?.edges || [];
  const incoming = new Set(edges.map((e) => e.target));
  const out = new Map();
  for (const e of edges) {
    if (!out.has(e.source)) out.set(e.source, []);
    out.get(e.source).push(e.target);
  }
  const depths = new Map();
  const queue = [];
  for (const n of nodes) {
    if (!incoming.has(n.id)) {
      depths.set(n.id, 0);
      queue.push(n.id);
    }
  }
  while (queue.length) {
    const id = queue.shift();
    for (const next of out.get(id) || []) {
      if (!depths.has(next)) {
        depths.set(next, depths.get(id) + 1);
        queue.push(next);
      }
    }
  }
  for (const n of nodes) if (!depths.has(n.id)) depths.set(n.id, 0);
  return depths;
}

/**
 * Layered left-to-right layout.
 * @returns {Map<string, {x: number, y: number}>}
 */
export function autoLayout(graph, width, height) {
  const nodes = graph?.nodes || [];
  const depths = nodeDepths(graph);
  const byDepth = new Map();
  for (const n of nodes) {
    const d = depths.get(n.id);
    if (!byDepth.has(d)) byDepth.set(d, []);
    byDepth.get(d).push(n.id);
  }
  const maxDepth = Math.max(0, ...byDepth.keys());
  const colStep = maxDepth > 0 ? (width - 2 * MARGIN_X) / maxDepth : 0;

  const positions = new Map();
  for (const [depth, ids] of byDepth) {
    const rowStep = Math.max(2 * NODE_RADIUS + 24, (height - 2 * MARGIN_Y) / Math.max(1, ids.length - 1));
    ids.forEach((id, i) => {
      const y = ids.length === 1 ? height / 2 : MARGIN_Y + i * Math.min(rowStep, (height - 2 * MARGIN_Y) / Math.max(1, ids.length - 1));
      positions.set(id, { x: MARGIN_X + depth * colStep, y });
    });
  }
  return positions;
}

/**
 * Keep prior (possibly user-dragged) positions for surviving node ids; lay out
 * only nodes that are new this refresh. Removed ids are dropped.
 */
export function mergePositions(prev, graph, width, height) {
  const fresh = autoLayout(graph, width, height);
  const merged = new Map();
  for (const n of graph?.nodes || []) {
    merged.set(n.id, prev?.get(n.id) || fresh.get(n.id));
  }
  return merged;
}

/**
 * Line endpoints trimmed to circle borders plus a midpoint label position
 * offset perpendicular to the line.
 */
export function edgeGeometry(sourcePos, targetPos, radius = NODE_RADIUS) {
  const dx = targetPos.x - sourcePos.x;
  const dy = targetPos.y - sourcePos.y;
  const dist = Math.hypot(dx, dy) || 1;
  const ux = dx / dist;
  const uy = dy / dist;
  const x1 = sourcePos.x + ux * (radius + 2);
  const y1 = sourcePos.y + uy * (radius + 2);
  const x2 = targetPos.x - ux * (radius + 6);
  const y2 = targetPos.y - uy * (radius + 6);
  return {
    x1, y1, x2, y2,
    labelX: (x1 + x2) / 2 - uy * 12,
    labelY: (y1 + y2) / 2 + ux * 12 - 4,
  };
}

/** Wrap a label to at most 2 lines of ~maxChars; ellipsize overflow. */
export function wrapLabel(label, maxChars = 12) {
  const words = String(label || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';
  for (const w of words) {
    const candidate = current ? `${current} ${w}` : w;
    if (candidate.length > maxChars && current) {
      lines.push(current);
      current = w;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  if (lines.length > 2) {
    const rest = lines.slice(1).join(' ');
    return [lines[0], rest.length > maxChars ? `${rest.slice(0, maxChars - 1)}…` : rest];
  }
  return lines;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_ui && npx vitest run src/pages/__tests__/telemetryGraph.test.js`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/pages/telemetryGraph.js demo_api_ui/src/pages/__tests__/telemetryGraph.test.js
git commit -m "feat(telemetry): pure layout/geometry helpers for graph rendering"
```

---

### Task 4: `TelemetryPage` component

**Files:**
- Create: `demo_api_ui/src/pages/TelemetryPage.jsx`
- Create: `demo_api_ui/src/pages/TelemetryPage.css`
- Test: `demo_api_ui/src/pages/__tests__/TelemetryPage.test.jsx`

**Interfaces:**
- Consumes: `GET /api/health/tracing/graph[?traceId=]` (Task 2), `GET /api/health/tracing/traces?service=demo-api-server&limit=20&lookback=1h` (existing, returns `{traces: [{traceId, operation, spanCount, durationMs, startTime}]}`), and all Task 3 exports.
- Produces: default export `TelemetryPage` (React component), consumed by Task 5's route.

- [ ] **Step 1: Write the failing test**

```jsx
// demo_api_ui/src/pages/__tests__/TelemetryPage.test.jsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TelemetryPage from "../TelemetryPage";

const GRAPH = {
  tracingEnabled: true,
  fetchedAt: "2026-07-18T00:00:00.000Z",
  nodes: [
    { id: "demo-api-server", label: "demo-api-server", latency: "45ms", status: "ok" },
    { id: "mcp-gateway", label: "mcp-gateway", latency: "12ms", status: "error" },
  ],
  edges: [{ source: "demo-api-server", target: "mcp-gateway", label: "mcp:tool" }],
};

const TRACES = {
  traces: [
    { traceId: "a1b2c3d4e5f60718", operation: "POST /run", spanCount: 6, durationMs: 2500, startTime: "2026-07-18T00:00:00.000Z" },
  ],
};

function stubFetch({ graph = GRAPH, traces = TRACES } = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn((url) => {
      const u = String(url);
      const body = u.includes("/tracing/graph") ? graph : traces;
      return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("TelemetryPage", () => {
  it("renders service nodes from the graph endpoint", async () => {
    stubFetch();
    render(<TelemetryPage />);
    await waitFor(() => expect(screen.getByText("demo-api-server")).toBeInTheDocument());
    expect(screen.getByText("mcp-gateway")).toBeInTheDocument();
    expect(screen.getByText("mcp:tool")).toBeInTheDocument();
  });

  it("shows the tracing-off empty state when tracingEnabled is false", async () => {
    stubFetch({ graph: { tracingEnabled: false, nodes: [], edges: [], fetchedAt: "x" } });
    render(<TelemetryPage />);
    await waitFor(() =>
      expect(screen.getByText(/tracing is off or Jaeger is unreachable/i)).toBeInTheDocument(),
    );
  });

  it("shows no-traces empty state when enabled but graph is empty", async () => {
    stubFetch({ graph: { tracingEnabled: true, nodes: [], edges: [], fetchedAt: "x" } });
    render(<TelemetryPage />);
    await waitFor(() => expect(screen.getByText(/No traces yet/i)).toBeInTheDocument());
  });

  it("Pause toggles to Resume and stops the auto-refresh interval", async () => {
    stubFetch();
    render(<TelemetryPage />);
    await waitFor(() => expect(screen.getByText("demo-api-server")).toBeInTheDocument());
    const btn = screen.getByRole("button", { name: "Pause" });
    fireEvent.click(btn);
    expect(screen.getByRole("button", { name: "Resume" })).toBeInTheDocument();
  });

  it("Fetch button triggers a new graph request", async () => {
    stubFetch();
    render(<TelemetryPage />);
    await waitFor(() => expect(screen.getByText("demo-api-server")).toBeInTheDocument());
    const calls = global.fetch.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Fetch" }));
    await waitFor(() => expect(global.fetch.mock.calls.length).toBeGreaterThan(calls));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_ui && npx vitest run src/pages/__tests__/TelemetryPage.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the component**

```jsx
// demo_api_ui/src/pages/TelemetryPage.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./TelemetryPage.css";
import {
  NODE_RADIUS,
  edgeGeometry,
  mergePositions,
  wrapLabel,
} from "./telemetryGraph";

const REFRESH_MS = 5000;
const VIEW_W = 900;
const VIEW_H = 480;
const DEFAULT_SERVICE = "demo-api-server";

async function fetchJson(url) {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * Telemetry page — draggable left-to-right service/span graph built from
 * Jaeger traces via the existing /api/health/tracing proxy. Overview shows
 * service topology; Detailed shows one selected trace's spans.
 */
export default function TelemetryPage() {
  const [view, setView] = useState("overview");
  const [graph, setGraph] = useState(null);
  const [positions, setPositions] = useState(new Map());
  const [traces, setTraces] = useState([]);
  const [selectedTraceId, setSelectedTraceId] = useState(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [paused, setPaused] = useState(false);
  const [filter, setFilter] = useState("");
  const [lastUpdated, setLastUpdated] = useState(null);
  const [error, setError] = useState(null);

  // Drag state lives in refs: pointermove must not re-create listeners.
  const dragRef = useRef(null);
  const svgRef = useRef(null);
  const positionsRef = useRef(positions);
  positionsRef.current = positions;

  const loadGraph = useCallback(async (opts = {}) => {
    const traceId = opts.traceId ?? (opts.view === "detailed" ? opts.selectedTraceId : null);
    const url = traceId
      ? `/api/health/tracing/graph?traceId=${encodeURIComponent(traceId)}`
      : "/api/health/tracing/graph?lookback=1h";
    try {
      const data = await fetchJson(url);
      setGraph(data);
      setPositions((prev) => mergePositions(prev, data, VIEW_W, VIEW_H));
      setLastUpdated(new Date());
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  const loadTraces = useCallback(async () => {
    try {
      const data = await fetchJson(
        `/api/health/tracing/traces?service=${DEFAULT_SERVICE}&limit=20&lookback=1h`,
      );
      setTraces(data.traces || []);
    } catch {
      /* recent-traces list is best-effort */
    }
  }, []);

  const refresh = useCallback(() => {
    loadGraph({ view, selectedTraceId });
    loadTraces();
  }, [loadGraph, loadTraces, view, selectedTraceId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!autoRefresh || paused) return undefined;
    const id = setInterval(() => {
      if (!dragRef.current && !document.hidden) refresh();
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, [autoRefresh, paused, refresh]);

  // ---- dragging ------------------------------------------------------------
  const svgPoint = useCallback((evt) => {
    const svg = svgRef.current;
    const pt = svg.createSVGPoint();
    pt.x = evt.clientX;
    pt.y = evt.clientY;
    return pt.matrixTransform(svg.getScreenCTM().inverse());
  }, []);

  const onPointerDown = useCallback(
    (evt) => {
      const group = evt.target.closest("g[data-node-id]");
      if (!group) return;
      const id = group.getAttribute("data-node-id");
      const pos = positionsRef.current.get(id);
      if (!pos) return;
      const p = svgPoint(evt);
      dragRef.current = { id, dx: p.x - pos.x, dy: p.y - pos.y };
      svgRef.current.setPointerCapture(evt.pointerId);
    },
    [svgPoint],
  );

  const onPointerMove = useCallback(
    (evt) => {
      const drag = dragRef.current;
      if (!drag) return;
      const p = svgPoint(evt);
      setPositions((prev) => {
        const next = new Map(prev);
        next.set(drag.id, { x: p.x - drag.dx, y: p.y - drag.dy });
        return next;
      });
    },
    [svgPoint],
  );

  const onPointerUp = useCallback((evt) => {
    dragRef.current = null;
    if (svgRef.current?.hasPointerCapture?.(evt.pointerId)) {
      svgRef.current.releasePointerCapture(evt.pointerId);
    }
  }, []);

  // ---- derived -------------------------------------------------------------
  const visibleNodes = useMemo(() => {
    const nodes = graph?.nodes || [];
    const q = filter.trim().toLowerCase();
    return q ? nodes.filter((n) => n.label.toLowerCase().includes(q)) : nodes;
  }, [graph, filter]);

  const visibleIds = useMemo(() => new Set(visibleNodes.map((n) => n.id)), [visibleNodes]);
  const visibleEdges = useMemo(
    () => (graph?.edges || []).filter((e) => visibleIds.has(e.source) && visibleIds.has(e.target)),
    [graph, visibleIds],
  );

  const stats = useMemo(
    () => ({
      nodes: graph?.nodes?.length || 0,
      edges: graph?.edges?.length || 0,
      errors: (graph?.nodes || []).filter((n) => n.status === "error").length,
      traces: traces.length,
    }),
    [graph, traces],
  );

  const selectTrace = (traceId) => {
    setSelectedTraceId(traceId);
    setView("detailed");
    loadGraph({ traceId });
  };

  const changeView = (next) => {
    setView(next);
    if (next === "overview") loadGraph({});
    else if (selectedTraceId) loadGraph({ traceId: selectedTraceId });
  };

  const tracingOff = graph && graph.tracingEnabled === false;
  const emptyGraph = graph && graph.tracingEnabled && (graph.nodes || []).length === 0;

  return (
    <div className="telemetry-page">
      <header className="telemetry-header">
        <h1>Telemetry</h1>
        <p>Real-time trace visualization of service topology and errors</p>
      </header>

      <div className="telemetry-body">
        <aside className="telemetry-controls">
          <div className="telemetry-control-group">
            <label className="telemetry-label" htmlFor="telemetry-auto">Refresh</label>
            <div className="telemetry-toggle">
              <input
                id="telemetry-auto"
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
              />
              <span>Auto-refresh (5s)</span>
            </div>
          </div>

          <div className="telemetry-button-row">
            <button
              type="button"
              className={`telemetry-btn ${paused ? "telemetry-btn--danger" : "telemetry-btn--secondary"}`}
              onClick={() => setPaused((p) => !p)}
            >
              {paused ? "Resume" : "Pause"}
            </button>
            <button type="button" className="telemetry-btn telemetry-btn--primary" onClick={refresh}>
              Fetch
            </button>
          </div>

          <div className="telemetry-control-group">
            <label className="telemetry-label" htmlFor="telemetry-view">View</label>
            <select id="telemetry-view" value={view} onChange={(e) => changeView(e.target.value)}>
              <option value="overview">Overview (Services)</option>
              <option value="detailed">Detailed (One Trace)</option>
            </select>
          </div>

          <div className="telemetry-control-group">
            <label className="telemetry-label" htmlFor="telemetry-filter">Filter</label>
            <input
              id="telemetry-filter"
              type="text"
              placeholder="Search nodes..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>

          <div className="telemetry-stats">
            <div><span>Nodes</span><strong>{stats.nodes}</strong></div>
            <div><span>Calls</span><strong>{stats.edges}</strong></div>
            <div><span>Errors</span><strong className={stats.errors ? "telemetry-stat-error" : ""}>{stats.errors}</strong></div>
            <div><span>Recent traces</span><strong>{stats.traces}</strong></div>
          </div>

          <div className="telemetry-control-group">
            <span className="telemetry-label">Recent traces</span>
            <ul className="telemetry-trace-list">
              {traces.map((t) => (
                <li key={t.traceId}>
                  <button
                    type="button"
                    className={`telemetry-trace-item${t.traceId === selectedTraceId ? " telemetry-trace-item--selected" : ""}`}
                    onClick={() => selectTrace(t.traceId)}
                  >
                    <strong>{t.operation}</strong>
                    <span>{t.spanCount} spans - {t.durationMs}ms</span>
                  </button>
                </li>
              ))}
              {!traces.length && <li className="telemetry-trace-empty">None in the last hour</li>}
            </ul>
          </div>

          <div className="telemetry-updated">
            {error
              ? `Error: ${error}`
              : lastUpdated
                ? `Last update: ${lastUpdated.toLocaleTimeString()}`
                : "Loading..."}
          </div>
        </aside>

        <section className="telemetry-canvas">
          {tracingOff && (
            <div className="telemetry-empty">
              <p>Tracing is off or Jaeger is unreachable.</p>
              <p>
                Enable the <a href="/feature-flags">Tracing - OpenTelemetry feature flag</a> and
                start Jaeger, then interact with the app.
              </p>
            </div>
          )}
          {emptyGraph && (
            <div className="telemetry-empty">
              <p>No traces yet - interact with the app (run an agent chip) and traces appear here.</p>
            </div>
          )}
          {!tracingOff && !emptyGraph && (
            <svg
              ref={svgRef}
              viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
              className="telemetry-svg"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            >
              <defs>
                <marker id="telemetry-arrow" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto">
                  <polygon points="0 0, 10 4, 0 8" fill="#95a5a6" />
                </marker>
                <linearGradient id="telemetry-grad-ok" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="#5dade2" />
                  <stop offset="100%" stopColor="#2e86c1" />
                </linearGradient>
                <linearGradient id="telemetry-grad-error" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="#ec7063" />
                  <stop offset="100%" stopColor="#cb4335" />
                </linearGradient>
                <filter id="telemetry-shadow" x="-50%" y="-50%" width="200%" height="200%">
                  <feDropShadow dx="0" dy="2" stdDeviation="3" floodOpacity="0.2" />
                </filter>
              </defs>

              <g>
                {visibleEdges.map((e) => {
                  const s = positions.get(e.source);
                  const t = positions.get(e.target);
                  if (!s || !t) return null;
                  const geo = edgeGeometry(s, t, NODE_RADIUS);
                  return (
                    <g key={`${e.source}-${e.target}`}>
                      <line
                        x1={geo.x1} y1={geo.y1} x2={geo.x2} y2={geo.y2}
                        stroke="#95a5a6" strokeWidth="2" markerEnd="url(#telemetry-arrow)"
                      />
                      <text x={geo.labelX} y={geo.labelY} className="telemetry-edge-label" textAnchor="middle">
                        {e.label}
                      </text>
                    </g>
                  );
                })}
              </g>

              <g>
                {visibleNodes.map((n) => {
                  const pos = positions.get(n.id);
                  if (!pos) return null;
                  const lines = wrapLabel(n.label);
                  return (
                    <g
                      key={n.id}
                      data-node-id={n.id}
                      transform={`translate(${pos.x}, ${pos.y})`}
                      filter="url(#telemetry-shadow)"
                      className="telemetry-node"
                    >
                      <circle
                        r={NODE_RADIUS}
                        fill={n.status === "error" ? "url(#telemetry-grad-error)" : "url(#telemetry-grad-ok)"}
                        stroke="white"
                        strokeWidth="3"
                      />
                      <text className="telemetry-node-label" textAnchor="middle" y={lines.length === 2 ? -10 : -4}>
                        {lines.map((line, i) => (
                          <tspan key={line + i} x="0" dy={i === 0 ? 0 : 12}>{line}</tspan>
                        ))}
                      </text>
                      <text
                        className={`telemetry-node-latency${n.status === "error" ? " telemetry-node-latency--error" : ""}`}
                        textAnchor="middle"
                        y={lines.length === 2 ? 18 : 14}
                      >
                        {n.latency}
                      </text>
                    </g>
                  );
                })}
              </g>
            </svg>
          )}

          <div className="telemetry-legend">
            <span><i className="telemetry-legend-dot telemetry-legend-dot--ok" /> OK</span>
            <span><i className="telemetry-legend-dot telemetry-legend-dot--error" /> Error</span>
            <span className="telemetry-legend-hint">Drag nodes to rearrange</span>
          </div>
        </section>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Write the CSS**

```css
/* demo_api_ui/src/pages/TelemetryPage.css */
.telemetry-page {
  padding: 16px 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  height: 100%;
}

.telemetry-header h1 {
  font-size: 24px;
  color: #2c3e50;
  margin: 0;
}

.telemetry-header p {
  color: #7f8c8d;
  font-size: 13px;
  margin: 4px 0 0;
}

.telemetry-body {
  display: flex;
  gap: 16px;
  flex: 1;
  min-height: 0;
}

.telemetry-controls {
  width: 280px;
  flex-shrink: 0;
  background: #fff;
  border: 1px solid #e3e6e8;
  border-radius: 8px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow-y: auto;
}

.telemetry-control-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.telemetry-control-group select,
.telemetry-control-group input[type="text"] {
  padding: 8px;
  border: 1px solid #bdc3c7;
  border-radius: 4px;
  font-size: 13px;
}

.telemetry-label {
  font-size: 11px;
  font-weight: 700;
  color: #2c3e50;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.telemetry-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: #2c3e50;
}

.telemetry-button-row {
  display: flex;
  gap: 8px;
}

.telemetry-btn {
  flex: 1;
  padding: 9px 12px;
  border: none;
  border-radius: 4px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
}

.telemetry-btn--primary { background: #3498db; color: #fff; }
.telemetry-btn--primary:hover { background: #2980b9; }
.telemetry-btn--secondary { background: #ecf0f1; color: #2c3e50; }
.telemetry-btn--secondary:hover { background: #d5dbdd; }
.telemetry-btn--danger { background: #e74c3c; color: #fff; }
.telemetry-btn--danger:hover { background: #c0392b; }

.telemetry-stats {
  background: #f4f6f7;
  border-radius: 4px;
  padding: 12px;
  font-size: 12px;
  color: #2c3e50;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.telemetry-stats > div {
  display: flex;
  justify-content: space-between;
}

.telemetry-stat-error { color: #e74c3c; }

.telemetry-trace-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 220px;
  overflow-y: auto;
}

.telemetry-trace-item {
  width: 100%;
  text-align: left;
  background: #f8f9fa;
  border: none;
  border-left: 3px solid #3498db;
  border-radius: 2px;
  padding: 8px;
  font-size: 11px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.telemetry-trace-item:hover { background: #ecf0f1; }
.telemetry-trace-item--selected { border-left-color: #e74c3c; background: #fdf3f2; }
.telemetry-trace-empty { font-size: 11px; color: #95a5a6; }

.telemetry-updated {
  font-size: 11px;
  color: #95a5a6;
  margin-top: auto;
}

.telemetry-canvas {
  flex: 1;
  min-width: 0;
  background: #fff;
  border: 1px solid #e3e6e8;
  border-radius: 8px;
  position: relative;
  overflow: hidden;
}

.telemetry-svg {
  width: 100%;
  height: 100%;
  display: block;
  touch-action: none;
}

.telemetry-node { cursor: grab; }
.telemetry-node:active { cursor: grabbing; }

.telemetry-node-label {
  font-size: 11px;
  font-weight: 700;
  fill: #fff;
  pointer-events: none;
}

.telemetry-node-latency {
  font-size: 10px;
  fill: #d6eaf8;
  pointer-events: none;
}

.telemetry-node-latency--error { fill: #fadbd8; }

.telemetry-edge-label {
  font-size: 10px;
  fill: #7f8c8d;
}

.telemetry-empty {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: #7f8c8d;
  font-size: 14px;
  text-align: center;
  padding: 24px;
}

.telemetry-legend {
  position: absolute;
  bottom: 12px;
  left: 16px;
  display: flex;
  gap: 14px;
  align-items: center;
  font-size: 11px;
  color: #2c3e50;
  background: rgba(255, 255, 255, 0.95);
  border-radius: 4px;
  padding: 6px 10px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
}

.telemetry-legend-dot {
  display: inline-block;
  width: 11px;
  height: 11px;
  border-radius: 50%;
  vertical-align: -1px;
  margin-right: 4px;
}

.telemetry-legend-dot--ok { background: #2e86c1; }
.telemetry-legend-dot--error { background: #cb4335; }
.telemetry-legend-hint { color: #95a5a6; }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd demo_api_ui && npx vitest run src/pages/__tests__/TelemetryPage.test.jsx`
Expected: PASS (5 tests). Note: jsdom lacks `createSVGPoint`; drag handlers are exercised only by real browsers — tests deliberately cover render, empty states, pause, fetch.

- [ ] **Step 6: Commit**

```bash
git add demo_api_ui/src/pages/TelemetryPage.jsx demo_api_ui/src/pages/TelemetryPage.css demo_api_ui/src/pages/__tests__/TelemetryPage.test.jsx
git commit -m "feat(telemetry): TelemetryPage draggable graph component"
```

---

### Task 5: Route + nav wiring

**Files:**
- Modify: `demo_api_ui/src/App.js` (import + route after the existing `/tracing` route, around line 568)
- Modify: `demo_api_ui/src/components/AdminSideNav.jsx` (monitoring paths list ~line 155; nav items ~line 699)

**Interfaces:**
- Consumes: `TelemetryPage` default export (Task 4).
- Produces: `/telemetry` route (any logged-in user), admin side nav entry.

- [ ] **Step 1: Add the import to App.js**

Next to the existing `import TracingPage from "./pages/TracingPage";` (line ~118):

```js
import TelemetryPage from "./pages/TelemetryPage";
```

- [ ] **Step 2: Add the route**

Immediately after the closing `/>` of the `/tracing` `<Route>` block (App.js ~line 580), copy its exact gate shape:

```jsx
                <Route
                  path="/telemetry"
                  element={
                    loading ? null : user ? (
                      <>
                        <TopNav user={user} onLogout={logout} />
                        <main className="main-content">
                          <TelemetryPage />
                        </main>
                      </>
                    ) : (
                      <Navigate to="/" replace />
                    )
                  }
                />
```

- [ ] **Step 3: Add the AdminSideNav entries**

In the monitoring paths group (~line 155), add `"/telemetry"`:

```js
  { id: "monitoring", paths: ["/audit", "/monitoring", "/reports", "/error-audit", "/tracing", "/telemetry", "/check"] },
```

Next to the existing Tracing item (~line 699):

```js
        { label: "Telemetry", path: "/telemetry", icon: "log" },
```

- [ ] **Step 4: Run the UI structure/session suites (route lists are asserted there)**

Run: `cd demo_api_ui && npx vitest run src/__tests__/App.structure.test.js src/__tests__/App.session.test.js`
Expected: PASS. If a snapshot/list assertion enumerates routes or nav items, add `/telemetry` to the expected list in the test — that is the test tracking reality, not a behavior change.

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/App.js demo_api_ui/src/components/AdminSideNav.jsx
git commit -m "feat(telemetry): /telemetry route and admin side-nav entry"
```

---

### Task 6: Full verification

**Files:** none (verification only).

- [ ] **Step 1: BFF unit suites**

Run: `cd demo_api_server && CI=true npx jest tests/services/tracingGraph.test.js tests/routes/tracingGraph.route.test.js`
Expected: PASS.

- [ ] **Step 2: UI suites**

Run: `cd demo_api_ui && npx vitest run src/pages/__tests__/telemetryGraph.test.js src/pages/__tests__/TelemetryPage.test.jsx src/__tests__/`
Expected: PASS.

- [ ] **Step 3: Repo unit gate**

Run: `./run-tests.sh unit` from the worktree root.
Expected: green (matches spec success criterion 6). Known-flake note: BFF suite requires `CI=true` (maxWorkers cap) — `run-tests.sh` handles this; if run manually, set it.

- [ ] **Step 4: Manual demo loop (stack running, tracing ON)**

1. Open `https://api.ping.demo:4000/telemetry` as `demoUser`.
2. Run a banking chip on /dashboard, return to /telemetry — overview shows `demo-api-server` plus downstream services left-to-right within one 5s poll.
3. Drag a node — edges/labels follow; wait 5s — dragged position survives refresh.
4. Switch View to Detailed, click a recent trace — span graph renders.
5. Toggle the Tracing feature flag OFF (or stop Jaeger) — page shows the tracing-off empty state, no console errors.

- [ ] **Step 5: Update graph index**

Run: `graphify update .` from the worktree root (per CLAUDE.md).

- [ ] **Step 6: Final commit if verification produced fixes**

```bash
git add <only files you changed during verification>
git commit -m "test(telemetry): verification fixes"
```
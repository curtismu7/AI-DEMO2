# Telemetry Overview → New D3 Graph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `/telemetry`'s old hand-rolled mindmap-card renderer with the D3 graph model+renderer already shipped for `/tracing`'s Graph tab, for both of its modes — Overview (whole system, aggregated across every service's recent traces) and Detailed (one selected trace).

**Architecture:** Generalize the UI-side graph model (`traceGraph.js`) to merge N traces instead of reading only the first one — a genuine single trace is the N=1 case, so `/tracing`'s existing Graph tab keeps working unchanged. A new BFF endpoint returns the raw multi-trace Jaeger payload for the whole system (reusing the existing overview-gathering logic verbatim, just skipping server-side aggregation). The fetch→build→render→panel glue that already exists in `TraceGraphView.jsx` is extracted into a reusable `TraceGraphCore` component, consumed by both the existing Graph tab (now a 3-line wrapper) and the rewritten `TelemetryPage`.

**Tech Stack:** Node/Express (BFF, CommonJS), React 19 + Vite 8 (UI, Vitest), d3 v7 (already a dependency).

**Spec:** `docs/superpowers/specs/2026-07-19-telemetry-overview-d3-design.md`

## Global Constraints

- All work in worktree `/Users/cmuir/Development/AI-DEMO2/.claude/worktrees/telemetry-overview-d3` (branch `worktree-telemetry-overview-d3`). Run `git branch --show-current` before every commit. Stage explicit files only — never `git add -A`.
- UI test runner is **Vitest**, not Jest: `./node_modules/.bin/vitest run <path>` from `demo_api_ui/`. `src/setupTests.js` aliases `global.jest = vi`, so Jest-style mock calls in existing test files work as-is.
- BFF tests: `CI=true npx jest --testPathPattern '<pattern>'` from `demo_api_server/` (maxWorkers flake guard).
- Emoji allowlist (REGRESSION_PLAN §0): only `⚠️ ✅ ❌ 🔐 ✕ ✓ 👤 🔑 🪟 📚`. No new emoji anywhere in this work.
- Each page's CSS is self-contained today — no page imports another page's `.css`. Keep that convention: copy shared `tracing-graph-*` rules into `TelemetryPage.css` rather than importing `TracingPage.css`.
- Existing `/tracing` Graph tab behavior and its test (`TraceGraphView.test.jsx`) must keep passing **unmodified** — the refactor in Task 3 is required to be behavior-preserving for that consumer.
- After each code task lands: `graphify update .` (AST-only) from the worktree root.

---

### Task 1: Generalize `traceGraph.js` for multi-trace input (TDD)

**Files:**
- Modify: `demo_api_ui/src/services/traceGraph.js`
- Modify: `demo_api_ui/src/services/__tests__/traceGraph.test.js` (extend; existing 6 tests must keep passing unmodified)

**Interfaces:**
- Consumes: `jaegerResponse` shaped `{ data: [trace1, trace2, ...] }` — Jaeger's native multi-trace query response. A single-trace response (today's `{data:[trace]}`, as returned by `/traces/:id/raw`) is the N=1 case.
- Produces: `buildGraph(jaegerResponse, opts)` and `buildCollapsedGraph(jaegerResponse, opts)` — **same return shape as today**, unchanged: `{ nodes, edges, totalDurationMs, traceId, isCollapsed }`. `traceId` is the single trace's ID when N=1, `''` when N>1 or N=0 (matches the existing empty-response convention). `buildCollapsedGraph` needs **no code changes** — it already operates on `buildGraph`'s output regardless of how many traces produced it.

- [ ] **Step 1: Write the failing multi-trace tests**

Add to `demo_api_ui/src/services/__tests__/traceGraph.test.js` (append inside the existing `describe("traceGraph model", ...)` block, after the last test):

```js
// Two-trace merge fixtures: a shared source->target edge across two synthetic
// traces must sum callCount, not overwrite it (first-write-wins would silently
// drop trace 2's calls). Distinguishable, non-symmetric counts (2 + 3 = 5) rule
// out a coincidental pass.
function makeTwoTraceOverview() {
  const mkTrace = (traceID, childCallCount, startBase) => {
    const mkRef = (spanID) => [{ refType: "CHILD_OF", traceID, spanID }];
    const spans = [
      {
        traceID, spanID: `${traceID}-root`, operationName: "GET /mcp",
        references: [], startTime: startBase, duration: 5000, tags: [], logs: [], processID: "p1",
      },
      ...Array.from({ length: childCallCount }, (_, i) => ({
        traceID, spanID: `${traceID}-c${i}`, operationName: `banking-call-${i + 1}`,
        references: mkRef(`${traceID}-root`), startTime: startBase + 1000 + i * 100,
        duration: 200, tags: [], logs: [], processID: "p2",
      })),
    ];
    return {
      traceID, spans,
      processes: { p1: { serviceName: "mcp-gateway" }, p2: { serviceName: "mcp-server" } },
    };
  };
  return {
    data: [
      mkTrace("overviewtraceA00000000000000001", 2, 1_000_000),
      mkTrace("overviewtraceB00000000000000002", 3, 2_000_000),
    ],
  };
}

describe("traceGraph model — multi-trace overview", () => {
  test("merges N traces into one graph: shared edge sums callCount across traces", () => {
    const overview = makeTwoTraceOverview();
    const g = buildGraph(overview, {});
    expect(g.nodes.map((n) => n.id).sort()).toEqual(["mcp-gateway", "mcp-server"]);
    expect(g.edges).toHaveLength(1);
    const edge = g.edges[0];
    expect(edge.source).toBe("mcp-gateway");
    expect(edge.target).toBe("mcp-server");
    expect(edge.callCount).toBe(5); // 2 (trace A) + 3 (trace B)
    expect(edge.avgDurationMs).toBe(Math.round(edge.totalDurationMs / 5));
  });

  test("node callCount sums across traces too", () => {
    const overview = makeTwoTraceOverview();
    const g = buildGraph(overview, {});
    const gateway = g.nodes.find((n) => n.id === "mcp-gateway");
    // 1 root span per trace (2 traces) = 2 calls on mcp-gateway
    expect(gateway.callCount).toBe(2);
    const server = g.nodes.find((n) => n.id === "mcp-server");
    expect(server.callCount).toBe(5); // 2 + 3 child spans
  });

  test("traceId is empty for a multi-trace overview, set for a single trace", () => {
    const overview = makeTwoTraceOverview();
    expect(buildGraph(overview, {}).traceId).toBe("");
    const single = { data: [overview.data[0]] };
    expect(buildGraph(single, {}).traceId).toBe("overviewtraceA00000000000000001");
  });

  test("totalDurationMs spans the full window across all contributing traces", () => {
    const overview = makeTwoTraceOverview();
    const g = buildGraph(overview, {});
    // trace A starts at 1_000_000us, trace B's last child ends at
    // 2_000_000 + 1000 + 200*100 + 200 = 2_021_200us -> window ~1021.2ms
    expect(g.totalDurationMs).toBeGreaterThan(1000);
  });

  test("empty data array yields the same empty-graph shape as today's no-trace case", () => {
    const g = buildGraph({ data: [] }, {});
    expect(g).toEqual({ nodes: [], edges: [], totalDurationMs: 0, traceId: "", isCollapsed: false });
  });

  test("buildCollapsedGraph collapses a multi-trace overview the same way it collapses one trace", () => {
    const overview = makeTwoTraceOverview();
    const full = buildGraph(overview, {});
    const collapsed = buildCollapsedGraph(overview, {});
    expect(collapsed.isCollapsed).toBe(true);
    expect(collapsed.nodes.map((n) => n.id).sort()).toEqual(["Gateway", "MCP Servers"]);
    expect(collapsed.edges).toHaveLength(1);
    expect(collapsed.edges[0].callCount).toBe(5);
  });
});
```

- [ ] **Step 2: Run tests, verify the new ones fail**

```bash
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/telemetry-overview-d3/demo_api_ui
./node_modules/.bin/vitest run src/services/__tests__/traceGraph.test.js 2>&1 | tail -20
```

Expected: the 6 existing tests PASS (today's code already handles `{data:[trace]}`, the N=1 case, correctly), the 6 new multi-trace tests FAIL — `buildGraph` reads only `jaegerResponse.data[0]`, so trace B's spans are silently ignored (e.g. `edge.callCount` comes back `2`, not `5`).

- [ ] **Step 3: Refactor `buildGraph` to merge N traces**

In `demo_api_ui/src/services/traceGraph.js`, replace the body of `buildGraph` (the whole function, lines ~118-305 today) with an extraction of a per-trace accumulate step plus a multi-trace driver. `buildCollapsedGraph` is untouched — only `buildGraph` changes. Full replacement:

```js
/**
 * Merge one trace's spans into the shared nodeMap/edgeMap accumulators.
 * Called once per trace in the response; nodeMap/edgeMap persist across
 * calls so a node or edge shared by two traces sums its counts rather than
 * being overwritten. This is the exact per-trace body buildGraph always ran —
 * only the accumulator lifetime changed (was function-local, now shared
 * across N calls).
 */
function _accumulateTrace(traceData, nodeMap, edgeMap, globalMinStart) {
  const spans = traceData.spans || [];
  const spanIndex = {};
  for (const s of spans) spanIndex[s.spanID] = s;

  for (const span of spans) {
    const raw = _serviceName(traceData, span);
    if (!nodeMap[raw]) {
      nodeMap[raw] = {
        id: raw,
        label: _labelFor(raw),
        cluster: _clusterFor(raw),
        isSynthetic: false,
        rawServices: new Set(),
        callCount: 0,
        totalDurationMs: 0,
        operationCounts: {},
        spans: [],
        status: 'ok',
        _hasOk: false,
        _hasError: false,
      };
    }
    const node = nodeMap[raw];
    node.rawServices.add(raw);
    node.callCount++;
    node.totalDurationMs += Math.round((span.duration || 0) / 1000);
    node.operationCounts[span.operationName] = (node.operationCounts[span.operationName] || 0) + 1;

    const tags = _tagsToObject(span.tags);
    const statusCode = tags['http.response.status_code'] ?? tags['http.status_code'];
    const status = _statusFor(tags, statusCode);
    if (status === 'error') node._hasError = true;
    else node._hasOk = true;

    node.spans.push(_spanSummary(span, tags, traceData, globalMinStart));
  }

  for (const span of spans) {
    const childRaw = _serviceName(traceData, span);
    const tags = _tagsToObject(span.tags);

    const asHost = _oauthEndpointHost(tags);
    if (asHost && tags['span.kind'] === 'client') {
      if (!nodeMap[asHost]) {
        nodeMap[asHost] = {
          id: asHost,
          label: _labelFor(asHost),
          cluster: _clusterFor(asHost),
          isSynthetic: true,
          rawServices: [`${asHost} (external)`],
          callCount: 0,
          totalDurationMs: 0,
          operationCounts: {},
          spans: [],
          status: 'ok',
        };
      }
      const oauthKey = `${childRaw}->${asHost}#oauth`;
      if (!edgeMap[oauthKey]) {
        edgeMap[oauthKey] = {
          source: childRaw,
          target: asHost,
          sourceLabel: _labelFor(childRaw),
          targetLabel: _labelFor(asHost),
          role: 'OAuth',
          protocol: 'OAuth 2.0',
          exchangeKind: 'oauth',
          callCount: 0,
          totalDurationMs: 0,
          outcomes: {},
          spans: [],
          isSynthetic: false,
        };
      }
      const oauthEdge = edgeMap[oauthKey];
      oauthEdge.callCount++;
      oauthEdge.totalDurationMs += Math.round((span.duration || 0) / 1000);
      const oauthStatusCode = tags['http.response.status_code'] ?? tags['http.status_code'];
      if (oauthStatusCode !== undefined) {
        const k = String(oauthStatusCode);
        oauthEdge.outcomes[k] = (oauthEdge.outcomes[k] || 0) + 1;
      }
      oauthEdge.spans.push(_spanSummary(span, tags, traceData, globalMinStart));
      continue;
    }

    if (tags['otel.scope.name'] === 'fastmcp') continue;

    const parentRef = (span.references || []).find(r => r.refType === 'CHILD_OF');
    if (!parentRef) continue;
    const parentSpan = spanIndex[parentRef.spanID];
    if (!parentSpan) continue;
    const parentRaw = _serviceName(traceData, parentSpan);
    if (parentRaw === childRaw) continue;

    const meta = _classifyExchange(childRaw, parentRaw, tags);
    const edgeKey = `${parentRaw}->${childRaw}`;
    if (!edgeMap[edgeKey]) {
      edgeMap[edgeKey] = {
        source: parentRaw,
        target: childRaw,
        sourceLabel: _labelFor(parentRaw),
        targetLabel: _labelFor(childRaw),
        role: meta.role,
        protocol: meta.protocol,
        exchangeKind: meta.kind,
        callCount: 0,
        totalDurationMs: 0,
        outcomes: {},
        spans: [],
        isSynthetic: false,
      };
    }
    const edge = edgeMap[edgeKey];
    edge.callCount++;
    edge.totalDurationMs += Math.round((span.duration || 0) / 1000);

    const statusCode = tags['http.response.status_code'] ?? tags['http.status_code'];
    if (statusCode !== undefined) {
      const key = String(statusCode);
      edge.outcomes[key] = (edge.outcomes[key] || 0) + 1;
    }

    edge.spans.push(_spanSummary(span, tags, traceData, globalMinStart));
  }
}

/**
 * Build nodes and edges from the raw Jaeger response — one trace or many.
 * Returns { nodes, edges, totalDurationMs, traceId, isCollapsed: false }.
 * traceId is set only when the response carries exactly one trace.
 */
function buildGraph(jaegerResponse, opts = {}) {
  const traces = (Array.isArray(jaegerResponse?.data) ? jaegerResponse.data : []).filter(Boolean);
  if (traces.length === 0) {
    return { nodes: [], edges: [], totalDurationMs: 0, traceId: '', isCollapsed: false };
  }

  let globalMinStart = Infinity;
  let globalMaxEnd = -Infinity;
  for (const traceData of traces) {
    for (const s of traceData.spans || []) {
      if (s.startTime < globalMinStart) globalMinStart = s.startTime;
      const end = s.startTime + s.duration;
      if (end > globalMaxEnd) globalMaxEnd = end;
    }
  }
  if (!Number.isFinite(globalMinStart)) globalMinStart = 0;

  const nodeMap = {};
  const edgeMap = {};
  for (const traceData of traces) {
    _accumulateTrace(traceData, nodeMap, edgeMap, globalMinStart);
  }

  for (const node of Object.values(nodeMap)) {
    node.rawServices = [...node.rawServices].sort();
    node.spans.sort((a, b) => a.startTimeOffsetMs - b.startTimeOffsetMs);
    if (node._hasError && node._hasOk) node.status = 'mixed';
    else if (node._hasError) node.status = 'error';
    else node.status = 'ok';
    delete node._hasOk;
    delete node._hasError;
  }

  for (const edge of Object.values(edgeMap)) {
    edge.avgDurationMs = edge.callCount > 0
      ? Math.round(edge.totalDurationMs / edge.callCount)
      : 0;
    edge.spans.sort((a, b) => a.startTimeOffsetMs - b.startTimeOffsetMs);
  }

  const totalDurationMs = (Number.isFinite(globalMaxEnd) && globalMaxEnd > globalMinStart)
    ? Math.round((globalMaxEnd - globalMinStart) / 1000)
    : 0;
  const nodes = Object.values(nodeMap);
  const nodeIds = new Set(nodes.map(n => n.id));
  const edges = Object.values(edgeMap).filter(
    e => nodeIds.has(e.source) && nodeIds.has(e.target)
  );

  return {
    nodes,
    edges,
    totalDurationMs,
    traceId: traces.length === 1 ? (traces[0].traceID || '') : '',
    isCollapsed: false,
  };
}
```

`buildCollapsedGraph` keeps its current implementation verbatim (it reads `jaegerResponse?.data?.[0]` only to fail-soft on an empty response and to read `traceId` for its own return value — change ONLY those two spots to match `buildGraph`'s new empty/traceId handling, nothing else in the function body):

```js
function buildCollapsedGraph(jaegerResponse, opts = {}) {
  const traces = (Array.isArray(jaegerResponse?.data) ? jaegerResponse.data : []).filter(Boolean);
  if (traces.length === 0) return { nodes: [], edges: [], totalDurationMs: 0, traceId: '', isCollapsed: true };

  const full = buildGraph(jaegerResponse, opts);
  const { nodes: fullNodes, edges: fullEdges, totalDurationMs, traceId } = full;
  // ...rest of the function body (rawToCluster, clusterNodeMap, collapsedEdgeMap
  // construction, return) is UNCHANGED from today's implementation — it already
  // operates entirely on `full`'s output, not on `jaegerResponse` directly.
```

- [ ] **Step 4: Run tests, verify all 12 pass**

```bash
./node_modules/.bin/vitest run src/services/__tests__/traceGraph.test.js 2>&1 | tail -15
```

Expected: 12 passed (6 original + 6 new), 0 failed.

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/services/traceGraph.js demo_api_ui/src/services/__tests__/traceGraph.test.js
git commit -m "feat(telemetry): generalize traceGraph model to merge multiple traces"
```

---

### Task 2: BFF raw multi-trace overview endpoint (TDD)

**Files:**
- Modify: `demo_api_server/routes/tracing.js` (append route before `module.exports`)
- Test: `demo_api_server/tests/routes/tracingOverview.route.test.js`

**Interfaces:**
- Consumes: existing `resolveJaegerBase()`, `axios`, `configStore` — all already imported in this file.
- Produces: `GET /api/health/tracing/overview/raw?lookback=` → `{ data: [trace1, trace2, ...] }`, the raw Jaeger multi-trace shape `buildGraph` (Task 1) consumes directly. Fail-soft `{ data: [] }` (200) when Jaeger is unreachable, `ff_tracing=false`, or the services/traces gathering throws — mirrors the existing `/graph` overview branch's fail-soft convention exactly, just shaped as a raw payload instead of a pre-aggregated graph.

- [ ] **Step 1: Write the failing route test**

`demo_api_server/tests/routes/tracingOverview.route.test.js` — same mock idiom as the sibling `tracingGraph.route.test.js`:

```js
'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('axios');
const axios = require('axios');

jest.mock('../../services/configStore', () => ({
  getEffective: jest.fn(() => ''),
}));
const configStore = require('../../services/configStore');

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

const TRACE_A = { traceID: 'aaaaaaaaaaaaaaaa', processes: {}, spans: [] };
const TRACE_B = { traceID: 'bbbbbbbbbbbbbbbb', processes: {}, spans: [] };

afterEach(() => jest.resetAllMocks());
beforeEach(() => configStore.getEffective.mockImplementation(() => ''));

describe('GET /api/health/tracing/overview/raw', () => {
  test('fail-soft 200 {data:[]} when Jaeger is unreachable', async () => {
    axios.get.mockRejectedValue(new Error('ECONNREFUSED'));
    const res = await request(makeApp()).get('/api/health/tracing/overview/raw');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: [] });
  });

  test('fail-soft 200 {data:[]} when ff_tracing flag is off', async () => {
    configStore.getEffective.mockImplementation((key) => (key === 'ff_tracing' ? 'false' : ''));
    const res = await request(makeApp()).get('/api/health/tracing/overview/raw');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: [] });
    expect(axios.get).not.toHaveBeenCalled();
  });

  // Note: axios.get is mocked at the function level — the mock only sees the
  // literal URL string (e.g. `${base}/api/traces`), never the serialized
  // `params` object a real request would carry. So handlers below can't
  // differentiate by `service=...`; every `/api/traces` call gets the same
  // response, matching the sibling `tracingGraph.route.test.js` overview
  // test's established pattern.
  test('gathers and dedupes traces across every returned service', async () => {
    mockJaeger([
      ['/api/services', () => Promise.resolve({
        status: 200, data: { data: ['demo-api-server', 'mcp-gateway'] },
      })],
      // Same response for both services' per-service call — 2 services x
      // 2 traces each = 4 raw entries, deduped by traceID down to 2.
      ['/api/traces', () => Promise.resolve({ status: 200, data: { data: [TRACE_A, TRACE_B] } })],
    ]);
    const res = await request(makeApp()).get('/api/health/tracing/overview/raw?lookback=1h');
    expect(res.status).toBe(200);
    expect(res.body.data.map((t) => t.traceID).sort()).toEqual(['aaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbb']);
  });

  test('excludes jaeger-all-in-one from the per-service trace gather', async () => {
    mockJaeger([
      ['/api/services', () => Promise.resolve({
        status: 200, data: { data: ['demo-api-server', 'jaeger-all-in-one'] },
      })],
      ['/api/traces', () => Promise.resolve({ status: 200, data: { data: [TRACE_A] } })],
    ]);
    const res = await request(makeApp()).get('/api/health/tracing/overview/raw');
    expect(res.status).toBe(200);
    // One /api/traces call (demo-api-server) — jaeger-all-in-one filtered out
    // before the per-service Promise.all, so it's never queried.
    const tracesCalls = axios.get.mock.calls.filter(([url]) => String(url).includes('/api/traces')).length;
    expect(tracesCalls).toBe(1);
  });

  test('fail-soft 200 {data:[]} when the /api/services call itself throws', async () => {
    mockJaeger([
      ['/api/services', () => Promise.reject(new Error('boom'))],
    ]);
    const res = await request(makeApp()).get('/api/health/tracing/overview/raw');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: [] });
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

```bash
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/telemetry-overview-d3/demo_api_server
CI=true npx jest --testPathPattern 'routes/tracingOverview' 2>&1 | tail -10
```

Expected: FAIL — 404s from Express (route doesn't exist yet). Note `resolveJaegerBase()` itself calls `axios.get('.../api/services')` as its reachability probe (see `demo_api_server/routes/tracing.js:44-58`) — the mock's `/api/services` handler serves both that probe and the route's own service-list call, matching the existing `/graph` route test's setup.

- [ ] **Step 3: Implement the route**

Append to `demo_api_server/routes/tracing.js`, after the existing `/graph` route and before `module.exports = router;`:

```js
/**
 * GET /overview/raw?lookback= — raw multi-trace Jaeger payload for the whole
 * system (all instrumented services' recent traces, deduped by traceID). The
 * client-side model (buildGraph/buildCollapsedGraph) aggregates this the same
 * way it aggregates a single trace — this endpoint reuses the /graph route's
 * overview-gathering exactly, just skips server-side aggregation so Overview
 * and Detailed share one rendering path.
 * Fail-soft: Jaeger unreachable, ff_tracing=false, or the gather throwing all
 * return 200 { data: [] } — never 5xx.
 */
router.get('/overview/raw', async (req, res) => {
  if (String(configStore.getEffective('ff_tracing')).trim() === 'false') {
    return res.json({ data: [] });
  }
  const base = await resolveJaegerBase();
  if (!base) return res.json({ data: [] });

  const lookback = String(req.query.lookback || '1h').trim();
  try {
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
    return res.json({ data: [...byId.values()] });
  } catch {
    return res.json({ data: [] });
  }
});
```

- [ ] **Step 4: Run test, verify pass; no-regression on the sibling suite**

```bash
CI=true npx jest --testPathPattern 'routes/tracingOverview' 2>&1 | tail -10
CI=true npx jest --testPathPattern 'routes/tracing' 2>&1 | tail -10
```

Expected: new suite passes (5/5); `tracingGraph.route.test.js` and `tracingProjected.route.test.js` (from the earlier port) still pass unchanged.

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/routes/tracing.js demo_api_server/tests/routes/tracingOverview.route.test.js
git commit -m "feat(telemetry): raw multi-trace overview endpoint"
```

---

### Task 3: Extract `TraceGraphCore` from `TraceGraphView`

**Files:**
- Create: `demo_api_ui/src/components/TraceGraphCore.jsx`
- Modify: `demo_api_ui/src/components/TraceGraphView.jsx` (shrink to a wrapper)
- No test changes — `TraceGraphView.test.jsx` must pass **unmodified**; its coverage transfers to `TraceGraphCore` through the wrapper.

**Interfaces:**
- Produces: `TraceGraphCore({ rawUrl })` — identical behavior to today's `TraceGraphView`, but fetches whatever `rawUrl` is passed instead of building the URL from a `traceId` prop internally. Same CSS classes (`tracing-graph`, `tracing-graph-canvas`, `tracing-graph-panel`, ...), same collapse toggle, same click-to-inspect panel, same error/loading states.
- `TraceGraphView({ traceId })` becomes a thin wrapper: builds the single-trace URL and delegates to `TraceGraphCore`.

- [ ] **Step 1: Create `TraceGraphCore.jsx`**

This is `TraceGraphView.jsx`'s current body verbatim, with the prop renamed and the URL construction moved to the caller:

```jsx
// demo_api_ui/src/components/TraceGraphCore.jsx
import React, { useEffect, useRef, useState } from "react";
import { buildGraph, buildCollapsedGraph } from "../services/traceGraph";
import { renderTraceGraph } from "../services/traceGraphRender";

/**
 * Interactive D3 service graph for whatever raw Jaeger payload `rawUrl`
 * returns — one trace or a multi-trace overview, both handled by the same
 * generalized model. Shared by /tracing's Graph tab (TraceGraphView, one
 * trace) and /telemetry (TelemetryPage, one trace or the whole system).
 */
export default function TraceGraphCore({ rawUrl }) {
  const hostRef = useRef(null);
  const [raw, setRaw] = useState(null);
  const [error, setError] = useState(null);
  const [collapsed, setCollapsed] = useState(false);
  const [selection, setSelection] = useState(null); // { kind: 'node'|'edge', data }

  useEffect(() => {
    let live = true;
    setRaw(null); setError(null); setSelection(null);
    (async () => {
      try {
        const res = await fetch(rawUrl, { credentials: "include" });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.message || `HTTP ${res.status}`);
        }
        const data = await res.json();
        if (live) setRaw(data);
      } catch (e) {
        if (live) setError(e.message || "Failed to load trace");
      }
    })();
    return () => { live = false; };
  }, [rawUrl]);

  useEffect(() => {
    if (!raw || !hostRef.current) return undefined;
    const graph = collapsed ? buildCollapsedGraph(raw, {}) : buildGraph(raw, {});
    const handle = renderTraceGraph(hostRef.current, graph, {
      onNodeClick: (node) => setSelection({ kind: "node", data: node }),
      onEdgeClick: (edge) => setSelection({ kind: "edge", data: edge }),
    });
    return () => handle.destroy();
  }, [raw, collapsed]);

  if (error) return <div className="tracing-detail tracing-detail--msg tracing-detail--error">{error}</div>;
  if (!raw) return <div className="tracing-detail tracing-detail--msg">Loading graph…</div>;

  return (
    <div className="tracing-graph">
      <div className="tracing-graph-controls">
        <label className="tracing-graph-toggle">
          <input type="checkbox" checked={collapsed} onChange={(e) => setCollapsed(e.target.checked)} />
          <span>Collapse clusters</span>
        </label>
      </div>
      <div className="tracing-graph-canvas" ref={hostRef} />
      {selection && (
        <aside className="tracing-graph-panel">
          <button type="button" className="tracing-btn tracing-btn--secondary" onClick={() => setSelection(null)}>
            Close
          </button>
          <h3>{selection.kind === "node" ? selection.data.label : `${selection.data.sourceLabel} to ${selection.data.targetLabel}`}</h3>
          <dl className="tracing-graph-panel-facts">
            <dt>Calls</dt><dd>{selection.data.callCount ?? "1"}</dd>
            {selection.kind === "edge" && (<><dt>Avg duration</dt><dd>{selection.data.avgDurationMs} ms</dd></>)}
          </dl>
          <div className="tracing-graph-panel-spans">
            {(selection.data.spans || []).map((s, i) => (
              <div key={i} className="tracing-span-row">
                <span className="tracing-span-op">{s.operationName || s.op}</span>
                <span className="tracing-span-dur">{s.durationMs} ms</span>
              </div>
            ))}
          </div>
        </aside>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Shrink `TraceGraphView.jsx` to a wrapper**

Replace the entire contents of `demo_api_ui/src/components/TraceGraphView.jsx`:

```jsx
// demo_api_ui/src/components/TraceGraphView.jsx
import React from "react";
import TraceGraphCore from "./TraceGraphCore";

/** Interactive service graph for one trace — thin wrapper over TraceGraphCore. */
export default function TraceGraphView({ traceId }) {
  return <TraceGraphCore rawUrl={`/api/health/tracing/traces/${traceId}/raw`} />;
}
```

- [ ] **Step 3: Run the existing test unmodified, verify it still passes**

```bash
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/telemetry-overview-d3/demo_api_ui
./node_modules/.bin/vitest run src/components/__tests__/TraceGraphView.test.jsx 2>&1 | tail -15
```

Expected: PASS, same 3/3 as before this task — this is the regression check that the extraction is behavior-preserving. If it fails, the wrapper's URL construction or prop threading is wrong; fix `TraceGraphView.jsx`, not the test.

Also run the page-level consumer to catch any import-path break:

```bash
./node_modules/.bin/vitest run src/pages/__tests__/TracingPage.test.jsx 2>&1 | tail -15
```

Expected: PASS, same 6/6 as before (5 original + 1 tabs test from the earlier port).

- [ ] **Step 4: Commit**

```bash
git add demo_api_ui/src/components/TraceGraphCore.jsx demo_api_ui/src/components/TraceGraphView.jsx
git commit -m "refactor(tracing-ui): extract TraceGraphCore, shared by Tracing and Telemetry"
```

---

### Task 4: Rewrite `TelemetryPage` on the shared core; retire the old renderer

**Files:**
- Modify: `demo_api_ui/src/pages/TelemetryPage.jsx` (full rewrite)
- Modify: `demo_api_ui/src/pages/TelemetryPage.css` (full rewrite)
- Modify: `demo_api_ui/src/pages/__tests__/TelemetryPage.test.jsx` (full rewrite)
- Delete: `demo_api_ui/src/pages/telemetryGraph.js`
- Delete: `demo_api_ui/src/pages/__tests__/telemetryGraph.test.js`

**Interfaces:**
- Consumes: `TraceGraphCore` (Task 3), `GET /api/health/tracing/overview/raw?lookback=` (Task 2), existing `GET /api/health/tracing/traces?service=&lookback=` (trace picker list, unchanged endpoint).
- No change to `App.js` — route `/telemetry` and the `TelemetryPage` default export stay as they are.

- [ ] **Step 1: Write the failing test file**

Replace `demo_api_ui/src/pages/__tests__/TelemetryPage.test.jsx` entirely:

```jsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import TelemetryPage from "../TelemetryPage";

vi.mock("../../components/TraceGraphCore", () => ({
  default: ({ rawUrl }) => <div data-testid="graph-core">{rawUrl}</div>,
}));

const TRACES = {
  traces: [
    { traceId: "a1b2c3d4e5f60718", operation: "POST /run", spanCount: 6, durationMs: 2500, startTime: "2026-07-19T00:00:00.000Z" },
    { traceId: "9988776655443322", operation: "GET /api/token-chain", spanCount: 29, durationMs: 26, startTime: "2026-07-19T00:01:00.000Z" },
  ],
};

function stubFetch() {
  vi.stubGlobal("fetch", vi.fn(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve(TRACES) })));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("TelemetryPage", () => {
  it("defaults to Overview mode, rendering TraceGraphCore with the overview URL", async () => {
    stubFetch();
    render(<TelemetryPage />);
    await waitFor(() => expect(screen.getByTestId("graph-core")).toBeInTheDocument());
    expect(screen.getByTestId("graph-core").textContent).toBe(
      "/api/health/tracing/overview/raw?lookback=1h",
    );
    expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
  });

  it("changing the window filter updates the overview URL", async () => {
    stubFetch();
    render(<TelemetryPage />);
    await waitFor(() => expect(screen.getByTestId("graph-core")).toBeInTheDocument());
    await userEvent.selectOptions(screen.getByRole("combobox"), "Last 6 hours");
    await waitFor(() =>
      expect(screen.getByTestId("graph-core").textContent).toBe(
        "/api/health/tracing/overview/raw?lookback=6h",
      ),
    );
  });

  it("Detailed mode shows a trace picker instead of the window filter", async () => {
    stubFetch();
    render(<TelemetryPage />);
    await userEvent.click(screen.getByRole("tab", { name: "Detailed" }));
    await waitFor(() => expect(screen.getByText(/POST \/run/)).toBeInTheDocument());
    expect(screen.queryByRole("combobox", { name: /window/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId("graph-core")).not.toBeInTheDocument(); // no trace picked yet
    expect(screen.getByText("Pick a trace above.")).toBeInTheDocument();
  });

  it("selecting a trace in Detailed mode renders TraceGraphCore with that trace's raw URL", async () => {
    stubFetch();
    render(<TelemetryPage />);
    await userEvent.click(screen.getByRole("tab", { name: "Detailed" }));
    await waitFor(() => expect(screen.getByText(/POST \/run/)).toBeInTheDocument());
    const select = screen.getAllByRole("combobox").find((el) => el.tagName === "SELECT");
    await userEvent.selectOptions(select, "a1b2c3d4e5f60718");
    await waitFor(() =>
      expect(screen.getByTestId("graph-core").textContent).toBe(
        "/api/health/tracing/traces/a1b2c3d4e5f60718/raw",
      ),
    );
  });

  it("auto-refreshes the trace list only while in Overview mode", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    stubFetch();
    render(<TelemetryPage />);
    const initialCalls = global.fetch.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5000);
    expect(global.fetch.mock.calls.length).toBeGreaterThan(initialCalls);

    await userEvent.click(screen.getByRole("tab", { name: "Detailed" }));
    const callsAfterSwitch = global.fetch.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10000);
    expect(global.fetch.mock.calls.length).toBe(callsAfterSwitch); // no more polling once in Detailed
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

```bash
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/telemetry-overview-d3/demo_api_ui
./node_modules/.bin/vitest run src/pages/__tests__/TelemetryPage.test.jsx 2>&1 | tail -20
```

Expected: FAIL against the current `TelemetryPage.jsx` (no `role="tablist"`, no `TraceGraphCore` import, different DOM entirely).

- [ ] **Step 3: Rewrite `TelemetryPage.jsx`**

Replace the entire file:

```jsx
// demo_api_ui/src/pages/TelemetryPage.jsx
import React, { useCallback, useEffect, useState } from "react";
import "./TelemetryPage.css";
import TraceGraphCore from "../components/TraceGraphCore";

const REFRESH_MS = 5000;
const DEFAULT_SERVICE = "demo-api-server";
const LOOKBACK_OPTIONS = [
  { value: "15m", label: "Last 15 minutes" },
  { value: "1h", label: "Last hour" },
  { value: "6h", label: "Last 6 hours" },
  { value: "24h", label: "Last 24 hours" },
];

async function fetchJson(url) {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * Telemetry page — Overview (whole system, aggregated across every service's
 * recent traces) or Detailed (one selected trace), both rendered by the same
 * D3 graph core /tracing's Graph tab uses.
 */
export default function TelemetryPage() {
  const [mode, setMode] = useState("overview");
  const [lookback, setLookback] = useState("1h");
  const [traces, setTraces] = useState([]);
  const [selectedTraceId, setSelectedTraceId] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [tracesError, setTracesError] = useState(null);

  const loadTraces = useCallback(async () => {
    try {
      const data = await fetchJson(
        `/api/health/tracing/traces?service=${DEFAULT_SERVICE}&limit=20&lookback=${lookback}`,
      );
      setTraces(data.traces || []);
      setTracesError(null);
      setLastUpdated(new Date());
    } catch (err) {
      setTracesError(err.message || "Failed to load traces");
    }
  }, [lookback]);

  useEffect(() => {
    loadTraces();
  }, [loadTraces]);

  useEffect(() => {
    if (mode !== "overview") return undefined;
    const id = setInterval(() => {
      if (!document.hidden) loadTraces();
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, [mode, loadTraces]);

  const overviewUrl = `/api/health/tracing/overview/raw?lookback=${encodeURIComponent(lookback)}`;
  const detailedUrl = selectedTraceId ? `/api/health/tracing/traces/${selectedTraceId}/raw` : null;

  return (
    <div className="telemetry-page">
      <header className="telemetry-header">
        <div>
          <h1>Telemetry</h1>
          <p className="telemetry-subtitle">
            The whole system at a glance — every service, every dependency, aggregated across
            recent traffic. Switch to Detailed to inspect one trace.
          </p>
        </div>
        <div className="telemetry-header-actions">
          {lastUpdated && (
            <span className="telemetry-meta">Updated {lastUpdated.toLocaleTimeString()}</span>
          )}
          <button type="button" className="telemetry-btn" onClick={loadTraces}>Refresh</button>
        </div>
      </header>

      <div className="telemetry-mode-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "overview"}
          className={`telemetry-mode-tab ${mode === "overview" ? "telemetry-mode-tab--active" : ""}`}
          onClick={() => setMode("overview")}
        >
          Overview
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "detailed"}
          className={`telemetry-mode-tab ${mode === "detailed" ? "telemetry-mode-tab--active" : ""}`}
          onClick={() => setMode("detailed")}
        >
          Detailed
        </button>
      </div>

      {mode === "overview" && (
        <>
          <div className="telemetry-filters">
            <label className="telemetry-filter">
              <span>Window</span>
              <select value={lookback} onChange={(e) => setLookback(e.target.value)}>
                {LOOKBACK_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </label>
          </div>
          <TraceGraphCore rawUrl={overviewUrl} />
        </>
      )}

      {mode === "detailed" && (
        <>
          <div className="telemetry-trace-picker">
            <span>Trace</span>
            <select
              value={selectedTraceId || ""}
              onChange={(e) => setSelectedTraceId(e.target.value || null)}
            >
              <option value="" disabled>
                {tracesError ? tracesError : traces.length ? "Select a trace…" : "No traces in this window"}
              </option>
              {traces.map((t) => (
                <option key={t.traceId} value={t.traceId}>
                  {t.operation} · {t.spanCount} spans · {t.durationMs}ms · {new Date(t.startTime).toLocaleTimeString()}
                </option>
              ))}
            </select>
          </div>
          {detailedUrl ? (
            <TraceGraphCore rawUrl={detailedUrl} />
          ) : (
            <div className="tracing-detail tracing-detail--msg">Pick a trace above.</div>
          )}
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Rewrite `TelemetryPage.css`**

Replace the entire file with page chrome (header, mode tabs, filters, trace picker) plus the `tracing-graph-*` block copied verbatim from `TracingPage.css` (needed because `TraceGraphCore` renders those class names and this page doesn't import `TracingPage.css` — see Global Constraints):

```css
/* demo_api_ui/src/pages/TelemetryPage.css */

.telemetry-page {
  padding: 20px;
  background: #f9fafb;
  min-height: 100vh;
  max-width: 1200px;
  margin: 0 auto;
}

.telemetry-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 12px;
}

.telemetry-header h1 { margin: 0; font-size: 24px; font-weight: 700; color: #111827; }

.telemetry-subtitle { margin: 4px 0 0 0; font-size: 14px; color: #4b5563; max-width: 52rem; }

.telemetry-header-actions { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }

.telemetry-meta { font-size: 13px; color: #6b7280; white-space: nowrap; }

.telemetry-btn {
  padding: 6px 14px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  background: #ffffff;
  color: #111827;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.telemetry-btn:hover { background: #f3f4f6; }

.telemetry-mode-tabs {
  display: flex;
  gap: 4px;
  padding: 4px;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  width: fit-content;
  background: #ffffff;
  margin-bottom: 16px;
}

.telemetry-mode-tab {
  padding: 7px 16px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: #6b7280;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.telemetry-mode-tab:hover { color: #374151; }
.telemetry-mode-tab--active { background: #1d4ed8; color: #fff; }

.telemetry-filters { display: flex; flex-wrap: wrap; gap: 16px; margin-bottom: 16px; }

.telemetry-filter {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  font-weight: 600;
  color: #374151;
}
.telemetry-filter select {
  min-width: 200px;
  padding: 6px 10px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  background: #fff;
  font-size: 13px;
}

.telemetry-trace-picker {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  font-weight: 600;
  color: #374151;
  margin-bottom: 16px;
}
.telemetry-trace-picker select {
  min-width: 340px;
  padding: 6px 10px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  background: #fff;
  font-size: 13px;
  font-weight: 400;
  color: #111827;
}

.tracing-detail { padding: 10px 14px; display: flex; flex-direction: column; gap: 4px; }
.tracing-detail--msg { color: #6b7280; font-size: 13px; }
.tracing-detail--error { color: #b91c1c; }

/* ── Trace service graph (TraceGraphCore + D3 renderer) — copied verbatim
   from TracingPage.css; each page's CSS is self-contained (no cross-page
   imports), so both pages carry their own copy of these rules. ───────────── */
.tracing-graph {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.tracing-graph-controls {
  display: flex;
  align-items: center;
  gap: 16px;
}

.tracing-graph-toggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 600;
  color: #374151;
  cursor: pointer;
}

.tracing-graph-canvas {
  position: relative;
  width: 100%;
  height: 460px;
  min-height: 220px;
  border: 1px solid #1e293b;
  border-radius: 10px;
  background: #0b1220;
  overflow: auto;
  resize: vertical;
}

.tracing-graph-svg {
  display: block;
  width: 100%;
  height: 100%;
  cursor: grab;
}

.tracing-graph-node-group,
.tracing-graph-edge-group {
  cursor: pointer;
}

.tracing-graph-node-label {
  font-family: ui-sans-serif, system-ui, sans-serif;
  pointer-events: none;
}

.tracing-graph-edge-label {
  pointer-events: none;
}

.tracing-graph-edge-label text {
  font-family: ui-sans-serif, system-ui, sans-serif;
}

.tracing-graph-dimmed {
  opacity: 0.18;
  transition: opacity 0.15s ease;
}

.tracing-graph-tooltip {
  position: fixed;
  z-index: 50;
  max-width: 280px;
  padding: 8px 10px;
  border: 1px solid #334155;
  border-radius: 6px;
  background: #0f172a;
  color: #e2e8f0;
  font-family: ui-sans-serif, system-ui, sans-serif;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  pointer-events: none;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
}

.tracing-graph-tooltip strong { color: #f1f5f9; font-weight: 600; }
.tracing-graph-tooltip-muted { color: #94a3b8; }
.tracing-graph-tooltip-hr { border: none; border-top: 1px solid #334155; margin: 5px 0; }
.tracing-graph-hidden { display: none; }

.tracing-graph-zoom { position: absolute; top: 10px; right: 10px; display: flex; gap: 6px; }
.tracing-graph-zoom-btn {
  min-width: 30px;
  height: 30px;
  padding: 0 8px;
  border: 1px solid #334155;
  border-radius: 6px;
  background: #1e293b;
  color: #e2e8f0;
  font-size: 14px;
  font-weight: 600;
  line-height: 1;
  cursor: pointer;
}
.tracing-graph-zoom-btn:hover { background: #334155; }

.tracing-graph-panel {
  position: absolute;
  top: 46px;
  right: 12px;
  width: 320px;
  max-height: 480px;
  overflow-y: auto;
  padding: 14px 16px;
  border: 1px solid #1e293b;
  border-radius: 10px;
  background: #0f172a;
  color: #e2e8f0;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5);
}

.tracing-graph-panel h3 { margin: 10px 0 8px 0; font-size: 15px; font-weight: 600; color: #f1f5f9; }

.tracing-graph-panel-facts {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px 12px;
  margin: 0 0 12px 0;
  font-size: 12px;
}
.tracing-graph-panel-facts dt { color: #94a3b8; font-weight: 600; }
.tracing-graph-panel-facts dd { margin: 0; color: #e2e8f0; font-variant-numeric: tabular-nums; }

.tracing-graph-panel-spans {
  display: flex;
  flex-direction: column;
  gap: 4px;
  border-top: 1px solid #1e293b;
  padding-top: 10px;
}
.tracing-graph-panel-spans .tracing-span-row { grid-template-columns: 1fr auto; color: #cbd5e1; }
.tracing-graph-panel-spans .tracing-span-dur { color: #94a3b8; }

.tracing-btn {
  padding: 6px 14px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  background: #ffffff;
  color: #111827;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.tracing-btn--secondary { background: #f9fafb; }

.tracing-span-row { display: grid; grid-template-columns: 260px 1fr 72px; align-items: center; gap: 8px; font-size: 12px; }
.tracing-span-op { text-overflow: ellipsis; overflow: hidden; }
.tracing-span-dur { text-align: right; color: #6b7280; font-variant-numeric: tabular-nums; }
```

- [ ] **Step 5: Delete the retired files**

```bash
git rm demo_api_ui/src/pages/telemetryGraph.js demo_api_ui/src/pages/__tests__/telemetryGraph.test.js
```

- [ ] **Step 6: Run tests, verify pass**

```bash
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/telemetry-overview-d3/demo_api_ui
./node_modules/.bin/vitest run src/pages/__tests__/TelemetryPage.test.jsx 2>&1 | tail -20
```

Expected: 5/5 pass.

- [ ] **Step 7: Build gate**

```bash
npm run build 2>&1 | tail -10
```

Expected: exit 0. This also catches the deleted `telemetryGraph.js` import if any stray reference survived the rewrite.

- [ ] **Step 8: Commit**

```bash
git add demo_api_ui/src/pages/TelemetryPage.jsx demo_api_ui/src/pages/TelemetryPage.css demo_api_ui/src/pages/__tests__/TelemetryPage.test.jsx
git commit -m "feat(telemetry): rewrite TelemetryPage on the shared D3 graph core, retire mindmap renderer"
```

(The `git rm` from Step 5 is already staged; it lands in the same commit.)

---

### Task 5: Full verification + live check

**Files:** none created — verification only.

- [ ] **Step 1: Full BFF suite**

```bash
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/telemetry-overview-d3/demo_api_server
CI=true npx jest 2>&1 | tail -10
```

Expected: full suite green (baseline was 6339/6340 with one known pre-existing flaky, unrelated test — confirm nothing new broke).

- [ ] **Step 2: UI touched suites**

Per-directory, not `vitest run src/` (that OOMs in this sandbox at default parallelism regardless of this change — see `docs/superpowers/plans/2026-07-18-jaeger-trace-ui-port.md` Task 8's note):

```bash
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/telemetry-overview-d3/demo_api_ui
./node_modules/.bin/vitest run src/services/__tests__/traceGraph.test.js src/components/__tests__/TraceGraphView.test.jsx src/pages/__tests__/TracingPage.test.jsx src/pages/__tests__/TelemetryPage.test.jsx 2>&1 | tail -20
```

Expected: all pass — 12 (traceGraph) + 3 (TraceGraphView) + 6 (TracingPage) + 5 (TelemetryPage) = 26.

- [ ] **Step 3: Build gate**

```bash
npm run build 2>&1 | tail -10
```

- [ ] **Step 4: Hygiene + graph update**

```bash
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/telemetry-overview-d3
graphify update .
npm run hygiene:check 2>&1 | tail -10
```

- [ ] **Step 5: Live verify after merge**

Docker serves the main checkout, not this worktree — do this after merging (mirrors the previous port's Task 8 pattern):
1. Restart `ai-demo-api-server` so the new `/overview/raw` route and generalized `traceGraph.js` bundle are live; `docker exec ai-demo-api-server grep -c "overview/raw" /app/routes/tracing.js` to confirm the code landed.
2. `curl -sk 'https://api.ping.demo:3001/api/health/tracing/overview/raw?lookback=1h'` — expect `{"data":[...]}` with real traces from whatever services are currently active.
3. Browse `/telemetry` — confirm Overview mode renders the D3 graph (not the old mindmap cards), switch to Detailed, pick a trace, confirm it renders too. Confirm `/tracing`'s Graph tab still works (Task 3's regression check).

- [ ] **Step 6: Finish the branch**

Use `superpowers:finishing-a-development-branch` once Step 5 is clean.

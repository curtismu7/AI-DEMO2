# Tracing In-App View + Jaeger Link at Base URL — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render trace span detail inside the demo `/tracing` page (via the BFF proxy) and make the external "View in Jaeger" link resolve in K8s by serving Jaeger at the demo base URL.

**Architecture:** Component A adds a BFF endpoint that fetches + normalizes one Jaeger trace and a React waterfall panel that expands under a clicked trace row — works in every environment because the browser never talks to Jaeger directly. Component B is pure config: an nginx `/jaeger/` proxy route, Jaeger `QUERY_BASE_PATH`, and a `JAEGER_UI_URL` env pointing at the demo base URL.

**Tech Stack:** Node/Express (BFF), Jest + supertest (BFF tests), React (Vite UI), nginx (K8s frontend), Jaeger all-in-one 1.62.0.

## Global Constraints

- Work only in the worktree `feat/tracing-in-app-view` (`.claude/worktrees/tracing-in-app`). Verify `git branch --show-current` before every commit.
- Stage explicitly with `git add <files>` — never `git add -A`.
- Emoji allowlist only: `⚠️ ✅ ❌ 🔐 ✕ ✓`. No other emoji in code/UI/docs.
- Minimal diff: name the element, change only that. No adjacent cleanup.
- `TracingPage.jsx` / `TracingPage.css` are UI surfaces — invoke the `regression-guard` skill before editing (REGRESSION_PLAN §0/§1).
- Run BFF tests from the worktree with the repo's jest invocation:
  `./node_modules/.bin/jest --testPathIgnorePatterns=/node_modules/ --runTestsByPath demo_api_server/tests/tracingRoute.test.js`
  (worktree needs `node_modules` symlinked at root + `demo_api_server` if absent — see AI-DEMO2 ops memory).

---

## Task 1: BFF single-trace route `GET /api/health/tracing/traces/:id`

**Files:**
- Modify: `demo_api_server/routes/tracing.js` (add `normaliseTrace` helper + `/traces/:id` route before `module.exports`, ~line 149)
- Test: `demo_api_server/tests/tracingRoute.test.js` (add a `describe` block)

**Interfaces:**
- Consumes: existing `resolveJaegerBase()` in `tracing.js`.
- Produces: `GET /api/health/tracing/traces/:id` → JSON
  `{ traceId, durationMs, startTime, serviceColors: {service: colorIndex},
     spans: [{ spanID, parentSpanID, serviceName, operationName,
               relativeStartMs, durationMs, depth }] }`
  Errors: 400 `invalid_trace_id`, 404 `trace_not_found`, 502 `jaeger_query_failed`, 503 `jaeger_unreachable`.

- [ ] **Step 1: Write the failing tests**

Append to `demo_api_server/tests/tracingRoute.test.js`:

```javascript
describe('GET /api/health/tracing/traces/:id', () => {
  beforeEach(() => jest.clearAllMocks());

  const traceFixture = {
    data: [{
      traceID: 'aa58608e90e7be4872a3ae9085509cce',
      spans: [
        { spanID: 'root', operationName: 'GET /api/x', startTime: 1000000, duration: 5000, references: [], processID: 'p1' },
        { spanID: 'child', operationName: 'middleware', startTime: 1001000, duration: 2000, references: [{ refType: 'CHILD_OF', spanID: 'root' }], processID: 'p1' },
      ],
      processes: { p1: { serviceName: 'demo-api-server' } },
    }],
  };

  test('returns normalised span tree on success', async () => {
    axios.get.mockImplementation((url) => {
      if (url.endsWith('/api/services')) return Promise.resolve({ status: 200, data: { data: ['demo-api-server'] } });
      return Promise.resolve({ status: 200, data: traceFixture });
    });
    const res = await request(buildApp()).get('/api/health/tracing/traces/aa58608e90e7be4872a3ae9085509cce');
    expect(res.status).toBe(200);
    expect(res.body.traceId).toBe('aa58608e90e7be4872a3ae9085509cce');
    expect(res.body.spans).toHaveLength(2);
    expect(res.body.spans[0]).toMatchObject({ spanID: 'root', parentSpanID: null, depth: 0, serviceName: 'demo-api-server' });
    expect(res.body.spans[1]).toMatchObject({ spanID: 'child', parentSpanID: 'root', depth: 1, relativeStartMs: 1 });
    expect(res.body.durationMs).toBe(5);
    expect(res.body.serviceColors).toHaveProperty('demo-api-server');
  });

  test('rejects a non-hex trace id with 400', async () => {
    const res = await request(buildApp()).get('/api/health/tracing/traces/not-a-hex-id');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_trace_id');
  });

  test('maps Jaeger empty result to 404', async () => {
    axios.get.mockImplementation((url) => {
      if (url.endsWith('/api/services')) return Promise.resolve({ status: 200, data: { data: ['demo-api-server'] } });
      return Promise.resolve({ status: 200, data: { data: [] } });
    });
    const res = await request(buildApp()).get('/api/health/tracing/traces/aa58608e90e7be4872a3ae9085509cce');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('trace_not_found');
  });

  test('maps a query error to 502', async () => {
    axios.get.mockImplementation((url) => {
      if (url.endsWith('/api/services')) return Promise.resolve({ status: 200, data: { data: ['demo-api-server'] } });
      return Promise.reject(new Error('socket hang up'));
    });
    const res = await request(buildApp()).get('/api/health/tracing/traces/aa58608e90e7be4872a3ae9085509cce');
    expect(res.status).toBe(502);
    expect(res.body.error).toBe('jaeger_query_failed');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `./node_modules/.bin/jest --testPathIgnorePatterns=/node_modules/ --runTestsByPath demo_api_server/tests/tracingRoute.test.js`
Expected: FAIL — the `/traces/:id` describe block fails (route returns 404 HTML or similar, not the JSON shape).

- [ ] **Step 3: Add the `normaliseTrace` helper**

In `demo_api_server/routes/tracing.js`, immediately after `summariseTrace` (before the `/traces` route, ~line 113):

```javascript
/**
 * Flatten one Jaeger trace into a render-ready span tree for the in-app waterfall.
 * @param {object} trace  a single Jaeger trace object ({ traceID, spans, processes })
 */
function normaliseTrace(trace) {
  const spans = Array.isArray(trace?.spans) ? trace.spans : [];
  const processes = trace?.processes || {};
  if (!spans.length) {
    return { traceId: trace?.traceID || '', spans: [], serviceColors: {}, durationMs: 0, startTime: null };
  }

  let minStart = Infinity;
  let maxEnd = 0;
  for (const s of spans) {
    const start = Number(s.startTime) || 0;
    const end = start + (Number(s.duration) || 0);
    if (start < minStart) minStart = start;
    if (end > maxEnd) maxEnd = end;
  }
  const totalUs = maxEnd > minStart ? maxEnd - minStart : 0;

  const spanIds = new Set(spans.map((s) => s.spanID));
  const parentOf = (s) => {
    const ref = (s.references || []).find(
      (r) => (r.refType === 'CHILD_OF' || r.refType === 'FOLLOWS_FROM') && spanIds.has(r.spanID),
    );
    return ref ? ref.spanID : null;
  };

  const byParent = new Map();
  for (const s of spans) {
    const p = parentOf(s);
    if (!byParent.has(p)) byParent.set(p, []);
    byParent.get(p).push(s);
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => (Number(a.startTime) || 0) - (Number(b.startTime) || 0));
  }

  const serviceOf = (s) => processes[s.processID]?.serviceName || 'unknown';
  const services = [...new Set(spans.map(serviceOf))];
  const serviceColors = Object.fromEntries(services.map((name, i) => [name, i % 8]));

  const ordered = [];
  const walk = (parentId, depth) => {
    for (const s of byParent.get(parentId) || []) {
      const start = Number(s.startTime) || 0;
      ordered.push({
        spanID: s.spanID,
        parentSpanID: parentOf(s),
        serviceName: serviceOf(s),
        operationName: s.operationName || '—',
        relativeStartMs: Math.round((start - minStart) / 1000),
        durationMs: Math.round((Number(s.duration) || 0) / 1000),
        depth,
      });
      walk(s.spanID, depth + 1);
    }
  };
  walk(null, 0);

  return {
    traceId: trace.traceID,
    spans: ordered,
    serviceColors,
    durationMs: Math.round(totalUs / 1000),
    startTime: minStart !== Infinity ? new Date(minStart / 1000).toISOString() : null,
  };
}
```

- [ ] **Step 4: Add the `/traces/:id` route**

In `demo_api_server/routes/tracing.js`, after the existing `/traces` route (before `module.exports`):

```javascript
/** GET /traces/:id — full span tree for one trace, normalised for the in-app waterfall. */
router.get('/traces/:id', async (req, res) => {
  const id = String(req.params.id || '');
  if (!/^[0-9a-f]{16,32}$/i.test(id)) {
    return res.status(400).json({ error: 'invalid_trace_id', message: 'Trace id must be 16-32 hex characters.' });
  }
  const base = await resolveJaegerBase();
  if (!base) {
    return res.status(503).json({ error: 'jaeger_unreachable', message: 'Jaeger query API is not reachable.' });
  }
  try {
    const resp = await axios.get(`${base}/api/traces/${id}`, { timeout: 10000 });
    const trace = Array.isArray(resp.data?.data) ? resp.data.data[0] : null;
    if (!trace) {
      return res.status(404).json({ error: 'trace_not_found', message: 'Trace not found.' });
    }
    return res.json(normaliseTrace(trace));
  } catch (err) {
    if (err.response?.status === 404) {
      return res.status(404).json({ error: 'trace_not_found', message: 'Trace not found.' });
    }
    return res.status(502).json({ error: 'jaeger_query_failed', message: err.message || 'Jaeger trace query failed' });
  }
});
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `./node_modules/.bin/jest --testPathIgnorePatterns=/node_modules/ --runTestsByPath demo_api_server/tests/tracingRoute.test.js`
Expected: PASS — all describe blocks green (existing status/traces tests + new `/traces/:id`).

- [ ] **Step 6: Commit**

```bash
git branch --show-current   # must print feat/tracing-in-app-view
git add demo_api_server/routes/tracing.js demo_api_server/tests/tracingRoute.test.js
git commit -m "feat(tracing): BFF route to proxy + normalise a single trace"
```

---

## Task 2: In-app trace waterfall panel in the UI

**Files:**
- Modify: `demo_api_ui/src/pages/TracingPage.jsx` (add trace-detail state, a `loadTrace` fetch, a clickable row, and an expanded `TraceDetail` sub-component)
- Modify: `demo_api_ui/src/pages/TracingPage.css` (add `.tracing-detail*` / `.tracing-span*` styles)

**Interfaces:**
- Consumes: `GET /api/health/tracing/traces/:id` from Task 1 (shape above).
- Produces: no export consumed elsewhere; self-contained page behavior.

- [ ] **Step 1: Invoke regression-guard**

Announce and invoke the `regression-guard` skill (TracingPage is a UI surface). Confirm no protected selectors/behaviors are being removed — this task only *adds* an expandable row.

- [ ] **Step 2: Add trace-detail state + loader in `TracingPage.jsx`**

After the existing state hooks (~line 24, after `lastUpdated`):

```javascript
  const [expandedId, setExpandedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState(null);

  const toggleTrace = useCallback(async (traceId) => {
    if (expandedId === traceId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(traceId);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/health/tracing/traces/${traceId}`, { credentials: "include" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || `HTTP ${res.status}`);
      }
      setDetail(await res.json());
    } catch (e) {
      setDetailError(e.message || "Failed to load trace");
    } finally {
      setDetailLoading(false);
    }
  }, [expandedId]);
```

- [ ] **Step 3: Add the `TraceDetail` sub-component**

At the bottom of `TracingPage.jsx`, before the final `}` closing the file (after the default export function), add a module-level component:

```javascript
function TraceDetail({ loading, error, detail }) {
  if (loading) return <div className="tracing-detail tracing-detail--msg">Loading spans…</div>;
  if (error) return <div className="tracing-detail tracing-detail--msg tracing-detail--error">{error}</div>;
  if (!detail || !detail.spans.length) {
    return <div className="tracing-detail tracing-detail--msg">No spans in this trace.</div>;
  }
  const total = detail.durationMs || 1;
  return (
    <div className="tracing-detail">
      {detail.spans.map((s) => {
        const left = Math.min(100, (s.relativeStartMs / total) * 100);
        const width = Math.max(0.5, (s.durationMs / total) * 100);
        return (
          <div className="tracing-span-row" key={s.spanID}>
            <div className="tracing-span-label" style={{ paddingLeft: `${s.depth * 14}px` }}>
              <span className="tracing-span-svc">{s.serviceName}</span>
              <span className="tracing-span-op">{s.operationName}</span>
            </div>
            <div className="tracing-span-track">
              <div
                className={`tracing-span-bar tracing-span-bar--c${detail.serviceColors[s.serviceName] ?? 0}`}
                style={{ left: `${left}%`, width: `${width}%` }}
                title={`${s.operationName} — ${s.durationMs} ms`}
              />
            </div>
            <div className="tracing-span-dur">
              {s.durationMs >= 1000 ? `${(s.durationMs / 1000).toFixed(2)} s` : `${s.durationMs} ms`}
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Make each trace row clickable and render the detail row**

Replace the existing `traces.map((t) => ( ... ))` row block (`TracingPage.jsx:191-210`) with a version that toggles on click and appends a detail row. Keep every existing cell; only wrap in a fragment and add the expander row:

```javascript
              traces.map((t) => (
                <React.Fragment key={t.traceId}>
                  <tr
                    className={`tracing-row ${expandedId === t.traceId ? "tracing-row--open" : ""}`}
                    onClick={() => toggleTrace(t.traceId)}
                  >
                    <td className="tracing-op">{t.operation}</td>
                    <td className="tracing-id">
                      <code>{t.traceId.slice(0, 16)}…</code>
                    </td>
                    <td>{t.spanCount}</td>
                    <td>{t.durationMs >= 1000 ? `${(t.durationMs / 1000).toFixed(2)} s` : `${t.durationMs} ms`}</td>
                    <td>{t.startTime ? new Date(t.startTime).toLocaleString() : "—"}</td>
                    <td>
                      <a
                        className="tracing-link"
                        href={traceUrl(t.traceId)}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                      >
                        View in Jaeger
                      </a>
                    </td>
                  </tr>
                  {expandedId === t.traceId && (
                    <tr className="tracing-detail-row">
                      <td colSpan={6}>
                        <TraceDetail loading={detailLoading} error={detailError} detail={detail} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))
```

(`React` is already imported at the top of the file; `React.Fragment` is available.)

- [ ] **Step 5: Add the CSS**

Append to `demo_api_ui/src/pages/TracingPage.css`:

```css
.tracing-row { cursor: pointer; }
.tracing-row:hover { background: var(--tracing-row-hover, rgba(127, 127, 127, 0.08)); }
.tracing-row--open { background: var(--tracing-row-hover, rgba(127, 127, 127, 0.12)); }

.tracing-detail-row > td { padding: 0; }
.tracing-detail { padding: 10px 14px; display: flex; flex-direction: column; gap: 4px; }
.tracing-detail--msg { color: var(--tracing-muted, #6b7280); font-size: 13px; }
.tracing-detail--error { color: #b91c1c; }

.tracing-span-row { display: grid; grid-template-columns: 260px 1fr 72px; align-items: center; gap: 8px; font-size: 12px; }
.tracing-span-label { display: flex; gap: 6px; overflow: hidden; white-space: nowrap; }
.tracing-span-svc { color: var(--tracing-muted, #6b7280); }
.tracing-span-op { text-overflow: ellipsis; overflow: hidden; }
.tracing-span-track { position: relative; height: 12px; background: rgba(127, 127, 127, 0.12); border-radius: 3px; }
.tracing-span-bar { position: absolute; top: 0; height: 12px; border-radius: 3px; min-width: 2px; }
.tracing-span-dur { text-align: right; color: var(--tracing-muted, #6b7280); font-variant-numeric: tabular-nums; }

.tracing-span-bar--c0 { background: #3b82f6; }
.tracing-span-bar--c1 { background: #10b981; }
.tracing-span-bar--c2 { background: #f59e0b; }
.tracing-span-bar--c3 { background: #8b5cf6; }
.tracing-span-bar--c4 { background: #ef4444; }
.tracing-span-bar--c5 { background: #06b6d4; }
.tracing-span-bar--c6 { background: #ec4899; }
.tracing-span-bar--c7 { background: #84cc16; }
```

- [ ] **Step 6: Verify in the running app**

Start (or reuse) the stack, log in, open `/tracing`, generate traffic, click a trace row.
Expected: the row expands to a waterfall whose span count matches the row's `Spans` column and whose bars scale with duration. Clicking "View in Jaeger" still opens a new tab (does not toggle the row — `stopPropagation`).
Use the `webapp-testing` skill (Playwright in `demo_api_ui/node_modules`) or manual browser check.

- [ ] **Step 7: Commit**

```bash
git branch --show-current   # must print feat/tracing-in-app-view
git add demo_api_ui/src/pages/TracingPage.jsx demo_api_ui/src/pages/TracingPage.css
git commit -m "feat(tracing): in-app span waterfall on trace-row expand"
```

---

## Task 3: Serve Jaeger at the demo base URL (K8s config)

**Files:**
- Modify: `k8s/02-configmap.yaml` (add `location /jaeger/` to the `nginx-config` `default.conf`)
- Modify: `k8s/73-jaeger-deployment.yaml` (add `QUERY_BASE_PATH` env)
- Modify: `k8s/20-api-server-deployment.yaml` (add `JAEGER_UI_URL` env)

**Interfaces:**
- Consumes: nothing from prior tasks (config only).
- Produces: browser-reachable `https://api.ping.demo:4000/jaeger/…`; the BFF `/status` route now advertises the base-URL `jaegerUiUrl` (already read from `JAEGER_UI_URL` at `tracing.js:16`, no code change).

- [ ] **Step 1: Add the nginx `/jaeger/` proxy route**

In `k8s/02-configmap.yaml`, inside the `default.conf` server block, after the `location /api/ { … }` block (~line 218's closing `}`), add:

```
        location /jaeger/ {
            proxy_pass http://jaeger:16686/;
            proxy_http_version 1.1;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }
```

(Note: `proxy_pass` target is plain `http://` — Jaeger's query UI is HTTP, unlike the `https://demo-api-server` upstream, so no `proxy_ssl_*` directives.)

- [ ] **Step 2: Set Jaeger's query base path**

In `k8s/73-jaeger-deployment.yaml`, in the jaeger container `env:` list (after `COLLECTOR_OTLP_ENABLED`, ~line 45):

```yaml
        - name: QUERY_BASE_PATH
          value: "/jaeger"
```

- [ ] **Step 3: Point the BFF link at the demo base URL**

In `k8s/20-api-server-deployment.yaml`, in the api-server `env:` list, after `JAEGER_QUERY_URL` (~line 70):

```yaml
        - name: JAEGER_UI_URL
          value: "https://api.ping.demo:4000/jaeger"
```

(This must equal the browser base URL + `/jaeger`. `https://api.ping.demo:4000` is `PUBLIC_APP_URL` from `k8s/02-configmap.yaml:31`. If the cluster is reached on the NodePort `:30400` instead, use that port here.)

- [ ] **Step 4: Validate the manifests parse**

Run: `kubectl apply --dry-run=client -f k8s/02-configmap.yaml -f k8s/73-jaeger-deployment.yaml -f k8s/20-api-server-deployment.yaml`
Expected: three `… configured (dry run)` / `… created (dry run)` lines, no YAML errors.

- [ ] **Step 5: Commit**

```bash
git branch --show-current   # must print feat/tracing-in-app-view
git add k8s/02-configmap.yaml k8s/73-jaeger-deployment.yaml k8s/20-api-server-deployment.yaml
git commit -m "feat(tracing): serve Jaeger UI at demo base URL (/jaeger) in k8s"
```

- [ ] **Step 6: Apply + verify in-cluster (when deploying)**

```bash
kubectl -n ai-demo apply -f k8s/02-configmap.yaml -f k8s/73-jaeger-deployment.yaml -f k8s/20-api-server-deployment.yaml
kubectl -n ai-demo rollout restart deploy/frontend deploy/jaeger deploy/api-server
```
Then in a browser: `https://api.ping.demo:4000/jaeger/` loads the Jaeger UI, and clicking "View in Jaeger" on a listed trace opens `…/jaeger/trace/<id>` with no 404 and no `localhost`.

---

## Final verification (whole feature)

- [ ] BFF tests green: `./node_modules/.bin/jest --testPathIgnorePatterns=/node_modules/ --runTestsByPath demo_api_server/tests/tracingRoute.test.js`
- [ ] `npm run topology:verify` and `npm run hygiene:check` clean.
- [ ] In-app waterfall renders for a live trace (span count matches).
- [ ] Docker/native tracing unchanged (still link to `localhost:16686` by default — no env change there).
- [ ] Finish the branch via `superpowers:finishing-a-development-branch`.

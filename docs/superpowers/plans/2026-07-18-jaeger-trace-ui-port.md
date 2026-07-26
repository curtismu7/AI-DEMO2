# Jaeger Trace UI Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the ACP workforce-portal Jaeger trace UI — D3 trace graph + projected business-step timeline — into AI-DEMO2's existing `/tracing` page.

**Architecture:** BFF gains a `traceProjector` service (curates raw Jaeger spans into business steps) plus two proxy endpoints (`/projected`, `/raw`). The UI gains a ported graph-model builder + D3 renderer and two new tab views inside the existing per-trace detail row of TracingPage. Port method is verbatim-port + adapt: keep ACP's proven span-derivation/render engine, replace its ACP-specific topology config with ours.

**Tech Stack:** Node/Express (BFF, CommonJS), React 19 + Vite 8 (UI), d3 v7 (new npm dep), Jest + supertest, Jaeger all-in-one (existing `tracing` compose profile).

**Spec:** `docs/superpowers/specs/2026-07-18-jaeger-trace-ui-port-design.md`
**ACP source repo:** `/Users/cmuir/Documents/id4ai-pingsoftware-acp-main/acp-workforce-portal/` (read-only reference; never modify)

## Global Constraints

- All work in worktree `/Users/cmuir/Development/AI-DEMO2/.claude/worktrees/jaeger-trace-ui` (branch `worktree-jaeger-trace-ui`). Run `git branch --show-current` before every commit. Stage explicit files only — never `git add -A`.
- Emoji allowlist (REGRESSION_PLAN §0): only `⚠️ ✅ ❌ 🔐 ✕ ✓ 👤 🔑 🪟 📚`. Projected-span `icon` values are plain strings (`'brain'`, `'key'`, …) rendered as CSS badges — never emoji.
- BFF tracing routes mount at `/api/health/tracing` (see existing `tracingGraph.route.test.js` `makeApp()`). All new endpoints live under the same router; existing endpoints must not change behavior.
- Jest from a worktree: follow `verify-ai-demo2` skill — run inside the worktree dirs with explicit `--testPathPattern`; BFF suites need `CI=true` (maxWorkers flake guard).
- ACP files are ES modules / browser globals; demo_api_server is CommonJS (`'use strict'; require/module.exports`). Convert on port.
- After each code task lands: `graphify update .` (AST-only) from the worktree root.
- UI copy: no new fonts, no Tailwind — extend `TracingPage.css` with plain CSS matching its existing `tracing-*` class naming.

---

### Task 1: Capture a live trace fixture

The projector's anchor conditions must match spans our stack actually emits. Capture one real agent-run trace as a committed fixture before writing any projector code.

**Files:**
- Create: `demo_api_server/tests/fixtures/trace-agent-run.json`
- Create: `demo_api_server/tests/fixtures/trace-agent-run.inventory.md`

**Interfaces:**
- Produces: fixture JSON in raw Jaeger query shape `{ data: [ { traceID, spans: [...], processes: {...} } ] }` — consumed by Tasks 2, 4, 5 tests.

- [ ] **Step 1: Start the stack with tracing**

```bash
cd /Users/cmuir/Development/AI-DEMO2   # main checkout runs the stack (Docker mounts main, not worktrees)
./run-docker.sh tracing
```

Wait for health: `docker ps --format '{{.Names}} {{.Status}}' | grep -e demo-api-server -e ai-demo-jaeger` — both `healthy`/`Up`.

- [ ] **Step 2: Generate one agent run**

Use the webapp-testing skill (Playwright): browse `https://api.ping.demo:4000`, sign in as `demoUser` (password in `.env`), open the AI agent, click one use-case chip (e.g. account balance) and wait for the reply. Fallback: do it manually in a browser.

- [ ] **Step 3: Pull the trace from Jaeger**

```bash
curl -s 'http://localhost:16686/api/traces?service=agent-service&limit=1&lookback=1h' \
  > /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/jaeger-trace-ui/demo_api_server/tests/fixtures/trace-agent-run.json
python3 -c "import json;d=json.load(open('demo_api_server/tests/fixtures/trace-agent-run.json'));print(len(d['data'][0]['spans']),'spans')"
```

Expected: a span count > 10. If `data` is empty, widen lookback or re-fire the chip; if `agent-service` is absent from `curl -s http://localhost:16686/api/services`, the agent run didn't traverse agent-service — check the chip actually invoked the agent.

- [ ] **Step 4: Write the span inventory**

```bash
python3 - <<'EOF'
import json
d = json.load(open('demo_api_server/tests/fixtures/trace-agent-run.json'))['data'][0]
procs = {k: v['serviceName'] for k, v in d['processes'].items()}
rows = sorted({(procs[s['processID']], s['operationName']) for s in d['spans']})
with open('demo_api_server/tests/fixtures/trace-agent-run.inventory.md', 'w') as f:
    f.write('# Span inventory — trace-agent-run.json\n\n| service | operation |\n|---|---|\n')
    for svc, op in rows: f.write(f'| {svc} | {op} |\n')
print(open('demo_api_server/tests/fixtures/trace-agent-run.inventory.md').read())
EOF
```

Read the inventory. It is the ground truth for every anchor in Task 2 — where this plan's anchor code disagrees with the inventory, **the inventory wins** and the anchor regex/attr keys are adjusted to it.

- [ ] **Step 5: Commit** (from the worktree)

```bash
git -C /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/jaeger-trace-ui add demo_api_server/tests/fixtures/trace-agent-run.json demo_api_server/tests/fixtures/trace-agent-run.inventory.md
git -C /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/jaeger-trace-ui commit -m "test(tracing): capture live agent-run trace fixture"
```

---

### Task 2: BFF traceProjector service (TDD)

**Files:**
- Create: `demo_api_server/services/traceProjector.js`
- Test: `demo_api_server/tests/services/traceProjector.test.js`
- Reference: ACP `lib/traceProjector.js` (helpers ported verbatim; builders rewritten for our anchors)

**Interfaces:**
- Produces: `module.exports = { project }` where `project(jaegerResponse)` takes the raw Jaeger query response `{ data: [trace] }` and returns:

```js
{
  traceId: string,           // '' when no trace
  traceStartedAt: string,    // ISO
  traceDurationMs: number,
  outcome: 'ok' | 'error',
  spans: [{
    id: string,              // 'agent_reasoning', 'tool_call_0', …
    title: string,           // 'Agent Reasoning', 'Token Exchange', …
    icon: string,            // 'brain'|'key'|'shield'|'bolt'|'database'|'bell'
    status: 'ok' | 'error',
    summary: [{ facet: 'outcome'|'target'|'protocol'|'description', value: string }
              | { facet: 'additionalMetadata', key: string, value: string }],
    source: string,          // 'service / operationName'
    durationMs: number,
    details: object,         // tag key→value map of the anchor span
    ids: string[],           // anchor spanIDs
    traceID: string,
  }]
}
```

(The ACP contract's `deepLink` field is dropped — the UI already builds Jaeger links from `status.jaegerUiUrl`.)

- [ ] **Step 1: Write failing tests** — synthetic traces per builder + live-fixture integration

`demo_api_server/tests/services/traceProjector.test.js`:

```js
'use strict';

const { project } = require('../../services/traceProjector');
const liveFixture = require('../fixtures/trace-agent-run.json');

/** Builds a minimal Jaeger response with one process per service. */
function makeTrace(spans) {
  const services = [...new Set(spans.map((s) => s.service))];
  const processes = Object.fromEntries(services.map((s, i) => [`p${i}`, { serviceName: s }]));
  const pidOf = (svc) => Object.keys(processes).find((k) => processes[k].serviceName === svc);
  return {
    data: [{
      traceID: 'feedfacefeedfacefeedfacefeedface',
      processes,
      spans: spans.map((s, i) => ({
        traceID: 'feedfacefeedfacefeedfacefeedface',
        spanID: `s${i}`,
        processID: pidOf(s.service),
        operationName: s.op,
        startTime: 1_000_000 + i * 1000,
        duration: s.duration ?? 5000,
        references: [],
        tags: Object.entries(s.tags || {}).map(([key, value]) => ({ key, value })),
      })),
    }],
  };
}

describe('traceProjector.project', () => {
  test('empty response projects to empty contract', () => {
    const out = project({ data: [] });
    expect(out).toMatchObject({ traceId: '', outcome: 'ok', spans: [] });
  });

  test('agent reasoning: groups reasoning-step-N spans into one card', () => {
    const out = project(makeTrace([
      { service: 'agent-service', op: 'reasoning-step-1', tags: { provider: 'llamacpp', input_tokens: 100, output_tokens: 40 } },
      { service: 'agent-service', op: 'reasoning-step-2', tags: { provider: 'llamacpp', input_tokens: 120, output_tokens: 30 } },
    ]));
    const card = out.spans.find((s) => s.id === 'agent_reasoning');
    expect(card).toBeDefined();
    expect(card.title).toBe('Agent Reasoning');
    expect(card.ids).toHaveLength(2);
    expect(card.summary).toContainEqual({ facet: 'outcome', value: '2 reasoning steps' });
    expect(card.summary).toContainEqual({ facet: 'additionalMetadata', key: 'provider', value: 'llamacpp' });
  });

  test('tool call: one card per tool-execution span, named from tool_name', () => {
    const out = project(makeTrace([
      { service: 'agent-service', op: 'tool-execution', tags: { tool_name: 'get_accounts', tool_call_id: 'c1' } },
      { service: 'agent-service', op: 'tool-execution', tags: { tool_name: 'create_transfer', tool_call_id: 'c2' } },
    ]));
    const cards = out.spans.filter((s) => s.title === 'Tool Call');
    expect(cards).toHaveLength(2);
    expect(cards[0].summary).toContainEqual({ facet: 'target', value: 'get_accounts' });
  });

  test('token exchange: anchors on demo-api-server POST to /as/token', () => {
    const out = project(makeTrace([
      { service: 'demo-api-server', op: 'POST', tags: { 'http.url': 'https://auth.pingone.com/x/as/token', 'http.status_code': 200 } },
    ]));
    const card = out.spans.find((s) => s.title === 'Token Exchange');
    expect(card).toBeDefined();
    expect(card.status).toBe('ok');
    expect(card.summary).toContainEqual({ facet: 'additionalMetadata', key: 'spec', value: 'RFC 8693 (token exchange)' });
  });

  test('token exchange: HTTP 4xx anchor projects status error', () => {
    const out = project(makeTrace([
      { service: 'demo-api-server', op: 'POST', tags: { 'url.full': 'https://auth.pingone.com/x/as/token', 'http.response.status_code': '401' } },
    ]));
    expect(out.spans.find((s) => s.title === 'Token Exchange').status).toBe('error');
    expect(out.outcome).toBe('error');
  });

  test('authorization: anchors on authz-server server span', () => {
    const out = project(makeTrace([
      { service: 'authz-server', op: 'POST /api/authorize', tags: { 'http.status_code': 200, 'span.kind': 'server' } },
    ]));
    const card = out.spans.find((s) => s.title === 'Authorization');
    expect(card).toBeDefined();
    expect(card.icon).toBe('shield');
  });

  test('backend api: anchors on mcp-server / mcp-invest server spans', () => {
    const out = project(makeTrace([
      { service: 'mcp-server', op: 'POST /mcp', tags: { 'http.status_code': 200, 'span.kind': 'server' } },
    ]));
    expect(out.spans.find((s) => s.title === 'MCP Backend')).toBeDefined();
  });

  test('hitl approval: card appears only when hitl-service spans exist', () => {
    const withHitl = project(makeTrace([
      { service: 'hitl-service', op: 'POST /api/consent', tags: { 'span.kind': 'server' } },
    ]));
    expect(withHitl.spans.find((s) => s.title === 'Human Approval')).toBeDefined();
    const without = project(makeTrace([
      { service: 'agent-service', op: 'reasoning-step-1', tags: {} },
    ]));
    expect(without.spans.find((s) => s.title === 'Human Approval')).toBeUndefined();
  });

  test('cards are sorted by anchor start time', () => {
    const out = project(makeTrace([
      { service: 'mcp-server', op: 'POST /mcp', tags: { 'span.kind': 'server' } },      // starts first
      { service: 'agent-service', op: 'reasoning-step-1', tags: {} },                    // starts second
    ]));
    expect(out.spans.map((s) => s.title)).toEqual(['MCP Backend', 'Agent Reasoning']);
  });

  // Live-fixture integration: structural, anchored to what Task 1 captured.
  test('live fixture: projects at least agent reasoning and one tool call', () => {
    const out = project(liveFixture);
    expect(out.traceId).toMatch(/^[0-9a-f]+$/i);
    expect(out.spans.length).toBeGreaterThanOrEqual(2);
    expect(out.spans.find((s) => s.id === 'agent_reasoning')).toBeDefined();
    expect(out.spans.find((s) => s.title === 'Tool Call')).toBeDefined();
    for (const s of out.spans) {
      expect(typeof s.title).toBe('string');
      expect(['ok', 'error']).toContain(s.status);
      expect(s.durationMs).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(s.summary)).toBe(true);
    }
  });
});
```

If the live-fixture test's expectations fail after implementation, consult `trace-agent-run.inventory.md`: adjust the failing builder's anchor (service name / op regex / tag keys) to what the inventory shows. Never delete the live-fixture test to get green.

- [ ] **Step 2: Run tests, verify they fail**

```bash
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/jaeger-trace-ui/demo_api_server
CI=true npx jest --testPathPattern 'services/traceProjector' 2>&1 | tail -5
```

Expected: FAIL — `Cannot find module '../../services/traceProjector'`.

- [ ] **Step 3: Implement `demo_api_server/services/traceProjector.js`**

Helpers are verbatim ACP ports (converted to CommonJS); builders are ours. Complete file:

```js
/**
 * traceProjector.js — Projects a raw Jaeger trace into curated business steps
 * for the /tracing page Steps tab.
 *
 * Ported from acp-workforce-portal/lib/traceProjector.js. Helper core kept
 * verbatim; anchor builders rewritten for this demo's span topology:
 *   Agent Reasoning   agent-service   / reasoning-step-N   (custom tracer)
 *   Tool Call         agent-service   / tool-execution     (custom tracer)
 *   Token Exchange    demo-api-server / HTTP POST …/as/token
 *   Authorization     authz-server    / HTTP server spans
 *   MCP Backend       mcp-server|mcp-invest / HTTP server spans
 *   Human Approval    hitl-service    / HTTP server spans
 * A builder whose anchor is absent from the trace is omitted.
 */

'use strict';

function tagsToObject(tags) {
  const obj = {};
  for (const tag of tags || []) obj[tag.key] = tag.value;
  return obj;
}

function processName(traceData, span) {
  const proc = traceData.processes?.[span.processID];
  return proc?.serviceName || '?';
}

function durationMs(span) {
  return Math.max(0, Math.round((span.duration || 0) / 1000));
}

function _isErrorCode(code) {
  if (code === undefined) return false;
  const n = typeof code === 'number' ? code : parseInt(code, 10);
  return Number.isFinite(n) && n >= 400;
}

function httpStatusCode(tagMap) {
  return tagMap['http.response.status_code'] ?? tagMap['http.status_code'];
}

function statusFromHttp(tagMap) {
  return _isErrorCode(httpStatusCode(tagMap)) ? 'error' : 'ok';
}

function httpUrl(tagMap) {
  return String(tagMap['url.full'] ?? tagMap['http.url'] ?? '');
}

function isServerSpan(tagMap) {
  return String(tagMap['span.kind'] || '').toLowerCase() === 'server';
}

function buildProjectedSpan({ id, title, icon, span, traceData, summary, status }) {
  return {
    id,
    title,
    icon,
    status: status || 'ok',
    summary,
    source: `${processName(traceData, span)} / ${span.operationName}`,
    durationMs: durationMs(span),
    startTime: span.startTime,
    details: tagsToObject(span.tags),
    ids: [span.spanID],
    traceID: null,
  };
}

// Facet factories (verbatim from ACP) — locals named `outcome` inside a
// builder shadow the helper; use `outcomeValue` for locals.
const outcome = (v) => ({ facet: 'outcome', value: String(v) });
const target = (v) => ({ facet: 'target', value: String(v) });
const protocol = (v) => ({ facet: 'protocol', value: String(v) });
const metadata = (k, v) => ({ facet: 'additionalMetadata', key: k, value: String(v) });

// ── Builders ─────────────────────────────────────────────────────────────────

function projectAgentReasoning(traceData) {
  const steps = (traceData.spans || [])
    .filter((s) => processName(traceData, s) === 'agent-service' && /^reasoning-step-\d+$/.test(s.operationName))
    .sort((a, b) => (a.startTime || 0) - (b.startTime || 0));
  if (!steps.length) return null;

  const firstTags = tagsToObject(steps[0].tags);
  const totalMs = steps.reduce((sum, s) => sum + durationMs(s), 0);
  const sumTag = (key) => steps.reduce((sum, s) => sum + (parseInt(tagsToObject(s.tags)[key], 10) || 0), 0);
  const inTok = sumTag('input_tokens');
  const outTok = sumTag('output_tokens');

  const summary = [outcome(`${steps.length} reasoning step${steps.length === 1 ? '' : 's'}`)];
  if (firstTags.provider) summary.push(metadata('provider', firstTags.provider));
  if (inTok || outTok) summary.push(metadata('tokens', `${inTok} in / ${outTok} out`));

  return {
    ...buildProjectedSpan({
      id: 'agent_reasoning',
      title: 'Agent Reasoning',
      icon: 'brain',
      span: steps[0],
      traceData,
      summary,
    }),
    durationMs: totalMs,
    ids: steps.map((s) => s.spanID),
  };
}

function projectToolCalls(traceData) {
  const calls = (traceData.spans || [])
    .filter((s) => processName(traceData, s) === 'agent-service' && s.operationName === 'tool-execution')
    .sort((a, b) => (a.startTime || 0) - (b.startTime || 0));
  if (!calls.length) return null;

  return calls.map((span, i) => {
    const tags = tagsToObject(span.tags);
    const summary = [];
    if (tags.tool_name) summary.push(target(tags.tool_name));
    if (tags.tool_call_id) summary.push(metadata('call id', tags.tool_call_id));
    summary.push(protocol('MCP'));
    return buildProjectedSpan({
      id: calls.length === 1 ? 'tool_call' : `tool_call_${i}`,
      title: 'Tool Call',
      icon: 'bolt',
      span,
      traceData,
      summary,
    });
  });
}

function projectTokenExchange(traceData) {
  const candidates = (traceData.spans || []).filter((s) => {
    if (processName(traceData, s) !== 'demo-api-server') return false;
    return httpUrl(tagsToObject(s.tags)).includes('/as/token');
  });
  if (!candidates.length) return null;

  return candidates.map((span, i) => {
    const tags = tagsToObject(span.tags);
    const code = httpStatusCode(tags);
    const url = httpUrl(tags);
    let host = '';
    try { host = new URL(url).host; } catch { /* keep '' */ }
    const summary = [outcome(code !== undefined ? `HTTP ${code}` : 'sent')];
    if (host) summary.push(target(host));
    summary.push(protocol('HTTP'));
    summary.push(metadata('spec', 'RFC 8693 (token exchange)'));
    return buildProjectedSpan({
      id: candidates.length === 1 ? 'token_exchange' : `token_exchange_${i}`,
      title: 'Token Exchange',
      icon: 'key',
      span,
      traceData,
      summary,
      status: statusFromHttp(tags),
    });
  });
}

// Generic HTTP-server-span builder for services whose auto-instrumented
// spans are the anchor (authz-server, mcp backends, hitl-service).
function projectServiceCards(traceData, { services, id, title, icon, protocolLabel }) {
  const candidates = (traceData.spans || []).filter((s) => {
    if (!services.includes(processName(traceData, s))) return false;
    const tags = tagsToObject(s.tags);
    // Prefer server spans; a service with no span.kind tags still anchors.
    const anyKind = (traceData.spans || []).some(
      (x) => processName(traceData, x) === processName(traceData, s) && isServerSpan(tagsToObject(x.tags)),
    );
    return anyKind ? isServerSpan(tags) : true;
  });
  if (!candidates.length) return null;

  return candidates.map((span, i) => {
    const tags = tagsToObject(span.tags);
    const code = httpStatusCode(tags);
    const summary = [outcome(code !== undefined ? `HTTP ${code}` : 'ok')];
    summary.push(target(processName(traceData, span)));
    summary.push(metadata('endpoint', span.operationName));
    if (protocolLabel) summary.push(protocol(protocolLabel));
    return buildProjectedSpan({
      id: candidates.length === 1 ? id : `${id}_${i}`,
      title,
      icon,
      span,
      traceData,
      summary,
      status: statusFromHttp(tags),
    });
  });
}

const projectAuthorization = (t) =>
  projectServiceCards(t, { services: ['authz-server'], id: 'authorization', title: 'Authorization', icon: 'shield', protocolLabel: 'HTTP' });
const projectBackendApi = (t) =>
  projectServiceCards(t, { services: ['mcp-server', 'mcp-invest'], id: 'backend_api', title: 'MCP Backend', icon: 'database', protocolLabel: 'HTTP' });
const projectHitlApproval = (t) =>
  projectServiceCards(t, { services: ['hitl-service'], id: 'hitl_approval', title: 'Human Approval', icon: 'bell', protocolLabel: 'HTTP' });

const PROJECTED_SPAN_BUILDERS = [
  projectAgentReasoning,
  projectTokenExchange,
  projectAuthorization,
  projectToolCalls,
  projectBackendApi,
  projectHitlApproval,
];

// ── Trace-level metadata (verbatim from ACP) ────────────────────────────────

function computeTimings(spans) {
  if (!spans || spans.length === 0) {
    return { traceStartedAt: new Date().toISOString(), traceDurationMs: 0 };
  }
  let minStart = Infinity;
  let maxEnd = -Infinity;
  for (const s of spans) {
    const start = s.startTime;
    const end = start + s.duration;
    if (start < minStart) minStart = start;
    if (end > maxEnd) maxEnd = end;
  }
  return {
    traceStartedAt: new Date(minStart / 1000).toISOString(),
    traceDurationMs: Math.round((maxEnd - minStart) / 1000),
  };
}

// ── Public entry point ──────────────────────────────────────────────────────

function project(jaegerResponse) {
  const traceData = jaegerResponse?.data?.[0];
  if (!traceData) {
    return { traceId: '', traceStartedAt: new Date().toISOString(), traceDurationMs: 0, outcome: 'ok', spans: [] };
  }

  const { traceID } = traceData;
  const { traceStartedAt, traceDurationMs } = computeTimings(traceData.spans);

  const projectedSpans = [];
  for (const build of PROJECTED_SPAN_BUILDERS) {
    const result = build(traceData);
    if (!result) continue;
    const cards = Array.isArray(result) ? result : [result];
    for (const s of cards) s.traceID = traceID;
    projectedSpans.push(...cards);
  }

  projectedSpans.sort((a, b) => (a.startTime ?? 0) - (b.startTime ?? 0));
  for (const s of projectedSpans) delete s.startTime;

  const outcomeValue = projectedSpans.some((s) => s.status === 'error') ? 'error' : 'ok';
  return { traceId: traceID, traceStartedAt, traceDurationMs, outcome: outcomeValue, spans: projectedSpans };
}

module.exports = { project };
```

- [ ] **Step 4: Run tests, verify pass — reconcile against the inventory**

```bash
CI=true npx jest --testPathPattern 'services/traceProjector' 2>&1 | tail -5
```

Expected: PASS. If the live-fixture test fails, open `trace-agent-run.inventory.md` and adjust the failing anchor (see Step 1 note). Document any anchor change in the file-top comment block.

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/services/traceProjector.js demo_api_server/tests/services/traceProjector.test.js
git commit -m "feat(tracing): trace projector — curated business steps from Jaeger spans"
```

---

### Task 3: BFF projected + raw endpoints (TDD)

**Files:**
- Modify: `demo_api_server/routes/tracing.js` (append routes before `module.exports`; existing routes untouched)
- Test: `demo_api_server/tests/routes/tracingProjected.route.test.js`

**Interfaces:**
- Consumes: `project` from Task 2; existing `resolveJaegerBase()` in the same file.
- Produces:
  - `GET /api/health/tracing/traces/:id/projected` → Task 2 projection JSON. Retries Jaeger 404s with delays `[500, 1000, 1500]` ms (ingest lag), then 404 `{error:'trace_not_found'}`. Jaeger down → 503 `{error:'jaeger_unreachable'}`; other Jaeger errors → 502 `{error:'jaeger_query_failed'}`.
  - `GET /api/health/tracing/traces/:id/raw` → unmodified Jaeger `{data:[trace]}` passthrough, no retry, same error mapping.
  - Both validate `:id` as 16–32 hex chars (400 `{error:'invalid_trace_id'}`), matching the existing `/traces/:id` route.

- [ ] **Step 1: Write failing route tests**

`demo_api_server/tests/routes/tracingProjected.route.test.js` — reuse the existing mock pattern from `tracingGraph.route.test.js`:

```js
'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('axios');
const axios = require('axios');

jest.mock('../../services/configStore', () => ({
  getEffective: jest.fn(() => ''),
}));

const tracingRouter = require('../../routes/tracing');

function makeApp() {
  const app = express();
  app.use('/api/health/tracing', tracingRouter);
  return app;
}

const TRACE = {
  traceID: 'a1b2c3d4e5f60718a1b2c3d4e5f60718',
  processes: { p1: { serviceName: 'agent-service' } },
  spans: [{
    traceID: 'a1b2c3d4e5f60718a1b2c3d4e5f60718', spanID: 's1', processID: 'p1',
    operationName: 'reasoning-step-1', startTime: 1_000_000, duration: 50_000,
    references: [], tags: [{ key: 'provider', value: 'llamacpp' }],
  }],
};
const JAEGER_OK = { status: 200, data: { data: [TRACE] } };
const SERVICES_OK = { status: 200, data: { data: ['agent-service'] } };

/** First axios.get call resolves service probe; later calls follow `responses` in order. */
function mockJaegerSequence(responses) {
  let i = 0;
  axios.get.mockImplementation((url) => {
    if (String(url).includes('/api/services')) return Promise.resolve(SERVICES_OK);
    const r = responses[Math.min(i++, responses.length - 1)];
    return r instanceof Error ? Promise.reject(r) : Promise.resolve(r);
  });
}

afterEach(() => jest.resetAllMocks());

describe('GET /traces/:id/projected', () => {
  test('projects a found trace', async () => {
    mockJaegerSequence([JAEGER_OK]);
    const res = await request(makeApp()).get(`/api/health/tracing/traces/${TRACE.traceID}/projected`);
    expect(res.status).toBe(200);
    expect(res.body.traceId).toBe(TRACE.traceID);
    expect(res.body.spans.find((s) => s.id === 'agent_reasoning')).toBeDefined();
  });

  test('retries 404 then succeeds', async () => {
    const notFound = new Error('404'); notFound.response = { status: 404 };
    mockJaegerSequence([notFound, JAEGER_OK]);
    const res = await request(makeApp()).get(`/api/health/tracing/traces/${TRACE.traceID}/projected?retryDelaysMs=0`);
    expect(res.status).toBe(200);
    expect(res.body.spans.length).toBeGreaterThan(0);
  });

  test('404 after retries exhausted', async () => {
    const notFound = new Error('404'); notFound.response = { status: 404 };
    mockJaegerSequence([notFound, notFound, notFound, notFound]);
    const res = await request(makeApp()).get(`/api/health/tracing/traces/${TRACE.traceID}/projected?retryDelaysMs=0`);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('trace_not_found');
  });

  test('rejects malformed id', async () => {
    const res = await request(makeApp()).get('/api/health/tracing/traces/nothex/projected');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_trace_id');
  });
});

describe('GET /traces/:id/raw', () => {
  test('passes the Jaeger payload through untouched', async () => {
    mockJaegerSequence([JAEGER_OK]);
    const res = await request(makeApp()).get(`/api/health/tracing/traces/${TRACE.traceID}/raw`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: [TRACE] });
  });

  test('404 maps to trace_not_found without retry', async () => {
    const notFound = new Error('404'); notFound.response = { status: 404 };
    mockJaegerSequence([notFound, JAEGER_OK]);   // second response must never be reached
    const res = await request(makeApp()).get(`/api/health/tracing/traces/${TRACE.traceID}/raw`);
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

```bash
CI=true npx jest --testPathPattern 'routes/tracingProjected' 2>&1 | tail -5
```

Expected: FAIL — 404s from Express (routes don't exist yet).

- [ ] **Step 3: Implement the routes**

Append to `demo_api_server/routes/tracing.js` immediately before `module.exports = router;`:

```js
const { project } = require('../services/traceProjector');

const TRACE_ID_RE = /^[0-9a-f]{16,32}$/i;
const INGEST_RETRY_DELAYS_MS = [500, 1000, 1500];

/** Fetch a trace, retrying 404s to absorb Jaeger ingest lag (2–5s typical). */
async function fetchTraceWithRetry(base, id, delays) {
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      const resp = await axios.get(`${base}/api/traces/${id}`, { timeout: 10000 });
      return { ok: true, data: resp.data };
    } catch (err) {
      if (err.response?.status === 404 && attempt < delays.length) {
        await new Promise((r) => setTimeout(r, delays[attempt]));
        continue;
      }
      if (err.response?.status === 404) return { ok: false, status: 404 };
      return { ok: false, status: 502, message: err.message };
    }
  }
  return { ok: false, status: 404 };
}

/** GET /traces/:id/projected — curated business-step projection (Steps tab). */
router.get('/traces/:id/projected', async (req, res) => {
  const id = String(req.params.id || '');
  if (!TRACE_ID_RE.test(id)) {
    return res.status(400).json({ error: 'invalid_trace_id', message: 'Trace id must be 16-32 hex characters.' });
  }
  const base = await resolveJaegerBase();
  if (!base) {
    return res.status(503).json({ error: 'jaeger_unreachable', message: 'Jaeger query API is not reachable.' });
  }
  // retryDelaysMs=0 collapses the retry waits (tests); production callers omit it.
  const delays = req.query.retryDelaysMs === '0'
    ? INGEST_RETRY_DELAYS_MS.map(() => 0)
    : INGEST_RETRY_DELAYS_MS;
  const result = await fetchTraceWithRetry(base, id, delays);
  if (!result.ok) {
    if (result.status === 404) return res.status(404).json({ error: 'trace_not_found', message: 'Trace not found.' });
    return res.status(502).json({ error: 'jaeger_query_failed', message: result.message || 'Jaeger trace query failed' });
  }
  return res.json(project(result.data));
});

/** GET /traces/:id/raw — unmodified Jaeger trace payload (Graph tab). */
router.get('/traces/:id/raw', async (req, res) => {
  const id = String(req.params.id || '');
  if (!TRACE_ID_RE.test(id)) {
    return res.status(400).json({ error: 'invalid_trace_id', message: 'Trace id must be 16-32 hex characters.' });
  }
  const base = await resolveJaegerBase();
  if (!base) {
    return res.status(503).json({ error: 'jaeger_unreachable', message: 'Jaeger query API is not reachable.' });
  }
  try {
    const resp = await axios.get(`${base}/api/traces/${id}`, { timeout: 10000 });
    return res.json(resp.data);
  } catch (err) {
    if (err.response?.status === 404) {
      return res.status(404).json({ error: 'trace_not_found', message: 'Trace not found.' });
    }
    return res.status(502).json({ error: 'jaeger_query_failed', message: err.message || 'Jaeger trace query failed' });
  }
});
```

Route-ordering note: Express matches `/traces/:id/projected` before `/traces/:id` only because the paths differ in segment count — appending after the existing routes is safe.

- [ ] **Step 4: Run new + existing route tests, verify pass**

```bash
CI=true npx jest --testPathPattern 'routes/tracing' 2>&1 | tail -5
```

Expected: PASS for both `tracingGraph.route.test.js` and `tracingProjected.route.test.js`.

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/routes/tracing.js demo_api_server/tests/routes/tracingProjected.route.test.js
git commit -m "feat(tracing): projected + raw trace endpoints with ingest-lag retry"
```

---

### Task 4: UI graph-model builder port (traceGraph)

**Files:**
- Create: `demo_api_ui/src/services/traceGraph.js` (ported from ACP `js/traceGraph.js`)
- Create: `demo_api_ui/src/services/__tests__/traceGraph.test.js`
- Create: `demo_api_ui/src/services/__tests__/fixtures/trace-agent-run.json` (copy of Task 1 fixture)
- Modify: `demo_api_ui/package.json` (add `"d3": "^7.9.0"` to dependencies)

**Interfaces:**
- Consumes: raw Jaeger response `{data:[trace]}` from `/traces/:id/raw`.
- Produces ES-module exports (same shapes as ACP):
  - `buildGraph(jaegerResponse, opts) → { nodes, edges, totalDurationMs, traceId, isCollapsed: false }`
  - `buildCollapsedGraph(jaegerResponse, opts) → same, isCollapsed: true`
  - node: `{ id, label, cluster, status, spans, callCount }`; edge: `{ source, target, sourceLabel, targetLabel, role, protocol, exchangeKind, callCount, totalDurationMs, avgDurationMs, outcomes, spans, isSynthetic }`.

- [ ] **Step 1: Add d3 and copy the fixture**

```bash
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/jaeger-trace-ui/demo_api_ui
npm install d3@^7.9.0 --save
mkdir -p src/services/__tests__/fixtures
cp ../demo_api_server/tests/fixtures/trace-agent-run.json src/services/__tests__/fixtures/
```

- [ ] **Step 2: Write failing model tests**

`demo_api_ui/src/services/__tests__/traceGraph.test.js`:

```js
import { buildGraph, buildCollapsedGraph } from "../traceGraph";
import fixture from "./fixtures/trace-agent-run.json";

describe("traceGraph model", () => {
  test("buildGraph derives one node per service in the live fixture", () => {
    const g = buildGraph(fixture, {});
    const services = Object.values(fixture.data[0].processes).map((p) => p.serviceName);
    for (const svc of new Set(services)) {
      expect(g.nodes.find((n) => n.id === svc || n.rawServices?.includes(svc))).toBeDefined();
    }
    expect(g.edges.length).toBeGreaterThan(0);
    expect(g.isCollapsed).toBe(false);
  });

  test("edges connect known node ids and carry call counts", () => {
    const g = buildGraph(fixture, {});
    const ids = new Set(g.nodes.map((n) => n.id));
    for (const e of g.edges) {
      expect(ids.has(e.source)).toBe(true);
      expect(ids.has(e.target)).toBe(true);
      expect(e.callCount).toBeGreaterThan(0);
    }
  });

  test("collapsed graph merges to cluster-level nodes", () => {
    const full = buildGraph(fixture, {});
    const collapsed = buildCollapsedGraph(fixture, {});
    expect(collapsed.isCollapsed).toBe(true);
    expect(collapsed.nodes.length).toBeLessThanOrEqual(full.nodes.length);
  });

  test("token-exchange edges are classified as oauth exchangeKind", () => {
    const g = buildGraph(fixture, {});
    const oauthEdges = g.edges.filter((e) => e.exchangeKind === "oauth");
    // Only asserted when the fixture contains an /as/token call:
    const hasTokenCall = fixture.data[0].spans.some((s) =>
      (s.tags || []).some((t) => String(t.value).includes("/as/token")));
    if (hasTokenCall) expect(oauthEdges.length).toBeGreaterThan(0);
  });
});
```

Run: `npx jest --testPathPattern 'services/__tests__/traceGraph'` — expected FAIL (module missing).

- [ ] **Step 3: Port the module**

Copy `/Users/cmuir/Documents/id4ai-pingsoftware-acp-main/acp-workforce-portal/js/traceGraph.js` to `demo_api_ui/src/services/traceGraph.js`, then apply these adaptation rules (read the whole ACP file first — it is ~1200 lines: config block, span→node/edge derivation, status/outcome rollup, exchangeKind classification, `_expandIntraPod`, collapse logic):

1. **Module form:** drop the `const traceGraph = (() => { … })();` IIFE wrapper; the file becomes an ES module ending in `export { buildGraph, buildCollapsedGraph, SERVICE_CLUSTERS, CLUSTER_ORDER };` (Task 5's renderer imports `CLUSTER_ORDER`).
2. **Delete ACP topology:** remove `AGENT_CONFIGS` entirely, plus every code path that reads it — `_expandIntraPod`, the `intraPod` option, SPIRE node injection, Envoy/sidecar synthetic nodes, the `agentConfigs` field on returned graphs. Deletion rule: any identifier mentioning `spire`, `envoy`, `sidecar`, `intraPod`, `filterChain`, or `AGENT_CONFIGS` goes, along with its call sites. Keep generic synthetic-edge handling only if it compiles without those identifiers; otherwise delete it too.
3. **Insert our topology config** where `AGENT_CONFIGS`/`DISPLAY_LABELS` were:

```js
// Display labels + cluster grouping for this demo's services. Unlisted
// services (future additions) fall through to their raw name in 'Other'.
const DISPLAY_LABELS = {
  'demo-api-server': 'App Backend (BFF)',
  'mcp-gateway': 'MCP Gateway',
  'mcp-server': 'Banking MCP Server',
  'mcp-invest': 'Investment MCP Server',
  'agent-service': 'AI Agent',
  'hitl-service': 'HITL Service',
  'authz-server': 'Authorization (PDP)',
};

const SERVICE_CLUSTERS = {
  'agent-service': 'Agent Runtime',
  'mcp-gateway': 'Gateway',
  'mcp-server': 'MCP Servers',
  'mcp-invest': 'MCP Servers',
  'demo-api-server': 'Core',
  'hitl-service': 'Core',
  'authz-server': 'Ping',
};

const CLUSTER_ORDER = ['Core', 'Agent Runtime', 'Gateway', 'MCP Servers', 'Ping', 'Other'];
```

Wherever the ACP code resolved a node's cluster from `AGENT_CONFIGS`, resolve `SERVICE_CLUSTERS[serviceName] || 'Other'` instead. `buildCollapsedGraph`'s cluster ids become these cluster names.
4. **Keep verbatim:** span→edge derivation from `CHILD_OF`/`FOLLOWS_FROM` references crossing services, outcome/status rollup, per-edge callCount/duration aggregation, the collapse merge shown above (minus `_roleCallCount` internals it already deletes), and `exchangeKind` classification — but reduce the classifier to the kinds our traces can produce: `oauth` when the client span URL matches `/as/token` or `/as/authorize` or `/oauth`, `authz` when either endpoint service is `authz-server`, otherwise unset. Delete `jwks` and `ldap` branches.
5. **Signature change:** ACP's builders take `traceData` (already unwrapped). Ours take the raw response: first line of each exported function: `const traceData = jaegerResponse?.data?.[0]; if (!traceData) return { nodes: [], edges: [], totalDurationMs: 0, traceId: '', isCollapsed: <bool> };`
6. Remove `deepLink` from returns (UI builds Jaeger links from `status.jaegerUiUrl`).

- [ ] **Step 4: Run tests, verify pass**

```bash
npx jest --testPathPattern 'services/__tests__/traceGraph' 2>&1 | tail -5
```

Expected: PASS. If node-id shapes differ from the test's assumptions (e.g. the port keeps display labels as ids), fix the **test's** id lookup only if the module genuinely exposes raw service names another way (`rawServices`); otherwise make ids the raw service names — that is the contract Task 5 renders with.

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/package.json demo_api_ui/package-lock.json demo_api_ui/src/services/traceGraph.js demo_api_ui/src/services/__tests__/traceGraph.test.js demo_api_ui/src/services/__tests__/fixtures/trace-agent-run.json
git commit -m "feat(tracing-ui): port ACP trace graph model builder for demo topology"
```

---

### Task 5: D3 renderer + TraceGraphView component

**Files:**
- Create: `demo_api_ui/src/services/traceGraphRender.js` (ported from `graph.html` inline script, lines ~210–1262)
- Create: `demo_api_ui/src/components/TraceGraphView.jsx`
- Test: `demo_api_ui/src/components/__tests__/TraceGraphView.test.jsx`
- Modify: `demo_api_ui/src/pages/TracingPage.css` (graph styles)

**Interfaces:**
- Consumes: `buildGraph`/`buildCollapsedGraph` from Task 4; `GET /api/health/tracing/traces/:id/raw`.
- Produces: `renderTraceGraph(containerEl, graphData, { onNodeClick, onEdgeClick }) → { destroy() }` (traceGraphRender.js) and `<TraceGraphView traceId={string} />` (React component with Collapse + Hide-infra toggles and a detail side panel).

- [ ] **Step 1: Write failing component test**

`demo_api_ui/src/components/__tests__/TraceGraphView.test.jsx` (match the render/mocking idiom of the nearest existing component test, e.g. `TokenChainTraceRail.test.jsx`):

```jsx
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import TraceGraphView from "../TraceGraphView";
import fixture from "../../services/__tests__/fixtures/trace-agent-run.json";

beforeEach(() => {
  global.fetch = jest.fn(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve(fixture) }));
});
afterEach(() => { jest.resetAllMocks(); });

test("fetches raw trace and renders an svg with service nodes", async () => {
  const traceId = fixture.data[0].traceID;
  const { container } = render(<TraceGraphView traceId={traceId} />);
  expect(global.fetch).toHaveBeenCalledWith(
    `/api/health/tracing/traces/${traceId}/raw`,
    expect.objectContaining({ credentials: "include" }));
  await waitFor(() => expect(container.querySelector("svg")).toBeInTheDocument());
  const labels = container.textContent;
  expect(labels).toContain("AI Agent");   // DISPLAY_LABELS['agent-service']
});

test("shows the error state when the trace fetch fails", async () => {
  global.fetch = jest.fn(() =>
    Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({ message: "Trace not found." }) }));
  render(<TraceGraphView traceId="feedfacefeedface" />);
  await waitFor(() => expect(screen.getByText(/Trace not found/i)).toBeInTheDocument());
});
```

Run: `npx jest --testPathPattern 'TraceGraphView'` — expected FAIL (component missing).

- [ ] **Step 2: Port the renderer**

Create `demo_api_ui/src/services/traceGraphRender.js` from the `graph.html` inline `<script>` (the `(function () { … })()` block). Adaptation rules:

1. Top of file: `import * as d3 from "d3";` (replaces the `d3-bundle.js` global). Export one function:

```js
export function renderTraceGraph(containerEl, graphData, { onNodeClick, onEdgeClick } = {}) {
  // …ported body…
  return { destroy };   // destroy(): remove listeners, clear containerEl
}
```

2. **DOM decoupling:** every `document.getElementById(...)` becomes a lookup inside `containerEl` (`containerEl.querySelector('[data-tooltip]')` etc.). The tooltip div, zoom buttons, and svg root are created by the renderer itself inside `containerEl` so the React side stays a single empty `<div ref>`.
3. **Delete ACP-only layout:** the `CLUSTER_SPIRE`/`CLUSTER_ACME`/`CLUSTER_PARTNER`/`SPIRE_NODE_IDS`/`BACKEND_IDS` constants and all conditional layout keyed on them; the intra-pod/filter-chain sub-label machinery (`resolveSubLabel` keeps only its `return null` path — inline it away). Clusters render generically from `node.cluster` using `CLUSTER_ORDER` from `traceGraph.js`.
4. **Keep verbatim:** force/cluster layout math, `EDGE_DASH` (drop `jwks`/`ldap` keys, keep `oauth`/`authz`), `STATUS_COLORS`, tooltip/dim/zoom handlers, `spanRowHtml`/`spansGroupedHtml` span listings, edge/node detail panel content builders. Detail-panel open/close: instead of `window.closeDetailPanel = …` globals, invoke the `onNodeClick`/`onEdgeClick` callbacks with the node/edge object and let React render the panel.
5. **Styling:** all Tailwind utility classes in ported HTML strings become `tracing-graph-*` classes; add the equivalent rules to `TracingPage.css` (dark panel background, 12px sans labels, `STATUS_COLORS` accents). Hex colors from the ACP file may be copied as-is.

Create `demo_api_ui/src/components/TraceGraphView.jsx`:

```jsx
// demo_api_ui/src/components/TraceGraphView.jsx
import React, { useEffect, useRef, useState } from "react";
import { buildGraph, buildCollapsedGraph } from "../services/traceGraph";
import { renderTraceGraph } from "../services/traceGraphRender";

/**
 * Interactive service graph for one trace (ported from the ACP portal).
 * Fetches the raw Jaeger payload once; collapse/detail are client-side.
 */
export default function TraceGraphView({ traceId }) {
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
        const res = await fetch(`/api/health/tracing/traces/${traceId}/raw`, { credentials: "include" });
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
  }, [traceId]);

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

The renderer's own detail-panel HTML builders (`openNodePanel`/`openEdgePanel`) are therefore NOT ported — the React panel above replaces them; port only their data extraction if the span arrays on nodes/edges need massaging. The ACP "hide SPIRE" toggle is dropped (no SPIRE here); collapse is the only toggle.

- [ ] **Step 3: Run tests, verify pass**

```bash
npx jest --testPathPattern 'TraceGraphView' 2>&1 | tail -5
```

Expected: PASS. jsdom has no layout, so if d3 force layout requires measurements, guard: renderer must not throw when `containerEl.clientWidth` is 0 (default to 900×480 like ACP's viewBox).

- [ ] **Step 4: Commit**

```bash
git add demo_api_ui/src/services/traceGraphRender.js demo_api_ui/src/components/TraceGraphView.jsx demo_api_ui/src/components/__tests__/TraceGraphView.test.jsx demo_api_ui/src/pages/TracingPage.css
git commit -m "feat(tracing-ui): D3 trace graph renderer + TraceGraphView"
```

---

### Task 6: ProjectedTimeline component (Steps tab)

**Files:**
- Create: `demo_api_ui/src/components/ProjectedTimeline.jsx`
- Test: `demo_api_ui/src/components/__tests__/ProjectedTimeline.test.jsx`
- Modify: `demo_api_ui/src/pages/TracingPage.css` (steps styles)

**Interfaces:**
- Consumes: `GET /api/health/tracing/traces/:id/projected` (Task 3 contract).
- Produces: `<ProjectedTimeline traceId={string} />`.

- [ ] **Step 1: Write failing test**

```jsx
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ProjectedTimeline from "../ProjectedTimeline";

const PROJECTION = {
  traceId: "a1b2c3d4e5f60718",
  traceStartedAt: "2026-07-18T10:00:00.000Z",
  traceDurationMs: 812,
  outcome: "ok",
  spans: [
    {
      id: "agent_reasoning", title: "Agent Reasoning", icon: "brain", status: "ok",
      summary: [
        { facet: "outcome", value: "2 reasoning steps" },
        { facet: "additionalMetadata", key: "provider", value: "llamacpp" },
      ],
      source: "agent-service / reasoning-step-1", durationMs: 420,
      details: { provider: "llamacpp" }, ids: ["s1", "s2"], traceID: "a1b2c3d4e5f60718",
    },
    {
      id: "tool_call", title: "Tool Call", icon: "bolt", status: "error",
      summary: [{ facet: "target", value: "get_accounts" }],
      source: "agent-service / tool-execution", durationMs: 95,
      details: { tool_name: "get_accounts" }, ids: ["s3"], traceID: "a1b2c3d4e5f60718",
    },
  ],
};

beforeEach(() => {
  global.fetch = jest.fn(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve(PROJECTION) }));
});
afterEach(() => jest.resetAllMocks());

test("renders one card per projected span with facets", async () => {
  render(<ProjectedTimeline traceId={PROJECTION.traceId} />);
  await waitFor(() => expect(screen.getByText("Agent Reasoning")).toBeInTheDocument());
  expect(screen.getByText("Tool Call")).toBeInTheDocument();
  expect(screen.getByText("2 reasoning steps")).toBeInTheDocument();
  expect(screen.getByText("provider")).toBeInTheDocument();
  expect(screen.getByText("llamacpp")).toBeInTheDocument();
});

test("error-status card is visually flagged and details expand on click", async () => {
  render(<ProjectedTimeline traceId={PROJECTION.traceId} />);
  await waitFor(() => expect(screen.getByText("Tool Call")).toBeInTheDocument());
  const errCard = screen.getByText("Tool Call").closest(".tracing-step-card");
  expect(errCard.className).toContain("tracing-step-card--error");
  await userEvent.click(screen.getByText("Tool Call"));
  expect(screen.getByText(/tool_name/)).toBeInTheDocument();
});

test("empty projection explains itself", async () => {
  global.fetch = jest.fn(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve({ ...PROJECTION, spans: [] }) }));
  render(<ProjectedTimeline traceId={PROJECTION.traceId} />);
  await waitFor(() =>
    expect(screen.getByText(/No recognized steps in this trace/i)).toBeInTheDocument());
});
```

Run: `npx jest --testPathPattern 'ProjectedTimeline'` — expected FAIL.

- [ ] **Step 2: Implement**

`demo_api_ui/src/components/ProjectedTimeline.jsx`:

```jsx
// demo_api_ui/src/components/ProjectedTimeline.jsx
import React, { useEffect, useState } from "react";

/** CSS-badge letter per icon kind — no emoji (REGRESSION_PLAN §0 allowlist). */
const ICON_TEXT = { brain: "R", key: "K", shield: "A", bolt: "T", database: "B", bell: "H" };

/**
 * Steps tab — curated business steps for one trace, from
 * GET /api/health/tracing/traces/:id/projected (ACP telemetry-panel port).
 */
export default function ProjectedTimeline({ traceId }) {
  const [projection, setProjection] = useState(null);
  const [error, setError] = useState(null);
  const [openId, setOpenId] = useState(null);

  useEffect(() => {
    let live = true;
    setProjection(null); setError(null); setOpenId(null);
    (async () => {
      try {
        const res = await fetch(`/api/health/tracing/traces/${traceId}/projected`, { credentials: "include" });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.message || `HTTP ${res.status}`);
        }
        const data = await res.json();
        if (live) setProjection(data);
      } catch (e) {
        if (live) setError(e.message || "Failed to load steps");
      }
    })();
    return () => { live = false; };
  }, [traceId]);

  if (error) return <div className="tracing-detail tracing-detail--msg tracing-detail--error">{error}</div>;
  if (!projection) return <div className="tracing-detail tracing-detail--msg">Loading steps…</div>;
  if (!projection.spans.length) {
    return (
      <div className="tracing-detail tracing-detail--msg">
        No recognized steps in this trace. Steps appear for agent runs — token exchange,
        authorization, reasoning, and tool calls. Try a trace from agent-service.
      </div>
    );
  }

  const maxMs = Math.max(...projection.spans.map((s) => s.durationMs), 1);

  return (
    <div className="tracing-steps">
      <p className="tracing-detail-legend">
        Curated view: the business steps of this request, distilled from {projection.spans.length} anchor
        span{projection.spans.length === 1 ? "" : "s"} · total {projection.traceDurationMs} ms
      </p>
      {projection.spans.map((s) => (
        <div
          key={s.id}
          className={`tracing-step-card ${s.status === "error" ? "tracing-step-card--error" : ""}`}
          onClick={() => setOpenId(openId === s.id ? null : s.id)}
        >
          <div className="tracing-step-head">
            <span className={`tracing-step-icon tracing-step-icon--${s.icon}`}>{ICON_TEXT[s.icon] || "·"}</span>
            <span className="tracing-step-title">{s.title}</span>
            <span className="tracing-step-dur">{s.durationMs} ms</span>
          </div>
          <div className="tracing-step-bar">
            <div className="tracing-step-bar-fill" style={{ width: `${Math.max(2, (s.durationMs / maxMs) * 100)}%` }} />
          </div>
          <dl className="tracing-step-facets">
            {s.summary.map((f, i) => (
              <div key={i} className="tracing-step-facet">
                <dt>{f.facet === "additionalMetadata" ? f.key : f.facet}</dt>
                <dd>{f.value}</dd>
              </div>
            ))}
          </dl>
          {openId === s.id && (
            <div className="tracing-step-details">
              <p className="tracing-step-source">{s.source}</p>
              <pre>{JSON.stringify(s.details, null, 2)}</pre>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
```

Add to `TracingPage.css` (extend, don't reorder existing rules): `.tracing-steps`, `.tracing-step-card` (bordered card, pointer cursor), `.tracing-step-card--error` (existing error accent color used by `.tracing-detail--error`), `.tracing-step-icon` (24px circle badge), `.tracing-step-bar`/`-fill` (thin track like `.tracing-span-track`), `.tracing-step-facets` (2-column dl grid), `.tracing-step-details pre` (scrollable, `overflow-x: auto`).

- [ ] **Step 3: Run tests, verify pass**

```bash
npx jest --testPathPattern 'ProjectedTimeline' 2>&1 | tail -5
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add demo_api_ui/src/components/ProjectedTimeline.jsx demo_api_ui/src/components/__tests__/ProjectedTimeline.test.jsx demo_api_ui/src/pages/TracingPage.css
git commit -m "feat(tracing-ui): projected steps timeline component"
```

---

### Task 7: Tabs in TracingPage trace detail

**Files:**
- Modify: `demo_api_ui/src/pages/TracingPage.jsx` (TraceDetail area, ~lines 435–492)
- Modify: `demo_api_ui/src/pages/__tests__/TracingPage.test.jsx` (extend)
- Modify: `demo_api_ui/src/pages/TracingPage.css` (tab bar)

**Interfaces:**
- Consumes: `TraceGraphView` (Task 5), `ProjectedTimeline` (Task 6), existing `TraceDetail` waterfall.
- Produces: expanded trace row shows a tab bar `Waterfall | Graph | Steps`; Waterfall stays default and unchanged.

- [ ] **Step 1: Extend the page test (failing first)**

Add to `demo_api_ui/src/pages/__tests__/TracingPage.test.jsx`, following its existing mock/setup idiom (read the file first; reuse its fetch-mock helpers for `/status`, `/services`, `/traces`):

```jsx
jest.mock("../../components/TraceGraphView", () => ({ traceId }) => (
  <div data-testid="graph-view">graph:{traceId}</div>
));
jest.mock("../../components/ProjectedTimeline", () => ({ traceId }) => (
  <div data-testid="steps-view">steps:{traceId}</div>
));

test("expanded trace shows Waterfall|Graph|Steps tabs and switches views", async () => {
  // …use the suite's existing helpers to render the page with one trace and expand it…
  await waitFor(() => expect(screen.getByRole("tab", { name: "Waterfall" })).toBeInTheDocument());
  expect(screen.queryByTestId("graph-view")).not.toBeInTheDocument();  // lazy: not mounted until selected
  await userEvent.click(screen.getByRole("tab", { name: "Graph" }));
  expect(screen.getByTestId("graph-view")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("tab", { name: "Steps" }));
  expect(screen.getByTestId("steps-view")).toBeInTheDocument();
  expect(screen.queryByTestId("graph-view")).not.toBeInTheDocument();
});
```

Run: `npx jest --testPathPattern 'pages/__tests__/TracingPage'` — new test FAILS, existing tests still PASS.

- [ ] **Step 2: Implement the tabs**

In `TracingPage.jsx`:

1. Imports: `import TraceGraphView from "../components/TraceGraphView"; import ProjectedTimeline from "../components/ProjectedTimeline";`
2. Add state next to `expandedId` (line ~76): `const [detailTab, setDetailTab] = useState("waterfall");` and reset it in `toggleTrace` when expanding a new row: `setDetailTab("waterfall");`
3. Replace the expanded-row cell body (currently just `<TraceDetail …/>`, lines ~435–441) with:

```jsx
{expandedId === t.traceId && (
  <tr className="tracing-detail-row">
    <td colSpan={6}>
      <div className="tracing-detail-tabs" role="tablist">
        {[["waterfall", "Waterfall"], ["graph", "Graph"], ["steps", "Steps"]].map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={detailTab === key}
            className={`tracing-detail-tab ${detailTab === key ? "tracing-detail-tab--active" : ""}`}
            onClick={(e) => { e.stopPropagation(); setDetailTab(key); }}
          >
            {label}
          </button>
        ))}
      </div>
      {detailTab === "waterfall" && <TraceDetail loading={detailLoading} error={detailError} detail={detail} />}
      {detailTab === "graph" && <TraceGraphView traceId={t.traceId} />}
      {detailTab === "steps" && <ProjectedTimeline traceId={t.traceId} />}
    </td>
  </tr>
)}
```

4. CSS: `.tracing-detail-tabs` (flex row, bottom border), `.tracing-detail-tab` (borderless button matching `.tracing-btn--secondary` typography), `.tracing-detail-tab--active` (accent underline). Match the page's existing color variables.

- [ ] **Step 3: Run the full page suite, verify pass**

```bash
npx jest --testPathPattern 'pages/__tests__/TracingPage' 2>&1 | tail -5
```

Expected: PASS (new + all pre-existing tests).

- [ ] **Step 4: Commit**

```bash
git add demo_api_ui/src/pages/TracingPage.jsx demo_api_ui/src/pages/__tests__/TracingPage.test.jsx demo_api_ui/src/pages/TracingPage.css
git commit -m "feat(tracing-ui): Waterfall|Graph|Steps tabs in trace detail"
```

---

### Task 8: Full verification + live check

**Files:** none created — verification only. Use the `superpowers:verification-before-completion` and `verify-ai-demo2` skills.

- [ ] **Step 1: Full test suites (worktree)**

```bash
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/jaeger-trace-ui/demo_api_server && CI=true npx jest 2>&1 | tail -3
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/jaeger-trace-ui/demo_api_ui && npx jest 2>&1 | tail -3
```

Expected: all suites pass (BFF requires `CI=true`; 4 supertest suites flake otherwise).

- [ ] **Step 2: UI build gate**

```bash
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/jaeger-trace-ui/demo_api_ui && npm run build 2>&1 | tail -3
```

Expected: Vite build succeeds, no errors.

- [ ] **Step 3: Live verify against the running stack**

Docker serves the MAIN checkout (memory: `project-docker-serves-main-checkout`); to see worktree UI live either run the worktree UI on :4443 (memory: `project-worktree-ui-live-verify` — symlink node_modules + certs, `.env` required) or land the changes first. BFF route changes need the worktree BFF or a post-merge check — if verifying pre-merge is too costly, do the live check as the post-merge step and say so in the report.

Check, with the tracing profile up and one fresh agent chip fired:
1. `/tracing` loads; trace list renders (existing behavior intact).
2. Expand the agent-service trace → **Graph** tab: SVG renders nodes for demo-api-server / agent-service / mcp-gateway with edges; collapse toggle works; clicking a node opens the side panel.
3. **Steps** tab: cards appear (at minimum Agent Reasoning + Tool Call), durations non-zero, error styling absent on a successful run.
4. **Waterfall** tab unchanged.

Record evidence (screenshot via webapp-testing skill, or curl of `/projected` for the trace id) before claiming done.

- [ ] **Step 4: Hygiene + graph update**

```bash
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/jaeger-trace-ui
graphify update .
npm run hygiene:check 2>&1 | tail -3
```

- [ ] **Step 5: Commit any verification fixes, then finish the branch**

Use `superpowers:finishing-a-development-branch` — present merge/PR options to the user. Note in the PR body that GitHub Actions is billing-blocked (memory: `feedback-ci-blocked-validate-locally`) and local suites are the CI evidence.

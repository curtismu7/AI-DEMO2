# Agentic Control Plane Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build one page that assembles the diagram's Agentic Control Plane box — Catalog, Registry, Discovery, Governance, Observability — from data that already exists, with a computed triage queue of what is actually wrong.

**Architecture:** A new aggregating endpoint `GET /api/control-plane/overview` composes three services that already exist (`agentRegistryService`, `data/serverInventory`, `agentLifecycleEvents`) and runs a set of pure rule functions over the assembled context. Findings ship in the same response as the zones, so the "needs attention" count and the triage queue are one array and cannot disagree. The UI is a two-view board, not an inspector.

**Tech Stack:** Node 22 CommonJS + Express + jest (server); React 19 + Vite + **vitest** + @testing-library/react (UI). No new dependencies.

**Spec:** [docs/superpowers/specs/2026-08-27-agentic-control-plane-surface-design.md](../specs/2026-08-27-agentic-control-plane-surface-design.md)

## Global Constraints

- **Worktree only.** Edit/test/commit in an isolated git worktree; a hard-block hook denies `Write`/`Edit` in the main checkout. Stage explicitly with `git add <files>`, never `git add -A` — a jest run regenerates ~443 files.
- **`CI=true` is mandatory** on every server test run. Without it supertest suites flake and a green run proves nothing.
- **Scoped test runs by default:** `cd demo_api_server && CI=true ./node_modules/.bin/jest <paths> --forceExit`. Do **not** pass `--testPathIgnorePatterns` — it replaces the list rather than appending and drags `/tests/real/` against the live stack.
- **Use `./node_modules/.bin/jest`, not `npx jest`.** In a worktree `npx` fetches a different jest that throws ESM `SyntaxError` on `jose`/`@a2a-js`. Same hazard with `npx vitest` — use `npm --prefix <abs path> run test:unit`.
- **Emoji allowlist:** `⚠️` `✅` `❌` `🔐` `✕` `✓` `👤` `🔑` `🪟` `📚` only, anywhere in code or UI copy. Severity is carried by CSS stripes and pills, never icons.
- **Error responses use `{ error }`**, never `{ message }`.
- **Never conclude from a piped command's exit status** — `cmd | tail` reports `tail`'s status. Redirect to a file and read it, or check `${PIPESTATUS[0]}`.
- **`demo_api_ui` is a protected area** (`REGRESSION_PLAN.md` §1). State what you will not break before editing, and `npm run build` must exit 0.
- Thresholds are constants in `controlPlaneFindings.js`: `WINDOW_DAYS = 30`, `STALE_DAYS = 7`. Not feature flags.

---

## File Structure

**Create**
| File | Responsibility |
|---|---|
| `demo_api_server/services/controlPlaneFindings.js` | The rules. Pure functions over an injected context, no I/O, no `Date.now()`. |
| `demo_api_server/services/controlPlaneOverview.js` | Assembles the five zones + enforcement stubs, calls the rules. |
| `demo_api_server/tests/controlPlaneFindings.test.js` | Fixture pair per rule: fires when it should, silent when it shouldn't. |
| `demo_api_server/tests/controlPlaneOverview.test.js` | Source states, degradation, stub behaviour. |
| `demo_api_ui/src/pages/ControlPlanePage.jsx` | Landscape + Triage views. |
| `demo_api_ui/src/pages/ControlPlanePage.css` | Board styling on the app's `--th-*` tokens. |
| `demo_api_ui/src/pages/__tests__/ControlPlanePage.test.jsx` | Renders both views from a fixture payload. |

**Modify**
| File | Change |
|---|---|
| `demo_api_server/services/agentRegistryService.js` | `scopeDrift: boolean` → `scopeStatus: 'match'\|'drift'\|'unverified'` (1 producer + 4 hardcoded sites). |
| `demo_api_server/tests/agentRegistryService.test.js` | 2 assertions. |
| `demo_api_server/routes/controlPlane.js` | Add `GET /overview`. |
| `demo_api_ui/src/pages/AgentRegistryPage.jsx` | 3 read sites: 76, 107, 161. |
| `demo_api_ui/src/pages/__tests__/AgentRegistryPage.test.jsx` | Fixture + assertions. |
| `demo_api_ui/src/App.js` | Route `/control-plane`. |
| `demo_api_ui/src/components/AdminSideNav.jsx` | New entry + relabel `/ai-control-plane`. |
| `demo_api_ui/src/config/navStructureCatalog.js` | Label mirror. |
| `demo_api_server/config/auth-requirements.json` | `"/control-plane": "user"`. |

---

## Task 1: Split scope status into match / drift / unverified

The registry hardcodes `scopeDrift: false` in four places, so every non-PingOne source claims "no drift" without ever owning an expectation. All 12 A2A rows read as verified-clean when nothing was compared. Ships value on its own — it fixes what `/agent-registry` shows today — and Task 2's `unverified-scopes` rule cannot be honest without it.

**Files:**
- Modify: `demo_api_server/services/agentRegistryService.js:51-60, 109, 142, 180, 200`
- Modify: `demo_api_server/tests/agentRegistryService.test.js:198, 207`
- Modify: `demo_api_ui/src/pages/AgentRegistryPage.jsx:76, 107, 161`
- Modify: `demo_api_ui/src/pages/__tests__/AgentRegistryPage.test.jsx`

**Interfaces:**
- Produces: registry rows carry `scopeStatus: 'match' | 'drift' | 'unverified'`. `scopeDrift` is **removed**, not kept alongside — two fields meaning almost the same thing is how they drift apart. `expectedScopes` and `missingScopes` are unchanged.

- [ ] **Step 1: Write the failing tests**

In `demo_api_server/tests/agentRegistryService.test.js`, replace the two `scopeDrift` assertions (lines 198 and 207) and add a third:

```js
  test('flags scope drift when granted does not match the topology SSOT', async () => {
    // Topology expects agent:invoke + admin:read; PingOne granted only the first.
    const out = await registry.buildRegistry();

    const row = out.rows.find((r) => r.id === 'app-1');
    expect(row.scopeStatus).toBe('drift');
    expect(row.missingScopes).toEqual(['admin:read']);
  });

  test('reports match when granted covers everything expected', async () => {
    scopeTopology.appGrantedScopes.mockReturnValue(['agent:invoke']);

    const out = await registry.buildRegistry();
    const row = out.rows.find((r) => r.id === 'app-1');
    expect(row.scopeStatus).toBe('match');
    expect(row.missingScopes).toEqual([]);
  });

  test('reports unverified when there was no expectation to compare against', async () => {
    // The bug this replaces: an empty expectation produced scopeDrift:false,
    // which is indistinguishable from a real match. All 12 a2a rows are this
    // case, and every one of them read as verified-clean.
    scopeTopology.appGrantedScopes.mockReturnValue([]);

    const out = await registry.buildRegistry();

    expect(out.rows.find((r) => r.id === 'app-1').scopeStatus).toBe('unverified');
    // Sources that never had an expectation report the same, not 'match'.
    expect(out.rows.find((r) => r.source === 'a2a').scopeStatus).toBe('unverified');
    expect(out.rows.every((r) => r.scopeDrift === undefined)).toBe(true);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd demo_api_server && CI=true ./node_modules/.bin/jest tests/agentRegistryService.test.js --forceExit
```

Expected: 3 failures — `expect(received).toBe('drift')` receiving `undefined`, because `scopeStatus` does not exist yet.

- [ ] **Step 3: Change the producer**

In `demo_api_server/services/agentRegistryService.js`, replace `scopeDriftFor`:

```js
/**
 * Expected scopes come from scope-topology.json (the SSOT); granted scopes come
 * from the live PingOne grants. The gap between them is the governance signal.
 *
 * Three outcomes, not two. An EMPTY expectation is not a match — it means the
 * comparison never happened. Collapsing those two into `scopeDrift: false` made
 * all 12 A2A rows read as verified-clean when nothing had been compared.
 */
function scopeStatusFor(appName, grantedScopes) {
  let expected = [];
  try {
    expected = scopeTopology.appGrantedScopes(appName) || [];
  } catch {
    expected = [];
  }
  if (expected.length === 0) {
    return { expectedScopes: [], missingScopes: [], scopeStatus: 'unverified' };
  }
  const granted = new Set(grantedScopes);
  const missing = expected.filter((s) => !granted.has(s));
  return {
    expectedScopes: expected,
    missingScopes: missing,
    scopeStatus: missing.length > 0 ? 'drift' : 'match',
  };
}
```

- [ ] **Step 4: Update the call site and the four hardcoded sites**

Line 83, inside `pingOneAgents()`:

```js
      ...scopeStatusFor(app.name, granted),
```

At lines 109, 142, 180 and 200 — inside `demoRegistryClients()`, `a2aSpecialists()`, and both row builders in `runtimeAgents()` — replace each `scopeDrift: false,` with:

```js
    scopeStatus: 'unverified',
```

Each of those sources issues identities at runtime with no declared expectation, so `unverified` is the literal truth about them. Delete the now-stale comment above line 109 that reads "these are issued at runtime, so there is no declared expectation to drift from" and keep only the field — the field now says it.

- [ ] **Step 5: Run the server tests to verify they pass**

```bash
cd demo_api_server && CI=true ./node_modules/.bin/jest tests/agentRegistryService.test.js tests/agentRegistryRoute.test.js --forceExit
```

Expected: PASS, all suites.

- [ ] **Step 6: Write the failing UI test**

In `demo_api_ui/src/pages/__tests__/AgentRegistryPage.test.jsx`, change the fixture rows to carry `scopeStatus` instead of `scopeDrift` (`scopeStatus: 'drift'` on `app-1`, `scopeStatus: 'unverified'` on `mcp-client-abc`) and add:

```jsx
  it('distinguishes unverified from clean', async () => {
    apiClient.get.mockResolvedValue({ data: PAYLOAD });
    render(<AgentRegistryPage />);

    // 1 row drifts; the other was never compared, so it must NOT be counted
    // as clean and must NOT be counted as drift.
    await waitFor(() => expect(screen.getByText(/1 with scope drift/)).toBeInTheDocument());
    expect(screen.getByText(/1 unverified/)).toBeInTheDocument();
  });
```

- [ ] **Step 7: Run it to verify it fails**

```bash
npm --prefix /absolute/path/to/worktree/demo_api_ui run test:unit -- src/pages/__tests__/AgentRegistryPage.test.jsx
```

Expected: FAIL — no element matching `/1 unverified/`.

- [ ] **Step 8: Update the three UI read sites**

`demo_api_ui/src/pages/AgentRegistryPage.jsx` line 76:

```jsx
  const driftCount = rows.filter((r) => r.scopeStatus === 'drift').length;
  const unverifiedCount = rows.filter((r) => r.scopeStatus === 'unverified').length;
```

Line 107 — only real drift earns the badge; unverified is not an alarm:

```jsx
                badges={r.scopeStatus === 'drift' ? ['sensitive'] : []}
```

Lines 159-177, the Scopes tab — three branches, not two:

```jsx
        {selected && tab === 'scopes' && (
          <div>
            {selected.scopeStatus === 'drift' && (
              <p className="inspector-shell-form-error">
                ⚠️ Scope drift — granted does not match what scope-topology declares.
                Missing: {(selected.missingScopes || []).join(', ')}
              </p>
            )}
            {selected.scopeStatus === 'match' && (
              <p>✅ Granted scopes match the topology declaration.</p>
            )}
            {selected.scopeStatus === 'unverified' && (
              <p>
                Not verified — scope-topology declares no expectation for this identity,
                so there was nothing to compare against. This is not the same as a clean result.
              </p>
            )}
            <div className="inspector-shell-field">
              <label>Granted</label>
              <div>{(selected.grantedScopes || []).join(', ') || '—'}</div>
            </div>
            <div className="inspector-shell-field">
              <label>Expected (scope-topology)</label>
              <div>{(selected.expectedScopes || []).join(', ') || 'none declared'}</div>
            </div>
          </div>
        )}
```

And the topbar status text (line ~209) gains the second count:

```jsx
          : `${rows.length} identities · ${driftCount} with scope drift · ${unverifiedCount} unverified`
```

- [ ] **Step 9: Run UI tests and build**

```bash
npm --prefix /absolute/path/to/worktree/demo_api_ui run test:unit
npm --prefix /absolute/path/to/worktree/demo_api_ui run build
```

Expected: both exit 0.

- [ ] **Step 10: Commit**

```bash
git add demo_api_server/services/agentRegistryService.js \
        demo_api_server/tests/agentRegistryService.test.js \
        demo_api_ui/src/pages/AgentRegistryPage.jsx \
        demo_api_ui/src/pages/__tests__/AgentRegistryPage.test.jsx
git commit -m "fix(registry): distinguish unverified scopes from a clean match

scopeDrift:false meant both 'granted covers expected' and 'there was no
expectation', so all 12 A2A rows read as verified-clean without anything
having been compared. Four sources hardcoded that false.

scopeStatus: match | drift | unverified. scopeDrift removed rather than kept
alongside — two fields meaning almost the same thing is how they drift apart."
```

---

## Task 2: The findings rules

Pure functions over an injected context. No I/O and no `Date.now()` — `now` is passed in, which is what makes the two time-based rules testable at all.

**Files:**
- Create: `demo_api_server/services/controlPlaneFindings.js`
- Create: `demo_api_server/tests/controlPlaneFindings.test.js`

**Interfaces:**
- Consumes: registry rows carrying `scopeStatus` (Task 1).
- Produces:
  - `evaluate(context) => Finding[]` where `context` is
    `{ now: Date, rows: Row[], events: Event[], sources: Record<string, {state: string}> }`
    and `events` is newest-first.
  - `DECLARED: Finding[]` — the two structural facts, exported as a constant.
  - `Finding` is `{ id, rule, severity: 'critical'|'advisory'|'structural', domain, title, detail, evidence }`.
  - `WINDOW_DAYS = 30`, `STALE_DAYS = 7` exported for the tests to reference rather than duplicate.

- [ ] **Step 1: Write the failing tests**

Create `demo_api_server/tests/controlPlaneFindings.test.js`:

```js
'use strict';

/**
 * Every rule gets a pair: it fires when it should, and it stays silent when it
 * shouldn't. A rule that has never been watched to fail is a guess.
 *
 * `now` is injected rather than read from the clock, so the two time-based
 * rules are deterministic instead of passing until the fixtures age out.
 */

const findings = require('../services/controlPlaneFindings');

const NOW = new Date('2026-08-27T12:00:00.000Z');

function ctx(over = {}) {
  return { now: NOW, rows: [], events: [], sources: {}, ...over };
}
function leaver(agentId, iso) {
  return { eventId: `e-${agentId}-${iso}`, agentId, eventType: 'leaver', timestamp: iso };
}

describe('repeat-revocation', () => {
  test('fires for an identity revoked twice inside the window', () => {
    const out = findings.evaluate(ctx({ events: [
      leaver('default-agent', '2026-08-12T00:00:00.000Z'),
      leaver('default-agent', '2026-08-10T20:49:40.788Z'),
    ] }));

    const f = out.find((x) => x.rule === 'repeat-revocation');
    expect(f).toBeDefined();
    expect(f.severity).toBe('critical');
    expect(f.evidence.agentId).toBe('default-agent');
    expect(f.evidence.count).toBe(2);
  });

  test('stays silent for a single revocation', () => {
    const out = findings.evaluate(ctx({ events: [leaver('demo-agent', '2026-08-11T09:29:54.929Z')] }));
    expect(out.some((x) => x.rule === 'repeat-revocation')).toBe(false);
  });

  test('stays silent once the revocations fall outside the window', () => {
    // History is immutable, so an all-time rule could never clear and would
    // train the reader to ignore the queue. The signal is "recently".
    const out = findings.evaluate(ctx({ events: [
      leaver('old-agent', '2026-06-01T00:00:00.000Z'),
      leaver('old-agent', '2026-06-02T00:00:00.000Z'),
    ] }));
    expect(out.some((x) => x.rule === 'repeat-revocation')).toBe(false);
  });

  test('counts per identity, not across identities', () => {
    const out = findings.evaluate(ctx({ events: [
      leaver('a', '2026-08-20T00:00:00.000Z'),
      leaver('b', '2026-08-21T00:00:00.000Z'),
    ] }));
    expect(out.some((x) => x.rule === 'repeat-revocation')).toBe(false);
  });
});

describe('unverified-scopes', () => {
  test('fires once, summarising the count', () => {
    const out = findings.evaluate(ctx({ rows: [
      { id: 'a2a:banking', source: 'a2a', scopeStatus: 'unverified' },
      { id: 'a2a:retail', source: 'a2a', scopeStatus: 'unverified' },
      { id: 'app-1', source: 'pingone', scopeStatus: 'match' },
    ] }));

    const f = out.filter((x) => x.rule === 'unverified-scopes');
    expect(f).toHaveLength(1);
    expect(f[0].severity).toBe('advisory');
    expect(f[0].evidence.count).toBe(2);
  });

  test('stays silent when every row was actually compared', () => {
    const out = findings.evaluate(ctx({ rows: [
      { id: 'app-1', source: 'pingone', scopeStatus: 'match' },
      { id: 'app-2', source: 'pingone', scopeStatus: 'drift' },
    ] }));
    expect(out.some((x) => x.rule === 'unverified-scopes')).toBe(false);
  });
});

describe('stale-ledger', () => {
  test('fires when the newest event is older than the threshold', () => {
    const out = findings.evaluate(ctx({ events: [leaver('x', '2026-08-12T00:43:51.909Z')] }));

    const f = out.find((x) => x.rule === 'stale-ledger');
    expect(f).toBeDefined();
    expect(f.evidence.days).toBe(15);
  });

  test('stays silent when something was recorded recently', () => {
    const out = findings.evaluate(ctx({ events: [leaver('x', '2026-08-26T00:00:00.000Z')] }));
    expect(out.some((x) => x.rule === 'stale-ledger')).toBe(false);
  });

  test('stays silent on an empty ledger rather than reporting Infinity days', () => {
    // Nothing recorded ever is a different condition from "went quiet", and
    // reporting it as staleness would fire on a fresh install forever.
    const out = findings.evaluate(ctx({ events: [] }));
    expect(out.some((x) => x.rule === 'stale-ledger')).toBe(false);
  });
});

describe('source-down', () => {
  test('fires once per down source', () => {
    const out = findings.evaluate(ctx({ sources: {
      pingone: { state: 'down', error: 'PingOne unreachable' },
      a2a: { state: 'live' },
    } }));

    const f = out.filter((x) => x.rule === 'source-down');
    expect(f).toHaveLength(1);
    expect(f[0].severity).toBe('critical');
    expect(f[0].evidence.source).toBe('pingone');
  });

  test('does NOT fire for a not-wired source', () => {
    // The regression the four-state model exists to prevent: a stub is not an
    // outage, and collapsing them would light this rule up forever.
    const out = findings.evaluate(ctx({ sources: {
      p1az: { state: 'not-wired' },
      discovery: { state: 'structural' },
    } }));
    expect(out.some((x) => x.rule === 'source-down')).toBe(false);
  });
});

describe('declared structural facts', () => {
  test('are constants, not rules, and are never severity critical or advisory', () => {
    expect(findings.DECLARED.map((f) => f.id).sort())
      .toEqual(['discovery-has-no-source', 'no-alert-receiver']);
    expect(findings.DECLARED.every((f) => f.severity === 'structural')).toBe(true);
  });

  test('evaluate() does not emit them — they are not computed', () => {
    const out = findings.evaluate(ctx());
    expect(out.some((f) => f.severity === 'structural')).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
cd demo_api_server && CI=true ./node_modules/.bin/jest tests/controlPlaneFindings.test.js --forceExit
```

Expected: FAIL — `Cannot find module '../services/controlPlaneFindings'`.

- [ ] **Step 3: Write the implementation**

Create `demo_api_server/services/controlPlaneFindings.js`:

```js
'use strict';

/**
 * controlPlaneFindings — what is actually wrong, computed from the assembled
 * control-plane context.
 *
 * Every rule is a pure function of its argument. No I/O, no module state, and
 * no clock read: `now` arrives in the context, which is the only reason the two
 * time-based rules can be tested deterministically.
 *
 * Rules return an array because one rule may produce many findings (one per
 * offending identity) or exactly one summarising many rows.
 */

const WINDOW_DAYS = 30;
const STALE_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

function daysBetween(now, iso) {
  return Math.floor((now.getTime() - new Date(iso).getTime()) / DAY_MS);
}

/**
 * An identity revoked more than once recently. Windowed on purpose: history is
 * immutable, so an all-time rule could never clear — it would sit in the queue
 * forever and train the reader to ignore the queue. The signal is "repeatedly,
 * recently".
 */
function repeatRevocation({ now, events }) {
  const cutoff = now.getTime() - WINDOW_DAYS * DAY_MS;
  const byAgent = new Map();
  for (const ev of events || []) {
    if (ev.eventType !== 'leaver' || !ev.agentId) continue;
    if (new Date(ev.timestamp).getTime() < cutoff) continue;
    if (!byAgent.has(ev.agentId)) byAgent.set(ev.agentId, []);
    byAgent.get(ev.agentId).push(ev);
  }
  const out = [];
  for (const [agentId, list] of byAgent) {
    if (list.length < 2) continue;
    const stamps = list.map((e) => e.timestamp).sort();
    out.push({
      id: `repeat-revocation:${agentId}`,
      rule: 'repeat-revocation',
      severity: 'critical',
      domain: 'governance',
      title: `${agentId} was revoked ${list.length} times in the last ${WINDOW_DAYS} days`,
      detail: 'A repeat revocation is the strongest governance signal this environment produces. '
        + 'Check whether it is currently active.',
      evidence: { agentId, count: list.length, first: stamps[0], last: stamps[stamps.length - 1] },
    });
  }
  return out;
}

/**
 * Rows whose scope expectation is empty, so drift was never evaluated.
 * One finding summarising the set — the reader acts on the group, not on each.
 */
function unverifiedScopes({ rows }) {
  const affected = (rows || []).filter((r) => r.scopeStatus === 'unverified');
  if (affected.length === 0) return [];
  return [{
    id: 'unverified-scopes',
    rule: 'unverified-scopes',
    severity: 'advisory',
    domain: 'registry',
    title: `${affected.length} identities have no scope expectation to check against`,
    detail: 'These rows were never compared, which is not the same as being clean. '
      + 'A real drift here would look identical until the identity is declared in scope-topology.',
    evidence: { count: affected.length, ids: affected.slice(0, 20).map((r) => r.id) },
  }];
}

/**
 * The ledger has gone quiet. An EMPTY ledger is deliberately not stale — never
 * recorded is a different condition from went quiet, and treating them alike
 * would fire on a fresh install forever.
 */
function staleLedger({ now, events }) {
  if (!events || events.length === 0) return [];
  const newest = events.reduce((a, e) => (a && a > e.timestamp ? a : e.timestamp), null);
  const days = daysBetween(now, newest);
  if (days < STALE_DAYS) return [];
  return [{
    id: 'stale-ledger',
    rule: 'stale-ledger',
    severity: 'advisory',
    domain: 'governance',
    title: `Lifecycle ledger has recorded nothing for ${days} days`,
    detail: 'Only the kill switch and the control-plane roster write to the ledger, '
      + 'so ordinary provisioning leaves no trace.',
    evidence: { days, newest },
  }];
}

/**
 * A source we asked that failed. Explicitly NOT fired by `not-wired` or
 * `structural`: a stub is not an outage, and collapsing those states would
 * light this rule up permanently.
 */
function sourceDown({ sources }) {
  return Object.entries(sources || {})
    .filter(([, s]) => s && s.state === 'down')
    .map(([name, s]) => ({
      id: `source-down:${name}`,
      rule: 'source-down',
      severity: 'critical',
      domain: 'registry',
      title: `Source "${name}" is not answering`,
      detail: s.error || 'No reason reported.',
      evidence: { source: name, error: s.error || null },
    }));
}

const RULES = [repeatRevocation, unverifiedScopes, staleLedger, sourceDown];

/**
 * Facts about how the deployment is configured, not live signals — a rule
 * evaluating these would return the same answer forever. Declared, counted
 * separately from "needs attention", because nothing the reader does today
 * can action them.
 */
const DECLARED = [
  {
    id: 'discovery-has-no-source',
    rule: 'declared',
    severity: 'structural',
    domain: 'discovery',
    title: 'Discovery has no source, and will not get one here',
    detail: 'Browsers, endpoints and workloads are unmonitored. This is a CASB/EDR capability '
      + 'rather than an IAM one, so it stays listed and stays empty.',
    evidence: { surfaces: 0, of: 3 },
  },
  {
    id: 'no-alert-receiver',
    rule: 'declared',
    severity: 'structural',
    domain: 'observability',
    title: 'Alert rules evaluate but route nowhere',
    detail: 'Prometheus rules are live with no Alertmanager, so nothing here can be raised to '
      + 'someone who is not already looking at it.',
    evidence: { receiver: null },
  },
];

/** @param {{now: Date, rows: object[], events: object[], sources: object}} context */
function evaluate(context) {
  return RULES.flatMap((rule) => rule(context) || []);
}

module.exports = { evaluate, DECLARED, WINDOW_DAYS, STALE_DAYS };
```

- [ ] **Step 4: Run to verify they pass**

```bash
cd demo_api_server && CI=true ./node_modules/.bin/jest tests/controlPlaneFindings.test.js --forceExit
```

Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/services/controlPlaneFindings.js demo_api_server/tests/controlPlaneFindings.test.js
git commit -m "feat(control-plane): computed findings rules

Four rules as pure functions over an injected context — no I/O, no clock
read, so the time-based rules are deterministic under test.

repeat-revocation is windowed: history is immutable, so an all-time rule
could never clear and would train the reader to ignore the queue.

source-down deliberately ignores not-wired and structural sources. A stub is
not an outage; collapsing them lights the rule up forever."
```

---

## Task 3: Assemble the overview

**Files:**
- Create: `demo_api_server/services/controlPlaneOverview.js`
- Create: `demo_api_server/tests/controlPlaneOverview.test.js`

**Interfaces:**
- Consumes: `controlPlaneFindings.evaluate` / `.DECLARED` (Task 2); `agentRegistryService.buildRegistry(req)`; `data/serverInventory.SERVER_INVENTORY`; `agentLifecycleEvents.query/summary`.
- Produces: `buildOverview(req) => Promise<Overview>` where `Overview` is
  `{ generatedAt, sources, zones: { catalog, registry, discovery, governance, observability }, enforcement, findings, declared }`.
  Always resolves.

- [ ] **Step 1: Write the failing test**

Create `demo_api_server/tests/controlPlaneOverview.test.js`:

```js
'use strict';

/**
 * The overview composes services that already exist and never re-reads their
 * stores, so the page cannot show a stale control plane.
 *
 * Two properties are load-bearing and both are pinned here:
 *  - four source states, where `not-wired` is NOT `down`
 *  - per-source degradation: a dead source greys one zone, never the page
 */

jest.mock('../services/agentRegistryService', () => ({ buildRegistry: jest.fn() }));
jest.mock('../services/agentLifecycleEvents', () => ({ query: jest.fn(), summary: jest.fn() }));

const agentRegistryService = require('../services/agentRegistryService');
const agentLifecycleEvents = require('../services/agentLifecycleEvents');
const overview = require('../services/controlPlaneOverview');

beforeEach(() => {
  jest.clearAllMocks();
  agentRegistryService.buildRegistry.mockResolvedValue({
    generatedAt: '2026-08-27T12:00:00.000Z',
    sources: { pingone: { up: true, rows: 13 }, a2a: { up: true, rows: 12 } },
    rows: [
      { id: 'app-1', source: 'pingone', identityType: 'agent', status: 'active', scopeStatus: 'match' },
      { id: 'a2a:banking', source: 'a2a', identityType: 'agent', status: 'active', scopeStatus: 'unverified' },
    ],
  });
  agentLifecycleEvents.query.mockReturnValue([]);
  agentLifecycleEvents.summary.mockReturnValue({ totalEvents: 0, byEventType: {} });
});

test('returns all five zones plus the enforcement band', async () => {
  const out = await overview.buildOverview({ session: {} });

  expect(Object.keys(out.zones).sort())
    .toEqual(['catalog', 'discovery', 'governance', 'observability', 'registry']);
  expect(out.enforcement.map((e) => e.id).sort()).toEqual(['aigateway', 'p1az', 'privilege']);
});

test('enforcement cards are not-wired and carry no counts', async () => {
  const out = await overview.buildOverview({ session: {} });

  for (const card of out.enforcement) {
    expect(card.state).toBe('not-wired');
    // A stub showing numbers is the thing this design exists to avoid.
    expect(card.count).toBeUndefined();
    expect(card.willShow).toEqual(expect.any(String));
    expect(card.today).toMatch(/^\//);
  }
});

test('a not-wired source does not produce a source-down finding', async () => {
  const out = await overview.buildOverview({ session: {} });
  expect(out.findings.some((f) => f.rule === 'source-down')).toBe(false);
});

test('degrades per source: registry down still returns the other zones', async () => {
  agentRegistryService.buildRegistry.mockRejectedValue(new Error('registry exploded'));

  const out = await overview.buildOverview({ session: {} });

  expect(out.sources.registry.state).toBe('down');
  expect(out.sources.registry.error).toMatch(/exploded/);
  expect(out.zones.catalog).toBeDefined();
  // and the failure becomes a finding rather than vanishing
  expect(out.findings.some((f) => f.rule === 'source-down')).toBe(true);
});

test('discovery is structural, never down', async () => {
  const out = await overview.buildOverview({ session: {} });
  expect(out.sources.discovery.state).toBe('structural');
});

test('declared facts ship separately from computed findings', async () => {
  const out = await overview.buildOverview({ session: {} });

  expect(out.declared).toHaveLength(2);
  expect(out.findings.every((f) => f.severity !== 'structural')).toBe(true);
});

test('never throws — the caller always gets a payload', async () => {
  agentRegistryService.buildRegistry.mockRejectedValue(new Error('boom'));
  agentLifecycleEvents.query.mockImplementation(() => { throw new Error('lmdb down'); });

  const out = await overview.buildOverview({ session: {} });
  expect(out.generatedAt).toEqual(expect.any(String));
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd demo_api_server && CI=true ./node_modules/.bin/jest tests/controlPlaneOverview.test.js --forceExit
```

Expected: FAIL — `Cannot find module '../services/controlPlaneOverview'`.

- [ ] **Step 3: Write the implementation**

Create `demo_api_server/services/controlPlaneOverview.js`:

```js
'use strict';

/**
 * controlPlaneOverview — the five zones of the Agentic Control Plane, assembled
 * from services that already hold the data.
 *
 * Composes; does not re-read. Nothing is cached, so the page cannot show a
 * stale control plane — the same property that makes the registry trustworthy.
 *
 * FOUR source states, not two. `up: false` on the registry means "we asked and
 * it broke". A stub is neither up nor broken, and collapsing the two would make
 * every not-yet-wired card look like an outage and fire source-down forever:
 *
 *   live       asked, answered          → numbers, links
 *   down       asked, failed            → grey, error named, fires source-down
 *   not-wired  never connected          → stub, no numbers, fires nothing
 *   structural will not be connected    → gap state, declared fact only
 */

const agentRegistryService = require('./agentRegistryService');
const agentLifecycleEvents = require('./agentLifecycleEvents');
const { SERVER_INVENTORY } = require('../data/serverInventory');
const findings = require('./controlPlaneFindings');

/** Enforcement services are observed, not owned — in the reference architecture
 *  they sit outside the control-plane box, so they render as their own band
 *  rather than a sixth zone. Phase 2 fills these in. */
const ENFORCEMENT = [
  {
    id: 'p1az',
    name: 'Fine-Grained Authorization',
    state: 'not-wired',
    willShow: 'P1AZ decisions per agent, deny reasons, policy version',
    today: '/pingone-authorize',
  },
  {
    id: 'aigateway',
    name: 'AI Gateway',
    state: 'not-wired',
    willShow: 'which agents route through which gate, tool-level allow and deny',
    today: '/agent-gateway-inspector',
  },
  {
    id: 'privilege',
    name: 'Privilege',
    state: 'not-wired',
    willShow: 'LLM, MCP, A2A and AI Guard sub-gateway state, injected credentials',
    today: '/privilege-mcp-client',
  },
];

/** Run one source in isolation. A throw contributes `state: 'down'` with its
 *  reason — never an exception that costs the caller every other zone. */
async function readSource(name, fn, sources) {
  try {
    const value = await fn();
    sources[name] = { state: 'live' };
    return value;
  } catch (err) {
    sources[name] = { state: 'down', error: err?.message || String(err) };
    return null;
  }
}

function catalogZone() {
  const mcp = SERVER_INVENTORY.filter((s) => s.category === 'mcp');
  return {
    services: SERVER_INVENTORY.length,
    mcpServers: mcp.length,
    items: mcp.map((s) => ({ key: s.key, name: s.name, lang: s.lang })),
    links: [
      { label: 'Agent Builder', href: '/agent-builder' },
      { label: 'MCP Inspector', href: '/pingone-mcp-inspector' },
    ],
  };
}

function registryZone(registry) {
  const rows = registry?.rows || [];
  const bySource = rows.reduce((a, r) => (a[r.source] = (a[r.source] || 0) + 1, a), {});
  return {
    total: rows.length,
    bySource,
    byType: rows.reduce((a, r) => (a[r.identityType] = (a[r.identityType] || 0) + 1, a), {}),
    revoked: rows.filter((r) => r.status === 'revoked').length,
    drift: rows.filter((r) => r.scopeStatus === 'drift').length,
    unverified: rows.filter((r) => r.scopeStatus === 'unverified').length,
    links: [{ label: 'Open registry', href: '/agent-registry' }],
  };
}

function governanceZone(events, summary) {
  return {
    totalEvents: summary?.totalEvents || 0,
    byEventType: summary?.byEventType || {},
    recent: (events || []).slice(0, 5),
    links: [{ label: 'Kill-switch roster', href: '/ai-control-plane' }],
  };
}

/** Observability backends are declared rather than probed: their health lives in
 *  Grafana, and duplicating that probe here would be a second source of truth. */
function observabilityZone() {
  return {
    backends: [
      { name: 'Grafana', detail: 'dashboards over Prometheus' },
      { name: 'Jaeger', detail: 'distributed traces' },
      { name: 'Transaction trace', detail: 'one chain per correlation id' },
    ],
    links: [
      { label: 'Grafana', href: '/grafana' },
      { label: 'Agent & token flow history', href: '/agent-flow-inspector' },
    ],
  };
}

/**
 * Build the control-plane overview. Always resolves — never throws — so the
 * caller can render a partial view with the failures named.
 * @param {object} [req] Express request; only the session-scoped roster inside
 *   the registry needs it.
 */
async function buildOverview(req) {
  const sources = {};

  const registry = await readSource('registry', () => agentRegistryService.buildRegistry(req), sources);
  const events = await readSource('lifecycle', async () => agentLifecycleEvents.query({ limit: 200 }), sources);
  const summary = await readSource('lifecycleSummary', async () => agentLifecycleEvents.summary(), sources);
  await readSource('catalog', async () => SERVER_INVENTORY, sources);

  // Not asked, so not up and not down.
  sources.discovery = { state: 'structural' };
  for (const card of ENFORCEMENT) sources[card.id] = { state: 'not-wired' };

  const computed = findings.evaluate({
    now: new Date(),
    rows: registry?.rows || [],
    events: events || [],
    sources,
  });

  return {
    generatedAt: new Date().toISOString(),
    sources,
    zones: {
      catalog: catalogZone(),
      registry: registryZone(registry),
      discovery: { surfaces: ['Browsers', 'Endpoints', 'Workloads'], wired: 0 },
      governance: governanceZone(events, summary),
      observability: observabilityZone(),
    },
    enforcement: ENFORCEMENT,
    findings: computed,
    declared: findings.DECLARED,
  };
}

module.exports = { buildOverview, ENFORCEMENT };
```

- [ ] **Step 4: Run to verify it passes**

```bash
cd demo_api_server && CI=true ./node_modules/.bin/jest tests/controlPlaneOverview.test.js --forceExit
```

Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/services/controlPlaneOverview.js demo_api_server/tests/controlPlaneOverview.test.js
git commit -m "feat(control-plane): assemble the five zones + enforcement band

Composes agentRegistryService, serverInventory and agentLifecycleEvents
without re-reading any of them, so nothing can go stale.

Four source states. Enforcement services render as their own band rather
than a sixth zone: in the reference architecture they sit outside the
control-plane box, and the page whose job is to teach that should not
misstate it."
```

---

## Task 4: The route

**Files:**
- Modify: `demo_api_server/routes/controlPlane.js` (after line 103, before `module.exports`)
- Create: `demo_api_server/tests/controlPlaneOverviewRoute.test.js`

**Interfaces:**
- Consumes: `controlPlaneOverview.buildOverview(req)` (Task 3).
- Produces: `GET /api/control-plane/overview`, 200 with the overview, 500 `{ error: 'overview_unavailable' }` only if assembly itself throws.

- [ ] **Step 1: Write the failing test**

Create `demo_api_server/tests/controlPlaneOverviewRoute.test.js`:

```js
'use strict';

jest.mock('../services/controlPlaneOverview', () => ({ buildOverview: jest.fn() }));
jest.mock('../middleware/auth', () => ({
  authenticateToken: (req, _res, next) => { req.user = { id: 'u1' }; next(); },
  optionalAuthenticateToken: (req, _res, next) => next(),
}));

const express = require('express');
const request = require('supertest');
const controlPlaneOverview = require('../services/controlPlaneOverview');

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/control-plane', require('../routes/controlPlane'));
  return a;
}

beforeEach(() => jest.clearAllMocks());

test('returns the overview', async () => {
  controlPlaneOverview.buildOverview.mockResolvedValue({
    generatedAt: '2026-08-27T12:00:00.000Z', sources: {}, zones: {},
    enforcement: [], findings: [], declared: [],
  });

  const res = await request(app()).get('/api/control-plane/overview');

  expect(res.status).toBe(200);
  expect(res.body.generatedAt).toBe('2026-08-27T12:00:00.000Z');
});

test('passes the request through, because the roster is session-scoped', async () => {
  controlPlaneOverview.buildOverview.mockResolvedValue({ zones: {}, findings: [], declared: [] });

  await request(app()).get('/api/control-plane/overview');

  expect(controlPlaneOverview.buildOverview).toHaveBeenCalledWith(expect.objectContaining({ user: { id: 'u1' } }));
});

test('500s with { error } — never { message } — if assembly itself throws', async () => {
  controlPlaneOverview.buildOverview.mockRejectedValue(new Error('boom'));

  const res = await request(app()).get('/api/control-plane/overview');

  expect(res.status).toBe(500);
  expect(res.body).toEqual({ error: 'overview_unavailable' });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd demo_api_server && CI=true ./node_modules/.bin/jest tests/controlPlaneOverviewRoute.test.js --forceExit
```

Expected: FAIL — 404, the route does not exist.

- [ ] **Step 3: Add the route**

In `demo_api_server/routes/controlPlane.js`, add the require at the top alongside the existing ones:

```js
const controlPlaneOverview = require('../services/controlPlaneOverview');
```

and insert before `module.exports = router;`:

```js
/**
 * GET /api/control-plane/overview
 *
 * The whole control-plane surface in one request: five zones, the enforcement
 * band, and the computed findings. 200 whenever the response can be assembled
 * at all — a dead source shows as `sources.<name>.state === 'down'` and every
 * other zone still renders.
 *
 * `req` is passed through because the registry's runtime source reads the
 * session-scoped control-plane roster.
 */
router.get('/overview', authenticateToken, async (req, res) => {
  try {
    return res.json(await controlPlaneOverview.buildOverview(req));
  } catch (err) {
    console.error('[controlPlane] overview failed:', err?.stack || String(err));
    return res.status(500).json({ error: 'overview_unavailable' });
  }
});
```

- [ ] **Step 4: Run to verify it passes**

```bash
cd demo_api_server && CI=true ./node_modules/.bin/jest tests/controlPlaneOverviewRoute.test.js tests/controlPlaneOverview.test.js tests/controlPlaneFindings.test.js --forceExit
```

Expected: PASS, all three suites.

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/routes/controlPlane.js demo_api_server/tests/controlPlaneOverviewRoute.test.js
git commit -m "feat(control-plane): GET /api/control-plane/overview"
```

---

## Task 5: The page

> **Not shippable alone.** A route with no nav entry is unshipped — Task 6 lands in the same PR. Split from Task 6 only because the three-sources-of-truth wiring is its own reviewer gate.

**Files:**
- Create: `demo_api_ui/src/pages/ControlPlanePage.jsx`
- Create: `demo_api_ui/src/pages/ControlPlanePage.css`
- Create: `demo_api_ui/src/pages/__tests__/ControlPlanePage.test.jsx`

**Interfaces:**
- Consumes: `GET /api/control-plane/overview` (Task 4) via `apiClient`.
- Produces: default-exported `ControlPlanePage` component, no props.

**Reference:** approved mockup, artifact `f80ee191-ee9a-44f0-aa76-cee856758c03`. Take the layout and the copy from it. Do **not** take its `Auto/Light/Dark` control — the app owns theming through its `--th-*` tokens, and the page consumes those. Do not take its hardcoded numbers; every number comes from the payload.

- [ ] **Step 1: Write the failing test**

Create `demo_api_ui/src/pages/__tests__/ControlPlanePage.test.jsx`:

```jsx
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../services/apiClient', () => ({ default: { get: vi.fn() } }));

import apiClient from '../../services/apiClient';
import ControlPlanePage from '../ControlPlanePage';

const PAYLOAD = {
  generatedAt: '2026-08-27T12:00:00.000Z',
  sources: { registry: { state: 'live' }, discovery: { state: 'structural' }, p1az: { state: 'not-wired' } },
  zones: {
    catalog: { services: 22, mcpServers: 5, items: [{ key: 'mcp-server', name: 'MCP Server (OLB)', lang: 'Node' }], links: [] },
    registry: { total: 33, bySource: { pingone: 13, a2a: 12, runtime: 8 }, byType: { agent: 28, external: 5 },
                revoked: 2, drift: 0, unverified: 12, links: [{ label: 'Open registry', href: '/agent-registry' }] },
    discovery: { surfaces: ['Browsers', 'Endpoints', 'Workloads'], wired: 0 },
    governance: { totalEvents: 7, byEventType: { leaver: 6, mover: 1 }, recent: [], links: [] },
    observability: { backends: [{ name: 'Grafana', detail: 'dashboards' }], links: [] },
  },
  enforcement: [
    { id: 'p1az', name: 'Fine-Grained Authorization', state: 'not-wired',
      willShow: 'P1AZ decisions per agent', today: '/pingone-authorize' },
  ],
  findings: [
    { id: 'repeat-revocation:default-agent', rule: 'repeat-revocation', severity: 'critical',
      domain: 'governance', title: 'default-agent was revoked 4 times in the last 30 days',
      detail: 'Check whether it is currently active.', evidence: { agentId: 'default-agent', count: 4 } },
    { id: 'unverified-scopes', rule: 'unverified-scopes', severity: 'advisory', domain: 'registry',
      title: '12 identities have no scope expectation to check against', detail: '…', evidence: { count: 12 } },
  ],
  declared: [
    { id: 'discovery-has-no-source', severity: 'structural', domain: 'discovery',
      title: 'Discovery has no source', detail: '…', evidence: {} },
  ],
};

beforeEach(() => { vi.clearAllMocks(); });

describe('ControlPlanePage', () => {
  it('renders every zone from the payload, not from constants', async () => {
    apiClient.get.mockResolvedValue({ data: PAYLOAD });
    render(<ControlPlanePage />);

    await waitFor(() => expect(screen.getByText('33')).toBeInTheDocument());
    expect(screen.getByText(/22 services/)).toBeInTheDocument();
    expect(screen.getByText(/Agent Discovery/)).toBeInTheDocument();
  });

  it('counts needs-attention from findings only, excluding declared facts', async () => {
    apiClient.get.mockResolvedValue({ data: PAYLOAD });
    render(<ControlPlanePage />);

    // 2 findings, 1 declared. Structural facts are counted separately because
    // nothing the reader does today can action them.
    await waitFor(() => expect(screen.getByTestId('kpi-attention')).toHaveTextContent('2'));
  });

  it('switches to triage and lists findings worst-first', async () => {
    apiClient.get.mockResolvedValue({ data: PAYLOAD });
    render(<ControlPlanePage />);

    await waitFor(() => expect(screen.getByRole('tab', { name: /Triage/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('tab', { name: /Triage/ }));

    const items = await screen.findAllByTestId('finding-title');
    expect(items[0]).toHaveTextContent(/revoked 4 times/);
  });

  it('the needs-attention KPI is itself the way into triage', async () => {
    apiClient.get.mockResolvedValue({ data: PAYLOAD });
    render(<ControlPlanePage />);

    await waitFor(() => expect(screen.getByTestId('kpi-attention')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('kpi-attention'));

    expect(await screen.findAllByTestId('finding-title')).not.toHaveLength(0);
  });

  it('renders enforcement stubs with no numbers', async () => {
    apiClient.get.mockResolvedValue({ data: PAYLOAD });
    render(<ControlPlanePage />);

    await waitFor(() => expect(screen.getByText('Fine-Grained Authorization')).toBeInTheDocument());
    expect(screen.getByText(/not wired/i)).toBeInTheDocument();
    expect(screen.getByText(/P1AZ decisions per agent/)).toBeInTheDocument();
  });

  it('names a dead source instead of blanking the page', async () => {
    apiClient.get.mockResolvedValue({
      data: { ...PAYLOAD, sources: { ...PAYLOAD.sources, registry: { state: 'down', error: 'PingOne unreachable' } } },
    });
    render(<ControlPlanePage />);

    await waitFor(() => expect(screen.getByText(/PingOne unreachable/)).toBeInTheDocument());
    // …and the rest of the board is still there.
    expect(screen.getByText(/22 services/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npm --prefix /absolute/path/to/worktree/demo_api_ui run test:unit -- src/pages/__tests__/ControlPlanePage.test.jsx
```

Expected: FAIL — cannot resolve `../ControlPlanePage`.

- [ ] **Step 3: Build the component**

Create `demo_api_ui/src/pages/ControlPlanePage.jsx`. Structure, following the mockup:

```jsx
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import apiClient from '../services/apiClient';
import './ControlPlanePage.css';

/**
 * Agentic Control Plane — the five zones of the reference architecture, read
 * live from GET /api/control-plane/overview. Nothing here is fabricated and
 * nothing is cached.
 *
 * Two views. Landscape is the board; Triage is what is actually wrong. The
 * "needs attention" count and the triage list are the SAME array, so they
 * cannot disagree — which is why the KPI is itself the button into triage.
 */

const SEVERITY_ORDER = { critical: 0, advisory: 1, structural: 2 };

export default function ControlPlanePage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('landscape');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get('/api/control-plane/overview');
      setData(res.data);
    } catch (err) {
      setError(err?.response?.data?.error || 'overview_unavailable');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const findings = useMemo(
    () => [...(data?.findings || [])].sort(
      (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
    ),
    [data],
  );
  const declared = data?.declared || [];
  const downSources = Object.entries(data?.sources || {})
    .filter(([, s]) => s.state === 'down')
    .map(([name, s]) => ({ name, error: s.error }));

  // …render: topbar, view tabs, then either the Landscape board or the Triage
  // queue. Full markup follows the mockup.
}
```

Requirements the tests pin, all of which must hold:

1. **KPI tile** `data-testid="kpi-attention"` renders `findings.length` (**not** `findings.length + declared.length`) and is a `<button>` calling `setView('triage')`.
2. **View tabs** are `role="tab"` with accessible names `Landscape` and `Triage`; the Triage tab carries a badge of `findings.length`.
3. **Each finding title** carries `data-testid="finding-title"`; the list renders in `findings` order (already severity-sorted).
4. **Down sources** render a banner naming `name: error`, and the zones still render beneath it.
5. **Enforcement cards** render `name`, `willShow`, a link to `today`, and the literal text `not wired`. They render **no** count.
6. **Discovery zone** renders its three surfaces as dashed rows with `no source`, never a zero that reads as a metric.
7. Emoji allowlist: `⚠️` is permitted on the drift/critical banner; everything else is CSS.

Create `demo_api_ui/src/pages/ControlPlanePage.css` using the app's existing `--th-*` semantic tokens for surface/ink/hairline, with a local fallback chain matching what other pages in `demo_api_ui/src/pages/` do. Severity is carried by a 3px left stripe and a pill, both colour-only — no icon fonts, no emoji.

- [ ] **Step 4: Run to verify it passes**

```bash
npm --prefix /absolute/path/to/worktree/demo_api_ui run test:unit -- src/pages/__tests__/ControlPlanePage.test.jsx
```

Expected: PASS, 6 tests.

- [ ] **Step 5: Run the full UI suite and build**

```bash
npm --prefix /absolute/path/to/worktree/demo_api_ui run test:unit
npm --prefix /absolute/path/to/worktree/demo_api_ui run build
```

Expected: both exit 0.

- [ ] **Step 6: Commit**

```bash
git add demo_api_ui/src/pages/ControlPlanePage.jsx \
        demo_api_ui/src/pages/ControlPlanePage.css \
        demo_api_ui/src/pages/__tests__/ControlPlanePage.test.jsx
git commit -m "feat(ui): control plane page — landscape + triage views

The needs-attention KPI and the triage list are the same array, so they
cannot disagree; the KPI is itself the button into triage rather than a
number you then hunt for elsewhere.

Enforcement cards render as stubs with no numbers. Declared structural facts
are counted separately from findings, because nothing the reader does today
can action them."
```

---

## Task 6: Route and nav — three sources of truth

A route with no nav entry is unshipped. All three SoTs move in one commit; two of them have their own CI gate and the third has none, which is exactly why they are easy to miss.

**Files:**
- Modify: `demo_api_ui/src/App.js` (import near line 140; route near line 833)
- Modify: `demo_api_ui/src/components/AdminSideNav.jsx:579-589`
- Modify: `demo_api_ui/src/config/navStructureCatalog.js:45-47`
- Modify: `demo_api_server/config/auth-requirements.json:114`

**Interfaces:**
- Consumes: `ControlPlanePage` (Task 5).

- [ ] **Step 1: Add the route**

In `demo_api_ui/src/App.js`, beside the other page imports:

```jsx
import ControlPlanePage from "./pages/ControlPlanePage";
```

and beside the `/ai-control-plane` route, following its exact shape:

```jsx
                {/* Agentic Control Plane — the five zones, any logged-in user. */}
                <Route
                  path="/control-plane"
                  element={
                    loading ? null : user ? (
                      <>
                        <TopNav user={user} onLogout={logout} />
                        <main className="main-content">
                          <ControlPlanePage />
                        </main>
                      </>
                    ) : (
                      <SignInRequired />
                    )
                  }
                />
```

- [ ] **Step 2: Add the nav entry and relabel the roster**

In `demo_api_ui/src/components/AdminSideNav.jsx`, inside the `AI Agents` group, put the new entry **first** and rename the existing one to what it actually is:

```jsx
        {
          label: "Agentic Control Plane",
          path: "/control-plane",
          icon: "sec",
          highlight: true,
        },
        {
          // Renamed: this is the kill-switch roster, reachable from the
          // Governance zone. It never was the control plane.
          label: "Agent Kill Switch",
          path: "/ai-control-plane",
          icon: "sec",
          introGate: true,
        },
```

- [ ] **Step 3: Mirror both labels in the catalog**

In `demo_api_ui/src/config/navStructureCatalog.js`, the `AI Agents` children array — the catalog is label-keyed, so a rename is a two-line edit:

```js
      "Agentic Control Plane",
      "Agent Kill Switch",
      "Agent Registry",
```

- [ ] **Step 4: Declare the route's auth level**

In `demo_api_server/config/auth-requirements.json`, beside line 114:

```json
    "/control-plane": "user",
```

- [ ] **Step 5: Run all three gates**

```bash
cd /absolute/path/to/worktree && npm run authz:verify
npm --prefix /absolute/path/to/worktree/demo_api_ui run test:unit -- src/config/__tests__/navStructureCatalog.drift.test.js
npm --prefix /absolute/path/to/worktree/demo_api_ui run build
```

Expected: all three exit 0. `authz:verify` fails on an unlisted route; the drift test fails on a label the catalog is missing. If the drift test fails, the catalog does not match `AdminSideNav` — fix the catalog, never the test.

- [ ] **Step 6: Commit**

```bash
git add demo_api_ui/src/App.js \
        demo_api_ui/src/components/AdminSideNav.jsx \
        demo_api_ui/src/config/navStructureCatalog.js \
        demo_api_server/config/auth-requirements.json
git commit -m "feat(nav): ship the control plane at /control-plane

Three sources of truth in one commit: AdminSideNav, navStructureCatalog and
auth-requirements. A route with no nav entry is unshipped.

/ai-control-plane keeps its route and is renamed to what it is — a kill
switch roster — reachable from the Governance zone. It never was the
control plane."
```

---

## Task 7: Verify live and open the PR

A green suite is not evidence the page works. Code existing is not evidence it runs.

- [ ] **Step 1: Run every touched server suite together**

```bash
cd demo_api_server && CI=true ./node_modules/.bin/jest \
  tests/controlPlaneFindings.test.js tests/controlPlaneOverview.test.js \
  tests/controlPlaneOverviewRoute.test.js tests/agentRegistryService.test.js \
  tests/agentRegistryRoute.test.js --forceExit > /tmp/cp-server.txt 2>&1
echo "exit: $?"; grep -E "Tests:|Test Suites:" /tmp/cp-server.txt
```

Do not pipe to `tail` and read the exit code — redirect and read the file.

- [ ] **Step 2: Confirm the endpoint against the real stack**

The container's LMDB is a **named volume**, not the bind mount, so a host-side check reads an empty store and proves nothing. Run it inside the container:

```bash
docker exec -w /app ai-demo-api-server node -e "
require('/app/services/controlPlaneOverview').buildOverview({ session: {} }).then((o) => {
  console.log('sources :', JSON.stringify(o.sources));
  console.log('findings:', o.findings.map((f) => f.rule).join(', ') || '(none)');
  console.log('declared:', o.declared.length);
  console.log('zones   :', Object.keys(o.zones).join(', '));
});" 2>&1 | grep -v -E "otel|Warning|lmdb"
```

Expected against today's data: `repeat-revocation`, `unverified-scopes`, `stale-ledger` fire; `source-down` does not; `declared: 2`; every source `live` except `discovery` (`structural`) and the three enforcement ids (`not-wired`).

- [ ] **Step 3: Open the page in both themes**

Pin the stack generation first — several sessions share one stack and a mid-drive restart looks exactly like an application bug:

```bash
gen="$(npm run -s stack:generation)"
# …drive https://local.ping-devops.com:4000/control-plane, light and dark…
npm run -s stack:generation -- --check "$gen"
```

Confirm: the counts on screen equal the counts step 2 printed; the Triage tab lists the same findings; the enforcement cards show no numbers; a non-zero `--check` means the run is void, not a finding.

- [ ] **Step 4: Push and open the PR**

```bash
git push -u origin <branch>
gh pr create --title "feat(control-plane): the agentic control plane surface" --body "…"
```

The PR body should name what was measured, not assert that it works: the server suite result line, the in-container finding list from step 2, and the stack-generation check from step 3.

---

## Self-Review

**Spec coverage** — every section maps to a task:

| Spec section | Task |
|---|---|
| §1 server modules | 2, 3, 4 |
| §2 four source states | 3 (impl), 2 (`source-down` ignores `not-wired`) |
| §3.1 computed rules | 2 |
| §3.2 declared facts | 2 (`DECLARED`), 5 (counted separately) |
| §3.3 registry scope defect | 1 |
| §4 enforcement band | 3 (`ENFORCEMENT`), 5 (render, no numbers) |
| §5 UI | 5 |
| §6 nav, three SoTs | 6 |
| §7 verification | 7 |

**Placeholder scan** — one deliberate exception: Task 5 Step 3 gives the component's contract and its seven pinned requirements rather than 300 lines of JSX, because the approved mockup *is* the markup spec and duplicating it here would create a second source of truth that can drift. Every behaviour the tests assert is enumerated. No other step defers work.

**Type consistency** — `scopeStatus` is produced in Task 1 and consumed by name in Tasks 2, 3 and 5. `evaluate(context)` / `DECLARED` are defined in Task 2 and called in Task 3. `buildOverview(req)` is defined in Task 3 and called in Task 4. `state` values (`live`/`down`/`not-wired`/`structural`) are identical in Tasks 2, 3 and 5. Severity values (`critical`/`advisory`/`structural`) match across Tasks 2 and 5.

**One gap found and closed:** the spec named three `scopeDrift` UI read sites but not `AgentRegistryPage.test.jsx`, which also pins the field. Task 1 Steps 6–8 cover it.

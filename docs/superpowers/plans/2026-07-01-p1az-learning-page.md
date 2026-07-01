# P1AZ Learning Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing `/authz-test` page into a sectioned PingOne Authorize (P1AZ) learning page that covers the full policy model with interactive, annotated demos (Simulated always; Live where an endpoint exists).

**Architecture:** Backend gains one isolated module (`authorizeLearningDemos.js`) holding four new simulated demo handlers + a shared policy-element **trace** builder; the existing `test-evaluate` route gains a `demoType` discriminator that routes to it while leaving the default transaction path byte-for-byte unchanged. Frontend gains two reusable presentational components (`DemoSection`, `AnnotatedResult`) and a data-only section registry (`authzSections.js`); `AuthzTestPage.jsx` is refactored to render seven collapsible sections while preserving its existing chrome (engine banner, settings panel, run history).

**Tech Stack:** Node/Express + jest (server, tests in `demo_api_server/src/__tests__/`); React + Vite + vitest (UI). No new runtime dependencies.

## Global Constraints

- **Worktree only.** All work happens in this worktree (`.claude/worktrees/p1az-learning-page`, branch `worktree-p1az-learning-page`). Never edit the main checkout. Stage files explicitly with `git add <path>` — never `git add -A`. Verify `git branch --show-current` before every commit.
- **No regression to the existing transaction path.** A `test-evaluate` request with no `demoType` (or `demoType: 'transaction'`) MUST behave exactly as today. This is the parity invariant enforced across engines — do not alter `simulatedAuthorizeService.js` production functions.
- **Additive only.** No new nav entry, no route change (`/authz-test` stays), no auth/permission changes. Live P1AZ policy provisioning is out of scope — Simulated is the guaranteed path.
- **Deny-by-default.** Any new demo whose inputs cannot be resolved returns `INDETERMINATE` treated as deny (fail-closed), matching P1AZ semantics.
- **Server test dir:** `demo_api_server/src/__tests__/`. Run a single server test with `npx jest --forceExit <pattern>` from `demo_api_server/`. UI tests use `npx vitest run <path>` from `demo_api_ui/`.
- **Doc grounding:** concept copy is grounded in <https://docs.pingidentity.com/pingone/authorization_using_pingone_authorize/p1az_introduction.html> and sibling pages.

---

### Task 1: Backend — `authorizeLearningDemos` module with trace builder + four demo handlers

**Files:**
- Create: `demo_api_server/services/authorizeLearningDemos.js`
- Test: `demo_api_server/src/__tests__/authorizeLearningDemos.test.js`

**Interfaces:**
- Produces:
  - `buildTrace({ policySet, rule, condition, effect, statements })` → returns a normalized trace object `{ policySet, rule, condition, effect, statements: Array<{type,detail}> }`.
  - `evaluateLearningDemo({ demoType, input })` → `Promise<{ demoType, decision, effect, obligations, statements, trace, raw, output? }>` where `decision ∈ {'PERMIT','DENY','INDETERMINATE'}`, `effect === decision`. Supported `demoType`: `'abac'`, `'indeterminate'`, `'payloadFilter'`, `'obligations'`. Unknown `demoType` throws `Error('unknown demoType: <x>')`.
  - `LEARNING_DEMO_TYPES` → `['abac','indeterminate','payloadFilter','obligations']`.

- [ ] **Step 1: Write the failing test**

```javascript
// demo_api_server/src/__tests__/authorizeLearningDemos.test.js
'use strict';
const demos = require('../../services/authorizeLearningDemos');

describe('authorizeLearningDemos', () => {
  test('exports the four demo types', () => {
    expect(demos.LEARNING_DEMO_TYPES).toEqual(['abac', 'indeterminate', 'payloadFilter', 'obligations']);
  });

  test('buildTrace normalizes a full trace', () => {
    const t = demos.buildTrace({
      policySet: 'Account Access', rule: 'Region match', condition: 'user.region == resource.region',
      effect: 'PERMIT', statements: [{ type: 'ADVICE', detail: 'logged' }],
    });
    expect(t).toEqual({
      policySet: 'Account Access', rule: 'Region match', condition: 'user.region == resource.region',
      effect: 'PERMIT', statements: [{ type: 'ADVICE', detail: 'logged' }],
    });
    expect(demos.buildTrace({ policySet: 'x', rule: 'y', condition: 'z', effect: 'DENY' }).statements).toEqual([]);
  });

  test('abac: matching region + manager role PERMITs, with trace', async () => {
    const r = await demos.evaluateLearningDemo({
      demoType: 'abac',
      input: { role: 'manager', userRegion: 'EU', resourceRegion: 'EU', action: 'read' },
    });
    expect(r.decision).toBe('PERMIT');
    expect(r.effect).toBe('PERMIT');
    expect(r.trace.rule).toMatch(/region/i);
    expect(r.trace.condition).toContain('EU');
  });

  test('abac: region mismatch DENYs', async () => {
    const r = await demos.evaluateLearningDemo({
      demoType: 'abac',
      input: { role: 'manager', userRegion: 'US', resourceRegion: 'EU', action: 'read' },
    });
    expect(r.decision).toBe('DENY');
    expect(r.trace.effect).toBe('DENY');
  });

  test('abac: clerk cannot write even in-region', async () => {
    const r = await demos.evaluateLearningDemo({
      demoType: 'abac',
      input: { role: 'clerk', userRegion: 'EU', resourceRegion: 'EU', action: 'write' },
    });
    expect(r.decision).toBe('DENY');
  });

  test('indeterminate: unresolved attribute fails closed', async () => {
    const r = await demos.evaluateLearningDemo({
      demoType: 'indeterminate',
      input: { attributeResolves: false },
    });
    expect(r.decision).toBe('INDETERMINATE');
    expect(r.effect).toBe('INDETERMINATE');
    expect(r.raw.failClosed).toBe(true);
  });

  test('indeterminate: resolved attribute PERMITs', async () => {
    const r = await demos.evaluateLearningDemo({
      demoType: 'indeterminate',
      input: { attributeResolves: true },
    });
    expect(r.decision).toBe('PERMIT');
  });

  test('payloadFilter: teller role redacts ssn and balance', async () => {
    const r = await demos.evaluateLearningDemo({
      demoType: 'payloadFilter',
      input: { role: 'teller', payload: { name: 'Ada', ssn: '123-45-6789', balance: 9000, accountId: 'a1' } },
    });
    expect(r.decision).toBe('PERMIT');
    expect(r.output.ssn).toBe('***-**-6789');
    expect(r.output.balance).toBeUndefined();
    expect(r.output.name).toBe('Ada');
    expect(r.statements.some((s) => s.type === 'FILTER')).toBe(true);
  });

  test('payloadFilter: auditor role sees full payload', async () => {
    const r = await demos.evaluateLearningDemo({
      demoType: 'payloadFilter',
      input: { role: 'auditor', payload: { name: 'Ada', ssn: '123-45-6789', balance: 9000, accountId: 'a1' } },
    });
    expect(r.output.ssn).toBe('123-45-6789');
    expect(r.output.balance).toBe(9000);
  });

  test('obligations: high-value read attaches audit-log advice + step-up obligation', async () => {
    const r = await demos.evaluateLearningDemo({
      demoType: 'obligations',
      input: { amount: 25000, acr: '' },
    });
    expect(r.decision).toBe('PERMIT');
    expect(r.obligations.some((o) => o.type === 'STEP_UP')).toBe(true);
    expect(r.statements.some((s) => s.type === 'ADVICE' && /audit/i.test(s.detail))).toBe(true);
  });

  test('obligations: satisfied MFA drops the step-up obligation', async () => {
    const r = await demos.evaluateLearningDemo({
      demoType: 'obligations',
      input: { amount: 25000, acr: 'Multi_Factor' },
    });
    expect(r.obligations.some((o) => o.type === 'STEP_UP')).toBe(false);
  });

  test('unknown demoType throws', async () => {
    await expect(demos.evaluateLearningDemo({ demoType: 'nope', input: {} })).rejects.toThrow(/unknown demoType/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && npx jest --forceExit authorizeLearningDemos`
Expected: FAIL — `Cannot find module '../../services/authorizeLearningDemos'`.

- [ ] **Step 3: Write minimal implementation**

```javascript
// demo_api_server/services/authorizeLearningDemos.js
'use strict';

/**
 * authorizeLearningDemos.js
 *
 * In-process, education-only demonstrations of PingOne Authorize (P1AZ) policy
 * capabilities that the amount-threshold transaction demo does not exercise:
 *   - abac          — attribute-based access control (user/resource/environment attrs)
 *   - indeterminate — unresolved attribute → INDETERMINATE → fail-closed deny
 *   - payloadFilter — a Statement that redacts/transforms an API payload by role
 *   - obligations   — obligations (STEP_UP) vs advice (audit-log) on a PERMIT
 *
 * These NEVER call PingOne and are wired ONLY to the /authz-test learning page.
 * Each handler returns a normalized shape including a policy-element `trace`
 * (policy set -> rule -> condition -> effect -> statements) so the UI can
 * annotate which element fired. Deny-by-default: unresolved inputs fail closed.
 *
 * @module services/authorizeLearningDemos
 */

const LEARNING_DEMO_TYPES = ['abac', 'indeterminate', 'payloadFilter', 'obligations'];

/** Normalize a policy-element decision trace for the annotated-result UI. */
function buildTrace({ policySet, rule, condition, effect, statements }) {
  return {
    policySet: policySet || '',
    rule: rule || '',
    condition: condition || '',
    effect: effect || 'INDETERMINATE',
    statements: Array.isArray(statements) ? statements : [],
  };
}

function acrLooksStrong(acr) {
  if (!acr) return false;
  const s = String(acr).toLowerCase();
  return s.includes('mfa') || s.includes('multi') || s.includes('fido') || s.includes('passkey');
}

// ── Demo: ABAC ───────────────────────────────────────────────────────────────
// Rule 1: user.region must equal resource.region (data residency).
// Rule 2: write actions require role == 'manager'. Combining algorithm: deny-overrides.
function evalAbac({ role, userRegion, resourceRegion, action }) {
  const wantsWrite = String(action || 'read').toLowerCase() === 'write';
  if (userRegion !== resourceRegion) {
    return {
      decision: 'DENY', effect: 'DENY', obligations: [], statements: [],
      trace: buildTrace({
        policySet: 'Account Access',
        rule: 'Data residency — region match',
        condition: `user.region (${userRegion}) == resource.region (${resourceRegion})`,
        effect: 'DENY',
      }),
      raw: { engine: 'simulated-learning', demoType: 'abac', reason: 'region_mismatch' },
    };
  }
  if (wantsWrite && String(role).toLowerCase() !== 'manager') {
    return {
      decision: 'DENY', effect: 'DENY', obligations: [], statements: [],
      trace: buildTrace({
        policySet: 'Account Access',
        rule: 'Privilege — write requires manager',
        condition: `action == write AND user.role (${role}) == manager`,
        effect: 'DENY',
      }),
      raw: { engine: 'simulated-learning', demoType: 'abac', reason: 'insufficient_role_for_write' },
    };
  }
  return {
    decision: 'PERMIT', effect: 'PERMIT', obligations: [], statements: [],
    trace: buildTrace({
      policySet: 'Account Access',
      rule: 'Data residency — region match',
      condition: `user.region (${userRegion}) == resource.region (${resourceRegion})`,
      effect: 'PERMIT',
    }),
    raw: { engine: 'simulated-learning', demoType: 'abac', reason: 'attributes_satisfied' },
  };
}

// ── Demo: INDETERMINATE / fail-closed ────────────────────────────────────────
function evalIndeterminate({ attributeResolves }) {
  if (attributeResolves === false) {
    return {
      decision: 'INDETERMINATE', effect: 'INDETERMINATE', obligations: [], statements: [],
      trace: buildTrace({
        policySet: 'Account Access',
        rule: 'Requires resolved risk attribute',
        condition: 'attribute "customer.riskTier" could not be resolved',
        effect: 'INDETERMINATE',
      }),
      raw: { engine: 'simulated-learning', demoType: 'indeterminate', failClosed: true,
        reason: 'Attribute could not be resolved by the Trust Framework service; P1AZ returns INDETERMINATE and the PEP must fail closed (treat as DENY).' },
    };
  }
  return {
    decision: 'PERMIT', effect: 'PERMIT', obligations: [], statements: [],
    trace: buildTrace({
      policySet: 'Account Access',
      rule: 'Requires resolved risk attribute',
      condition: 'attribute "customer.riskTier" resolved successfully',
      effect: 'PERMIT',
    }),
    raw: { engine: 'simulated-learning', demoType: 'indeterminate', failClosed: false, reason: 'attribute_resolved' },
  };
}

// ── Demo: Statement payload filtering ────────────────────────────────────────
// A Statement post-processes the PERMITted response: redact/drop fields by role.
const PAYLOAD_VISIBILITY = {
  auditor: { full: true },
  teller: { full: false },
};
function maskSsn(ssn) {
  const s = String(ssn);
  return s.length >= 4 ? `***-**-${s.slice(-4)}` : '****';
}
function evalPayloadFilter({ role, payload }) {
  const src = payload && typeof payload === 'object' ? payload : {};
  const vis = PAYLOAD_VISIBILITY[String(role).toLowerCase()] || PAYLOAD_VISIBILITY.teller;
  let output;
  let statements;
  if (vis.full) {
    output = { ...src };
    statements = [{ type: 'FILTER', detail: `Role "${role}" — no redaction; full payload returned.` }];
  } else {
    output = { ...src };
    if ('ssn' in output) output.ssn = maskSsn(output.ssn);
    if ('balance' in output) delete output.balance;
    statements = [{ type: 'FILTER', detail: `Role "${role}" — Statement redacts ssn and drops balance.` }];
  }
  return {
    decision: 'PERMIT', effect: 'PERMIT', obligations: [], statements, output,
    trace: buildTrace({
      policySet: 'Account Read',
      rule: 'Read permitted for authenticated staff',
      condition: 'user.authenticated == true',
      effect: 'PERMIT',
      statements,
    }),
    raw: { engine: 'simulated-learning', demoType: 'payloadFilter', role, reason: 'payload_filtered' },
  };
}

// ── Demo: Obligations vs advice ──────────────────────────────────────────────
// PERMIT with an audit-log ADVICE always; STEP_UP obligation when amount is high
// and MFA (acr) not already satisfied.
function evalObligations({ amount, acr }) {
  const amt = Number(amount) || 0;
  const stepUpThreshold = 10000;
  const statements = [{ type: 'ADVICE', detail: 'Write an audit-log record for this high-value read (advice — advisory, not enforced).' }];
  const obligations = [];
  if (amt >= stepUpThreshold && !acrLooksStrong(acr)) {
    obligations.push({ type: 'STEP_UP', detail: 'Obligation — step-up MFA required before the PEP may release the resource.' });
  }
  return {
    decision: 'PERMIT', effect: 'PERMIT', obligations, statements,
    trace: buildTrace({
      policySet: 'High-Value Read',
      rule: 'Permit with obligations above threshold',
      condition: `amount (${amt}) >= ${stepUpThreshold} AND NOT mfaSatisfied(acr)`,
      effect: 'PERMIT',
      statements: [...statements, ...obligations],
    }),
    raw: { engine: 'simulated-learning', demoType: 'obligations', amount: amt, acrStrong: acrLooksStrong(acr) },
  };
}

async function evaluateLearningDemo({ demoType, input }) {
  const i = input || {};
  switch (demoType) {
    case 'abac': return evalAbac(i);
    case 'indeterminate': return evalIndeterminate(i);
    case 'payloadFilter': return evalPayloadFilter(i);
    case 'obligations': return evalObligations(i);
    default: throw new Error(`unknown demoType: ${demoType}`);
  }
}

module.exports = { LEARNING_DEMO_TYPES, buildTrace, evaluateLearningDemo };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_server && npx jest --forceExit authorizeLearningDemos`
Expected: PASS (13 tests).

- [ ] **Step 5: Commit**

```bash
git branch --show-current   # must print worktree-p1az-learning-page
git add demo_api_server/services/authorizeLearningDemos.js demo_api_server/src/__tests__/authorizeLearningDemos.test.js
git commit -m "feat(p1az): learning-demo engine (abac, indeterminate, payload filter, obligations)"
```

---

### Task 2: Backend — route the `demoType` discriminator through `test-evaluate`

**Files:**
- Modify: `demo_api_server/routes/authorize.js` (top of the `POST /test-evaluate` handler, currently line 311)
- Test: `demo_api_server/src/__tests__/authorizeLearningRoute.test.js`

**Interfaces:**
- Consumes: `evaluateLearningDemo`, `LEARNING_DEMO_TYPES` from Task 1.
- Produces: `POST /api/authorize/test-evaluate` with body `{ demoType, input }` → `200 { ok:true, engine:'simulated-learning', demoType, decision, effect, obligations, statements, trace, output?, raw }`. When `demoType` is absent or `'transaction'`, the existing amount/type behavior is unchanged.

- [ ] **Step 1: Write the failing test**

```javascript
// demo_api_server/src/__tests__/authorizeLearningRoute.test.js
'use strict';
const request = require('supertest');
const express = require('express');

// Mount only the authorize router on a bare app (mirrors authorize-routes-admin.test.js pattern).
function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/authorize', require('../../routes/authorize'));
  return app;
}

describe('POST /api/authorize/test-evaluate — learning demoType routing', () => {
  const app = makeApp();

  test('demoType abac (permit) returns trace + effect', async () => {
    const res = await request(app).post('/api/authorize/test-evaluate').send({
      demoType: 'abac',
      input: { role: 'manager', userRegion: 'EU', resourceRegion: 'EU', action: 'read' },
    });
    expect(res.status).toBe(200);
    expect(res.body.engine).toBe('simulated-learning');
    expect(res.body.demoType).toBe('abac');
    expect(res.body.decision).toBe('PERMIT');
    expect(res.body.trace.rule).toMatch(/region/i);
  });

  test('demoType payloadFilter returns redacted output', async () => {
    const res = await request(app).post('/api/authorize/test-evaluate').send({
      demoType: 'payloadFilter',
      input: { role: 'teller', payload: { name: 'Ada', ssn: '123-45-6789', balance: 9000 } },
    });
    expect(res.status).toBe(200);
    expect(res.body.output.balance).toBeUndefined();
    expect(res.body.output.ssn).toBe('***-**-6789');
  });

  test('unknown demoType is a 400', async () => {
    const res = await request(app).post('/api/authorize/test-evaluate').send({ demoType: 'bogus', input: {} });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/demoType/);
  });

  test('no demoType still requires amount+type (existing contract preserved)', async () => {
    const res = await request(app).post('/api/authorize/test-evaluate').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/amount and type/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && npx jest --forceExit authorizeLearningRoute`
Expected: FAIL — abac request falls through to the `amount and type are required` 400 (learning branch not yet added).

- [ ] **Step 3: Write minimal implementation**

At the top of `require(...)` block in `demo_api_server/routes/authorize.js`, add the import (place beside the other service requires):

```javascript
const { evaluateLearningDemo, LEARNING_DEMO_TYPES } = require('../services/authorizeLearningDemos');
```

Then insert the learning branch as the FIRST statement inside the `router.post('/test-evaluate', ...)` handler, immediately after `const { amount, type, acr, userId: bodyUserId } = req.body || {};` (line 312) and BEFORE the `useCaseId`/`forceLive`/validation lines:

```javascript
  // Learning-page demos (abac / indeterminate / payloadFilter / obligations).
  // Routed by an explicit demoType discriminator; the default transaction path
  // (no demoType, or demoType === 'transaction') is untouched below.
  const demoType = req.body?.demoType;
  if (demoType && demoType !== 'transaction') {
    if (!LEARNING_DEMO_TYPES.includes(demoType)) {
      return res.status(400).json({ ok: false, error: `unknown demoType: ${demoType}` });
    }
    try {
      const d = await evaluateLearningDemo({ demoType, input: req.body?.input || {} });
      return res.json({
        ok: true,
        engine: 'simulated-learning',
        demoType,
        decision: d.decision,
        effect: d.effect,
        obligations: d.obligations || [],
        statements: d.statements || [],
        trace: d.trace,
        ...(d.output !== undefined ? { output: d.output } : {}),
        raw: d.raw,
      });
    } catch (err) {
      return res.status(400).json({ ok: false, error: err.message });
    }
  }
```

- [ ] **Step 4: Run tests to verify they pass (and no regression)**

Run: `cd demo_api_server && npx jest --forceExit authorizeLearningRoute`
Expected: PASS (4 tests).

Run the existing route regression: `cd demo_api_server && npx jest --forceExit authorize-routes-admin authorize-gate`
Expected: PASS (existing transaction/admin behavior unchanged).

- [ ] **Step 5: Commit**

```bash
git branch --show-current
git add demo_api_server/routes/authorize.js demo_api_server/src/__tests__/authorizeLearningRoute.test.js
git commit -m "feat(p1az): route demoType discriminator through test-evaluate"
```

---

### Task 3: Frontend — `AnnotatedResult` component (policy-element trace + raw JSON)

**Files:**
- Create: `demo_api_ui/src/components/authz/AnnotatedResult.jsx`
- Test: `demo_api_ui/src/components/authz/AnnotatedResult.test.jsx`

**Interfaces:**
- Produces: `default export AnnotatedResult({ result })` where `result` is the `test-evaluate` response body (`{ decision, effect, trace, obligations, statements, output?, raw, pingoneRequest?, pingoneResponse? }`) or `null`. Renders nothing when `result` is falsy.

- [ ] **Step 1: Write the failing test**

```jsx
// demo_api_ui/src/components/authz/AnnotatedResult.test.jsx
import { render, screen } from '@testing-library/react';
import { describe, test, expect } from 'vitest';
import AnnotatedResult from './AnnotatedResult';

describe('AnnotatedResult', () => {
  test('renders nothing when result is null', () => {
    const { container } = render(<AnnotatedResult result={null} />);
    expect(container.firstChild).toBeNull();
  });

  test('renders decision badge and the policy-element trace', () => {
    render(<AnnotatedResult result={{
      decision: 'PERMIT', effect: 'PERMIT',
      trace: { policySet: 'Account Access', rule: 'Region match', condition: 'user.region == EU', effect: 'PERMIT', statements: [{ type: 'ADVICE', detail: 'logged' }] },
      obligations: [], statements: [{ type: 'ADVICE', detail: 'logged' }], raw: { engine: 'simulated-learning' },
    }} />);
    expect(screen.getByText('PERMIT')).toBeInTheDocument();
    expect(screen.getByText('Account Access')).toBeInTheDocument();
    expect(screen.getByText('Region match')).toBeInTheDocument();
    expect(screen.getByText(/user\.region == EU/)).toBeInTheDocument();
  });

  test('renders filtered output when present', () => {
    render(<AnnotatedResult result={{
      decision: 'PERMIT', effect: 'PERMIT',
      trace: { policySet: 'x', rule: 'y', condition: 'z', effect: 'PERMIT', statements: [] },
      obligations: [], statements: [], output: { name: 'Ada', ssn: '***-**-6789' }, raw: {},
    }} />);
    expect(screen.getByText(/Filtered payload/i)).toBeInTheDocument();
    expect(screen.getByText(/\*\*\*-\*\*-6789/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_ui && npx vitest run src/components/authz/AnnotatedResult.test.jsx`
Expected: FAIL — cannot resolve `./AnnotatedResult`.

- [ ] **Step 3: Write minimal implementation**

```jsx
// demo_api_ui/src/components/authz/AnnotatedResult.jsx
import "./AnnotatedResult.css";

const BADGE_CLASS = {
  PERMIT: "ar-badge ar-permit",
  DENY: "ar-badge ar-deny",
  INDETERMINATE: "ar-badge ar-indeterminate",
};

function StatementList({ items, title }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="ar-statements">
      <div className="ar-statements-title">{title}</div>
      <ul>
        {items.map((s, idx) => (
          <li key={`${s.type}-${idx}`}>
            <span className="ar-stmt-type">{s.type}</span> — {s.detail}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function AnnotatedResult({ result }) {
  if (!result) return null;
  const decision = result.decision || result.effect || "INDETERMINATE";
  const trace = result.trace || {};
  return (
    <div className="annotated-result">
      <div className="ar-header">
        <span className={BADGE_CLASS[decision] || "ar-badge"}>{decision}</span>
        {result.engine ? <span className="ar-engine">engine: {result.engine}</span> : null}
      </div>

      <div className="ar-trace">
        <div className="ar-trace-row"><span className="ar-k">Policy set</span><span className="ar-v">{trace.policySet}</span></div>
        <div className="ar-trace-row"><span className="ar-k">Rule</span><span className="ar-v">{trace.rule}</span></div>
        <div className="ar-trace-row"><span className="ar-k">Condition</span><span className="ar-v ar-mono">{trace.condition}</span></div>
        <div className="ar-trace-row"><span className="ar-k">Effect</span><span className="ar-v">{trace.effect || decision}</span></div>
      </div>

      <StatementList items={result.obligations} title="Obligations (enforced)" />
      <StatementList items={result.statements} title="Statements / advice" />

      {result.output !== undefined ? (
        <div className="ar-output">
          <div className="ar-statements-title">Filtered payload</div>
          <pre className="ar-mono">{JSON.stringify(result.output, null, 2)}</pre>
        </div>
      ) : null}

      <details className="ar-raw">
        <summary>Raw decision JSON</summary>
        <pre className="ar-mono">{JSON.stringify(
          { raw: result.raw, pingoneRequest: result.pingoneRequest, pingoneResponse: result.pingoneResponse },
          null, 2,
        )}</pre>
      </details>
    </div>
  );
}
```

Create `demo_api_ui/src/components/authz/AnnotatedResult.css` with minimal styles reusing existing tokens:

```css
.annotated-result { border: 1px solid var(--border, #d0d5dd); border-radius: 8px; padding: 12px; margin-top: 12px; }
.ar-header { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; }
.ar-badge { font-weight: 700; padding: 2px 10px; border-radius: 999px; font-size: 12px; }
.ar-permit { background: #e7f6ec; color: #087443; }
.ar-deny { background: #fdeceb; color: #b42318; }
.ar-indeterminate { background: #fef6e7; color: #b54708; }
.ar-engine { color: #667085; font-size: 12px; }
.ar-trace { display: grid; gap: 4px; margin-bottom: 8px; }
.ar-trace-row { display: grid; grid-template-columns: 100px 1fr; gap: 8px; font-size: 13px; }
.ar-k { color: #667085; font-weight: 600; }
.ar-mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; }
.ar-statements { margin: 6px 0; }
.ar-statements-title { font-weight: 600; font-size: 12px; color: #344054; margin-bottom: 2px; }
.ar-stmt-type { font-weight: 700; }
.ar-raw summary { cursor: pointer; color: #667085; font-size: 12px; }
.ar-output pre, .ar-raw pre { background: #f9fafb; padding: 8px; border-radius: 6px; overflow: auto; font-size: 12px; }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_ui && npx vitest run src/components/authz/AnnotatedResult.test.jsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git branch --show-current
git add demo_api_ui/src/components/authz/AnnotatedResult.jsx demo_api_ui/src/components/authz/AnnotatedResult.css demo_api_ui/src/components/authz/AnnotatedResult.test.jsx
git commit -m "feat(p1az): AnnotatedResult component for policy-element trace"
```

---

### Task 4: Frontend — `DemoSection` collapsible container

**Files:**
- Create: `demo_api_ui/src/components/authz/DemoSection.jsx`
- Test: `demo_api_ui/src/components/authz/DemoSection.test.jsx`

**Interfaces:**
- Produces: `default export DemoSection({ id, number, title, concept, docHref, open, onToggle, children })`. Renders a collapsible section: a header button (calls `onToggle(id)` on click) and, when `open` is true, the concept panel (`concept` string), a "Learn more" link to `docHref`, and `children` (the demo form + result). When `open` is false, body is not rendered.

- [ ] **Step 1: Write the failing test**

```jsx
// demo_api_ui/src/components/authz/DemoSection.test.jsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, test, expect, vi } from 'vitest';
import DemoSection from './DemoSection';

const base = { id: 'abac', number: 4, title: 'Attributes & ABAC', concept: 'ABAC uses attributes.', docHref: 'https://docs.pingidentity.com/x' };

describe('DemoSection', () => {
  test('collapsed: shows title, hides body', () => {
    render(<DemoSection {...base} open={false} onToggle={() => {}}><div>DEMO_BODY</div></DemoSection>);
    expect(screen.getByText(/Attributes & ABAC/)).toBeInTheDocument();
    expect(screen.queryByText('DEMO_BODY')).toBeNull();
  });

  test('open: shows concept, learn-more link, and children', () => {
    render(<DemoSection {...base} open onToggle={() => {}}><div>DEMO_BODY</div></DemoSection>);
    expect(screen.getByText('ABAC uses attributes.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /learn more/i })).toHaveAttribute('href', base.docHref);
    expect(screen.getByText('DEMO_BODY')).toBeInTheDocument();
  });

  test('clicking header calls onToggle with id', () => {
    const onToggle = vi.fn();
    render(<DemoSection {...base} open={false} onToggle={onToggle}><div /></DemoSection>);
    fireEvent.click(screen.getByRole('button', { name: /Attributes & ABAC/ }));
    expect(onToggle).toHaveBeenCalledWith('abac');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_ui && npx vitest run src/components/authz/DemoSection.test.jsx`
Expected: FAIL — cannot resolve `./DemoSection`.

- [ ] **Step 3: Write minimal implementation**

```jsx
// demo_api_ui/src/components/authz/DemoSection.jsx
import "./DemoSection.css";

export default function DemoSection({ id, number, title, concept, docHref, open, onToggle, children }) {
  return (
    <section className={`demo-section${open ? " is-open" : ""}`}>
      <button
        type="button"
        className="demo-section-header"
        aria-expanded={open}
        onClick={() => onToggle(id)}
      >
        <span className="demo-section-num">{number}</span>
        <span className="demo-section-title">{title}</span>
        <span className="demo-section-chevron" aria-hidden="true">{open ? "▾" : "▸"}</span>
      </button>
      {open ? (
        <div className="demo-section-body">
          <p className="demo-section-concept">{concept}</p>
          {docHref ? (
            <a className="demo-section-doc" href={docHref} target="_blank" rel="noreferrer">
              Learn more ↗
            </a>
          ) : null}
          <div className="demo-section-demo">{children}</div>
        </div>
      ) : null}
    </section>
  );
}
```

Create `demo_api_ui/src/components/authz/DemoSection.css`:

```css
.demo-section { border: 1px solid var(--border, #d0d5dd); border-radius: 10px; margin-bottom: 12px; overflow: hidden; }
.demo-section-header { width: 100%; display: flex; align-items: center; gap: 12px; padding: 14px 16px; background: #f9fafb; border: 0; cursor: pointer; text-align: left; font-size: 15px; }
.demo-section.is-open .demo-section-header { background: #eef2ff; }
.demo-section-num { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 999px; background: #4338ca; color: #fff; font-size: 12px; font-weight: 700; }
.demo-section-title { font-weight: 600; flex: 1; }
.demo-section-chevron { color: #667085; }
.demo-section-body { padding: 16px; }
.demo-section-concept { margin: 0 0 8px; color: #344054; line-height: 1.5; }
.demo-section-doc { font-size: 13px; }
.demo-section-demo { margin-top: 12px; }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_ui && npx vitest run src/components/authz/DemoSection.test.jsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git branch --show-current
git add demo_api_ui/src/components/authz/DemoSection.jsx demo_api_ui/src/components/authz/DemoSection.css demo_api_ui/src/components/authz/DemoSection.test.jsx
git commit -m "feat(p1az): DemoSection collapsible container"
```

---

### Task 5: Frontend — section registry + demo runner hook

**Files:**
- Create: `demo_api_ui/src/components/authz/authzSections.js`
- Create: `demo_api_ui/src/components/authz/useDemoRunner.js`
- Test: `demo_api_ui/src/components/authz/authzSections.test.js`

**Interfaces:**
- Consumes: `apiClient` from `../../services/apiClient` (already used by AuthzTestPage: `apiClient.post(url, body)` returns `{ data }`).
- Produces:
  - `AUTHZ_SECTIONS` → ordered array of `{ id, number, title, concept, docHref, demoType | 'transaction', fields }`, where `fields` describes the demo form. Exactly 7 entries, numbered 1–7.
  - `useDemoRunner()` → `{ result, loading, error, run }`, where `run({ demoType, input, transaction })` POSTs to `/api/authorize/test-evaluate` and stores the response in `result`. For `demoType === 'transaction'` it sends `{ amount, type, acr }` from `transaction`; otherwise `{ demoType, input }`.

- [ ] **Step 1: Write the failing test**

```javascript
// demo_api_ui/src/components/authz/authzSections.test.js
import { describe, test, expect } from 'vitest';
import { AUTHZ_SECTIONS } from './authzSections';

describe('AUTHZ_SECTIONS', () => {
  test('has 7 sections numbered 1..7', () => {
    expect(AUTHZ_SECTIONS).toHaveLength(7);
    expect(AUTHZ_SECTIONS.map((s) => s.number)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  test('every section has id, title, concept, and a pingidentity doc link', () => {
    for (const s of AUTHZ_SECTIONS) {
      expect(s.id).toBeTruthy();
      expect(s.title).toBeTruthy();
      expect(s.concept.length).toBeGreaterThan(20);
      expect(s.docHref).toMatch(/docs\.pingidentity\.com/);
    }
  });

  test('interactive sections reference a known demoType or transaction', () => {
    const known = ['transaction', 'abac', 'indeterminate', 'payloadFilter', 'obligations', null];
    for (const s of AUTHZ_SECTIONS) {
      expect(known).toContain(s.demoType ?? null);
    }
    // The 4 new demoTypes are each present exactly once.
    const types = AUTHZ_SECTIONS.map((s) => s.demoType);
    for (const t of ['abac', 'indeterminate', 'payloadFilter', 'obligations']) {
      expect(types.filter((x) => x === t)).toHaveLength(1);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_ui && npx vitest run src/components/authz/authzSections.test.js`
Expected: FAIL — cannot resolve `./authzSections`.

- [ ] **Step 3: Write minimal implementation**

```javascript
// demo_api_ui/src/components/authz/authzSections.js
const DOC = "https://docs.pingidentity.com/pingone/authorization_using_pingone_authorize";

/**
 * Ordered learning sections for the P1AZ learning page. `demoType` selects the
 * backend path: 'transaction' reuses the existing amount/type engine; the four
 * others hit authorizeLearningDemos via the test-evaluate discriminator.
 * `demoType: null` sections are explainer-only (no runnable form).
 * `fields` drives the demo form in AuthzTestPage (rendered generically).
 */
export const AUTHZ_SECTIONS = [
  {
    id: "overview", number: 1, title: "Overview & Trust Framework",
    concept:
      "PingOne Authorize is a policy decision point (PDP): your app (the PEP) asks it 'may this subject do this action on this resource?' and it answers from centrally-managed policies. Inputs come from the Trust Framework — attributes and services (data resolvers) — so decisions are attribute-based (ABAC), not hard-coded in app code.",
    docHref: `${DOC}/p1az_introduction.html`,
    demoType: null, fields: [],
  },
  {
    id: "policies", number: 2, title: "Policies, Policy Sets & Combining Algorithms",
    concept:
      "Policies live in a hierarchical tree of policy sets. Each policy holds rules; a combining algorithm (e.g. deny-overrides) reduces the rules' effects to one decision. This demo runs the Super Banking transaction policy so you can watch amount thresholds resolve to PERMIT / STEP_UP / DENY.",
    docHref: `${DOC}/p1az_policies.html`,
    demoType: "transaction",
    fields: [
      { name: "amount", label: "Amount (USD)", type: "number", default: 1000 },
      { name: "type", label: "Transaction type", type: "select", options: ["transfer", "withdrawal", "deposit"], default: "transfer" },
      { name: "acr", label: "ACR (e.g. Multi_Factor)", type: "text", default: "" },
    ],
  },
  {
    id: "effects", number: 3, title: "Rules, Conditions & Effects",
    concept:
      "A rule's condition compares attributes and evaluates true/false, producing an effect: PERMIT, DENY, or INDETERMINATE. INDETERMINATE means the policy could not be evaluated (e.g. an attribute would not resolve) — a PEP must treat it as DENY (fail closed). Toggle whether the risk attribute resolves to see it.",
    docHref: `${DOC}/p1az_conditions.html`,
    demoType: "indeterminate",
    fields: [
      { name: "attributeResolves", label: "Risk attribute resolves?", type: "select", options: ["true", "false"], default: "true", coerce: "boolean" },
    ],
  },
  {
    id: "abac", number: 4, title: "Attributes & ABAC",
    concept:
      "The same request yields different decisions based on attributes, not just amount. Here a data-residency rule requires user.region == resource.region, and write actions require a manager role. Change the attributes and watch which rule fires.",
    docHref: `${DOC}/p1az_introduction.html`,
    demoType: "abac",
    fields: [
      { name: "role", label: "User role", type: "select", options: ["manager", "clerk"], default: "manager" },
      { name: "userRegion", label: "User region", type: "select", options: ["EU", "US"], default: "EU" },
      { name: "resourceRegion", label: "Resource region", type: "select", options: ["EU", "US"], default: "EU" },
      { name: "action", label: "Action", type: "select", options: ["read", "write"], default: "read" },
    ],
  },
  {
    id: "obligations", number: 5, title: "Statements: Obligations & Advice",
    concept:
      "A decision can carry statements. An obligation MUST be enforced by the PEP (e.g. STEP_UP: perform MFA before releasing the resource); advice is advisory (e.g. write an audit-log record). A high-value read PERMITs but attaches a step-up obligation unless MFA is already satisfied.",
    docHref: `${DOC}/p1az_policies.html`,
    demoType: "obligations",
    fields: [
      { name: "amount", label: "Amount (USD)", type: "number", default: 25000 },
      { name: "acr", label: "ACR (blank = no MFA)", type: "text", default: "" },
    ],
  },
  {
    id: "payload", number: 6, title: "Statements: Payload Filtering",
    concept:
      "Statements can transform the API payload on a PERMIT — redacting or dropping fields by attribute. A teller sees a masked SSN and no balance; an auditor sees the full record. The decision is PERMIT in both cases; the difference is the returned data.",
    docHref: `${DOC}/p1az_policies.html`,
    demoType: "payloadFilter",
    fields: [
      { name: "role", label: "Caller role", type: "select", options: ["teller", "auditor"], default: "teller" },
    ],
    // Fixed sample payload injected by the runner; not user-edited in v1.
    fixedInput: { payload: { name: "Ada Lovelace", ssn: "123-45-6789", balance: 9000, accountId: "acct-001" } },
  },
  {
    id: "apiaccess", number: 7, title: "API Access Management",
    concept:
      "Beyond raw decision calls, P1AZ can govern which API operations a token may invoke (scope/operation-level authorization). In this demo the environment's scope topology maps a caller to the tools/operations it is permitted — the same least-privilege model the banking agent enforces at runtime.",
    docHref: `${DOC}/p1az_introduction.html`,
    demoType: null, fields: [],
  },
];
```

```javascript
// demo_api_ui/src/components/authz/useDemoRunner.js
import { useCallback, useState } from "react";
import apiClient from "../../services/apiClient";

/**
 * Runs a learning-page demo against POST /api/authorize/test-evaluate.
 * transaction demos send { amount, type, acr }; others send { demoType, input }.
 */
export function useDemoRunner() {
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const run = useCallback(async ({ demoType, input, transaction }) => {
    setLoading(true);
    setError(null);
    try {
      const body =
        demoType === "transaction"
          ? { amount: transaction.amount, type: transaction.type, acr: transaction.acr || undefined }
          : { demoType, input: input || {} };
      const { data } = await apiClient.post("/api/authorize/test-evaluate", body);
      setResult(data);
      return data;
    } catch (err) {
      const msg = err?.response?.data?.error || err?.message || "Evaluation failed";
      setError(msg);
      setResult(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  return { result, loading, error, run };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_ui && npx vitest run src/components/authz/authzSections.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git branch --show-current
git add demo_api_ui/src/components/authz/authzSections.js demo_api_ui/src/components/authz/useDemoRunner.js demo_api_ui/src/components/authz/authzSections.test.js
git commit -m "feat(p1az): section registry + demo runner hook"
```

---

### Task 6: Frontend — render the 7 collapsible sections in `AuthzTestPage`

**Files:**
- Modify: `demo_api_ui/src/components/AuthzTestPage.jsx`
- Create: `demo_api_ui/src/components/authz/DemoForm.jsx` (generic field renderer)
- Test: `demo_api_ui/src/components/authz/DemoForm.test.jsx`
- Test: `demo_api_ui/src/components/AuthzTestPage.sections.test.jsx`

**Interfaces:**
- Consumes: `AUTHZ_SECTIONS`, `useDemoRunner` (Task 5); `DemoSection` (Task 4); `AnnotatedResult` (Task 3).
- Produces: `default export DemoForm({ fields, values, onChange })` — renders one input per field (`number`/`text`/`select`), calling `onChange(name, value)`. AuthzTestPage renders a `<DemoSection>` per registry entry with a `<DemoForm>` + Run button + `<AnnotatedResult>` inside; existing engine banner, settings panel, and run-history table are preserved above/below the sections.

- [ ] **Step 1: Write the failing test (DemoForm)**

```jsx
// demo_api_ui/src/components/authz/DemoForm.test.jsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, test, expect, vi } from 'vitest';
import DemoForm from './DemoForm';

const fields = [
  { name: 'amount', label: 'Amount (USD)', type: 'number', default: 1000 },
  { name: 'type', label: 'Transaction type', type: 'select', options: ['transfer', 'deposit'], default: 'transfer' },
];

describe('DemoForm', () => {
  test('renders a control per field', () => {
    render(<DemoForm fields={fields} values={{ amount: 1000, type: 'transfer' }} onChange={() => {}} />);
    expect(screen.getByLabelText('Amount (USD)')).toBeInTheDocument();
    expect(screen.getByLabelText('Transaction type')).toBeInTheDocument();
  });

  test('calls onChange with name and value', () => {
    const onChange = vi.fn();
    render(<DemoForm fields={fields} values={{ amount: 1000, type: 'transfer' }} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Amount (USD)'), { target: { value: '5000' } });
    expect(onChange).toHaveBeenCalledWith('amount', '5000');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_ui && npx vitest run src/components/authz/DemoForm.test.jsx`
Expected: FAIL — cannot resolve `./DemoForm`.

- [ ] **Step 3: Write `DemoForm` implementation**

```jsx
// demo_api_ui/src/components/authz/DemoForm.jsx
export default function DemoForm({ fields, values, onChange }) {
  if (!fields || fields.length === 0) return null;
  return (
    <div className="demo-form">
      {fields.map((f) => {
        const id = `df-${f.name}`;
        const value = values[f.name] ?? f.default ?? "";
        return (
          <div className="demo-form-row" key={f.name}>
            <label htmlFor={id}>{f.label}</label>
            {f.type === "select" ? (
              <select id={id} value={value} onChange={(e) => onChange(f.name, e.target.value)}>
                {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : (
              <input id={id} type={f.type === "number" ? "number" : "text"} value={value}
                onChange={(e) => onChange(f.name, e.target.value)} />
            )}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_ui && npx vitest run src/components/authz/DemoForm.test.jsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Wire sections into AuthzTestPage**

In `demo_api_ui/src/components/AuthzTestPage.jsx`:

1. Add imports near the existing ones (after line 7):

```jsx
import DemoSection from "./authz/DemoSection";
import DemoForm from "./authz/DemoForm";
import AnnotatedResult from "./authz/AnnotatedResult";
import { AUTHZ_SECTIONS } from "./authz/authzSections";
import { useDemoRunner } from "./authz/useDemoRunner";
```

2. Add a self-contained child component at the bottom of the file (before the default export of the page, or as a named function in the same module) that owns one section's form state, so each section runs independently:

```jsx
function LearningSection({ section, open, onToggle }) {
  const { result, loading, error, run } = useDemoRunner();
  const initial = {};
  for (const f of section.fields) initial[f.name] = f.default;
  const [values, setValues] = useState(initial);
  const onChange = (name, value) => setValues((v) => ({ ...v, [name]: value }));

  const runnable = section.demoType != null;
  const onRun = () => {
    if (section.demoType === "transaction") {
      run({ demoType: "transaction", transaction: values });
    } else {
      // coerce booleans declared in the registry; merge any fixedInput
      const input = { ...(section.fixedInput || {}) };
      for (const f of section.fields) {
        const raw = values[f.name];
        input[f.name] = f.coerce === "boolean" ? raw === "true" : (f.type === "number" ? Number(raw) : raw);
      }
      run({ demoType: section.demoType, input });
    }
  };

  return (
    <DemoSection id={section.id} number={section.number} title={section.title}
      concept={section.concept} docHref={section.docHref} open={open} onToggle={onToggle}>
      {runnable ? (
        <>
          <DemoForm fields={section.fields} values={values} onChange={onChange} />
          <button type="button" className="btn btn-primary" onClick={onRun} disabled={loading}>
            {loading ? "Evaluating…" : "Evaluate"}
          </button>
          {error ? <div className="authz-error">{error}</div> : null}
          <AnnotatedResult result={result} />
        </>
      ) : (
        <p className="demo-section-note">Explainer section — see “Learn more” for the full documentation.</p>
      )}
    </DemoSection>
  );
}
```

3. Inside the page component's render, add section state and render the list. Add near the top of the component body:

```jsx
  const [openSection, setOpenSection] = useState("overview");
  const toggleSection = useCallback((id) => {
    setOpenSection((cur) => (cur === id ? null : id));
  }, []);
```

Then, in the returned JSX, insert the learning sections block directly below the existing Engine Status banner and ABOVE the preset/custom-eval blocks (keep those blocks — they remain the Section 2 transaction playground, or move the presets inside Section 2 in a later pass). Minimal insertion:

```jsx
      <div className="authz-learning-sections">
        <h2 className="authz-learning-heading">Learn PingOne Authorize</h2>
        {AUTHZ_SECTIONS.map((s) => (
          <LearningSection key={s.id} section={s} open={openSection === s.id} onToggle={toggleSection} />
        ))}
      </div>
```

- [ ] **Step 6: Write the sections smoke test**

```jsx
// demo_api_ui/src/components/AuthzTestPage.sections.test.jsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, test, expect, vi, beforeEach } from 'vitest';

// apiClient is called on mount by the page; stub it so the test is deterministic.
vi.mock('../services/apiClient', () => ({
  default: {
    get: vi.fn().mockResolvedValue({ data: { activeEngine: 'simulated', thresholds: { simulated: {}, pingone: {} } } }),
    post: vi.fn().mockResolvedValue({ data: {
      ok: true, engine: 'simulated-learning', demoType: 'abac', decision: 'PERMIT', effect: 'PERMIT',
      obligations: [], statements: [], trace: { policySet: 'Account Access', rule: 'Region match', condition: 'EU==EU', effect: 'PERMIT', statements: [] }, raw: {},
    } }),
  },
}));

import apiClient from '../services/apiClient';
import AuthzTestPage from './AuthzTestPage';

describe('AuthzTestPage learning sections', () => {
  beforeEach(() => { apiClient.post.mockClear(); });

  test('renders all 7 section headers', () => {
    render(<AuthzTestPage />);
    expect(screen.getByText(/Overview & Trust Framework/)).toBeInTheDocument();
    expect(screen.getByText(/Attributes & ABAC/)).toBeInTheDocument();
    expect(screen.getByText(/API Access Management/)).toBeInTheDocument();
  });

  test('opening ABAC and evaluating posts to test-evaluate and shows a decision', async () => {
    render(<AuthzTestPage />);
    fireEvent.click(screen.getByRole('button', { name: /Attributes & ABAC/ }));
    fireEvent.click(screen.getByRole('button', { name: /Evaluate/i }));
    expect(await screen.findByText('PERMIT')).toBeInTheDocument();
    const postCalls = apiClient.post.mock.calls.filter((c) => c[0] === '/api/authorize/test-evaluate');
    expect(postCalls.length).toBeGreaterThan(0);
    expect(postCalls[postCalls.length - 1][1].demoType).toBe('abac');
  });
});
```

- [ ] **Step 7: Run the section tests**

Run: `cd demo_api_ui && npx vitest run src/components/AuthzTestPage.sections.test.jsx`
Expected: PASS (2 tests). If the page's mount effect calls additional endpoints, extend the `apiClient.get` mock to return benign shapes — do not change page logic to satisfy the test.

- [ ] **Step 8: Full suite sanity + commit**

Run: `cd demo_api_ui && npx vitest run src/components/authz`
Expected: PASS (all authz component tests).

```bash
git branch --show-current
git add demo_api_ui/src/components/authz/DemoForm.jsx demo_api_ui/src/components/authz/DemoForm.test.jsx demo_api_ui/src/components/AuthzTestPage.jsx demo_api_ui/src/components/AuthzTestPage.sections.test.jsx
git commit -m "feat(p1az): render 7 collapsible learning sections on /authz-test"
```

---

### Task 7: Verify end-to-end in the running app

**Files:** none (verification only)

- [ ] **Step 1: Server unit suite (no regression)**

Run: `cd demo_api_server && npx jest --forceExit authorizeLearningDemos authorizeLearningRoute authorize-routes-admin authorize-gate simulatedAuthorizeService`
Expected: PASS. Confirms the new engine + route pass and the existing transaction/simulated behavior is unchanged.

- [ ] **Step 2: UI suite**

Run: `cd demo_api_ui && npx vitest run src/components/authz src/components/AuthzTestPage.sections.test.jsx`
Expected: PASS.

- [ ] **Step 3: Manual smoke (per project run skill)**

Follow the project's app-run path (Docker per memory: `./run-docker.sh`). Navigate to `/authz-test`. Confirm:
  - All 7 sections render collapsed with `Overview` open by default; clicking a header expands one at a time.
  - Section 4 (ABAC): region mismatch → DENY with the residency rule in the trace; manager+EU read → PERMIT.
  - Section 3 (Effects): attribute-resolves=false → INDETERMINATE badge, fail-closed note in raw.
  - Section 6 (Payload): teller → SSN masked, balance dropped; auditor → full payload.
  - Section 5 (Obligations): $25,000 blank ACR → PERMIT + STEP_UP obligation + audit-log advice; ACR `Multi_Factor` → no STEP_UP.
  - Existing engine banner + run-history still render and the live PingOne toggle path is unaffected.

- [ ] **Step 4: Record verification result**

Note pass/fail per section in the PR description. If any section fails, fix in the owning task's file(s) and re-run that task's tests before re-verifying.

---

## Self-Review

**Spec coverage:**
- 7 sections (spec table) → Task 5 registry (7 entries) + Task 6 render. ✅
- Concept panel + runnable demo + annotated result per section → Tasks 3, 4, 6. ✅
- 4 new capabilities (ABAC, INDETERMINATE, payload filter, obligations) → Task 1 handlers + Task 5 wiring. ✅
- Extend single `test-evaluate` with demoType discriminator (locked decision) → Task 2. ✅
- Collapsible sections (locked decision) → Task 4 `DemoSection` + Task 6 one-open-at-a-time state. ✅
- Hybrid live/simulated: transaction section keeps the existing live path; new demos are simulated-only by design (live P1AZ policies are stretch/out-of-scope per spec) → preserved in Task 6 (existing chrome untouched). ✅
- No regression to existing transaction path → Task 2 branch is additive + Task 7 Step 1 regression run. ✅
- Deny-by-default / INDETERMINATE fail-closed → Task 1 `evalIndeterminate`. ✅

**Placeholder scan:** No TBD/TODO; every code step has complete code. The one intentional simplification (Section 6 uses a fixed sample payload, not a user-edited one) is stated explicitly in the registry comment and is within scope.

**Type consistency:** `evaluateLearningDemo({demoType,input})` return shape (`decision/effect/obligations/statements/trace/output?/raw`) is produced in Task 1, surfaced unchanged by the Task 2 route, and consumed field-for-field by `AnnotatedResult` (Task 3) and the section tests. `useDemoRunner.run({demoType,input,transaction})` (Task 5) matches the call sites in `LearningSection` (Task 6). `DemoSection` prop names (`id,number,title,concept,docHref,open,onToggle`) match Task 4 definition and Task 6 usage. Section 7 `apiaccess` and Section 1 `overview` are `demoType:null` explainer-only — consistent with the `known` list in the Task 5 test.

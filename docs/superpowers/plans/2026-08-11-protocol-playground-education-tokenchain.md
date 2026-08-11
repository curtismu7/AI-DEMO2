# Protocol Playground — Token-Chain Activity, Education, Step Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Activity panel's raw JSON dump with Token-Chain-styled
event cards, populate the already-built (but unused) `ProtocolExplainer`
with real per-protocol descriptions and RFC citations, and add per-step
cards (title, description, actor chips, own Execute button) additive to
the existing Execute All / Next Step / Reset controls.

**Architecture:** Two new JSDoc tags (`@rfc`, `@title`) plus automatic
capture of each route's existing leading doc-comment prose extend the
`generateProtocolFlows.js` introspector — zero new content authoring for
descriptions, since that prose already exists in every route file. Two new
small presentational components (`TokenChainEventCard`, `StepCard`) plus one
pure data-shaping helper (`buildChainEvents`) render the richer UI; no
existing component's public props change in a breaking way.

**Tech Stack:** Node >=22 CommonJS (generator), React 19.2 + Vite 8 + Vitest
(UI), plain JS/JSX — no TypeScript.

## Global Constraints

- Node >= 22 everywhere. BFF is CommonJS (`'use strict'` + `require`), not ESM.
- UI is plain JS/JSX — no TypeScript sources. Vitest for unit (not jest).
- Emoji allowlist only: `⚠️` `✅` `❌` `🔐` `✕` `✓` `👤` `🔑` `🪟` `📚`.
- Work in the git worktree at
  `/Users/cmuir/Development/AI-DEMO2/.claude/worktrees/protocol-playground-education`
  on branch `worktree-protocol-playground-education`. Stage files explicitly
  (never `git add -A` — running the full jest suite regenerates hundreds of
  unrelated `data/step-verification/*.json` files as a side effect).
- Never hand-edit `demo_api_ui/src/data/protocolFlows.json` — always
  regenerate via `cd demo_api_server && node scripts/generateProtocolFlows.js`.
- Verify before claiming done: `cd demo_api_server && CI=true npm test --
  --forceExit --maxWorkers=4`; `cd demo_api_ui && npm run test:unit && npm
  run build`.

---

## Task 1: Introspector — `@rfc` / `@title` tags + prose capture

**Files:**
- Modify: `demo_api_server/scripts/generateProtocolFlows.js`
- Test: `demo_api_server/tests/generateProtocolFlows.test.js` (new)

**Interfaces:**
- Produces: `parseFlowAnnotation(jsdocComment)` now also returns
  `{ rfcUrl, rfcLabel, title, description }` alongside the existing
  `{ flowId, displayName, actor, toActor, step, expects, body, branches }`.
- Produces: `buildFlowSpecs(routes)` output flow objects now carry
  `flow.spec = { url, label, title, why }` (only when the flow's primary
  annotation has `@rfc`) and `flow.description` is the real captured prose
  instead of the placeholder `"Protocol flow: <id>"`. Each step object
  gains `step.title` (falls back to the existing `step.label` when no
  `@title` was given) and `step.description` (the step's own captured
  prose, or `null`).

- [ ] **Step 1: Write the failing tests**

Create `demo_api_server/tests/generateProtocolFlows.test.js`:

```javascript
'use strict';

const path = require('path');
const scriptPath = path.join(__dirname, '../scripts/generateProtocolFlows.js');

// generateProtocolFlows.js only exports `main` (it scans the real routes/
// dir). Requiring internals directly isn't possible without changing the
// module's exports, so this test suite requires the exported helpers by
// re-requiring the module with its internal functions exposed for testing.
// The functions under test are pure string-in/object-out — no fs, no
// network — so re-implementing the same regex-driven parse here would
// drift from the real implementation. Instead, module.exports is extended
// (see Step 3) to also export parseFlowAnnotation and buildFlowSpecs.
const { parseFlowAnnotation, buildFlowSpecs } = require(scriptPath);

describe('parseFlowAnnotation', () => {
  test('captures @rfc as rfcUrl and rfcLabel', () => {
    const doc = [
      ' * Execute a transfer whose intent is declared via RAR.',
      ' *',
      ' * @flow rar',
      ' * @name RAR',
      ' * @rfc https://datatracker.ietf.org/doc/html/rfc9396 RFC 9396',
      ' * @actor client-app',
      ' * @to auth-server',
      ' * @step 1',
    ].join('\n');

    const result = parseFlowAnnotation(doc);
    expect(result.rfcUrl).toBe('https://datatracker.ietf.org/doc/html/rfc9396');
    expect(result.rfcLabel).toBe('RFC 9396');
  });

  test('captures @title', () => {
    const doc = [
      ' * Push an authorization request for later retrieval.',
      ' *',
      ' * @flow par',
      ' * @title Push Authorization Request',
      ' * @actor client-app',
      ' * @step 1',
    ].join('\n');

    const result = parseFlowAnnotation(doc);
    expect(result.title).toBe('Push Authorization Request');
  });

  test('captures the leading prose paragraph as description, stopping at the first blank line', () => {
    const doc = [
      ' * Initiate a CIBA request for human approval.',
      ' * Client initiates a transfer that requires human review.',
      ' *',
      ' * Body: {',
      ' *   scope?: default includes offline_access',
      ' * }',
      ' *',
      ' * @flow ciba-hitl',
      ' * @actor client-app',
      ' * @step 1',
    ].join('\n');

    const result = parseFlowAnnotation(doc);
    expect(result.description).toBe(
      'Initiate a CIBA request for human approval. Client initiates a transfer that requires human review.'
    );
    // The Body: {...} block after the blank line must NOT leak into description.
    expect(result.description).not.toContain('Body:');
    expect(result.description).not.toContain('scope?');
  });

  test('a step with no prose and no tags-adjacent description has description undefined', () => {
    const doc = [' * @flow dpop', ' * @actor gateway', ' * @step 2'].join('\n');
    const result = parseFlowAnnotation(doc);
    expect(result.description).toBeUndefined();
  });
});

describe('buildFlowSpecs', () => {
  const baseRoute = (overrides) => ({
    file: 'test.js',
    annotation: {
      flowId: 'rar',
      actor: 'client-app',
      toActor: 'auth-server',
      step: 1,
      method: 'POST',
      endpoint: '/api/demo/intent-binding/run',
      ...overrides,
    },
  });

  test('sets flow.spec and flow.description when the annotation has @rfc', () => {
    const flows = buildFlowSpecs([
      baseRoute({
        displayName: 'RAR',
        rfcUrl: 'https://datatracker.ietf.org/doc/html/rfc9396',
        rfcLabel: 'RFC 9396',
        description: 'Execute a transfer whose intent is declared via RAR.',
      }),
    ]);

    expect(flows.rar.spec).toEqual({
      url: 'https://datatracker.ietf.org/doc/html/rfc9396',
      label: 'RFC 9396',
      title: 'RAR',
      why: 'Execute a transfer whose intent is declared via RAR.',
    });
    expect(flows.rar.description).toBe('Execute a transfer whose intent is declared via RAR.');
  });

  test('a flow with no @rfc anywhere has no spec, and keeps the placeholder description', () => {
    const flows = buildFlowSpecs([baseRoute({})]);
    expect(flows.rar.spec).toBeUndefined();
    expect(flows.rar.description).toBe('Protocol flow: rar');
  });

  test('sets step.title from @title, falling back to the auto-derived label', () => {
    const flows = buildFlowSpecs([
      baseRoute({ title: 'Execute RAR Transfer' }),
      baseRoute({
        flowId: 'par',
        step: 2,
        actor: 'auth-server',
        toActor: 'client-app',
        method: 'GET',
        endpoint: '/api/auth/authorize',
      }),
    ]);

    expect(flows.rar.steps[0].title).toBe('Execute RAR Transfer');
    expect(flows.par.steps[0].title).toBe('GET /api/auth/authorize');
  });

  test('sets step.description from the step-level prose, or null when absent', () => {
    const flows = buildFlowSpecs([
      baseRoute({ description: 'Client authenticates and obtains a token.' }),
      baseRoute({ flowId: 'dpop', step: 1, description: undefined }),
    ]);

    expect(flows.rar.steps[0].description).toBe('Client authenticates and obtains a token.');
    expect(flows.dpop.steps[0].description).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd demo_api_server
CI=true npx jest tests/generateProtocolFlows.test.js --forceExit
```

Expected: fails with `TypeError: (0 , generateProtocolFlows.parseFlowAnnotation) is not a function` (or similar) — the module currently only exports `{ main }`.

- [ ] **Step 3: Extend `parseFlowAnnotation` with `@rfc` / `@title` and prose capture**

In `demo_api_server/scripts/generateProtocolFlows.js`, replace the whole
`parseFlowAnnotation` function (currently lines 13-43) with:

```javascript
/**
 * Parse JSDoc comments for @flow, @name, @rfc, @actor, @to, @step, @title,
 * @body, @expects, @branch tags, plus the leading prose paragraph (the
 * sentence(s) written above the first @-tag) as a description.
 */
function parseFlowAnnotation(jsdocComment) {
  const rawLines = jsdocComment.split('\n');
  const result = {};
  const proseLines = [];
  let proseDone = false;

  for (const raw of rawLines) {
    const line = raw.replace(/^\s*\*\s?/, '').trimEnd();
    const match = line.match(/@(\w+)\s+(.+)/);

    if (match) {
      const [, tag, value] = match;
      if (tag === 'flow') {
        result.flowId = value.trim();
      } else if (tag === 'name') {
        result.displayName = value.trim();
      } else if (tag === 'rfc') {
        const trimmed = value.trim();
        const spaceIdx = trimmed.indexOf(' ');
        result.rfcUrl = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx);
        result.rfcLabel = spaceIdx === -1 ? trimmed : trimmed.slice(spaceIdx + 1).trim();
      } else if (tag === 'actor') {
        result.actor = value.trim();
      } else if (tag === 'to') {
        result.toActor = value.trim();
      } else if (tag === 'step') {
        result.step = parseInt(value.trim(), 10);
      } else if (tag === 'title') {
        result.title = value.trim();
      } else if (tag === 'expects') {
        result.expects = value.trim();
      } else if (tag === 'body') {
        result.body = value.trim();
      } else if (tag === 'branch') {
        if (!result.branches) result.branches = [];
        result.branches.push(value.trim());
      }
      proseDone = true;
      continue;
    }

    if (proseDone) continue;
    if (line.trim() === '') {
      if (proseLines.length > 0) proseDone = true;
      continue;
    }
    proseLines.push(line.trim());
  }

  if (proseLines.length > 0) result.description = proseLines.join(' ');
  return result;
}
```

- [ ] **Step 4: Wire the new fields through `buildFlowSpecs`**

Replace the whole `buildFlowSpecs` function (currently lines 145-212) with:

```javascript
/**
 * Build flow specs from route annotations
 */
function buildFlowSpecs(routes) {
  const flows = {};

  for (const { annotation } of routes) {
    const {
      flowId, displayName, rfcUrl, rfcLabel, title, description,
      actor, toActor, step, expects, body, branches, method, endpoint,
    } = annotation;

    if (!flows[flowId]) {
      flows[flowId] = {
        id: flowId,
        name: toTitleCase(flowId),
        description: `Protocol flow: ${flowId}`,
        actors: [],
        steps: [],
        branches: []
      };
    }

    // @name overrides the naive title-caser, which mangles acronym flow IDs
    // (e.g. "ciba-hitl" -> "Ciba Hitl" instead of "CIBA / HITL").
    if (displayName) {
      flows[flowId].name = displayName;
    }

    // @rfc marks the flow's primary annotation (always step 1 by
    // convention, same as @name). Only that one annotation sets spec /
    // replaces the placeholder description — other steps' own prose stays
    // scoped to their own step.description below.
    if (rfcUrl && rfcLabel) {
      flows[flowId].spec = {
        url: rfcUrl,
        label: rfcLabel,
        title: displayName || flows[flowId].name,
        why: description || '',
      };
      if (description) {
        flows[flowId].description = description;
      }
    }

    // Add actors in the order they appear (source first, then target)
    for (const name of [actor, toActor]) {
      if (name && !flows[flowId].actors.includes(name)) {
        flows[flowId].actors.push(name);
      }
    }

    // Add step (deduplicate by step number)
    if (step !== undefined && !Number.isNaN(step) && actor) {
      if (!flows[flowId].steps.some(s => s.step === step)) {
        const target = toActor || actor;
        const action = method && endpoint ? `${method} ${endpoint}` : `Step ${step}`;
        flows[flowId].steps.push({
          id: `step-${step}`,
          actor,
          fromActor: actor,
          toActor: target,
          action,
          label: action,
          title: title || action,
          description: description || null,
          method: method || null,
          endpoint: endpoint || null,
          step,
          body: body ? safeParseJson(body) : null,
          expected: expects ? safeParseJson(expects) : {}
        });
      }
    }

    // Add branches
    if (branches && Array.isArray(branches)) {
      for (const branch of branches) {
        if (!flows[flowId].branches.includes(branch)) {
          flows[flowId].branches.push(branch);
        }
      }
    }
  }

  // Sort steps by order within each flow
  for (const flowId of Object.keys(flows)) {
    flows[flowId].steps.sort((a, b) => a.step - b.step);
  }

  return flows;
}
```

- [ ] **Step 5: Export the two functions for testing**

Find the existing export at the bottom of the file:

```javascript
module.exports = { main };
```

Replace with:

```javascript
module.exports = { main, parseFlowAnnotation, buildFlowSpecs };
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
cd demo_api_server
CI=true npx jest tests/generateProtocolFlows.test.js --forceExit
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add demo_api_server/scripts/generateProtocolFlows.js demo_api_server/tests/generateProtocolFlows.test.js
git commit -m "feat(protocol-playground): add @rfc/@title tags + prose capture to introspector"
```

---

## Task 2: Author `@rfc` and `@title` annotations across all 10 flows

**Files:**
- Modify: `demo_api_server/routes/intentBinding.js` (rar)
- Modify: `demo_api_server/routes/parRequest.js` (par)
- Modify: `demo_api_server/routes/dpopRequest.js` (dpop)
- Modify: `demo_api_server/routes/oauthToken.js` (rfc8693-token-exchange)
- Modify: `demo_api_server/routes/ciba.js` (ciba-hitl)
- Modify: `demo_api_server/routes/pkceDemo.js` (pkce)
- Modify: `demo_api_server/routes/protectedResourceMetadata.js` (resource-metadata)
- Modify: `demo_api_server/routes/spiffeDemo.js` (spiffe)
- Modify: `demo_api_server/routes/txnTokenDemo.js` (txn-tokens)
- Modify: `demo_api_server/routes/xaaIdJagDemo.js` (xaa)

**Interfaces:**
- Consumes: `@rfc`, `@title` tag parsing from Task 1.
- Produces: no new interfaces — this task is content-only, no logic changes.

This task is mechanical: add one `@rfc <url> <label>` line next to each
flow's existing `@name` line (only the step-1 annotation needs it, same
rule as `@name`), and one `@title <2-4 words>` line to **every** step
annotation across all 10 flows (19 steps total: 9 flows × 2 steps, minus
RAR's single step, plus... count check: rar=1, par=2, dpop=2,
rfc8693=2, ciba=2, pkce=2, resource-metadata=2, spiffe=2, txn-tokens=2,
xaa=2 = 19 steps).

- [ ] **Step 1: RAR — `demo_api_server/routes/intentBinding.js`**

Find:

```javascript
 * @flow rar
 * @name RAR
 * @actor client-app
 * @to auth-server
 * @step 1
 * @body {"action":"permit","requestedAmount":50,"live":false}
 */
```

Replace with:

```javascript
 * @flow rar
 * @name RAR
 * @rfc https://datatracker.ietf.org/doc/html/rfc9396 RFC 9396
 * @title Execute RAR Transfer
 * @actor client-app
 * @to auth-server
 * @step 1
 * @body {"action":"permit","requestedAmount":50,"live":false}
 */
```

- [ ] **Step 2: PAR — `demo_api_server/routes/parRequest.js`**

Find (step 1):

```javascript
 * @flow par
 * @name PAR
 * @actor client-app
 * @to auth-server
 * @step 1
 */
```

Replace with:

```javascript
 * @flow par
 * @name PAR
 * @rfc https://datatracker.ietf.org/doc/html/rfc9126 RFC 9126
 * @title Push Authorization Request
 * @actor client-app
 * @to auth-server
 * @step 1
 */
```

Find (step 2):

```javascript
 * @flow par
 * @actor auth-server
 * @to client-app
 * @step 2
 */
```

Replace with:

```javascript
 * @flow par
 * @title Authorize Pushed Request
 * @actor auth-server
 * @to client-app
 * @step 2
 */
```

- [ ] **Step 3: DPoP — `demo_api_server/routes/dpopRequest.js`**

Find (step 1):

```javascript
 * @flow dpop
 * @name DPoP
 * @actor client-app
 * @to gateway
 * @step 1
 */
```

Replace with:

```javascript
 * @flow dpop
 * @name DPoP
 * @rfc https://datatracker.ietf.org/doc/html/rfc9449 RFC 9449
 * @title Request DPoP-Bound Token
 * @actor client-app
 * @to gateway
 * @step 1
 */
```

Find (step 2):

```javascript
 * @flow dpop
 * @actor gateway
 * @to client-app
 * @step 2
 */
```

Replace with:

```javascript
 * @flow dpop
 * @title Verify DPoP Proof
 * @actor gateway
 * @to client-app
 * @step 2
 */
```

- [ ] **Step 4: RFC 8693 Token Exchange — `demo_api_server/routes/oauthToken.js`**

Find (step 1):

```javascript
 * @flow rfc8693-token-exchange
 * @name RFC 8693 Token Exchange
 * @actor client-app
 * @to token-exchanger
 * @step 1
 */
```

Replace with:

```javascript
 * @flow rfc8693-token-exchange
 * @name RFC 8693 Token Exchange
 * @rfc https://datatracker.ietf.org/doc/html/rfc8693 RFC 8693
 * @title Exchange Subject Token
 * @actor client-app
 * @to token-exchanger
 * @step 1
 */
```

Find (step 2):

```javascript
 * @flow rfc8693-token-exchange
 * @actor token-exchanger
 * @to client-app
 * @step 2
 */
```

Replace with:

```javascript
 * @flow rfc8693-token-exchange
 * @title Introspect Exchanged Token
 * @actor token-exchanger
 * @to client-app
 * @step 2
 */
```

- [ ] **Step 5: CIBA / HITL — `demo_api_server/routes/ciba.js`**

Find (step 1):

```javascript
 * @flow ciba-hitl
 * @name CIBA / HITL
 * @actor client-app
 * @to human-approver
 * @step 1
 */
```

Replace with:

```javascript
 * @flow ciba-hitl
 * @name CIBA / HITL
 * @rfc https://openid.net/specs/openid-client-initiated-backchannel-authentication-core-1_0.html OIDC CIBA Core 1.0
 * @title Initiate CIBA Request
 * @actor client-app
 * @to human-approver
 * @step 1
 */
```

Find (step 2):

```javascript
 * @flow ciba-hitl
 * @actor human-approver
 * @to client-app
 * @step 2
 */
```

Replace with:

```javascript
 * @flow ciba-hitl
 * @title Approve Pending Transfer
 * @actor human-approver
 * @to client-app
 * @step 2
 */
```

- [ ] **Step 6: PKCE — `demo_api_server/routes/pkceDemo.js`**

Find (step 1):

```javascript
 * @flow pkce
 * @name PKCE
 * @actor client-app
 * @to auth-server
 * @step 1
 * @body {"code_challenge":"ewuOoauAc4HDP26uT55nbd_OX32mHAsIb1VtknVbfv8","code_challenge_method":"S256"}
 */
```

Replace with:

```javascript
 * @flow pkce
 * @name PKCE
 * @rfc https://datatracker.ietf.org/doc/html/rfc7636 RFC 7636
 * @title Push Code Challenge
 * @actor client-app
 * @to auth-server
 * @step 1
 * @body {"code_challenge":"ewuOoauAc4HDP26uT55nbd_OX32mHAsIb1VtknVbfv8","code_challenge_method":"S256"}
 */
```

Find (step 2):

```javascript
 * @flow pkce
 * @actor auth-server
 * @to client-app
 * @step 2
 * @body {"code":"vdA2j5Y2ifHKpWEK","code_verifier":"demo-pkce-verifier-9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c"}
 */
```

Replace with:

```javascript
 * @flow pkce
 * @title Redeem Code + Verifier
 * @actor auth-server
 * @to client-app
 * @step 2
 * @body {"code":"vdA2j5Y2ifHKpWEK","code_verifier":"demo-pkce-verifier-9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c"}
 */
```

- [ ] **Step 7: Resource Metadata — `demo_api_server/routes/protectedResourceMetadata.js`**

Find (step 1):

```javascript
 * @flow resource-metadata
 * @actor client-app
 * @to resource-server
 * @step 1
 */
```

Replace with:

```javascript
 * @flow resource-metadata
 * @rfc https://datatracker.ietf.org/doc/html/rfc9728 RFC 9728
 * @title Fetch Resource Metadata
 * @actor client-app
 * @to resource-server
 * @step 1
 */
```

Find (step 2):

```javascript
 * @flow resource-metadata
 * @actor client-app
 * @to resource-server
 * @step 2
 *
 * GET /all — served at /api/rfc9728/all. Fetches RFC 9728 metadata from BFF
 * (self) and all downstream MCP services. Each entry includes a _status
 * field: "ok" | "unreachable" | "error"
 */
```

Replace with:

```javascript
 * @flow resource-metadata
 * @title Discover All Resource Servers
 * @actor client-app
 * @to resource-server
 * @step 2
 *
 * GET /all — served at /api/rfc9728/all. Fetches RFC 9728 metadata from BFF
 * (self) and all downstream MCP services. Each entry includes a _status
 * field: "ok" | "unreachable" | "error"
 */
```

- [ ] **Step 8: SPIFFE — `demo_api_server/routes/spiffeDemo.js`**

Find (step 1):

```javascript
 * @flow spiffe
 * @name SPIFFE
 * @actor workload-a
 * @to spire-agent
 * @step 1
 * @body {"spiffe_id":"spiffe://demo.local/service/payments"}
 */
```

Replace with:

```javascript
 * @flow spiffe
 * @name SPIFFE
 * @rfc https://spiffe.io/docs/latest/spiffe-about/overview/ SPIFFE Specification
 * @title Fetch JWT-SVID
 * @actor workload-a
 * @to spire-agent
 * @step 1
 * @body {"spiffe_id":"spiffe://demo.local/service/payments"}
 */
```

Find (step 2):

```javascript
 * @flow spiffe
 * @actor workload-b
 * @to workload-a
 * @step 2
 * @body {"svid":"demo.placeholder.svid","expected_trust_domain":"demo.local"}
 */
```

Replace with:

```javascript
 * @flow spiffe
 * @title Verify Peer SVID
 * @actor workload-b
 * @to workload-a
 * @step 2
 * @body {"svid":"demo.placeholder.svid","expected_trust_domain":"demo.local"}
 */
```

- [ ] **Step 9: TXN Tokens — `demo_api_server/routes/txnTokenDemo.js`**

Find (step 1):

```javascript
 * @flow txn-tokens
 * @name TXN Tokens
 * @actor edge-service
 * @to txn-token-service
 * @step 1
 * @body {"subject_token":"demo-subject-access-token","request_ctx":{"method":"POST","path":"/transfer"},"purp":"issue"}
 */
```

Replace with:

```javascript
 * @flow txn-tokens
 * @name TXN Tokens
 * @rfc https://datatracker.ietf.org/doc/draft-ietf-oauth-transaction-tokens/ draft-ietf-oauth-transaction-tokens
 * @title Mint Txn-Token
 * @actor edge-service
 * @to txn-token-service
 * @step 1
 * @body {"subject_token":"demo-subject-access-token","request_ctx":{"method":"POST","path":"/transfer"},"purp":"issue"}
 */
```

Find (step 2):

```javascript
 * @flow txn-tokens
 * @actor downstream-service
 * @to txn-token-service
 * @step 2
 * @body {"txn_token":"demo.placeholder.token","hop":"inventory-service"}
 */
```

Replace with:

```javascript
 * @flow txn-tokens
 * @title Propagate Txn-Token
 * @actor downstream-service
 * @to txn-token-service
 * @step 2
 * @body {"txn_token":"demo.placeholder.token","hop":"inventory-service"}
 */
```

- [ ] **Step 10: XAA / ID-JAG — `demo_api_server/routes/xaaIdJagDemo.js`**

Find (step 1):

```javascript
 * @flow xaa
 * @name XAA / ID-JAG
 * @actor client-app
 * @to idp-a
 * @step 1
 * @body {"subject_token":"demo-id-token","subject_token_type":"urn:ietf:params:oauth:token-type:id_token","requested_token_type":"urn:ietf:params:oauth:token-type:id-jag","audience":"domain-b-as"}
 */
```

Replace with:

```javascript
 * @flow xaa
 * @name XAA / ID-JAG
 * @rfc https://datatracker.ietf.org/doc/draft-ietf-oauth-identity-chaining/ draft-ietf-oauth-identity-chaining
 * @title Mint ID-JAG Assertion
 * @actor client-app
 * @to idp-a
 * @step 1
 * @body {"subject_token":"demo-id-token","subject_token_type":"urn:ietf:params:oauth:token-type:id_token","requested_token_type":"urn:ietf:params:oauth:token-type:id-jag","audience":"domain-b-as"}
 */
```

Find (step 2):

```javascript
 * @flow xaa
 * @actor domain-b-as
 * @to client-app
 * @step 2
 * @body {"grant_type":"urn:ietf:params:oauth:grant-type:jwt-bearer","assertion":"demo.placeholder.idjag","scope":"read"}
 */
```

Replace with:

```javascript
 * @flow xaa
 * @title Exchange ID-JAG For Token
 * @actor domain-b-as
 * @to client-app
 * @step 2
 * @body {"grant_type":"urn:ietf:params:oauth:grant-type:jwt-bearer","assertion":"demo.placeholder.idjag","scope":"read"}
 */
```

- [ ] **Step 11: Regenerate and spot-check**

```bash
cd demo_api_server
node scripts/generateProtocolFlows.js
cd ..
python3 -c "
import json
d = json.load(open('demo_api_ui/src/data/protocolFlows.json'))
for k, v in d.items():
    assert 'spec' in v, f'{k} missing spec'
    print(k, '->', v['spec']['label'], '|', [s['title'] for s in v['steps']])
"
```

Expected: every flow prints a real RFC/spec label and a list of non-generic
step titles (no `POST /api/...` strings).

- [ ] **Step 12: Commit**

```bash
git add demo_api_server/routes/intentBinding.js demo_api_server/routes/parRequest.js demo_api_server/routes/dpopRequest.js demo_api_server/routes/oauthToken.js demo_api_server/routes/ciba.js demo_api_server/routes/pkceDemo.js demo_api_server/routes/protectedResourceMetadata.js demo_api_server/routes/spiffeDemo.js demo_api_server/routes/txnTokenDemo.js demo_api_server/routes/xaaIdJagDemo.js demo_api_ui/src/data/protocolFlows.json
git commit -m "feat(protocol-playground): annotate all 10 flows with @rfc + per-step @title"
```

---

## Task 3: `buildChainEvents` — normalize a step result into display events

**Files:**
- Create: `demo_api_ui/src/services/buildChainEvents.js`
- Test: `demo_api_ui/src/services/__tests__/buildChainEvents.test.js`

**Interfaces:**
- Produces: `buildChainEvents(result)` → `Array<{ id, label, status, detail, token }>`
  where `token` is either `null` or a `{ isValid: true, payload }` object
  shaped exactly like `decodeJWT()`'s return value — the same shape
  `TokenInspector` already consumes.
- Consumes: an `ExecutionEngine` result object as already produced by
  `demo_api_ui/src/services/executionEngine.js` — either the success shape
  `{ stepId, request: {method, url}, response: {status, body}, decodedToken }`
  or the failure shape `{ stepId, error, timestamp }` (no `request`/`response`
  at all).

- [ ] **Step 1: Write the failing tests**

Create `demo_api_ui/src/services/__tests__/buildChainEvents.test.js`:

```javascript
import { describe, test, expect } from 'vitest';
import { buildChainEvents } from '../buildChainEvents';

describe('buildChainEvents', () => {
  test('returns [] for a falsy result', () => {
    expect(buildChainEvents(null)).toEqual([]);
    expect(buildChainEvents(undefined)).toEqual([]);
  });

  test('maps a real tokenChainEvents array from the response body', () => {
    const result = {
      stepId: 'step-1',
      request: { method: 'POST', url: '/api/demo/intent-binding/run' },
      response: {
        status: 200,
        body: {
          tokenChainEvents: [
            { id: 'sim-rar-armed', label: 'RAR enforced by PingOne Authorize', status: 'active', explanation: 'within-cap calls PERMIT.' },
            { id: 'sim-exchange-ok', label: 'Exchanged Token', status: 'active', claims: { sub: 'user-1', aud: ['x'], scope: 'read' } },
          ],
        },
      },
      decodedToken: null,
    };

    const events = buildChainEvents(result);
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({
      id: 'sim-rar-armed',
      label: 'RAR enforced by PingOne Authorize',
      status: 'active',
      detail: 'within-cap calls PERMIT.',
      token: null,
    });
    expect(events[1].token).toEqual({ isValid: true, payload: { sub: 'user-1', aud: ['x'], scope: 'read' } });
  });

  test('synthesizes one event from method/status/decodedToken when no tokenChainEvents exist', () => {
    const result = {
      stepId: 'step-1',
      request: { method: 'POST', url: '/api/demo/pkce/token' },
      response: { status: 200, body: { access_token: 'abc' } },
      decodedToken: { isValid: true, header: {}, payload: { sub: 'demo-user' }, signature: 'x' },
    };

    const events = buildChainEvents(result);
    expect(events).toEqual([
      {
        id: 'step-1-http',
        label: 'POST /api/demo/pkce/token',
        status: 'active',
        detail: 'HTTP 200',
        token: { isValid: true, header: {}, payload: { sub: 'demo-user' }, signature: 'x' },
      },
    ]);
  });

  test('synthesized event status is error for a 4xx/5xx response', () => {
    const result = {
      stepId: 'step-1',
      request: { method: 'POST', url: '/api/demo/pkce/token' },
      response: { status: 400, body: { error: 'invalid_grant' } },
      decodedToken: null,
    };

    const events = buildChainEvents(result);
    expect(events[0].status).toBe('error');
    expect(events[0].detail).toBe('HTTP 400');
    expect(events[0].token).toBeNull();
  });

  test('handles the executeAll failure shape (no request/response at all)', () => {
    const result = { stepId: 'step-2', error: 'Network error', timestamp: '2026-08-11T00:00:00.000Z' };

    const events = buildChainEvents(result);
    expect(events).toEqual([
      {
        id: 'step-2-http',
        label: 'GET ',
        status: 'error',
        detail: 'Network error',
        token: null,
      },
    ]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd demo_api_ui
npm run test:unit -- src/services/__tests__/buildChainEvents.test.js
```

Expected: fails — `buildChainEvents.js` doesn't exist yet.

- [ ] **Step 3: Write the implementation**

Create `demo_api_ui/src/services/buildChainEvents.js`:

```javascript
/**
 * Normalizes one ExecutionEngine step result into a list of display events
 * for TokenChainEventCard. Real tokenChainEvents (only RAR emits these
 * today, via the real attackSimulatorService path) render verbatim — their
 * actual label/status/explanation/claims. Every other flow's plain
 * request/response gets exactly one synthesized event built honestly from
 * data the result already has: no invented narrative, no fabricated
 * PingOne-style steps for flows that never touched PingOne.
 */

function statusFromHttpStatus(status) {
  if (typeof status !== 'number') return 'error';
  return status >= 400 ? 'error' : 'active';
}

export function buildChainEvents(result) {
  if (!result) return [];

  const realEvents = result.response?.body?.tokenChainEvents;
  if (Array.isArray(realEvents) && realEvents.length > 0) {
    return realEvents.map((event, index) => ({
      id: event.id || `${result.stepId}-${index}`,
      label: event.label || `Event ${index + 1}`,
      status: event.status || 'active',
      detail: event.explanation || null,
      token: event.claims ? { isValid: true, payload: event.claims } : null,
    }));
  }

  const method = result.request?.method || 'GET';
  const url = result.request?.url || '';
  const httpStatus = result.response?.status;

  return [
    {
      id: `${result.stepId}-http`,
      label: `${method} ${url}`,
      status: result.error ? 'error' : statusFromHttpStatus(httpStatus),
      detail: result.error
        ? (typeof result.error === 'string' ? result.error : result.error.message || 'Request failed')
        : (typeof httpStatus === 'number' ? `HTTP ${httpStatus}` : null),
      token: result.decodedToken?.isValid ? result.decodedToken : null,
    },
  ];
}

export default buildChainEvents;
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd demo_api_ui
npm run test:unit -- src/services/__tests__/buildChainEvents.test.js
```

Expected: all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/services/buildChainEvents.js demo_api_ui/src/services/__tests__/buildChainEvents.test.js
git commit -m "feat(protocol-playground): add buildChainEvents step-result normalizer"
```

---

## Task 4: `TokenChainEventCard` component

**Files:**
- Create: `demo_api_ui/src/components/ProtocolPlayground/TokenChainEventCard.jsx`
- Test: `demo_api_ui/src/components/ProtocolPlayground/__tests__/TokenChainEventCard.test.jsx`
- Modify: `demo_api_ui/src/components/ProtocolPlayground/ProtocolPlayground.css`

**Interfaces:**
- Consumes: one event object from `buildChainEvents` (Task 3):
  `{ id, label, status, detail, token }`.
- Consumes: `TokenInspector` (existing, `demo_api_ui/src/components/ProtocolPlayground/TokenInspector.jsx`) — rendered directly when `event.token` is present, no new claims-rendering logic duplicated.
- Produces: `<TokenChainEventCard event={event} />` — no other props.

- [ ] **Step 1: Write the failing tests**

Create `demo_api_ui/src/components/ProtocolPlayground/__tests__/TokenChainEventCard.test.jsx`:

```javascript
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, test, expect } from 'vitest';
import TokenChainEventCard from '../TokenChainEventCard';

describe('TokenChainEventCard', () => {
  test('renders label, status badge, and detail', () => {
    render(
      <TokenChainEventCard
        event={{ id: 'e1', label: 'RAR enforced by PingOne Authorize', status: 'active', detail: 'within cap', token: null }}
      />
    );

    expect(screen.getByText('RAR enforced by PingOne Authorize')).toBeInTheDocument();
    expect(screen.getByText('active')).toBeInTheDocument();
    expect(screen.getByText('within cap')).toBeInTheDocument();
  });

  test('renders TokenInspector when a valid token is present', () => {
    render(
      <TokenChainEventCard
        event={{
          id: 'e2',
          label: 'Exchanged Token',
          status: 'active',
          detail: null,
          token: { isValid: true, payload: { sub: 'user-1', aud: 'x', scope: 'read', exp: 9999999999 } },
        }}
      />
    );

    expect(screen.getByText('Exchanged Token')).toBeInTheDocument();
    expect(screen.getByText(/Scopes:/)).toBeInTheDocument();
  });

  test('does not throw and renders no token section when token is null', () => {
    render(<TokenChainEventCard event={{ id: 'e3', label: 'HTTP call', status: 'error', detail: 'HTTP 400', token: null }} />);
    expect(screen.getByText('HTTP call')).toBeInTheDocument();
    expect(screen.queryByText(/Scopes:/)).not.toBeInTheDocument();
  });

  test('maps unknown status values to the neutral badge class, not error', () => {
    render(<TokenChainEventCard event={{ id: 'e4', label: 'x', status: 'enforced', detail: null, token: null }} />);
    const badge = screen.getByText('enforced');
    expect(badge.className).toContain('tc-event__badge--warn');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd demo_api_ui
npm run test:unit -- src/components/ProtocolPlayground/__tests__/TokenChainEventCard.test.jsx
```

Expected: fails — component doesn't exist yet.

- [ ] **Step 3: Write the implementation**

Create `demo_api_ui/src/components/ProtocolPlayground/TokenChainEventCard.jsx`:

```javascript
import React from 'react';
import TokenInspector from './TokenInspector';

/** Maps a chain event's free-form status string to one of three badge looks. */
function badgeClass(status) {
  if (status === 'error') return 'error';
  if (status === 'active') return 'ok';
  return 'warn';
}

export default function TokenChainEventCard({ event }) {
  const cls = badgeClass(event.status);

  return (
    <div className={`tc-event tc-event--${cls}`}>
      <div className="tc-event__row">
        <span className="tc-event__label">{event.label}</span>
        <span className={`tc-event__badge tc-event__badge--${cls}`}>{event.status}</span>
      </div>
      {event.detail && <p className="tc-event__detail">{event.detail}</p>}
      {event.token?.isValid && <TokenInspector token={event.token} />}
    </div>
  );
}
```

- [ ] **Step 4: Add CSS**

Append to `demo_api_ui/src/components/ProtocolPlayground/ProtocolPlayground.css`
(the light-theme block already defines `--pp-*` tokens at lines 4-35 and the
dark override at lines 38-64 — add one new token pair to each, then the new
rules anywhere after line 64):

In the `.protocol-playground` light block (after `--pp-ok-text: #16a34a;` on line 25), add:

```css
  --pp-warn-bg: #fffbeb;
  --pp-warn-text: #92400e;
```

In the `.protocol-playground.dark` block (after `--pp-ok-text: #4ade80;` on line 59), add:

```css
  --pp-warn-bg: #1c1006;
  --pp-warn-text: #fbbf24;
```

Then append at the end of the file:

```css
/* --- Token chain event cards --- */

.tc-event {
  padding: 10px 12px;
  border-radius: 8px;
  background-color: var(--pp-bg-surface);
  border: 1px solid var(--pp-border);
  margin-bottom: 10px;
}

.tc-event:last-child {
  margin-bottom: 0;
}

.tc-event__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.tc-event__label {
  font-size: 12.5px;
  font-weight: 500;
  color: var(--pp-text);
}

.tc-event__badge {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 2px 7px;
  border-radius: 4px;
  white-space: nowrap;
}

.tc-event__badge--ok {
  background-color: var(--pp-ok-bg);
  color: var(--pp-ok-text);
}

.tc-event__badge--error {
  background-color: var(--pp-err-badge-bg);
  color: var(--pp-err-badge-text);
}

.tc-event__badge--warn {
  background-color: var(--pp-warn-bg);
  color: var(--pp-warn-text);
}

.tc-event__detail {
  margin: 6px 0 0;
  font-size: 12px;
  line-height: 1.45;
  color: var(--pp-text-secondary);
}

.tc-event .token-inspector {
  margin-top: 8px;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd demo_api_ui
npm run test:unit -- src/components/ProtocolPlayground/__tests__/TokenChainEventCard.test.jsx
```

Expected: all 4 tests pass.

- [ ] **Step 6: Commit**

```bash
git add demo_api_ui/src/components/ProtocolPlayground/TokenChainEventCard.jsx demo_api_ui/src/components/ProtocolPlayground/__tests__/TokenChainEventCard.test.jsx demo_api_ui/src/components/ProtocolPlayground/ProtocolPlayground.css
git commit -m "feat(protocol-playground): add TokenChainEventCard component"
```

---

## Task 5: Wire `ActivityPanel` to render token-chain cards instead of raw JSON

**Files:**
- Modify: `demo_api_ui/src/components/ProtocolPlayground/ActivityPanel.jsx`
- Modify: `demo_api_ui/src/components/ProtocolPlayground/ProtocolPlayground.css`

**Interfaces:**
- Consumes: `buildChainEvents` (Task 3), `TokenChainEventCard` (Task 4).
- No prop changes — `ActivityPanel` still takes `{ results, error }`,
  same as today.

- [ ] **Step 1: Replace the bottom details block**

In `demo_api_ui/src/components/ProtocolPlayground/ActivityPanel.jsx`, the
current file is:

```javascript
import React, { useEffect, useRef } from 'react';
import TokenInspector from './TokenInspector';

/** ExecutionEngine reports errors as objects; React can only render a string. */
function errorText(error) {
  if (!error) return null;
  if (typeof error === 'string') return error;
  return error.message || 'Execution failed';
}

export default function ActivityPanel({ results, error }) {
  const logRef = useRef(null);
  const entries = Array.isArray(results) ? results : [];

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [results]);

  const lastResult = entries.length > 0 ? entries[entries.length - 1] : null;
  const message = errorText(error);

  return (
    <div className="activity-panel">
      <div className="activity-header">
        <h4>Activity</h4>
      </div>

      {message && (
        <div className="activity-error">
          ❌ {message}
        </div>
      )}

      <div className="activity-log" ref={logRef}>
        {entries.length === 0 ? (
          <div className="activity-empty">No activity yet. Click Execute or Next Step.</div>
        ) : (
          entries.map((result) => {
            const status = result.response?.status;
            const ok = status >= 200 && status < 300;
            return (
              <div key={result.stepId} className="activity-entry">
                <div className="entry-header">
                  <span className="entry-step">{result.stepId}</span>
                  <span className={`entry-status status-${ok ? 'ok' : 'error'}`}>
                    {status ?? 'failed'}
                  </span>
                </div>
                <div className="entry-method">
                  {result.request
                    ? `${result.request.method} ${result.request.url}`
                    : errorText(result.error)}
                </div>
              </div>
            );
          })
        )}
      </div>

      {lastResult?.response && (
        <div className="activity-details">
          <div className="details-section">
            <h5>Response</h5>
            <pre className="details-json">{JSON.stringify(lastResult.response, null, 2)}</pre>
          </div>

          {lastResult.decodedToken?.isValid && (
            <TokenInspector token={lastResult.decodedToken} />
          )}
        </div>
      )}
    </div>
  );
}
```

Replace it entirely with:

```javascript
import React, { useEffect, useRef } from 'react';
import TokenChainEventCard from './TokenChainEventCard';
import { buildChainEvents } from '../../services/buildChainEvents';

/** ExecutionEngine reports errors as objects; React can only render a string. */
function errorText(error) {
  if (!error) return null;
  if (typeof error === 'string') return error;
  return error.message || 'Execution failed';
}

export default function ActivityPanel({ results, error }) {
  const logRef = useRef(null);
  const entries = Array.isArray(results) ? results : [];

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [results]);

  const lastResult = entries.length > 0 ? entries[entries.length - 1] : null;
  const message = errorText(error);
  const chainEvents = lastResult ? buildChainEvents(lastResult) : [];

  return (
    <div className="activity-panel">
      <div className="activity-header">
        <h4>Activity</h4>
      </div>

      {message && (
        <div className="activity-error">
          ❌ {message}
        </div>
      )}

      <div className="activity-log" ref={logRef}>
        {entries.length === 0 ? (
          <div className="activity-empty">No activity yet. Click Execute or Next Step.</div>
        ) : (
          entries.map((result) => {
            const status = result.response?.status;
            const ok = status >= 200 && status < 300;
            return (
              <div key={result.stepId} className="activity-entry">
                <div className="entry-header">
                  <span className="entry-step">{result.stepId}</span>
                  <span className={`entry-status status-${ok ? 'ok' : 'error'}`}>
                    {status ?? 'failed'}
                  </span>
                </div>
                <div className="entry-method">
                  {result.request
                    ? `${result.request.method} ${result.request.url}`
                    : errorText(result.error)}
                </div>
              </div>
            );
          })
        )}
      </div>

      {lastResult && chainEvents.length > 0 && (
        <div className="activity-details">
          <h5>Token Chain</h5>
          {chainEvents.map((event) => (
            <TokenChainEventCard key={event.id} event={event} />
          ))}

          {lastResult.response && (
            <details className="activity-raw">
              <summary>Raw response</summary>
              <pre className="details-json">{JSON.stringify(lastResult.response, null, 2)}</pre>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add CSS for the raw-response disclosure**

Append to `demo_api_ui/src/components/ProtocolPlayground/ProtocolPlayground.css`:

```css
/* --- Raw response disclosure (secondary to the token-chain cards) --- */

.activity-raw {
  margin-top: 12px;
}

.activity-raw summary {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--pp-text-muted);
  cursor: pointer;
}

.activity-raw .details-json {
  margin-top: 8px;
}
```

- [ ] **Step 3: Update the existing wiring test's expectations**

`demo_api_ui/src/components/ProtocolPlayground/__tests__/ProtocolPlayground.test.jsx`
already asserts `screen.getByText('step-1')` and `screen.getByText('200')`
from the untouched top `.activity-log` summary list — those still pass
unchanged. Run the full component test to confirm:

```bash
cd demo_api_ui
npm run test:unit -- src/components/ProtocolPlayground/__tests__/ProtocolPlayground.test.jsx
```

Expected: all 5 existing tests still pass (no code change needed in the
test file itself — this step is verification only).

- [ ] **Step 4: Run the full ProtocolPlayground test suite**

```bash
cd demo_api_ui
npm run test:unit -- src/components/ProtocolPlayground
```

Expected: all tests across `ProtocolPlayground.test.jsx`,
`TokenChainEventCard.test.jsx` pass.

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/components/ProtocolPlayground/ActivityPanel.jsx demo_api_ui/src/components/ProtocolPlayground/ProtocolPlayground.css
git commit -m "feat(protocol-playground): render token-chain cards in ActivityPanel, keep raw response as a disclosure"
```

---

## Task 6: `StepCard` component

**Files:**
- Create: `demo_api_ui/src/components/ProtocolPlayground/StepCard.jsx`
- Test: `demo_api_ui/src/components/ProtocolPlayground/__tests__/StepCard.test.jsx`
- Modify: `demo_api_ui/src/services/protocolMermaid.js`
- Modify: `demo_api_ui/src/components/ProtocolPlayground/ProtocolPlayground.css`

**Interfaces:**
- Consumes: `actorLabel(actor)` from `protocolMermaid.js` (currently
  internal-only — this task exports it).
- Consumes: a `step` object from `protocolFlows.json` (Task 2 gives it
  `title`, `description`, `fromActor`, `toActor`, `step` (number), `method`,
  `endpoint`).
- Consumes: `result` — this step's own entry from `executionState.results`
  (or `undefined` if not yet run), same shape `buildChainEvents` (Task 3)
  reads: `{ stepId, response: { status }, error }`.
- Produces: `<StepCard step={step} result={result} canExecute={bool}
  onExecute={() => void} />`.

- [ ] **Step 1: Export `actorLabel` from `protocolMermaid.js`**

In `demo_api_ui/src/services/protocolMermaid.js`, find:

```javascript
function actorLabel(actor) {
  if (ACTOR_LABELS[actor]) return ACTOR_LABELS[actor];
  return String(actor || 'Actor')
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
```

Add `export` in front:

```javascript
export function actorLabel(actor) {
  if (ACTOR_LABELS[actor]) return ACTOR_LABELS[actor];
  return String(actor || 'Actor')
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
```

(`buildSequenceSource` calls `actorLabel` locally in the same file — this
change is additive, the existing call site is unaffected.)

- [ ] **Step 2: Write the failing tests**

Create `demo_api_ui/src/components/ProtocolPlayground/__tests__/StepCard.test.jsx`:

```javascript
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, test, expect, vi } from 'vitest';
import StepCard from '../StepCard';

const baseStep = {
  id: 'step-1',
  step: 1,
  title: 'Push Authorization Request',
  description: 'Client sends authorization parameters and receives a request_uri for later use.',
  fromActor: 'client-app',
  toActor: 'auth-server',
};

describe('StepCard', () => {
  test('renders the step number, title, description, and actor chips', () => {
    render(<StepCard step={baseStep} result={undefined} canExecute={true} onExecute={vi.fn()} />);

    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('Push Authorization Request')).toBeInTheDocument();
    expect(screen.getByText(baseStep.description)).toBeInTheDocument();
    expect(screen.getByText('Client App')).toBeInTheDocument();
    expect(screen.getByText('PingOne')).toBeInTheDocument();
  });

  test('Execute button is enabled when canExecute is true, calls onExecute(step.id) when clicked', () => {
    const onExecute = vi.fn();
    render(<StepCard step={baseStep} result={undefined} canExecute={true} onExecute={onExecute} />);

    const button = screen.getByRole('button', { name: /Execute/i });
    expect(button).not.toBeDisabled();
    fireEvent.click(button);
    expect(onExecute).toHaveBeenCalledTimes(1);
  });

  test('Execute button is disabled when canExecute is false', () => {
    render(<StepCard step={baseStep} result={undefined} canExecute={false} onExecute={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Execute/i })).toBeDisabled();
  });

  test('shows a success status badge once a 2xx result exists', () => {
    const result = { stepId: 'step-1', response: { status: 200 }, error: null };
    render(<StepCard step={baseStep} result={result} canExecute={true} onExecute={vi.fn()} />);
    expect(screen.getByText('200')).toBeInTheDocument();
  });

  test('shows a failure status badge once an error result exists', () => {
    const result = { stepId: 'step-1', response: { status: 400 }, error: null };
    render(<StepCard step={baseStep} result={result} canExecute={true} onExecute={vi.fn()} />);
    expect(screen.getByText('400')).toBeInTheDocument();
  });

  test('falls back to step.label when no description is present', () => {
    const stepWithoutDescription = { ...baseStep, description: null, label: 'POST /api/auth/par' };
    render(<StepCard step={stepWithoutDescription} result={undefined} canExecute={true} onExecute={vi.fn()} />);
    expect(screen.getByText('POST /api/auth/par')).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
cd demo_api_ui
npm run test:unit -- src/components/ProtocolPlayground/__tests__/StepCard.test.jsx
```

Expected: fails — component doesn't exist yet.

- [ ] **Step 4: Write the implementation**

Create `demo_api_ui/src/components/ProtocolPlayground/StepCard.jsx`:

```javascript
import React from 'react';
import { actorLabel } from '../../services/protocolMermaid';

export default function StepCard({ step, result, canExecute, onExecute }) {
  const status = result?.response?.status;
  const failed = !!result?.error || (typeof status === 'number' && status >= 400);

  return (
    <div className="pp-step-card">
      <div className="pp-step-card__number">{step.step}</div>

      <div className="pp-step-card__body">
        <div className="pp-step-card__title">{step.title || step.label}</div>
        {step.description && <p className="pp-step-card__description">{step.description}</p>}
        <div className="pp-step-card__actors">
          <span className="pp-step-card__chip">{actorLabel(step.fromActor)}</span>
          <span className="pp-step-card__arrow">→</span>
          <span className="pp-step-card__chip">{actorLabel(step.toActor)}</span>
        </div>
      </div>

      <div className="pp-step-card__action">
        {result && (
          <span className={`pp-step-card__status pp-step-card__status--${failed ? 'error' : 'ok'}`}>
            {status ?? (result.error ? '✕' : '')}
          </span>
        )}
        <button
          type="button"
          className="btn btn-default"
          disabled={!canExecute}
          onClick={onExecute}
        >
          Execute
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Add CSS**

Append to `demo_api_ui/src/components/ProtocolPlayground/ProtocolPlayground.css`:

```css
/* --- Per-step cards --- */

.pp-step-cards {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 16px 0;
}

.pp-step-card {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding: 14px 16px;
  border-radius: 8px;
  background-color: var(--pp-bg-surface);
  border: 1px solid var(--pp-border);
}

.pp-step-card__number {
  flex: 0 0 auto;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background-color: var(--pp-item-active-bg);
  color: var(--pp-item-active-text);
  font-size: 12px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}

.pp-step-card__body {
  flex: 1;
  min-width: 0;
}

.pp-step-card__title {
  font-size: 14px;
  font-weight: 600;
  color: var(--pp-text);
  margin-bottom: 4px;
}

.pp-step-card__description {
  margin: 0 0 8px;
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--pp-text-secondary);
}

.pp-step-card__actors {
  display: flex;
  align-items: center;
  gap: 6px;
}

.pp-step-card__chip {
  font-size: 11px;
  font-weight: 500;
  padding: 3px 8px;
  border-radius: 4px;
  background-color: var(--pp-bg-code);
  color: var(--pp-text-secondary);
}

.pp-step-card__arrow {
  font-size: 12px;
  color: var(--pp-text-muted);
}

.pp-step-card__action {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 10px;
}

.pp-step-card__status {
  font-size: 12px;
  font-weight: 700;
  padding: 2px 7px;
  border-radius: 4px;
}

.pp-step-card__status--ok {
  background-color: var(--pp-ok-bg);
  color: var(--pp-ok-text);
}

.pp-step-card__status--error {
  background-color: var(--pp-err-badge-bg);
  color: var(--pp-err-badge-text);
}
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
cd demo_api_ui
npm run test:unit -- src/components/ProtocolPlayground/__tests__/StepCard.test.jsx
```

Expected: all 6 tests pass.

- [ ] **Step 7: Commit**

```bash
git add demo_api_ui/src/components/ProtocolPlayground/StepCard.jsx demo_api_ui/src/components/ProtocolPlayground/__tests__/StepCard.test.jsx demo_api_ui/src/services/protocolMermaid.js demo_api_ui/src/components/ProtocolPlayground/ProtocolPlayground.css
git commit -m "feat(protocol-playground): add StepCard component"
```

---

## Task 7: Wire `StepCard` list into `ProtocolViewer`

**Files:**
- Modify: `demo_api_ui/src/components/ProtocolPlayground/ProtocolViewer.jsx`

**Interfaces:**
- Consumes: `StepCard` (Task 6).
- No prop changes to `ProtocolViewer` itself — still
  `{ flowSpec, executionState, onExecutionStateChange, dark }`.

- [ ] **Step 1: Add the import and a per-step execute handler**

In `demo_api_ui/src/components/ProtocolPlayground/ProtocolViewer.jsx`, add
to the imports at the top:

```javascript
import StepCard from './StepCard';
```

After the existing `handleStep` function (currently lines 46-59), add:

```javascript
  const handleExecuteStep = async (stepId) => {
    try {
      await engine.executeStep(stepId);
      onExecutionStateChange(engine.getState());
    } catch (err) {
      onExecutionStateChange({
        ...engine.getState(),
        error: err.message || 'Step execution failed'
      });
    }
  };
```

- [ ] **Step 2: Render the step card list**

Find the `diagram-section` block:

```javascript
        <div className="diagram-section">
          <SequenceDiagram
            flowSpec={flowSpec}
            currentStep={executionState.currentStep}
            results={executionState.results}
            dark={dark}
          />
          <ExecutionControls
            onExecute={handleExecute}
            onStep={handleStep}
            onReset={handleReset}
            stepCount={executionState.results.length}
            totalSteps={flowSpec.steps?.length || 0}
          />
        </div>
```

Replace with:

```javascript
        <div className="diagram-section">
          <SequenceDiagram
            flowSpec={flowSpec}
            currentStep={executionState.currentStep}
            results={executionState.results}
            dark={dark}
          />

          <div className="pp-step-cards">
            {(flowSpec.steps || []).map((step, index) => (
              <StepCard
                key={step.id}
                step={step}
                result={executionState.results[index]}
                canExecute={index === 0 || executionState.results.length > index - 1}
                onExecute={() => handleExecuteStep(step.id)}
              />
            ))}
          </div>

          <ExecutionControls
            onExecute={handleExecute}
            onStep={handleStep}
            onReset={handleReset}
            stepCount={executionState.results.length}
            totalSteps={flowSpec.steps?.length || 0}
          />
        </div>
```

- [ ] **Step 3: Run the full ProtocolPlayground test suite**

```bash
cd demo_api_ui
npm run test:unit -- src/components/ProtocolPlayground
```

Expected: all tests pass, including the pre-existing
`ProtocolPlayground.test.jsx` (StepCard's "Execute" buttons have an
accessible name of exactly "Execute", which does not match the existing
`getByRole('button', { name: /Execute All/i })` query, so no ambiguity).

- [ ] **Step 4: Commit**

```bash
git add demo_api_ui/src/components/ProtocolPlayground/ProtocolViewer.jsx
git commit -m "feat(protocol-playground): render per-step cards between the diagram and controls"
```

---

## Task 8: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Regenerate the spec one more time (idempotency check)**

```bash
cd demo_api_server
node scripts/generateProtocolFlows.js
git status --porcelain demo_api_ui/src/data/protocolFlows.json
```

Expected: no diff — confirms Task 2's annotations were already reflected
correctly and nothing drifted.

- [ ] **Step 2: Run the full server suite**

```bash
cd demo_api_server
CI=true npm test -- --forceExit --maxWorkers=4
```

Expected: 0 new failures (pre-existing repo-wide flakes — see prior PR
notes — may still appear; re-run any failing suite in isolation before
treating it as a regression).

- [ ] **Step 3: Run the full UI suite and build**

```bash
cd demo_api_ui
npm run test:unit
npm run build
```

Expected: all green.

- [ ] **Step 4: Manual live verification**

After merging, syncing the main checkout, and restarting `demo-api-server`
(per root `CLAUDE.md` — Node needs a restart to pick up new route/generator
code; the `ui` container's Vite dev server hot-reloads `src/` automatically):

1. Load `/protocol-playground`.
2. For RAR: confirm the bottom of the viewer now shows an RFC 9396 badge +
   "What it solves" paragraph (not blank), step cards render above the
   controls with real titles, and clicking a step card's own Execute
   button runs that step and shows a status badge.
3. For a flow with no real token-chain events (e.g. PKCE): confirm the
   Activity panel still renders a token-chain-styled card (not raw JSON) —
   with an honest "HTTP 200" detail line, not fabricated PingOne narration.
4. Confirm the "Raw response" disclosure still shows the literal wire
   response when expanded.

---

## Self-Review

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| Casing fix (`txn-tokens` → `TXN Tokens`) | Already shipped in PR #1640, prior to this plan |
| Token-chain-styled Activity panel, real events verbatim / synthesized honestly otherwise | Task 3, 4, 5 |
| Raw JSON kept as a secondary disclosure | Task 5 |
| `@rfc` tag + prose capture → `ProtocolExplainer` populated | Task 1, 2 |
| `spec.ai` intentionally left unset | Task 1 (never set in `buildFlowSpecs`) |
| Per-step cards: number, title, description, actor chips, own Execute button | Task 6, 7 |
| Additive to Execute All / Next Step / Reset (not a replacement) | Task 7 (both rendered) |
| `@title` tag, ~19 steps annotated | Task 2 |

**Placeholder scan:** none found — every step has real code, real tag
values, real test assertions.

**Type consistency:** `buildChainEvents` returns `{ id, label, status,
detail, token }` in Task 3; `TokenChainEventCard` (Task 4) destructures
exactly those fields; `ActivityPanel` (Task 5) passes the array through
unchanged. `StepCard` (Task 6) reads `step.title`, `step.description`,
`step.fromActor`, `step.toActor`, `step.step` — all fields Task 1/2's
generator changes actually produce. `handleExecuteStep` (Task 7) matches
the existing `engine.executeStep(stepId)` signature already used by
`handleStep`.

Plan complete and saved to
`docs/superpowers/plans/2026-08-11-protocol-playground-education-tokenchain.md`.

**Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**

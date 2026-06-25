# Token Chain Completeness + Vertical Feature Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the token chain's visibility gap (tool result, silent fallback, exchange metadata) and bring all non-banking verticals to feature parity with banking (admin pages, sensitive-data access pattern, generalized education paths, accurate architecture sim).

**Architecture:** Phase 1 adds three new backend events (`agent-actor-token-unavailable`, `mcp-tool-invoked`, `mcp-tool-result`) emitted at the right call sites and renders them in `TokenChainDisplay.js`. Phase 2 verifies non-banking vertical agent flows, then adds admin pages, sensitive-data tools, shared education paths, and patches the architecture sim — each vertical built as an isolated addition following existing patterns.

**Tech Stack:** Node.js/Express (BFF), React/CRA (UI), CommonJS modules in `demo_api_server`, ES modules + JSX in `demo_api_ui/src`.

**Spec:** [docs/superpowers/specs/2026-06-06-token-chain-vertical-parity-design.md](../specs/2026-06-06-token-chain-vertical-parity-design.md)

---

## Phase 1 — Token Chain Improvements

### Task 1: Export `buildTokenEvent` from `agentMcpTokenService.js`

The new events in Tasks 2 and 3 are emitted from `agentTool.js`, which currently has no access to `buildTokenEvent`. Export it so callers can build correctly-shaped events.

**Files:**
- Modify: `demo_api_server/services/agentMcpTokenService.js` (bottom of file, exports)
- Modify: `demo_api_server/routes/agentTool.js` (add import)

- [ ] **Step 1: Find the current module.exports in agentMcpTokenService.js**

Run: `grep -n "module.exports" demo_api_server/services/agentMcpTokenService.js`

Expected: one `module.exports = { ... }` block near end of file. Note the line number.

- [ ] **Step 2: Add `buildTokenEvent` to the exports**

In `demo_api_server/services/agentMcpTokenService.js`, add `buildTokenEvent` to the `module.exports` object:

```js
module.exports = {
  // ... existing exports ...
  buildTokenEvent,
  resolveMcpAccessTokenWithEvents,
};
```

- [ ] **Step 3: Import `buildTokenEvent` in `agentTool.js`**

In `demo_api_server/routes/agentTool.js`, update the existing import of `resolveMcpAccessTokenWithEvents` (line ~156) to also destructure `buildTokenEvent`:

```js
const { resolveMcpAccessTokenWithEvents, buildTokenEvent } = require('../services/agentMcpTokenService');
```

Note: this import is currently inside the try block. Move it to the top of the file with other requires, or keep it co-located — either is fine as long as both names are available.

- [ ] **Step 4: Verify the import resolves**

Run: `node -e "const { buildTokenEvent } = require('./demo_api_server/services/agentMcpTokenService'); console.log(typeof buildTokenEvent);"`

Expected: `function`

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/services/agentMcpTokenService.js demo_api_server/routes/agentTool.js
git commit -m "feat(token-chain): export buildTokenEvent for use in agentTool"
```

---

### Task 2: Replace silent `on-behalf-of-warning` with structured `agent-actor-token-unavailable`

Currently when `PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_ID` is not set the chain emits `on-behalf-of-warning` with status `skipped` (gray). This hides a meaningful gap. Replace it with a structured `agent-actor-token-unavailable` event that renders red and explains the impact.

**Files:**
- Modify: `demo_api_server/services/agentMcpTokenService.js` (~line 1235)

- [ ] **Step 1: Find the on-behalf-of-warning emission**

Run: `grep -n "on-behalf-of-warning" demo_api_server/services/agentMcpTokenService.js`

Note the line number. Read 10 lines around it to understand context.

- [ ] **Step 2: Replace the event emission**

Replace the existing `on-behalf-of-warning` `buildTokenEvent` call with:

```js
tokenEvents.push(buildTokenEvent(
  'agent-actor-token-unavailable',
  'Agent OAuth Client Not Configured',
  'degraded',
  null,
  'No MCP token exchanger client ID is configured (PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_ID is unset). ' +
  'The RFC 8693 exchange will proceed as subject-only — the returned MCP token will have no act claim, ' +
  'meaning there is no cryptographic proof of which agent acted on behalf of the user.',
  {
    reason: 'not-configured',
    impact: 'act claim will be absent from exchanged token',
    rfc: 'RFC 8693 §4.4',
  }
));
```

- [ ] **Step 3: Find where CC token fetch can fail and add a parallel event**

Run: `grep -n "agent-actor-token\|exchanger.*fetch\|actor.*token.*fail\|fetch.*actor" demo_api_server/services/agentMcpTokenService.js | head -20`

Find the catch block where the agent CC token fetch fails (the block that handles errors from fetching the `PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_ID` token). Add the same event with `reason: 'fetch-failed'` and status `'failed'`:

```js
tokenEvents.push(buildTokenEvent(
  'agent-actor-token-unavailable',
  'Agent OAuth Client Token Failed',
  'failed',
  null,
  'The MCP token exchanger failed to obtain a client credentials token. ' +
  'RFC 8693 exchange cannot include an actor token — the MCP token will have no act claim.',
  {
    reason: 'fetch-failed',
    impact: 'act claim will be absent from exchanged token',
    rfc: 'RFC 8693 §4.4',
    error: err.message,
  }
));
```

- [ ] **Step 4: Update any tests that reference on-behalf-of-warning**

Run: `grep -rn "on-behalf-of-warning" demo_api_server/tests/`

For each test that checks for `'on-behalf-of-warning'`, update the expected event id to `'agent-actor-token-unavailable'` and the expected status from `'skipped'` to `'degraded'`.

- [ ] **Step 5: Run the token service tests**

Run: `cd demo_api_server && npx jest agentMcpToken --no-coverage 2>&1 | tail -20`

Expected: all passing.

- [ ] **Step 6: Commit**

```bash
git add demo_api_server/services/agentMcpTokenService.js demo_api_server/tests/
git commit -m "feat(token-chain): replace silent on-behalf-of-warning with structured agent-actor-token-unavailable"
```

---

### Task 3: Emit `mcp-tool-invoked` and `mcp-tool-result` events in `agentTool.js`

The MCP tool call happens in `demo_api_server/routes/agentTool.js` lines ~169–202. After the token is resolved and before/after `mcpCallTool`, push two new events into `tokenEvents`.

**Files:**
- Modify: `demo_api_server/routes/agentTool.js` (~lines 169–202)

- [ ] **Step 1: Read the current MCP call block in agentTool.js**

Read `demo_api_server/routes/agentTool.js` lines 169–203. Confirm the structure:
```
// Execute tool via MCP WebSocket client
let result;
try {
  const { mcpCallTool } = require('../services/mcpWebSocketClient');
  result = await mcpCallTool(tool, args || {}, mcpToken);
} catch (err) { ... }
res.json({ result, tokenEvents });
```

- [ ] **Step 2: Add mcp-tool-invoked before the MCP call, mcp-tool-result after**

Replace the MCP call block (lines ~169–202) with:

```js
// ---------------------------------------------------------------------------
// Execute tool via MCP WebSocket client
// ---------------------------------------------------------------------------
const mcpStart = Date.now();
tokenEvents.push(buildTokenEvent(
  'mcp-tool-invoked',
  `MCP Tool Invoked: ${tool}`,
  'acquiring',
  null,
  'The exchanged token is forwarded to the MCP Server as a Bearer token. ' +
  'The MCP Server validates the audience (aud) matches its own resource URI before executing the tool.',
  { toolName: tool, tokenAud: mcpToken ? '(exchanged token)' : '(no token)', rfc: 'RFC 8693 §3' }
));

let result;
try {
  const { mcpCallTool } = require('../services/mcpWebSocketClient');
  result = await mcpCallTool(tool, args || {}, mcpToken);
  tokenEvents.push(buildTokenEvent(
    'mcp-tool-result',
    `MCP Tool Result: ${tool}`,
    'active',
    null,
    'The MCP Server executed the tool using the narrowed delegation token and returned a result. ' +
    'The token\'s sub (user identity) and aud (resource boundary) were enforced throughout.',
    {
      toolName: tool,
      duration: Date.now() - mcpStart,
      resultStatus: 'success',
      rfc: 'RFC 8693',
    }
  ));
} catch (err) {
  tokenEvents.push(buildTokenEvent(
    'mcp-tool-result',
    `MCP Tool Failed: ${tool}`,
    'failed',
    null,
    'The MCP tool call failed after the token exchange completed.',
    {
      toolName: tool,
      duration: Date.now() - mcpStart,
      resultStatus: 'failed',
      error: err.message,
      rfc: 'RFC 8693',
    }
  ));
  console.error('[agent-tool] MCP tool call failed:', err.message);
  // Check for HITL signal (428 shape from MCP gateway)
  if (err.statusCode === 428 || err.code === 'hitl_required') {
    return res.status(200).json({
      result: {
        hitlRequired: true,
        interruptId: err.challengeId || ('hitl-' + Date.now()),
        consentId: err.challengeId,
        reason: err.challengeType || 'consent_required',
        message: err.message || 'User approval required',
        expiresAt: err.expiresAt || new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      },
      tokenEvents,
    });
  }
  return res.status(502).json({
    error: err.code || 'tool_call_failed',
    message: err.message,
    tokenEvents,
  });
}

// ---------------------------------------------------------------------------
// Return result + token events (no raw tokens)
// ---------------------------------------------------------------------------
res.json({ result, tokenEvents });
```

- [ ] **Step 3: Run the agentTool tests**

Run: `cd demo_api_server && npx jest agentTool agentPathAudit --no-coverage 2>&1 | tail -20`

Expected: all passing. If tests mock `mcpCallTool`, they may need `tokenEvents` expectations updated — add the two new event ids to any expected tokenEvents arrays.

- [ ] **Step 4: Commit**

```bash
git add demo_api_server/routes/agentTool.js
git commit -m "feat(token-chain): emit mcp-tool-invoked and mcp-tool-result events in agentTool"
```

---

### Task 4: Verify `exchange-in-progress` already emits `exchangeRequest` metadata

The design called for surfacing `exchangeRequest: { audience, scopesRequested, subjectTokenType, actorTokenPresent }` in the exchange step. The backend may already emit this. Check before adding anything.

**Files:**
- Possibly modify: `demo_api_server/services/agentMcpTokenService.js` (~line 1279)

- [ ] **Step 1: Read the exchange-in-progress emission**

Run: `grep -n "exchange-in-progress" demo_api_server/services/agentMcpTokenService.js`

Read 20 lines around that line. Confirm whether the emitted event's `extra` object includes `exchangeRequest` (or equivalent fields: `audience`/`scope`/`has_actor_token`).

- [ ] **Step 2a: If exchangeRequest is already present — no backend change needed**

Skip to Step 3 (UI only).

- [ ] **Step 2b: If exchangeRequest is absent — add it**

In the `buildTokenEvent` call for `exchange-in-progress`, add to the `extra` argument:

```js
exchangeRequest: {
  audience: requestedAudience,          // the aud being requested
  scopesRequested: requestedScopes,     // string[] of scopes in the exchange request
  subjectTokenType: 'urn:ietf:params:oauth:token-type:access_token',
  actorTokenPresent: !!actorToken,
},
```

Where `requestedAudience`, `requestedScopes`, and `actorToken` are the local variables in scope at that point (they will already exist since they're passed to the exchange call).

- [ ] **Step 3: Commit (if backend changed)**

```bash
git add demo_api_server/services/agentMcpTokenService.js
git commit -m "feat(token-chain): surface exchangeRequest metadata in exchange-in-progress event"
```

---

### Task 5: Render new events in `TokenChainDisplay.js`

Add rendering for `mcp-tool-invoked`, `mcp-tool-result`, and `agent-actor-token-unavailable`. Also add the collapsible exchange-request detail.

**Files:**
- Modify: `demo_api_ui/src/components/TokenChainDisplay.js`

- [ ] **Step 1: Read the CLAIMS_STRIP_IDS block**

Read `demo_api_ui/src/components/TokenChainDisplay.js` around line 1802. Note the Set definition.

- [ ] **Step 2: Add new event IDs to CLAIMS_STRIP_IDS**

`mcp-tool-invoked` and `mcp-tool-result` don't have JWT claims (decoded is null) so they do NOT need claims strip rendering. `agent-actor-token-unavailable` also has no JWT. Leave CLAIMS_STRIP_IDS unchanged.

- [ ] **Step 3: Read the educational box rendering block**

Read `TokenChainDisplay.js` lines 1431–1503. Note the `if (event.id === 'user-token')` pattern for conditional box rendering.

- [ ] **Step 4: Add McpToolInvokedEduBox component**

Before the `EventDetail` component (around line 1391), add:

```jsx
function McpToolResultBox({ event }) {
  if (event.id !== 'mcp-tool-invoked' && event.id !== 'mcp-tool-result') return null;
  const isInvoked = event.id === 'mcp-tool-invoked';
  const succeeded = event.resultStatus === 'success';
  const failed = event.resultStatus === 'failed';
  return (
    <div className="tcd-edu-box tcd-edu-box--mcp">
      <div className="tcd-edu-box__title">
        {isInvoked ? 'Tool Dispatch' : (succeeded ? '✅ Tool Succeeded' : '❌ Tool Failed')}
      </div>
      <div className="tcd-edu-box__body">
        {isInvoked && (
          <p>
            The exchanged token is forwarded to the MCP Server as a Bearer token.
            The MCP Server validates <code>aud</code> before executing the tool.
          </p>
        )}
        {!isInvoked && event.toolName && (
          <p>
            Tool <strong>{event.toolName}</strong> completed in{' '}
            <strong>{event.duration}ms</strong>.
            {failed && event.error && <span> Error: {event.error}</span>}
          </p>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Add AgentActorUnavailableBox component**

After `McpToolResultBox`, add:

```jsx
function AgentActorUnavailableBox({ event }) {
  if (event.id !== 'agent-actor-token-unavailable') return null;
  return (
    <div className="tcd-edu-box tcd-edu-box--warning">
      <div className="tcd-edu-box__title">Degraded Delegation Path</div>
      <div className="tcd-edu-box__body">
        <p>
          <strong>Reason:</strong> {event.reason === 'not-configured'
            ? 'PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_ID is not set.'
            : 'Client credentials token fetch failed.'}
        </p>
        <p>
          <strong>Impact:</strong> The RFC 8693 exchange will proceed without an actor token.
          The resulting MCP token will have no <code>act</code> claim — there is no
          cryptographic proof of which agent acted on behalf of the user.
        </p>
        <p className="tcd-edu-box__rfc">RFC 8693 §4.4</p>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Wire the new boxes into EventDetail**

In the `EventDetail` component (lines 1431–1503), add after the last existing educational box:

```jsx
<McpToolResultBox event={event} />
<AgentActorUnavailableBox event={event} />
```

- [ ] **Step 7: Add collapsible exchange-request panel in EventDetail**

Inside `EventDetail`, after the existing explanation section, add:

```jsx
{event.exchangeRequest && (
  <details className="tcd-collapsible">
    <summary className="tcd-collapsible__trigger">Exchange Request Parameters</summary>
    <table className="tcd-claims-table">
      <tbody>
        <tr><td>audience</td><td><code>{event.exchangeRequest.audience}</code></td></tr>
        <tr><td>scopes</td><td><code>{Array.isArray(event.exchangeRequest.scopesRequested)
          ? event.exchangeRequest.scopesRequested.join(' ')
          : event.exchangeRequest.scopesRequested}</code></td></tr>
        <tr><td>subject_token_type</td><td><code>{event.exchangeRequest.subjectTokenType}</code></td></tr>
        <tr><td>actor_token_present</td><td>{event.exchangeRequest.actorTokenPresent ? '✅ yes' : '❌ no'}</td></tr>
      </tbody>
    </table>
  </details>
)}
```

- [ ] **Step 8: Build and check for errors**

Run: `cd demo_api_ui && npm run build 2>&1 | tail -30`

Expected: exit 0. Fix any JSX syntax errors before proceeding.

- [ ] **Step 9: Commit**

```bash
git add demo_api_ui/src/components/TokenChainDisplay.js
git commit -m "feat(token-chain): render mcp-tool-invoked, mcp-tool-result, agent-actor-token-unavailable, exchange-request collapsible"
```

---

### Task 6: Phase 1 manual verification

Confirm the three gaps are closed end-to-end with the running app.

- [ ] **Step 1: Start the app**

Run: `./run.sh` from the repo root. Wait for all services to report healthy.

- [ ] **Step 2: Make an MCP tool call via the agent**

Log in as a demo user → open the Banking vertical → open the agent sidebar → ask "What are my accounts?"

Expected token chain panel shows:
1. `user-token` (active/green)
2. `exchange-in-progress` with a "Exchange Request Parameters" collapsible
3. `exchanged-token` (exchanged/cyan)
4. `mcp-tool-invoked` (acquiring/amber then active/green)
5. `mcp-tool-result` (active/green) with tool name and duration

- [ ] **Step 3: Test the degraded path**

Temporarily comment out `PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_ID` in `demo_api_server/.env`. Restart the BFF (`kill` + `./run.sh`). Make another agent call.

Expected: chain shows `agent-actor-token-unavailable` with status "Degraded" (red badge) and the `AgentActorUnavailableBox` explanation.

Restore the env var and restart.

- [ ] **Step 4: Build one final time**

Run: `cd demo_api_ui && npm run build 2>&1 | tail -5`

Expected: exit 0.

---

## Phase 2 — Vertical Parity

### Task 7: Functional smoke test — all non-banking verticals (2a gate)

Before building any new content, verify the agent works end-to-end on all four non-banking verticals. Fix any failures before proceeding to Tasks 8–14.

**Files:**
- Possibly fix: `demo_api_server/config/verticals/*/index.js` and related

- [ ] **Step 1: Switch to healthcare vertical and make an agent tool call**

In the app, use the vertical picker in the sidebar to switch to **CareConnect (healthcare)**. Ask the agent: "Show my upcoming appointments."

Expected: agent responds with appointment data, token chain panel shows exchange events, no errors in `/tmp/demo-api.log`.

Run: `grep -i "error\|fail\|unhandled" /tmp/demo-api.log | tail -20` to check for silent failures.

- [ ] **Step 2: Verify healthcare HITL chip**

On the healthcare dashboard, click the "Release Records" chip (or equivalent HITL-gated action). Expected: a 428-style consent dialog appears.

- [ ] **Step 3: Switch to Retail (Great Buy) and test an agent call**

Switch vertical → ask "Show my recent orders." Verify response + token chain + no log errors.

- [ ] **Step 4: Switch to Sporting-Goods (Super Sports) and test**

Switch vertical → ask "Show my gear rentals." Verify response + chain + no errors.

- [ ] **Step 5: Switch to Workforce (WX Workforce) and test**

Switch vertical → ask "What's my PTO balance?" Verify response + chain + no errors.

- [ ] **Step 6: If any vertical fails — fix before continuing**

Check `/tmp/demo-api.log` for root cause. Common failure patterns:
- `Unknown tool` → tool name mismatch between heuristic and executeTool handler
- `401` from exchange → vertical's tool scopes not provisioned in PingOne resource server
- Agent does nothing → heuristic regex not matching natural language

Fix the specific failure. Commit the fix before continuing.

- [ ] **Step 7: Commit smoke test pass (no code change needed if all pass)**

If all verticals pass with no fixes needed, create a log entry:

```bash
git commit --allow-empty -m "chore: confirm all non-banking verticals pass functional smoke test"
```

---

### Task 8: Generalize `api_key_demo` and `dual_token_demo` to shared education paths

These heuristics currently live only in `demo_api_server/config/verticals/banking/index.js`. Move them to a shared module imported by all vertical index files.

**Files:**
- Create: `demo_api_server/config/verticals/shared/educationHeuristics.js`
- Modify: `demo_api_server/config/verticals/banking/index.js`
- Modify: `demo_api_server/config/verticals/healthcare/index.js`
- Modify: `demo_api_server/config/verticals/retail/index.js`
- Modify: `demo_api_server/config/verticals/sporting-goods/index.js`
- Modify: `demo_api_server/config/verticals/workforce/index.js`

- [ ] **Step 1: Read the api_key_demo and dual_token_demo heuristics in banking/index.js**

Run: `grep -n "api_key_demo\|dual_token_demo" demo_api_server/config/verticals/banking/index.js`

Read those lines to get the exact `{ re, action }` objects.

- [ ] **Step 2: Create the shared education heuristics module**

Create `demo_api_server/config/verticals/shared/educationHeuristics.js`:

```js
/**
 * Education-path heuristics shared across all verticals.
 * These trigger demo flows that are not vertical-specific.
 */
const EDUCATION_HEURISTICS = [
  { re: /\bapi[_\s-]?key\b|\bcredential[_\s-]?swap\b/i, action: 'api_key_demo' },
  { re: /\bdual[_\s-]?token\b|\btwo[_\s-]?token\b/i, action: 'dual_token_demo' },
];

module.exports = { EDUCATION_HEURISTICS };
```

Adjust the regex values to match exactly what was in banking/index.js (copy from Step 1 output).

- [ ] **Step 3: Update banking/index.js to import and spread EDUCATION_HEURISTICS**

In `demo_api_server/config/verticals/banking/index.js`:

1. Add at the top: `const { EDUCATION_HEURISTICS } = require('../shared/educationHeuristics');`
2. Remove the `api_key_demo` and `dual_token_demo` entries from the `HEURISTICS` array.
3. Change the export: `getHeuristics: () => [...HEURISTICS, ...EDUCATION_HEURISTICS],`

- [ ] **Step 4: Update each non-banking vertical index.js**

For each of `healthcare/index.js`, `retail/index.js`, `sporting-goods/index.js`, `workforce/index.js`:

1. Add at the top: `const { EDUCATION_HEURISTICS } = require('../shared/educationHeuristics');`
2. Change the export: `getHeuristics: () => [...HEURISTICS, ...EDUCATION_HEURISTICS],`

- [ ] **Step 5: Test that heuristics still resolve correctly for banking**

Run: `cd demo_api_server && node -e "
const b = require('./config/verticals/banking');
const h = b.getHeuristics();
const apiKey = h.find(x => x.action === 'api_key_demo');
const dual = h.find(x => x.action === 'dual_token_demo');
console.log('api_key_demo:', !!apiKey);
console.log('dual_token_demo:', !!dual);
console.log('total heuristics:', h.length);
"`

Expected: `api_key_demo: true`, `dual_token_demo: true`.

- [ ] **Step 6: Test that healthcare now has the education heuristics**

Run: `cd demo_api_server && node -e "
const h = require('./config/verticals/healthcare');
const heuristics = h.getHeuristics();
const apiKey = heuristics.find(x => x.action === 'api_key_demo');
console.log('healthcare api_key_demo:', !!apiKey);
"`

Expected: `healthcare api_key_demo: true`.

- [ ] **Step 7: Commit**

```bash
git add demo_api_server/config/verticals/shared/educationHeuristics.js \
        demo_api_server/config/verticals/banking/index.js \
        demo_api_server/config/verticals/healthcare/index.js \
        demo_api_server/config/verticals/retail/index.js \
        demo_api_server/config/verticals/sporting-goods/index.js \
        demo_api_server/config/verticals/workforce/index.js
git commit -m "feat(verticals): generalize api_key_demo/dual_token_demo to shared education heuristics"
```

---

### Task 9: Add `sensitive_patient_records` to healthcare vertical

Add a HITL-gated sensitive-data tool to healthcare following the `sensitive_account_details` pattern in banking.

**Files:**
- Modify: `demo_api_server/config/verticals/healthcare/index.js`
- Modify: `demo_api_server/config/verticals/healthcare/manifest.json` (chips10 array)

- [ ] **Step 1: Read sensitive_account_details in banking/index.js for the exact pattern**

Run: `grep -n "sensitive_account_details" demo_api_server/config/verticals/banking/index.js`

Read the heuristic entry, the actionAlias entry, and the executeTool handler for `sensitive_account_details`. Note the `authz: { consent: true }` field and the `scopes` array.

- [ ] **Step 2: Read the healthcare HEURISTICS array**

Read `demo_api_server/config/verticals/healthcare/index.js` lines 1–48 in full.

- [ ] **Step 3: Add heuristic entry to HEURISTICS in healthcare/index.js**

Add to the `HEURISTICS` array before the closing `]`:

```js
{ re: /\bsensitive\b.*\b(record|patient|data)\b|\b(patient|record)\b.*\bsensitive\b/i, action: 'sensitive_patient_records' },
```

- [ ] **Step 4: Add executeTool handler for sensitive_patient_records**

In the `executeTool` export handler in `healthcare/index.js`, add a case for the new tool. The tool returns a placeholder response — the HITL gate (consent dialog) is the demo point, not the data returned:

```js
if (name === 'sensitive_patient_records') {
  return {
    result: {
      data: {
        patientId: ctx?.userSub || 'unknown',
        records: [
          { type: 'diagnosis', date: '2025-11-03', summary: 'Annual physical — normal' },
          { type: 'prescription', date: '2025-11-03', medication: '[REDACTED]', status: 'active' },
        ],
        sensitiveDataAccessed: true,
        accessGrantedBy: 'consent',
      },
    },
    render: 'text',
  };
}
```

- [ ] **Step 5: Add the tool definition to getTools() return**

In `healthcare/index.js`, `getTools()` delegates to `buildHealthcareTools(store)`. Find that builder and add `sensitive_patient_records` to its tool list:

Run: `grep -rn "buildHealthcareTools\|list_appointments\|view_records" demo_api_server/config/verticals/healthcare/`

Read the file that defines `buildHealthcareTools`. Add:

```js
{
  name: 'sensitive_patient_records',
  description: 'Access highly sensitive patient health records. Requires explicit user consent.',
  inputSchema: { type: 'object', properties: {}, required: [] },
  scopes: ['read'],
  authz: { consent: true },
},
```

- [ ] **Step 6: Add chip to healthcare manifest.json chips10**

Read `demo_api_server/config/verticals/healthcare/manifest.json`. Find the `chips10` array. Add:

```json
{
  "label": "Sensitive Records",
  "action": "sensitive_patient_records",
  "hitl": true
}
```

Match the exact schema of the other `chips10` entries (some may have `icon`, `description`, etc. — copy the structure).

- [ ] **Step 7: Test the tool resolves without crashing**

Run: `cd demo_api_server && node -e "
const h = require('./config/verticals/healthcare');
const tools = h.getTools();
const t = tools.find(x => x.name === 'sensitive_patient_records');
console.log('tool found:', !!t);
console.log('authz:', JSON.stringify(t?.authz));
console.log('scopes:', t?.scopes);
"`

Expected: `tool found: true`, `authz: {"consent":true}`.

- [ ] **Step 8: Build**

Run: `cd demo_api_ui && npm run build 2>&1 | tail -5`

Expected: exit 0.

- [ ] **Step 9: Commit**

```bash
git add demo_api_server/config/verticals/healthcare/
git commit -m "feat(healthcare): add sensitive_patient_records HITL-gated tool"
```

---

### Task 10: Add sensitive-data tools to retail, sporting-goods, and workforce

Repeat the Task 9 pattern for the remaining three verticals. The steps are identical — only the names and field values differ.

**Files:**
- Modify: `demo_api_server/config/verticals/retail/index.js` + `manifest.json`
- Modify: `demo_api_server/config/verticals/sporting-goods/index.js` + `manifest.json`
- Modify: `demo_api_server/config/verticals/workforce/index.js` + `manifest.json`

- [ ] **Step 1: Add `sensitive_order_history` to retail**

Heuristic regex: `/\bsensitive\b.*\border\b|\border\b.*\bsensitive\b/i`

Tool definition:
```js
{
  name: 'sensitive_order_history',
  description: 'Access full order history including payment details. Requires explicit user consent.',
  inputSchema: { type: 'object', properties: {}, required: [] },
  scopes: ['read'],
  authz: { consent: true },
}
```

executeTool handler returns:
```js
{
  result: {
    data: {
      customerId: ctx?.userSub || 'unknown',
      orders: [
        { orderId: 'ORD-9982', date: '2025-12-01', total: 249.99, paymentLast4: '****' },
        { orderId: 'ORD-8841', date: '2025-10-14', total: 89.00, paymentLast4: '****' },
      ],
      sensitiveDataAccessed: true,
      accessGrantedBy: 'consent',
    },
  },
  render: 'text',
}
```

Chip label: `"Sensitive Orders"`, action: `"sensitive_order_history"`, hitl: true.

- [ ] **Step 2: Add `sensitive_membership_details` to sporting-goods**

Heuristic regex: `/\bsensitive\b.*\bmember\b|\bmember\b.*\bsensitive\b/i`

Tool definition:
```js
{
  name: 'sensitive_membership_details',
  description: 'Access membership and loyalty account details including payment methods. Requires explicit user consent.',
  inputSchema: { type: 'object', properties: {}, required: [] },
  scopes: ['read'],
  authz: { consent: true },
}
```

executeTool handler returns:
```js
{
  result: {
    data: {
      memberId: ctx?.userSub || 'unknown',
      membershipTier: 'Gold',
      paymentMethod: { type: 'card', last4: '****', expiry: '**/**' },
      lifetimeSpend: 1842.50,
      sensitiveDataAccessed: true,
      accessGrantedBy: 'consent',
    },
  },
  render: 'text',
}
```

Chip label: `"Sensitive Membership"`, action: `"sensitive_membership_details"`, hitl: true.

- [ ] **Step 3: Add `sensitive_payroll_details` to workforce**

Heuristic regex: `/\bsensitive\b.*\b(payroll|salary|pay)\b|\b(payroll|salary|pay)\b.*\bsensitive\b/i`

Tool definition:
```js
{
  name: 'sensitive_payroll_details',
  description: 'Access payroll and salary details. Requires explicit user consent.',
  inputSchema: { type: 'object', properties: {}, required: [] },
  scopes: ['read'],
  authz: { consent: true },
}
```

executeTool handler returns:
```js
{
  result: {
    data: {
      employeeId: ctx?.userSub || 'unknown',
      baseSalary: '[REDACTED]',
      lastPayslipDate: '2025-12-31',
      bankAccountLast4: '****',
      sensitiveDataAccessed: true,
      accessGrantedBy: 'consent',
    },
  },
  render: 'text',
}
```

Chip label: `"Payroll Details"`, action: `"sensitive_payroll_details"`, hitl: true.

- [ ] **Step 4: Verify all three tool definitions**

Run: `cd demo_api_server && node -e "
['retail','sporting-goods','workforce'].forEach(v => {
  const m = require('./config/verticals/' + v);
  const tools = m.getTools();
  const names = { retail: 'sensitive_order_history', 'sporting-goods': 'sensitive_membership_details', workforce: 'sensitive_payroll_details' };
  const t = tools.find(x => x.name === names[v]);
  console.log(v + ':', !!t, t?.authz);
});
"`

Expected: all three show `true { consent: true }`.

- [ ] **Step 5: Build**

Run: `cd demo_api_ui && npm run build 2>&1 | tail -5`

Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add demo_api_server/config/verticals/retail/ \
        demo_api_server/config/verticals/sporting-goods/ \
        demo_api_server/config/verticals/workforce/
git commit -m "feat(verticals): add sensitive-data HITL tools to retail, sporting-goods, workforce"
```

---

### Task 11: Create vertical admin ops pages (healthcare, retail, sporting-goods, workforce)

Create one admin dashboard component per non-banking vertical, following the `BankingAdminOps` pattern: three-column layout, async API calls via `bffAxios`, card-based actions.

**Files:**
- Create: `demo_api_ui/src/components/HealthcareAdminOps.js`
- Create: `demo_api_ui/src/components/RetailAdminOps.js`
- Create: `demo_api_ui/src/components/SportingGoodsAdminOps.js`
- Create: `demo_api_ui/src/components/WorkforceAdminOps.js`

- [ ] **Step 1: Read BankingAdminOps.js top-level structure**

Read `demo_api_ui/src/components/BankingAdminOps.js` lines 1–50 and 205–240. Note:
- Import list
- Component signature `({ user, onLogout })`
- The three-column layout class names: `banking-admin-dashboard`, `dashboard-content ud-body`, `ud-token-rail`, `ud-agent-column`, `ud-center ud-banking-column`

- [ ] **Step 2: Create HealthcareAdminOps.js**

Create `demo_api_ui/src/components/HealthcareAdminOps.js`:

```jsx
import { useState } from 'react';
import bffAxios from '../services/bffAxios';
import TokenChainDisplay from './TokenChainDisplay';
import BankingAgent from './BankingAgent';

export default function HealthcareAdminOps({ user, onLogout }) {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);

  async function runLookup() {
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const { data } = await bffAxios.get('/api/admin/healthcare/lookup', { params: { q: query } });
      setResults(data);
    } catch (err) {
      const st = err.response?.status;
      if (st === 401) setError('Admin session expired. Please log in again.');
      else if (st === 403) setError('Admin access required.');
      else setError(err.response?.data?.message || err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="banking-admin-dashboard">
      <div className="dashboard-content ud-body">
        <div className="ud-token-rail">
          <TokenChainDisplay />
        </div>
        <div className="ud-agent-column">
          <BankingAgent user={user} onLogout={onLogout} />
        </div>
        <div className="ud-center ud-banking-column">
          <div className="app-page-card">
            <div className="card-header">
              <h3>Patient Lookup</h3>
              <p>Search patient records by name or patient ID.</p>
            </div>
            <div className="card-body">
              <div className="input-group mb-3">
                <input
                  id="hc-lookup-query"
                  className="form-control"
                  placeholder="Patient name or ID"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && runLookup()}
                />
                <button className="btn btn-primary" onClick={runLookup} disabled={loading}>
                  {loading ? 'Searching…' : 'Search'}
                </button>
              </div>
              {error && <div className="alert alert-danger">{error}</div>}
              {results && (
                <div className="table-responsive">
                  <pre className="tcd-json-block">{JSON.stringify(results, null, 2)}</pre>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create RetailAdminOps.js**

Create `demo_api_ui/src/components/RetailAdminOps.js` — same structure as HealthcareAdminOps but:
- Card title: `"Order Lookup"`
- Placeholder: `"Order ID or customer email"`
- API endpoint: `'/api/admin/retail/lookup'`
- `id="retail-lookup-query"`

```jsx
import { useState } from 'react';
import bffAxios from '../services/bffAxios';
import TokenChainDisplay from './TokenChainDisplay';
import BankingAgent from './BankingAgent';

export default function RetailAdminOps({ user, onLogout }) {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);

  async function runLookup() {
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const { data } = await bffAxios.get('/api/admin/retail/lookup', { params: { q: query } });
      setResults(data);
    } catch (err) {
      const st = err.response?.status;
      if (st === 401) setError('Admin session expired. Please log in again.');
      else if (st === 403) setError('Admin access required.');
      else setError(err.response?.data?.message || err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="banking-admin-dashboard">
      <div className="dashboard-content ud-body">
        <div className="ud-token-rail">
          <TokenChainDisplay />
        </div>
        <div className="ud-agent-column">
          <BankingAgent user={user} onLogout={onLogout} />
        </div>
        <div className="ud-center ud-banking-column">
          <div className="app-page-card">
            <div className="card-header">
              <h3>Order Lookup</h3>
              <p>Search orders by order ID or customer email.</p>
            </div>
            <div className="card-body">
              <div className="input-group mb-3">
                <input
                  id="retail-lookup-query"
                  className="form-control"
                  placeholder="Order ID or customer email"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && runLookup()}
                />
                <button className="btn btn-primary" onClick={runLookup} disabled={loading}>
                  {loading ? 'Searching…' : 'Search'}
                </button>
              </div>
              {error && <div className="alert alert-danger">{error}</div>}
              {results && (
                <div className="table-responsive">
                  <pre className="tcd-json-block">{JSON.stringify(results, null, 2)}</pre>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Create SportingGoodsAdminOps.js**

Same pattern:
- Card title: `"Gear & Rental Lookup"`
- Placeholder: `"Rental ID or member email"`
- API endpoint: `'/api/admin/sporting-goods/lookup'`
- `id="sg-lookup-query"`

```jsx
import { useState } from 'react';
import bffAxios from '../services/bffAxios';
import TokenChainDisplay from './TokenChainDisplay';
import BankingAgent from './BankingAgent';

export default function SportingGoodsAdminOps({ user, onLogout }) {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);

  async function runLookup() {
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const { data } = await bffAxios.get('/api/admin/sporting-goods/lookup', { params: { q: query } });
      setResults(data);
    } catch (err) {
      const st = err.response?.status;
      if (st === 401) setError('Admin session expired. Please log in again.');
      else if (st === 403) setError('Admin access required.');
      else setError(err.response?.data?.message || err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="banking-admin-dashboard">
      <div className="dashboard-content ud-body">
        <div className="ud-token-rail">
          <TokenChainDisplay />
        </div>
        <div className="ud-agent-column">
          <BankingAgent user={user} onLogout={onLogout} />
        </div>
        <div className="ud-center ud-banking-column">
          <div className="app-page-card">
            <div className="card-header">
              <h3>Gear &amp; Rental Lookup</h3>
              <p>Search rentals and gear orders by rental ID or member email.</p>
            </div>
            <div className="card-body">
              <div className="input-group mb-3">
                <input
                  id="sg-lookup-query"
                  className="form-control"
                  placeholder="Rental ID or member email"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && runLookup()}
                />
                <button className="btn btn-primary" onClick={runLookup} disabled={loading}>
                  {loading ? 'Searching…' : 'Search'}
                </button>
              </div>
              {error && <div className="alert alert-danger">{error}</div>}
              {results && (
                <div className="table-responsive">
                  <pre className="tcd-json-block">{JSON.stringify(results, null, 2)}</pre>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Create WorkforceAdminOps.js**

Same pattern:
- Card title: `"Employee Lookup"`
- Placeholder: `"Employee ID or name"`
- API endpoint: `'/api/admin/workforce/lookup'`
- `id="wf-lookup-query"`

```jsx
import { useState } from 'react';
import bffAxios from '../services/bffAxios';
import TokenChainDisplay from './TokenChainDisplay';
import BankingAgent from './BankingAgent';

export default function WorkforceAdminOps({ user, onLogout }) {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);

  async function runLookup() {
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const { data } = await bffAxios.get('/api/admin/workforce/lookup', { params: { q: query } });
      setResults(data);
    } catch (err) {
      const st = err.response?.status;
      if (st === 401) setError('Admin session expired. Please log in again.');
      else if (st === 403) setError('Admin access required.');
      else setError(err.response?.data?.message || err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="banking-admin-dashboard">
      <div className="dashboard-content ud-body">
        <div className="ud-token-rail">
          <TokenChainDisplay />
        </div>
        <div className="ud-agent-column">
          <BankingAgent user={user} onLogout={onLogout} />
        </div>
        <div className="ud-center ud-banking-column">
          <div className="app-page-card">
            <div className="card-header">
              <h3>Employee Lookup</h3>
              <p>Search employee records by ID or name.</p>
            </div>
            <div className="card-body">
              <div className="input-group mb-3">
                <input
                  id="wf-lookup-query"
                  className="form-control"
                  placeholder="Employee ID or name"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && runLookup()}
                />
                <button className="btn btn-primary" onClick={runLookup} disabled={loading}>
                  {loading ? 'Searching…' : 'Search'}
                </button>
              </div>
              {error && <div className="alert alert-danger">{error}</div>}
              {results && (
                <div className="table-responsive">
                  <pre className="tcd-json-block">{JSON.stringify(results, null, 2)}</pre>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Build to check for import/JSX errors**

Run: `cd demo_api_ui && npm run build 2>&1 | tail -20`

Expected: exit 0. Fix any errors before continuing.

- [ ] **Step 7: Commit the four new components**

```bash
git add demo_api_ui/src/components/HealthcareAdminOps.js \
        demo_api_ui/src/components/RetailAdminOps.js \
        demo_api_ui/src/components/SportingGoodsAdminOps.js \
        demo_api_ui/src/components/WorkforceAdminOps.js
git commit -m "feat(admin): add ops dashboard components for healthcare, retail, sporting-goods, workforce"
```

---

### Task 12: Wire admin routes in App.js and AdminSideNav

Register the four new admin components as routes in `App.js` and add nav entries to `AdminSideNav.jsx`.

**Files:**
- Modify: `demo_api_ui/src/App.js`
- Modify: `demo_api_ui/src/components/AdminSideNav.jsx`

- [ ] **Step 1: Read the existing /admin/banking route in App.js**

Read `demo_api_ui/src/App.js` around line 463–530. Find the `<Route path="/admin/banking" ...>` block. Note its exact position in the file.

- [ ] **Step 2: Add four new admin routes in App.js**

Immediately after the `/admin/banking` route block, add:

```jsx
<Route path="/admin/healthcare" element={
  <AdminRoute user={user}>
    <HealthcareAdminOps user={user} onLogout={logout} />
  </AdminRoute>
} />
<Route path="/admin/retail" element={
  <AdminRoute user={user}>
    <RetailAdminOps user={user} onLogout={logout} />
  </AdminRoute>
} />
<Route path="/admin/sporting-goods" element={
  <AdminRoute user={user}>
    <SportingGoodsAdminOps user={user} onLogout={logout} />
  </AdminRoute>
} />
<Route path="/admin/workforce" element={
  <AdminRoute user={user}>
    <WorkforceAdminOps user={user} onLogout={logout} />
  </AdminRoute>
} />
```

- [ ] **Step 3: Add the four imports at the top of App.js**

Find the existing `import BankingAdminOps` line. Add immediately after it:

```js
import HealthcareAdminOps from './components/HealthcareAdminOps';
import RetailAdminOps from './components/RetailAdminOps';
import SportingGoodsAdminOps from './components/SportingGoodsAdminOps';
import WorkforceAdminOps from './components/WorkforceAdminOps';
```

- [ ] **Step 4: Read the AdminSideNav banking admin entry**

Run: `grep -n "admin/banking\|BankingAdmin\|admin.*banking" demo_api_ui/src/components/AdminSideNav.jsx | head -10`

Read those lines to see the exact nav object shape for the banking admin link.

- [ ] **Step 5: Add nav entries in AdminSideNav.jsx**

Find the nav array entry that links to `/admin/banking`. Immediately after it, add equivalent entries for the four new routes (using the same icon key as the banking entry — `adminOnly: true`):

```js
{ label: 'Healthcare Ops', path: '/admin/healthcare', icon: 'hc', adminOnly: true },
{ label: 'Retail Ops', path: '/admin/retail', icon: 'rt', adminOnly: true },
{ label: 'Sporting Goods Ops', path: '/admin/sporting-goods', icon: 'sg', adminOnly: true },
{ label: 'Workforce Ops', path: '/admin/workforce', icon: 'wf', adminOnly: true },
```

Note: do NOT change the icon rendering function, CSS classes, or layout — the AdminSideNav sidebar is frozen. Only add the four new object entries to the existing array.

- [ ] **Step 6: Build**

Run: `cd demo_api_ui && npm run build 2>&1 | tail -20`

Expected: exit 0.

- [ ] **Step 7: Run App structure tests**

Run: `cd demo_api_ui && npx jest App.structure --no-coverage 2>&1 | tail -20`

Expected: all 13 pass. If a test fails because it expects a specific number of routes and the count changed, update the expected count.

- [ ] **Step 8: Commit**

```bash
git add demo_api_ui/src/App.js demo_api_ui/src/components/AdminSideNav.jsx
git commit -m "feat(admin): wire /admin/healthcare, /admin/retail, /admin/sporting-goods, /admin/workforce routes and nav entries"
```

---

### Task 13: Add stub BFF admin lookup endpoints

The four admin components call `/api/admin/{vertical}/lookup`. These endpoints don't exist yet. Add minimal stub handlers so the UI doesn't 404.

**Files:**
- Modify or Create: `demo_api_server/routes/adminVerticals.js` (new file, or add to an existing admin routes file)
- Modify: `demo_api_server/server.js` (register the new routes)

- [ ] **Step 1: Check if an existing admin routes file can be extended**

Run: `grep -rn "admin/banking/lookup\|adminRoutes\|admin.*router" demo_api_server/ --include="*.js" | grep -v test | head -10`

If an existing file handles `/api/admin/banking/lookup`, add the new endpoints there. Otherwise create a new file.

- [ ] **Step 2: Add the four lookup endpoints**

In the chosen file, add:

```js
const express = require('express');
const router = express.Router();
const { requireAdminSession } = require('../middleware/auth'); // adjust import to match existing pattern

// Stub admin lookup endpoints — returns empty results until vertical data stores are wired
router.get('/healthcare/lookup', requireAdminSession, (req, res) => {
  res.json({ results: [], query: req.query.q || '', vertical: 'healthcare' });
});

router.get('/retail/lookup', requireAdminSession, (req, res) => {
  res.json({ results: [], query: req.query.q || '', vertical: 'retail' });
});

router.get('/sporting-goods/lookup', requireAdminSession, (req, res) => {
  res.json({ results: [], query: req.query.q || '', vertical: 'sporting-goods' });
});

router.get('/workforce/lookup', requireAdminSession, (req, res) => {
  res.json({ results: [], query: req.query.q || '', vertical: 'workforce' });
});

module.exports = router;
```

Note: use whatever middleware pattern the existing `/api/admin/banking/lookup` uses — check the actual file from Step 1 and copy the auth middleware name exactly.

- [ ] **Step 3: Register the routes in server.js (if new file)**

Find where `require('./routes/admin...')` is called in `server.js`. Add:

```js
app.use('/api/admin', require('./routes/adminVerticals'));
```

- [ ] **Step 4: Test the endpoints with curl**

Start the BFF (`./run.sh` or `cd demo_api_server && node server.js`) and run:

```bash
curl -s http://localhost:3001/api/admin/healthcare/lookup?q=test \
  -H "Cookie: connect.sid=<paste a valid admin session cookie from your browser>" | jq .
```

Expected: `{ "results": [], "query": "test", "vertical": "healthcare" }` (or a 401 if no valid admin session — that's correct behavior).

- [ ] **Step 5: Build**

Run: `cd demo_api_ui && npm run build 2>&1 | tail -5`

Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add demo_api_server/routes/adminVerticals.js demo_api_server/server.js
git commit -m "feat(admin): add stub BFF lookup endpoints for healthcare, retail, sporting-goods, workforce admin pages"
```

---

### Task 14: Architecture sim — fix `mcp-tool-call` scenario and add HITL scenario

**Files:**
- Modify: `demo_api_ui/src/config/architecture-sim-scenarios.js`

- [ ] **Step 1: Read the current mcp-tool-call scenario steps**

Read `demo_api_ui/src/config/architecture-sim-scenarios.js` lines 54–120. Write down the current 6 steps and what nodes/edges each highlights.

- [ ] **Step 2: Read the available SVG node/edge IDs**

Run: `grep -n "id=" demo_api_ui/src/components/ArchitectureSimSvg.jsx | grep -E "n-|e-" | head -30`

Note all valid `nodeId` and `edgeId` values. You can only reference IDs that exist in the SVG.

- [ ] **Step 3: Fix step 5 — split "token forwarded + tool executes" into two steps**

Current step 5 collapses the RFC 8693 exchange result forwarding and tool execution into one step. Replace step 5 with two steps:

```js
{
  nodes: ['n-mcp-gw'],
  edges: ['e-pingone-mcpgw'],
  desc: 'PingOne returns narrowed token — MCP Gateway validates aud and act claims.',
  why: 'The MCP Gateway checks: (1) aud matches the MCP resource URI, (2) act claim proves the agent acted on behalf of the user. Only if both pass does the call proceed.',
},
{
  nodes: ['n-mcp-server'],
  edges: ['e-mcpgw-mcpserver'],
  desc: 'MCP Gateway forwards tool call to MCP Server with the narrowed delegation token.',
  why: 'The MCP Server receives a token scoped only to its audience. It validates the token, resolves the tool, and executes it. The original user\'s sub is preserved — the server knows who the real user is.',
},
```

- [ ] **Step 4: Fix step 6 — show result returning to browser**

Current step 6 only activates `n-bff` but shows no edges. Fix to show the full return path:

```js
{
  nodes: ['n-browser'],
  edges: ['e-mcpgw-bff', 'e-bff-browser'],
  desc: 'Tool result returns: MCP Server → Gateway → BFF → browser. ✅',
  why: 'The result travels back through the same chain. The BFF strips any internal tokens before sending the response to the browser. The token chain panel receives the full event trace so you can inspect every delegation step.',
},
```

(Use the actual edge IDs from Step 2 — adjust `e-mcpgw-bff` and `e-bff-browser` to match what the SVG defines.)

- [ ] **Step 5: Add the HITL consent scenario**

After the `mcp-tool-call` scenario object, add a new scenario. Use node/edge IDs from Step 2:

```js
{
  id: 'hitl-consent',
  label: 'HITL Consent Gate',
  steps: [
    {
      nodes: ['n-browser'],
      edges: [],
      desc: 'User asks the agent to perform a sensitive action (e.g. "release my records").',
      why: 'Human-in-the-loop (HITL) gates sit in front of high-risk tool calls. Before any data moves, the system pauses and asks the user to explicitly approve.',
    },
    {
      nodes: ['n-bff'],
      edges: ['e-browser-bff'],
      desc: 'Browser → BFF: request arrives. BFF resolves the session and identifies the tool as HITL-gated.',
      why: 'The BFF checks the tool\'s authz.consent flag in the vertical config. If true, it does not forward the tool call — it issues a 428 challenge instead.',
    },
    {
      nodes: ['n-mcp-gw'],
      edges: ['e-bff-mcpgw'],
      desc: 'BFF → MCP Gateway: tool call forwarded. Gateway enforces consent policy — returns 428 Precondition Required.',
      why: '428 is the RFC status code for "precondition required." The gateway signals that the user must complete a consent step before this tool can execute. No tool call has happened yet.',
    },
    {
      nodes: ['n-browser'],
      edges: ['e-bff-browser'],
      desc: 'Browser receives 428 — consent dialog appears. User reads the request and approves or denies.',
      why: 'The consent dialog shows exactly what tool will be called and what data will be accessed. The user makes an explicit decision — this is the human-in-the-loop moment.',
    },
    {
      nodes: ['n-bff'],
      edges: ['e-browser-bff'],
      desc: 'User approves → consent token issued. BFF retries the tool call with the consent proof attached.',
      why: 'The consent decision is recorded server-side (a consent token or challenge ID). The BFF re-submits the tool call carrying this proof so the gateway can verify user approval happened.',
    },
    {
      nodes: ['n-mcp-server'],
      edges: ['e-bff-mcpgw', 'e-mcpgw-mcpserver'],
      desc: 'Gateway validates consent proof — tool executes. Result returns to browser. ✅',
      why: 'With the consent proof attached, the gateway permits the call. The tool executes with the same delegation token chain as a normal MCP call — but now with an auditable record that the user explicitly approved this action.',
    },
  ],
},
```

- [ ] **Step 6: Build**

Run: `cd demo_api_ui && npm run build 2>&1 | tail -20`

Expected: exit 0. If the SVG node/edge IDs in your steps don't match the actual SVG, the sim will silently skip animation for those IDs — verify them against Step 2's output.

- [ ] **Step 7: Manual sim verification**

Open the app → navigate to `/architecture/overview` → select "MCP Tool Call" scenario → click through all steps. Confirm the result-return step now shows edges lighting up. Then select "HITL Consent Gate" and step through it.

- [ ] **Step 8: Commit**

```bash
git add demo_api_ui/src/config/architecture-sim-scenarios.js
git commit -m "feat(arch-sim): fix mcp-tool-call result-return steps; add HITL consent gate scenario"
```

---

## Final Verification

- [ ] **Run full UI test suite**

Run: `cd demo_api_ui && npm run test:ui 2>&1 | tail -30`

Expected: all tests pass. Fix any failures introduced by the new routes or components.

- [ ] **Run BFF test suite**

Run: `cd demo_api_server && npm test 2>&1 | tail -30`

Expected: all tests pass. Fix any failures caused by the new events or routes.

- [ ] **Final build**

Run: `cd demo_api_ui && npm run build 2>&1 | tail -5`

Expected: exit 0.

- [ ] **Run App structure test**

Run: `cd demo_api_ui && npx jest App.structure --no-coverage 2>&1 | tail -10`

Expected: all 13 tests pass (update expected counts if the new routes added lines that changed the count).

- [ ] **Add regression plan entries**

Open `REGRESSION_PLAN.md` and add entries to §4 (Bug Fix Log) for:
1. Silent `on-behalf-of-warning` fallback replaced with structured `agent-actor-token-unavailable`
2. MCP tool call result now visible in token chain
3. Four non-banking vertical admin pages added
4. Sensitive-data HITL tools added to all verticals
5. `api_key_demo`/`dual_token_demo` now available from all verticals

---

*Implementation complete when all Final Verification steps pass.*

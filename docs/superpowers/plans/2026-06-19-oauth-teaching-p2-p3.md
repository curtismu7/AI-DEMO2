# OAuth Teaching P2 (EXPLAIN) + P3 (SHOW) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the `oauth-teaching` vertical working EXPLAIN and SHOW verbs — explain OAuth concepts while opening the matching education panel, render flow diagrams, and inspect the user's real session token (T1) next to the exchanged token (T2).

**Architecture:** Teaching tools are pure-local computations, so a new *local-tool bypass* in the shared `dispatchVerticalIntent` calls the plugin's `executeTool` directly — skipping the authz pre-flight + RFC 8693 + MCP round-trip that non-banking verticals otherwise force. The plugin tool returns `{ result, render }` where `result` may carry an `education:{panel,tab}` directive; the local branch forwards `education` on the response, and `AIAgent.js` opens the panel via the existing `EducationUIContext`. `inspect_token` reuses the existing exchange path to mint T2 and renders both tokens via `TokenCard`.

**Tech Stack:** Node.js (CommonJS) BFF (`demo_api_server`), React (`demo_api_ui`), Jest (unit + real-call suites).

## Global Constraints

- **No new SSE/streaming.** Ride the existing `/api/agent/invoke` request/response (forwards arbitrary fields verbatim at `agentInvokeRoute.js:~346`).
- **Tool name === heuristic `action`** for the generic vertical path. Declare tools with the exact names the heuristics emit.
- **Tool schemas use `inputSchema`**, not `parameters` (per `verticalDispatch.toToolSchema`).
- **No raw token strings** ever returned to the client — only `{header, payload, tokenType}` (matches `/api/token-display/raw-decode` and `TokenCard`'s `decoded` prop).
- **No `AIAgent.js` refactor**, no `nlIntentParser` THEME_VOCAB change, no P4 DEMONSTRATE.
- Plain `*.test.js` naming for real tests under `tests/real/shared/` (only `*.test.js` is collected by `jest.real.config.js`); real suite is gated — tests self-skip when there is no session.
- EDU panel constants live in `demo_api_ui/src/components/education/educationIds.js`. Relevant values: `LOGIN_FLOW:"login-flow"`, `TOKEN_EXCHANGE:"token-exchange"`, `MAY_ACT:"may-act"`, `INTROSPECTION:"introspection"`, `STEP_UP:"step-up"`, `HUMAN_IN_LOOP:"human-in-loop"`, `OIDC_21:"oidc-21"`, `SENSITIVE_DATA:"sensitive-data"`, `TOKEN_CHAIN:"token-chain"`, `RFC_8693:"rfc-8693"`, `FLOW_DIAGRAMS:"flow-diagrams"`, `TOKEN_FLOW:"token-flow"`, `RFC_INDEX:"rfc-index"`. **The server passes the panel *string value* (e.g. `"token-exchange"`), not the `EDU.X` symbol.**

---

## File Structure

- `demo_api_server/config/verticals/oauth-teaching/index.js` — MODIFY: real local tools, `isLocalTool`, heuristics, topic→panel map.
- `demo_api_server/config/verticals/oauth-teaching/manifest.json` — MODIFY: `render` map entry for `inspect_token`.
- `demo_api_server/services/demoAgentLangGraphService.js` — MODIFY: local-tool bypass branch in `dispatchVerticalIntent`.
- `demo_api_ui/src/components/VerticalResult.jsx` — MODIFY: `token` / `token-pair` render branches + `TokenCard` import.
- `demo_api_ui/src/components/AIAgent.js` — MODIFY: one-line `education` directive bridge (~6628).
- `demo_api_server/src/__tests__/oauthTeachingTools.test.js` — CREATE: unit tests for the plugin tools + `isLocalTool`.
- `demo_api_server/src/__tests__/dispatchVerticalIntent.localBypass.test.js` — CREATE: unit test for the dispatch bypass.
- `demo_api_server/tests/real/shared/oauth-teaching-pipeline.test.js` — CREATE: real-call suite.

---

### Task 1: Local-tool bypass in `dispatchVerticalIntent`

Add an early branch so a plugin tool marked local runs `plugin.executeTool` directly, before the authz pre-flight and MCP path. Additive — no current plugin implements `isLocalTool`, so existing behavior is unchanged.

**Files:**
- Modify: `demo_api_server/services/demoAgentLangGraphService.js` (in `dispatchVerticalIntent`, after `const plugin = verticalDispatch.resolvePlugin(vertical);` ~line 726, before the authz pre-flight ~line 732)
- Test: `demo_api_server/src/__tests__/dispatchVerticalIntent.localBypass.test.js`

**Interfaces:**
- Consumes: `verticalDispatch.resolvePlugin(vertical)` → plugin or null; plugin may expose `isLocalTool(name):boolean` and `executeTool(name, params, ctx):Promise<{result, render}>`.
- Produces: when `plugin.isLocalTool?.(action)` is true, returns `{ reply, success, toolsCalled:[action], tokensUsed:0, requiresConsent:false, agentConfigured:true, tokenEvents, verticalResult?, education? }` — the same envelope shape the MCP branch returns (~910), so callers and the UI are unaffected.

- [ ] **Step 1: Write the failing test**

```js
// demo_api_server/src/__tests__/dispatchVerticalIntent.localBypass.test.js
'use strict';

// Mock verticalDispatch so we can inject a plugin with a local tool.
jest.mock('../../services/verticalDispatch', () => ({
  resolvePlugin: jest.fn(),
  toolSchemasFor: jest.fn(() => []),
}));
// agentPreflightService must NOT be called for a local tool.
jest.mock('../../services/agentPreflightService', () => ({
  evaluate: jest.fn(() => { throw new Error('preflight should not run for local tools'); }),
}));

const verticalDispatch = require('../../services/verticalDispatch');
const { dispatchVerticalIntent } = require('../../services/demoAgentLangGraphService');

describe('dispatchVerticalIntent — local-tool bypass', () => {
  it('runs a local tool directly without authz pre-flight or MCP', async () => {
    const executeTool = jest.fn(async () => ({
      result: { text: 'Token exchange swaps one token for another (RFC 8693).', education: { panel: 'token-exchange', tab: null } },
      render: 'text',
    }));
    verticalDispatch.resolvePlugin.mockReturnValue({
      isLocalTool: (n) => n === 'explain_concept',
      executeTool,
      getHeuristics: () => [],
    });

    const res = await dispatchVerticalIntent(
      { vertical: 'oauth-teaching', action: 'explain_concept', params: { topic: 'token exchange' } },
      { userId: 'u1', userToken: 't1', req: {}, tokenEvents: [], sessionId: 's1' },
    );

    expect(executeTool).toHaveBeenCalledWith('explain_concept', { topic: 'token exchange' }, expect.any(Object));
    expect(res.success).toBe(true);
    expect(res.reply).toMatch(/RFC 8693/);
    expect(res.education).toEqual({ panel: 'token-exchange', tab: null });
    expect(res.toolsCalled).toEqual(['explain_concept']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && npx jest src/__tests__/dispatchVerticalIntent.localBypass.test.js -t "local-tool bypass" --testPathIgnorePatterns=/node_modules/`
Expected: FAIL — `dispatchVerticalIntent` either isn't exported or runs the pre-flight (throws "preflight should not run").

- [ ] **Step 3: Export `dispatchVerticalIntent` if not already, and add the bypass branch**

First confirm the export. At the bottom `module.exports` of `demo_api_server/services/demoAgentLangGraphService.js`, ensure `dispatchVerticalIntent` is included (add it if missing).

Then insert this block in `dispatchVerticalIntent`, immediately after `const plugin = verticalDispatch.resolvePlugin(vertical);` (~line 726) and before the authz pre-flight (`const preflight = await agentPreflightService.evaluate(...)`, ~732):

```js
  // Local-tool bypass: teaching/education tools are pure-local computations (text +
  // an education-panel directive, or a token decode). They must NOT trigger an authz
  // decision or an RFC 8693 exchange, so run the plugin's executeTool directly and skip
  // the pre-flight + MCP path below. Gated to tools a plugin explicitly marks local —
  // no existing plugin implements isLocalTool, so this is inert for every current vertical.
  if (plugin && typeof plugin.isLocalTool === 'function' && plugin.isLocalTool(action)) {
    let local;
    try {
      local = await plugin.executeTool(action, params || {}, { userId, userToken, req, tokenEvents, sessionId, isAdmin });
    } catch (e) {
      return {
        reply: `❌ ${e.message || 'teaching tool failed'}`,
        success: false, toolsCalled: [action], tokensUsed: 0,
        requiresConsent: false, agentConfigured: true, tokenEvents,
      };
    }
    const data = local?.result;
    const render = local?.render || 'text';
    const isErr = !!(data && data.error);
    const reply = isErr
      ? `❌ ${data.error}`
      : (data && typeof data.text === 'string' && data.text)
        || `Executed ${String(action).replace(/_/g, ' ')}.`;
    return {
      reply,
      success: !isErr,
      toolsCalled: [action],
      tokensUsed: 0,
      requiresConsent: false,
      agentConfigured: true,
      tokenEvents,
      // Only attach a verticalResult for non-text renders (text tools show only the reply).
      ...(render !== 'text' ? { verticalResult: { action, render, data } } : {}),
      // Forward an education-panel directive to the UI when the tool requested one.
      ...(data && data.education ? { education: data.education } : {}),
    };
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_server && npx jest src/__tests__/dispatchVerticalIntent.localBypass.test.js -t "local-tool bypass" --testPathIgnorePatterns=/node_modules/`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/services/demoAgentLangGraphService.js demo_api_server/src/__tests__/dispatchVerticalIntent.localBypass.test.js
git commit -m "feat(oauth-teaching): local-tool bypass in dispatchVerticalIntent"
```

---

### Task 2: P2 EXPLAIN tools (`explain_concept`, `open_education_panel`) + `isLocalTool`

Replace the P1 stubs with real local tools and a topic→panel map.

**Files:**
- Modify: `demo_api_server/config/verticals/oauth-teaching/index.js`
- Test: `demo_api_server/src/__tests__/oauthTeachingTools.test.js`

**Interfaces:**
- Produces: `module.exports.isLocalTool(name)` → true for `explain_concept`, `open_education_panel`, `show_flow_diagram`, `inspect_token`. `executeTool(name, params, ctx)` → `{ result, render }`. `explain_concept` returns `{ result:{ text, education:{panel,tab} }, render:'text' }`.
- Consumes (Task 1): the local-bypass branch calls `executeTool` and forwards `result.education`.

- [ ] **Step 1: Write the failing test**

```js
// demo_api_server/src/__tests__/oauthTeachingTools.test.js
'use strict';
const plugin = require('../../config/verticals/oauth-teaching');

describe('oauth-teaching plugin — EXPLAIN tools', () => {
  it('marks teaching tools as local', () => {
    ['explain_concept', 'open_education_panel', 'show_flow_diagram', 'inspect_token']
      .forEach((n) => expect(plugin.isLocalTool(n)).toBe(true));
    expect(plugin.isLocalTool('create_transfer')).toBe(false);
  });

  it('explain_concept(token exchange) returns text + the token-exchange panel directive', async () => {
    const out = await plugin.executeTool('explain_concept', { topic: 'token exchange' }, {});
    expect(out.render).toBe('text');
    expect(out.result.text).toMatch(/RFC 8693/);
    expect(out.result.education).toEqual({ panel: 'token-exchange', tab: null });
  });

  it('explain_concept(unknown) lists what it can explain, no panel', async () => {
    const out = await plugin.executeTool('explain_concept', { topic: 'zzz' }, {});
    expect(out.result.text).toMatch(/I can explain/i);
    expect(out.result.education).toBeUndefined();
  });

  it('open_education_panel returns the requested panel directive', async () => {
    const out = await plugin.executeTool('open_education_panel', { edu_id: 'may-act' }, {});
    expect(out.result.education).toEqual({ panel: 'may-act', tab: null });
  });

  it('exposes tools with inputSchema (not parameters)', () => {
    const tools = plugin.getTools();
    const names = tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['explain_concept', 'open_education_panel']));
    const ec = tools.find((t) => t.name === 'explain_concept');
    expect(ec.inputSchema).toBeDefined();
  });

  it('heuristics route explain phrasing to explain_concept', () => {
    const h = plugin.getHeuristics().find((x) => /explain/.test(String(x.re)) && x.action === 'explain_concept');
    expect(h).toBeTruthy();
    expect('explain token exchange').toMatch(h.re);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && npx jest src/__tests__/oauthTeachingTools.test.js --testPathIgnorePatterns=/node_modules/`
Expected: FAIL — `plugin.isLocalTool is not a function` / stub `executeTool` returns the P1 string.

- [ ] **Step 3: Rewrite `oauth-teaching/index.js`**

Replace the file's tool/heuristic/executeTool sections with:

```js
'use strict';

const { verticalManifest } = require('../../../services/verticalManifest');
const { EDUCATION_HEURISTICS } = require('../shared/educationHeuristics');

// topic regex -> { text, panel(EDU string value), tab }. Panel strings mirror educationIds.js.
const CONCEPTS = [
  { re: /token\s*exchange|rfc\s*8693|delegation/i, panel: 'token-exchange',
    text: 'Token exchange (RFC 8693) swaps a subject token for a new token scoped to a downstream audience, optionally recording the actor in an `act` claim. The subject (`sub`) is preserved; the `aud` is narrowed. See RFC 8693 §2.1.' },
  { re: /pkce|auth(orization)?\s*code/i, panel: 'login-flow', tab: 'pkce',
    text: 'Authorization Code + PKCE (RFC 7636) protects the code exchange with a per-request code_verifier/code_challenge so an intercepted code is useless without the verifier. See RFC 6749 §4.1 and RFC 7636.' },
  { re: /scope|least\s*privilege/i, panel: 'sensitive-data',
    text: 'Scopes (RFC 6749 §3.3) bound what an access token may do. Least privilege means requesting only the scopes a call needs; the resource server enforces them.' },
  { re: /may_?act|act\s*claim|delegat/i, panel: 'may-act',
    text: '`may_act` (in the subject token) prospectively authorizes a downstream actor; `act` (in the exchanged token) records who is acting. Together they make the delegation chain auditable. See RFC 8693 §4.' },
  { re: /introspect/i, panel: 'introspection',
    text: 'Token introspection (RFC 7662) lets a resource server ask the issuer whether a token is active and what claims it carries — useful when local signature validation is not possible.' },
  { re: /oidc|openid|id\s*token/i, panel: 'oidc-21',
    text: 'OpenID Connect layers identity on OAuth 2.0: the ID token (a JWT) asserts who authenticated, while the access token authorizes API calls.' },
  { re: /hitl|human.in.the.loop|consent|approval/i, panel: 'human-in-loop',
    text: 'Human-in-the-loop gates a sensitive action behind explicit user approval; the authorization decision can require a verified consent receipt before it PERMITs.' },
  { re: /step.?up|mfa/i, panel: 'step-up',
    text: 'Step-up authentication forces stronger auth (e.g. MFA) for a higher-risk action, typically driven by an `acr_values` request to the authorization server.' },
  { re: /token\s*chain/i, panel: 'token-chain',
    text: 'The token chain visualizes every hop a request takes — each exchange, its audience, scopes, and the act/may_act delegation — so you can see exactly which token reaches which service.' },
];

const VALID_PANELS = new Set([
  'login-flow', 'token-exchange', 'may-act', 'introspection', 'rfc-index', 'step-up',
  'human-in-loop', 'oidc-21', 'sensitive-data', 'token-chain', 'rfc-8693', 'flow-diagrams', 'token-flow',
]);

const FLOWS = {
  'auth code': 'login-flow', 'authorization code': 'login-flow', 'pkce': 'login-flow', login: 'login-flow',
  'token exchange': 'token-flow', exchange: 'token-flow', 'token chain': 'token-chain', chain: 'token-chain',
};

const LOCAL_TOOLS = new Set(['explain_concept', 'open_education_panel', 'show_flow_diagram', 'inspect_token']);

const TOOLS = [
  { name: 'explain_concept', description: 'Explain an OAuth/OIDC concept and open the matching education panel',
    inputSchema: { type: 'object', properties: { topic: { type: 'string' } }, required: ['topic'] } },
  { name: 'open_education_panel', description: 'Open a specific education panel by id',
    inputSchema: { type: 'object', properties: { edu_id: { type: 'string' }, tab: { type: 'string' } }, required: ['edu_id'] } },
  { name: 'show_flow_diagram', description: 'Open the diagram for an OAuth/OIDC flow',
    inputSchema: { type: 'object', properties: { flow: { type: 'string' } }, required: ['flow'] } },
  { name: 'inspect_token', description: 'Decode the session token and the exchanged token side by side',
    inputSchema: { type: 'object', properties: {}, required: [] } },
];

const HEURISTICS = [
  { re: /\b(inspect|decode|show\s+me|view)\b.*\btoken(s)?\b/i, action: 'inspect_token' },
  { re: /\b(show|draw|diagram|visuali[sz]e)\b.*\b(flow|auth(orization)?\s*code|pkce|exchange|chain)\b/i, action: 'show_flow_diagram' },
  { re: /\b(what\s+is|explain|how\s+does|tell\s+me\s+about)\b/i, action: 'explain_concept' },
];

function getManifest() { return verticalManifest.resolver.resolve('oauth-teaching'); }

function getSystemPrompt(ctx) {
  const role = ctx && ctx.role ? ctx.role : 'learner';
  return [
    'You are the OAuth Academy teacher — an expert in OAuth 2.0, OAuth 2.1, and OIDC.',
    'Teach these protocols clearly: explain concepts, cite RFCs, and open the relevant panel.',
    `The signed-in user role is "${role}".`,
    'Use teaching language: tokens instead of accounts, flows instead of transactions.',
    'Always cite the relevant RFC section. Keep answers concise and precise.',
    'Never use banking or healthcare terminology. You are exclusively an OAuth/OIDC teacher.',
  ].join(' ');
}

function explainConcept(params) {
  const topic = String((params && params.topic) || '').trim();
  const hit = CONCEPTS.find((c) => c.re.test(topic));
  if (!hit) {
    return { result: { text: 'I can explain: token exchange (RFC 8693), PKCE / authorization code, scopes & least privilege, may_act / act delegation, introspection, OIDC, HITL, step-up, and the token chain. Which one?' }, render: 'text' };
  }
  return { result: { text: hit.text, education: { panel: hit.panel, tab: hit.tab || null } }, render: 'text' };
}

function openEducationPanel(params) {
  const id = String((params && params.edu_id) || '').trim();
  if (!VALID_PANELS.has(id)) {
    return { result: { text: `I don't have a panel called "${id}". Try: ${Array.from(VALID_PANELS).join(', ')}.` }, render: 'text' };
  }
  return { result: { text: `Opening the ${id} panel.`, education: { panel: id, tab: (params && params.tab) || null } }, render: 'text' };
}

function showFlowDiagram(params) {
  const flow = String((params && params.flow) || '').toLowerCase().trim();
  const key = Object.keys(FLOWS).find((k) => flow.includes(k));
  const panel = key ? FLOWS[key] : 'flow-diagrams';
  return { result: { text: `Here's the ${key || 'OAuth'} flow diagram.`, education: { panel, tab: null } }, render: 'text' };
}

async function executeTool(name, params, ctx) {
  switch (name) {
    case 'explain_concept': return explainConcept(params);
    case 'open_education_panel': return openEducationPanel(params);
    case 'show_flow_diagram': return showFlowDiagram(params);
    case 'inspect_token': return inspectToken(params, ctx); // Task 6
    default:
      return { result: { text: `Teaching tool "${name}" is not implemented yet.` }, render: 'text' };
  }
}

// inspectToken is added in Task 6; declare a placeholder that Task 6 replaces.
async function inspectToken() {
  return { result: { text: 'Token inspection is being wired up.' }, render: 'text' };
}

module.exports = {
  getManifest,
  getTools: () => TOOLS,
  getHeuristics: () => [...HEURISTICS, ...EDUCATION_HEURISTICS],
  getSystemPrompt,
  getDataStore: () => null,
  isLocalTool: (name) => LOCAL_TOOLS.has(name),
  executeTool,
  getAuthz: () => ({}),
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_server && npx jest src/__tests__/oauthTeachingTools.test.js --testPathIgnorePatterns=/node_modules/`
Expected: PASS (the `inspect_token` placeholder is replaced in Task 6; its dedicated tests live there.)

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/config/verticals/oauth-teaching/index.js demo_api_server/src/__tests__/oauthTeachingTools.test.js
git commit -m "feat(oauth-teaching): real EXPLAIN tools (explain_concept, open_education_panel)"
```

---

### Task 3: UI education directive bridge in `AIAgent.js`

Open the requested panel when a vertical response carries `education`.

**Files:**
- Modify: `demo_api_ui/src/components/AIAgent.js` (the `kind:'vertical'` handler, immediately after the `addMessage(...)` at ~line 6628)

**Interfaces:**
- Consumes: `response.education = { panel, tab }` (from Task 1's local branch). `edu` (from `useEducationUIOptional()`, in scope ~1960) with `open(panelId, tab)`.

- [ ] **Step 1: Locate the insertion point**

Run: `cd demo_api_ui && grep -n "verticalResultExtra(response)" src/components/AIAgent.js`
Expected: a line inside `if (response?.reply) { ... addMessage("assistant", response.reply, null, { source: _source, ...verticalResultExtra(response), paramHint }); ... }` near 6628.

- [ ] **Step 2: Add the bridge line**

Immediately after that `addMessage("assistant", response.reply, ...)` call, add:

```js
        // Teaching directive: open the requested education panel (P2/P3). Mirrors the
        // kind:'education' path; fires only for a resolvable panel id.
        if (response.education?.panel) {
          edu?.open(response.education.panel, response.education.tab || null);
        }
```

- [ ] **Step 3: Build the UI to verify it compiles**

Run: `cd demo_api_ui && npm run build`
Expected: build succeeds with 0 errors (per the regression-guard UI build gate).

- [ ] **Step 4: Commit**

```bash
git add demo_api_ui/src/components/AIAgent.js
git commit -m "feat(oauth-teaching): open education panel from vertical response.education"
```

---

### Task 4: P3 `show_flow_diagram` is already implemented in Task 2 — add its test

`show_flow_diagram` shipped with the Task 2 rewrite. This task adds its dedicated test.

**Files:**
- Modify: `demo_api_server/src/__tests__/oauthTeachingTools.test.js`

- [ ] **Step 1: Add the failing test**

Append inside the existing describe block:

```js
  it('show_flow_diagram(auth code) opens the login-flow panel', async () => {
    const out = await plugin.executeTool('show_flow_diagram', { flow: 'auth code' }, {});
    expect(out.result.education).toEqual({ panel: 'login-flow', tab: null });
  });
  it('show_flow_diagram(unknown) falls back to flow-diagrams', async () => {
    const out = await plugin.executeTool('show_flow_diagram', { flow: 'mystery' }, {});
    expect(out.result.education.panel).toBe('flow-diagrams');
  });
```

- [ ] **Step 2: Run the tests**

Run: `cd demo_api_server && npx jest src/__tests__/oauthTeachingTools.test.js --testPathIgnorePatterns=/node_modules/`
Expected: PASS (implementation already present from Task 2).

- [ ] **Step 3: Commit**

```bash
git add demo_api_server/src/__tests__/oauthTeachingTools.test.js
git commit -m "test(oauth-teaching): cover show_flow_diagram"
```

---

### Task 5: TokenCard rendering in `VerticalResult.jsx`

Add `token` (single) and `token-pair` (T1 + T2) render branches so `inspect_token` (Task 6) can render decoded tokens.

**Files:**
- Modify: `demo_api_ui/src/components/VerticalResult.jsx`

**Interfaces:**
- Consumes: `descriptor.type ∈ {'token','token-pair'}`; for `token` `data = {header,payload,tokenType}`; for `token-pair` `data = { t1:{...}, t2:{...} }`.
- Produces: renders `<TokenCard decoded={...} />` (default export from `./TokenCard`, `decoded` prop = `{header,payload,tokenType}`).

- [ ] **Step 1: Add the import**

At the top of `demo_api_ui/src/components/VerticalResult.jsx`, after `import React from 'react';`:

```js
import TokenCard from './TokenCard';
```

- [ ] **Step 2: Add the token branches**

Update the fallback guard at line 27 to also allow the new types, and add the branches before the card/fieldList branch. Replace:

```js
  // Text fallback for null/undefined/unknown descriptor type
  if (!descriptor || !descriptor.type || !['card', 'fieldList', 'table'].includes(descriptor.type)) {
```

with:

```js
  // Token card(s) — decoded JWT view(s). data carries {header,payload,tokenType} (token)
  // or { t1, t2 } each of that shape (token-pair). No raw token string is present.
  if (descriptor && descriptor.type === 'token') {
    return (
      <div className="vertical-result vertical-result-token">
        {descriptor.title && <h3 className="vertical-result-title">{descriptor.title}</h3>}
        <TokenCard decoded={data} title="Token" />
      </div>
    );
  }
  if (descriptor && descriptor.type === 'token-pair') {
    return (
      <div className="vertical-result vertical-result-token-pair" style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
        {descriptor.title && <h3 className="vertical-result-title" style={{ flexBasis: '100%' }}>{descriptor.title}</h3>}
        <div style={{ flex: '1 1 320px', minWidth: 0 }}>
          <TokenCard decoded={data?.t1} title="Session token (T1)" />
        </div>
        <div style={{ flex: '1 1 320px', minWidth: 0 }}>
          {data?.t2
            ? <TokenCard decoded={data.t2} title="Exchanged token (T2)" />
            : <div className="vertical-result vertical-result-text">Exchange not available (sign-in required or exchange failed).</div>}
        </div>
      </div>
    );
  }

  // Text fallback for null/undefined/unknown descriptor type
  if (!descriptor || !descriptor.type || !['card', 'fieldList', 'table'].includes(descriptor.type)) {
```

- [ ] **Step 3: Build to verify it compiles**

Run: `cd demo_api_ui && npm run build`
Expected: build succeeds with 0 errors.

- [ ] **Step 4: Commit**

```bash
git add demo_api_ui/src/components/VerticalResult.jsx
git commit -m "feat(oauth-teaching): render decoded token(s) via TokenCard in VerticalResult"
```

---

### Task 6: `inspect_token` — T1 + T2 side by side

Decode the session token (T1) and the exchanged token (T2) and render both. Reuses the existing exchange path.

**Files:**
- Modify: `demo_api_server/config/verticals/oauth-teaching/index.js` (replace the `inspectToken` placeholder)
- Modify: `demo_api_server/config/verticals/oauth-teaching/manifest.json` (`render` map)
- Test: `demo_api_server/src/__tests__/oauthTeachingTools.test.js` (add inspect_token cases)

**Interfaces:**
- Consumes: `ctx.userToken` (raw session JWT), `ctx.req`, `ctx.tokenEvents`. `tokenDisplayService.decodeToken(token) → {header,payload,signature}|null` and `classifyTokenType(payload) → string`. The exchanged token (T2) decoded payload via the existing exchange path.
- Produces: `{ result: { t1:{header,payload,tokenType}, t2:{header,payload,tokenType}|null }, render:'token_pair' }`.

- [ ] **Step 1: Add the failing tests**

Append to `demo_api_server/src/__tests__/oauthTeachingTools.test.js`:

```js
describe('oauth-teaching plugin — inspect_token', () => {
  // A minimal unsigned JWT (header.payload.sig) — decodeToken only base64-decodes.
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const jwt = (payload) => `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64(payload)}.sig`;

  it('returns a text reply (no token-pair) when not signed in', async () => {
    const out = await plugin.executeTool('inspect_token', {}, { userToken: null });
    expect(out.render).toBe('text');
    expect(out.result.text).toMatch(/sign\s*in/i);
  });

  it('decodes T1 and renders token_pair even if the exchange is unavailable', async () => {
    const t1 = jwt({ sub: 'u-123', aud: 'enduser.ping.demo', scope: 'read' });
    const out = await plugin.executeTool('inspect_token', {}, { userToken: t1, req: {}, tokenEvents: [] });
    expect(out.render).toBe('token_pair');
    expect(out.result.t1.payload.sub).toBe('u-123');
    // t2 may be null when no live exchange is reachable in unit context
    expect('t2' in out.result).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd demo_api_server && npx jest src/__tests__/oauthTeachingTools.test.js -t "inspect_token" --testPathIgnorePatterns=/node_modules/`
Expected: FAIL — placeholder returns `render:'text'` and no `t1`.

- [ ] **Step 3: Implement `inspectToken`**

In `oauth-teaching/index.js`, add the requires near the top:

```js
const tokenDisplayService = require('../../../services/tokenDisplayService');
```

Replace the placeholder `inspectToken` with:

```js
function decodeForCard(token) {
  const d = tokenDisplayService.decodeToken(token);
  if (!d) return null;
  return { header: d.header, payload: d.payload, tokenType: tokenDisplayService.classifyTokenType(d.payload) };
}

// Mint+decode the exchanged token (T2) using the REAL production agent exchange path.
// resolveMcpAccessTokenWithEvents(req, tool, opts) returns { token, tokenEvents, need_auth };
// we decode `token` for display and merge its tokenEvents so the live Token Chain updates.
// Returns null (not an error) when no token can be minted, so T1 still renders.
async function getExchangedTokenDecoded(ctx) {
  try {
    const { resolveMcpAccessTokenWithEvents } = require('../../../services/agentMcpTokenService');
    if (!ctx || !ctx.req) return null;
    const ex = await resolveMcpAccessTokenWithEvents(ctx.req, 'inspect_token', {});
    if (Array.isArray(ex?.tokenEvents) && Array.isArray(ctx.tokenEvents)) {
      ctx.tokenEvents.push(...ex.tokenEvents);
    }
    if (!ex || !ex.token || ex.need_auth) return null;
    return decodeForCard(ex.token);
  } catch (_e) {
    return null;
  }
}

async function inspectToken(params, ctx) {
  const userToken = ctx && ctx.userToken;
  if (!userToken) {
    return { result: { text: 'Please sign in first — then I can decode your token and show what the exchange changes.' }, render: 'text' };
  }
  const t1 = decodeForCard(userToken);
  if (!t1) {
    return { result: { text: "I couldn't decode the current token." }, render: 'text' };
  }
  const t2 = await getExchangedTokenDecoded(ctx); // null if exchange unavailable — T1 still renders
  return { result: { t1, t2 }, render: 'token_pair' };
}
```

> **Verified reuse:** `resolveMcpAccessTokenWithEvents` is exported from `agentMcpTokenService.js` (module.exports ~line 2366) and is the same RFC 8693 exchange the agent runs (it returns the exchanged `token` plus `tokenEvents`, and `{ token:null, need_auth:true }` when there is no live session token). The `try/catch → null` keeps T1-only rendering safe if the exchange can't run in a given context.

- [ ] **Step 4: Wire the manifest render descriptor**

In `demo_api_server/config/verticals/oauth-teaching/manifest.json`, add (or extend) the top-level `render` map:

```json
  "render": {
    "token_pair": { "type": "token-pair", "title": "Your tokens — before & after exchange" }
  }
```

(Match the existing manifest's JSON structure/indentation; if a `render` key already exists, add the `token_pair` entry to it.)

- [ ] **Step 5: Run the tests**

Run: `cd demo_api_server && npx jest src/__tests__/oauthTeachingTools.test.js -t "inspect_token" --testPathIgnorePatterns=/node_modules/`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add demo_api_server/config/verticals/oauth-teaching/index.js demo_api_server/config/verticals/oauth-teaching/manifest.json demo_api_server/src/__tests__/oauthTeachingTools.test.js
git commit -m "feat(oauth-teaching): inspect_token renders session (T1) + exchanged (T2) tokens"
```

---

### Task 7: Real-call pipeline suite

End-to-end assertions against a live session, switching to the `oauth-teaching` vertical.

**Files:**
- Create: `demo_api_server/tests/real/shared/oauth-teaching-pipeline.test.js`

**Interfaces:**
- Consumes: `createBffClient('enduser')`, `setVertical`, `restoreVertical` from `../helpers/bffClient`.

- [ ] **Step 1: Write the suite**

```js
// demo_api_server/tests/real/shared/oauth-teaching-pipeline.test.js
const { createBffClient, setVertical, restoreVertical } = require('../helpers/bffClient');

describe('OAuth Teaching — E2E (oauth-teaching vertical)', () => {
  let enduser;
  beforeAll(async () => {
    try { enduser = createBffClient('enduser'); } catch { return; }
    await setVertical(enduser, 'oauth-teaching');
  });
  afterAll(async () => { await restoreVertical(enduser); });

  it('explain token exchange → reply + token-exchange panel directive', async () => {
    if (!enduser) return;
    const r = await enduser.post('/api/agent/invoke', { prompt: 'explain token exchange', forceHeuristic: true });
    expect(r.status).toBe(200);
    expect(r.data.success).toBe(true);
    expect(r.data.education?.panel).toBe('token-exchange');
    expect(String(r.data.reply)).toMatch(/RFC 8693/);
  });

  it('inspect my token → token_pair verticalResult with decoded T1, no raw token', async () => {
    if (!enduser) return;
    const r = await enduser.post('/api/agent/invoke', { prompt: 'inspect my token', forceHeuristic: true });
    expect(r.status).toBe(200);
    if (r.data?.verticalResult) {
      expect(r.data.verticalResult.render).toBe('token_pair');
      expect(r.data.verticalResult.data?.t1?.payload?.sub).toBeTruthy();
    }
    // Never leak a raw JWT string anywhere in the response.
    expect(JSON.stringify(r.data)).not.toMatch(/ey[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+/);
  });

  it('explain does NOT run an authz pre-flight or deny (local bypass)', async () => {
    if (!enduser) return;
    const r = await enduser.post('/api/agent/invoke', { prompt: 'explain scopes', forceHeuristic: true });
    expect(r.status).toBe(200);
    expect(r.data.success).toBe(true);
    expect(r.data.error).toBeUndefined();
  });
});
```

- [ ] **Step 2: Verify it parses**

Run: `cd demo_api_server && node --check tests/real/shared/oauth-teaching-pipeline.test.js`
Expected: no output (valid).

- [ ] **Step 3: (If a live session is available) run the real suite**

Run: `cd demo_api_server && RUN_REAL_TESTS=true npx jest --config=jest.real.config.js tests/real/shared/oauth-teaching-pipeline.test.js`
Expected: PASS, or cleanly skipped if no session.

- [ ] **Step 4: Commit**

```bash
git add demo_api_server/tests/real/shared/oauth-teaching-pipeline.test.js
git commit -m "test(oauth-teaching): real-call EXPLAIN + inspect_token pipeline suite"
```

---

## Self-Review

**Spec coverage:**
- Execution model (local-tool bypass) → Task 1. ✓
- P2 `explain_concept` + `open_education_panel` → Task 2. ✓
- Directive bridge (UI) → Task 3. ✓
- P3 `show_flow_diagram` → Task 2 (impl) + Task 4 (test). ✓
- P3 `inspect_token` T1+T2 → Task 6; TokenCard rendering → Task 5. ✓
- Tool registry / `isLocalTool` → Task 2. ✓
- Testing (unit + real) → Tasks 1,2,4,6,7. ✓
- Out of scope (P4, AIAgent refactor, nlIntentParser, new SSE) — honored. ✓

**Type consistency:** `isLocalTool(name)` (Tasks 1,2); `executeTool(name,params,ctx)→{result,render}` (Tasks 1,2,6); `result.education={panel,tab}` (Tasks 1,2,3); `render:'token_pair'` ↔ manifest `render.token_pair.type==='token-pair'` ↔ `VerticalResult` `descriptor.type==='token-pair'` (Tasks 5,6) — consistent. The server forwards the panel **string** (e.g. `"token-exchange"`), and `edu.open` accepts that string (Task 3).

**Known confirm-at-implementation point:** the exact exchange-helper name in `agentMcpTokenService.js` (Task 6, Step 3 note). The `try/catch→null` design keeps the feature safe (T1-only) if the name/shape differs, but the implementer must wire the real function for T2 to appear.

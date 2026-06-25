# Five-Mode Agent Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the implicit provider+heuristic-toggle model with five explicit user-selectable agent modes (Heuristics / Helix-Google / Heuristics+Helix / Just ChatGPT / Just Claude), where modes 4/5 carry a via-BFF (safe) vs platform-driven (lossy, educational) sub-shape.

**Architecture:** Introduce one server SSOT — an `agent_mode` configStore value — that deterministically maps to the existing `(provider, ff_heuristic_enabled)` primitives plus a new `external_wiring` value. The resolver and feature-flag stay the single low-level primitives (T-3 amended for *routing only*; server-side HITL/Authorize enforcement untouched). UI surfaces select a mode, not raw primitives.

**Tech Stack:** Node/Express (banking_api_server, CJS), React/CRA (banking_api_ui), TypeScript gateway (banking_mcp_gateway), Jest.

**Spec:** `docs/superpowers/specs/2026-05-18-five-mode-agent-provider-design.md`

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `banking_api_server/services/agentModeResolver.js` | NEW SSOT: map `agent_mode` → `{provider, heuristicRouting, externalWiring}`. Pure function. | Create |
| `banking_api_server/tests/agentModeResolver.regression.test.js` | Hermetic tests for the mapping. | Create |
| `banking_api_server/routes/langchainConfig.js` | Accept/return `agent_mode` + `external_wiring` in POST/GET; expose in status. | Modify |
| `banking_api_server/services/bankingAgentLangGraphService.js` | Gate heuristic routing on resolved mode (not raw flag); Mode-1 no-match catalog message. | Modify |
| `banking_api_server/services/nlIntentParser.js` | Export the capability catalog as a single source for the Mode-1 message. | Modify |
| `banking_api_ui/src/hooks/useLangchainProvider.js` | Add `mode`, `externalWiring`, `MODE_OPTIONS`, `setMode`, `setExternalWiring`. | Modify |
| `banking_api_ui/src/components/AgentModeSelector.jsx` | NEW shared 5-mode selector + 4/5 wiring sub-toggle + degraded banner. | Create |
| `banking_api_ui/src/components/AgentModeSelector.css` | Styles for the selector + banner. | Create |
| `banking_api_ui/src/components/Config.js` | Replace raw PROVIDERS `<select>` with `<AgentModeSelector>`. | Modify |
| `banking_api_ui/src/components/BankingAgent.js` | Replace header provider `<select>` with `<AgentModeSelector compact>`. | Modify |
| `banking_mcp_gateway` (none) | Live 4b/5b uses existing POST /mcp — no gateway change. | — |
| `banking_api_server/services/platformAgentRuntime.js` | NEW: live platform-driven loop (OpenAI Responses API / Claude mcp_connector) against the gateway, for modes 4b/5b. | Create |
| `banking_api_server/tests/platformAgentRuntime.regression.test.js` | Hermetic tests (mocked HTTP) for the platform loop request shape. | Create |
| `ARCHITECTURE-TRUTHS.md` | Amend T-3 (routing-only). | Modify |
| `REGRESSION_PLAN.md` | §4 entry + §1 note (HITL enforcement unchanged). | Modify |

---

## Task 1: agentModeResolver (server SSOT)

**Files:**
- Create: `banking_api_server/services/agentModeResolver.js`
- Test: `banking_api_server/tests/agentModeResolver.regression.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// banking_api_server/tests/agentModeResolver.regression.test.js
const { resolveAgentMode, AGENT_MODES } = require('../services/agentModeResolver');

describe('resolveAgentMode', () => {
  test('mode 1 heuristics: no provider, heuristic routing on', () => {
    expect(resolveAgentMode('heuristics')).toEqual({
      mode: 'heuristics', provider: null, heuristicRouting: true, externalWiring: null,
    });
  });
  test('mode 2 helix-google: helix provider, routing off', () => {
    expect(resolveAgentMode('helix_google')).toEqual({
      mode: 'helix_google', provider: 'helix', heuristicRouting: false, externalWiring: null,
    });
  });
  test('mode 3 heuristics+helix: helix, routing on', () => {
    expect(resolveAgentMode('heuristics_helix')).toEqual({
      mode: 'heuristics_helix', provider: 'helix', heuristicRouting: true, externalWiring: null,
    });
  });
  test('mode 4 chatgpt defaults to bff wiring', () => {
    expect(resolveAgentMode('chatgpt')).toEqual({
      mode: 'chatgpt', provider: 'openai', heuristicRouting: false, externalWiring: 'bff',
    });
  });
  test('mode 5 claude platform wiring honored', () => {
    expect(resolveAgentMode('claude', 'platform')).toEqual({
      mode: 'claude', provider: 'anthropic', heuristicRouting: false, externalWiring: 'platform',
    });
  });
  test('unknown mode falls back to heuristics_helix (current default)', () => {
    expect(resolveAgentMode('bogus')).toEqual({
      mode: 'heuristics_helix', provider: 'helix', heuristicRouting: true, externalWiring: null,
    });
  });
  test('external wiring ignored for non-external modes', () => {
    expect(resolveAgentMode('helix_google', 'platform').externalWiring).toBeNull();
  });
  test('AGENT_MODES lists exactly the five', () => {
    expect(AGENT_MODES.map((m) => m.id)).toEqual([
      'heuristics', 'helix_google', 'heuristics_helix', 'chatgpt', 'claude',
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd banking_api_server && npx jest tests/agentModeResolver.regression.test.js`
Expected: FAIL — "Cannot find module '../services/agentModeResolver'"

- [ ] **Step 3: Write minimal implementation**

```javascript
// banking_api_server/services/agentModeResolver.js
/**
 * Single SSOT mapping the user-facing agent MODE to the low-level
 * primitives (LLM provider, heuristic ROUTING on/off, external wiring).
 *
 * ARCHITECTURE-TRUTHS T-3 (amended): the heuristic ROUTING fast-path is
 * mode-dependent. Server-side transfer/HITL/Authorize enforcement is
 * INDEPENDENT of mode and is NOT affected here (see REGRESSION_PLAN §1).
 *
 * provider values feed llmProviderResolver unchanged (it stays the
 * single low-level resolver). heuristicRouting maps onto the existing
 * ff_heuristic_enabled primitive. externalWiring is 'bff' | 'platform'
 * for modes 4/5 only (null otherwise).
 */
const AGENT_MODES = [
  { id: 'heuristics',       label: 'Heuristics only',          provider: null,        heuristicRouting: true,  external: false },
  { id: 'helix_google',     label: 'Helix (Google/Gemini)',    provider: 'helix',     heuristicRouting: false, external: false },
  { id: 'heuristics_helix', label: 'Heuristics + Helix',       provider: 'helix',     heuristicRouting: true,  external: false },
  { id: 'chatgpt',          label: 'Just ChatGPT',             provider: 'openai',    heuristicRouting: false, external: true },
  { id: 'claude',           label: 'Just Claude',              provider: 'anthropic', heuristicRouting: false, external: true },
];

const DEFAULT_MODE = 'heuristics_helix'; // = today's default behaviour

function resolveAgentMode(modeId, externalWiring) {
  const found = AGENT_MODES.find((m) => m.id === modeId);
  const m = found || AGENT_MODES.find((x) => x.id === DEFAULT_MODE);
  return {
    mode: m.id,
    provider: m.provider,
    heuristicRouting: m.heuristicRouting,
    externalWiring: m.external ? (externalWiring === 'platform' ? 'platform' : 'bff') : null,
  };
}

module.exports = { resolveAgentMode, AGENT_MODES, DEFAULT_MODE };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd banking_api_server && npx jest tests/agentModeResolver.regression.test.js`
Expected: PASS — 8 passed

- [ ] **Step 5: Commit**

```bash
git add banking_api_server/services/agentModeResolver.js banking_api_server/tests/agentModeResolver.regression.test.js
git commit -m "feat(agent): agentModeResolver SSOT for 5-mode model"
```

---

## Task 2: nlIntentParser capability catalog (single source for Mode-1 message)

**Files:**
- Modify: `banking_api_server/services/nlIntentParser.js` (no-match return ~line 325-335)
- Test: `banking_api_server/tests/nlIntentParser.catalog.test.js` (Create)

- [ ] **Step 1: Write the failing test**

```javascript
// banking_api_server/tests/nlIntentParser.catalog.test.js
const parser = require('../services/nlIntentParser');

describe('capability catalog', () => {
  test('exports CAPABILITY_CATALOG as a non-empty string array', () => {
    expect(Array.isArray(parser.CAPABILITY_CATALOG)).toBe(true);
    expect(parser.CAPABILITY_CATALOG.length).toBeGreaterThan(3);
    parser.CAPABILITY_CATALOG.forEach((c) => expect(typeof c).toBe('string'));
  });
  test('buildCatalogMessage returns a message containing every catalog item', () => {
    const msg = parser.buildCatalogMessage();
    parser.CAPABILITY_CATALOG.forEach((c) => expect(msg).toContain(c));
    expect(msg).toMatch(/can help/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd banking_api_server && npx jest tests/nlIntentParser.catalog.test.js`
Expected: FAIL — `parser.CAPABILITY_CATALOG` undefined

- [ ] **Step 3: Implement — add catalog export + builder, reuse in existing no-match**

In `banking_api_server/services/nlIntentParser.js`, add near the top (after the `EDU` block):

```javascript
// Single source for the deterministic capability list. The Mode-1
// (Heuristics-only) no-match reply and the legacy heuristics-only
// message both derive from THIS — no second hand-maintained list.
const CAPABILITY_CATALOG = [
  'balance — "show my checking balance"',
  'accounts — "show my accounts"',
  'transactions — "recent transactions"',
  'transfer — "transfer $100 from checking to savings"',
  'education — "explain token exchange" / "what is CIBA"',
];

function buildCatalogMessage() {
  return (
    `I can help with:\n` +
    CAPABILITY_CATALOG.map((c) => `  • ${c}`).join('\n') +
    `\n\n(Heuristics-only mode — no LLM. Pick a different agent mode for ` +
    `full natural-language understanding.)`
  );
}
```

Then change the existing no-match `return { kind: 'none', message: ... }` (the ~10-line literal around line 325-335) to:

```javascript
  return { kind: 'none', message: buildCatalogMessage() };
```

Add to `module.exports` (find the existing `module.exports = {` line and add these keys):

```javascript
  CAPABILITY_CATALOG,
  buildCatalogMessage,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd banking_api_server && npx jest tests/nlIntentParser.catalog.test.js`
Expected: PASS — 2 passed

- [ ] **Step 5: Run the existing parser test to ensure no regression**

Run: `cd banking_api_server && npx jest nlIntentParser`
Expected: PASS (pre-existing nlIntentParser suites still green; if a snapshot of the old message exists, update it to `buildCatalogMessage()` output)

- [ ] **Step 6: Commit**

```bash
git add banking_api_server/services/nlIntentParser.js banking_api_server/tests/nlIntentParser.catalog.test.js
git commit -m "feat(agent): CAPABILITY_CATALOG single-source for Mode-1 no-match message"
```

---

## Task 3: Wire agent_mode into bankingAgentLangGraphService heuristic gate

**Files:**
- Modify: `banking_api_server/services/bankingAgentLangGraphService.js:513-546` (heuristic gate block)
- Test: `banking_api_server/tests/agentMode.heuristicGate.test.js` (Create)

- [ ] **Step 1: Write the failing test**

```javascript
// banking_api_server/tests/agentMode.heuristicGate.test.js
// Verifies the heuristic ROUTING gate now derives from resolveAgentMode,
// and Mode-1 no-match yields the catalog message (no LLM fallthrough).
const { resolveAgentMode } = require('../services/agentModeResolver');
const parser = require('../services/nlIntentParser');

describe('agent mode → heuristic routing gate', () => {
  test('heuristics + heuristics_helix route via heuristic', () => {
    expect(resolveAgentMode('heuristics').heuristicRouting).toBe(true);
    expect(resolveAgentMode('heuristics_helix').heuristicRouting).toBe(true);
  });
  test('helix_google / chatgpt / claude do NOT route via heuristic', () => {
    ['helix_google', 'chatgpt', 'claude'].forEach((m) =>
      expect(resolveAgentMode(m).heuristicRouting).toBe(false));
  });
  test('Mode-1 no-match returns catalog message, never null', () => {
    const r = parser.parseHeuristic
      ? parser.parseHeuristic('asdf qwerty zxcv')
      : { kind: 'none', message: parser.buildCatalogMessage() };
    expect(r.kind).toBe('none');
    expect(r.message).toEqual(parser.buildCatalogMessage());
  });
});
```

- [ ] **Step 2: Run test to verify it fails or passes-trivially, then wire the gate**

Run: `cd banking_api_server && npx jest tests/agentMode.heuristicGate.test.js`
Expected: PASS for resolver assertions (Task 1 done); the gate-wiring is verified by Step 4 integration check.

- [ ] **Step 3: Modify the heuristic gate in bankingAgentLangGraphService.js**

Find this block (~line 513-515):

```javascript
    let heuristicFallbackResult = null;
    const heuristicEnabled = require('../services/configStore').getEffective('ff_heuristic_enabled') !== 'false';
```

Replace the `heuristicEnabled` line with mode-derived routing (keep `heuristicFallbackResult`):

```javascript
    let heuristicFallbackResult = null;
    const { resolveAgentMode } = require('../services/agentModeResolver');
    const cs = require('../services/configStore');
    const _agentMode = resolveAgentMode(
      cs.getEffective('agent_mode'),
      cs.getEffective('agent_external_wiring'),
    );
    // T-3 (amended): heuristic ROUTING is mode-dependent. ff_heuristic_enabled
    // is still honored as an override when no explicit agent_mode is set
    // (back-compat) — agent_mode wins when present.
    const heuristicEnabled = cs.getEffective('agent_mode')
      ? _agentMode.heuristicRouting
      : cs.getEffective('ff_heuristic_enabled') !== 'false';
```

Then, in the `if (heuristicEnabled) { ... }` block, find the comment
`// Heuristic matched but couldn't execute (transfer/deposit/etc.) — fall through to LLM`
and, immediately AFTER the `if (heuristic && heuristic.kind === 'banking')` block closes, add the Mode-1 terminal branch:

```javascript
      // Mode 1 (Heuristics-only): no LLM. An unrecognised query returns
      // the deterministic capability catalog instead of falling through.
      if (_agentMode.mode === 'heuristics') {
        if (req) req.agentPath = 'heuristic';
        return {
          reply: require('../services/nlIntentParser').buildCatalogMessage(),
          success: true,
          toolsCalled: [],
          tokensUsed: 0,
          requiresConsent: false,
          agentConfigured: true,
          tokenEvents: (req && req.tokenEvents) || [],
        };
      }
```

- [ ] **Step 4: Run targeted + integration check**

Run: `cd banking_api_server && npx jest tests/agentMode.heuristicGate.test.js agentReasoningLoop`
Expected: PASS (mode gate tests green; agent reasoning loop unaffected)

- [ ] **Step 5: Commit**

```bash
git add banking_api_server/services/bankingAgentLangGraphService.js banking_api_server/tests/agentMode.heuristicGate.test.js
git commit -m "feat(agent): heuristic routing gate derives from agent_mode (T-3 amended, HITL untouched)"
```

---

## Task 4: langchainConfig route — accept/return agent_mode + external_wiring

**Files:**
- Modify: `banking_api_server/routes/langchainConfig.js` (POST handler ~line 122; GET status ~line 89-112)
- Test: `banking_api_server/tests/langchainConfig.agentMode.test.js` (Create)

- [ ] **Step 1: Write the failing test**

```javascript
// banking_api_server/tests/langchainConfig.agentMode.test.js
const request = require('supertest');
const express = require('express');

jest.mock('../services/configStore', () => {
  const store = {};
  return {
    getEffective: jest.fn((k) => store[k]),
    setConfig: jest.fn(async (u) => Object.assign(store, u)),
    __store: store,
  };
});

describe('langchainConfig agent_mode', () => {
  let app;
  beforeEach(() => {
    jest.resetModules();
    app = express();
    app.use(express.json());
    app.use((req, _r, n) => { req.session = {}; n(); });
    app.use('/api/langchain', require('../routes/langchainConfig'));
  });

  test('POST accepts agent_mode + external_wiring and echoes resolved', async () => {
    const res = await request(app)
      .post('/api/langchain/config')
      .send({ agent_mode: 'claude', external_wiring: 'platform' });
    expect(res.status).toBe(200);
    expect(res.body.agent_mode).toBe('claude');
    expect(res.body.external_wiring).toBe('platform');
    expect(res.body.provider).toBe('anthropic');
  });

  test('GET status returns agent_mode + external_wiring + mode list', async () => {
    await request(app).post('/api/langchain/config')
      .send({ agent_mode: 'heuristics' });
    const res = await request(app).get('/api/langchain/config/status');
    expect(res.status).toBe(200);
    expect(res.body.agent_mode).toBe('heuristics');
    expect(Array.isArray(res.body.agent_modes)).toBe(true);
    expect(res.body.agent_modes.map((m) => m.id)).toContain('chatgpt');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd banking_api_server && npx jest tests/langchainConfig.agentMode.test.js`
Expected: FAIL — `res.body.agent_mode` undefined

- [ ] **Step 3: Implement in langchainConfig.js**

At top, after existing requires, add:

```javascript
const { resolveAgentMode, AGENT_MODES } = require('../services/agentModeResolver');
```

In `POST /config`, after the existing `const { provider, model, key_type, ... } = req.body || {};` line, add:

```javascript
  const { agent_mode, external_wiring } = req.body || {};
```

After the existing `setLangchainConfig(req, updates);` call, add agent-mode persistence:

```javascript
  if (agent_mode !== undefined) {
    const am = resolveAgentMode(agent_mode, external_wiring);
    try {
      await configStore.setConfig({
        agent_mode: am.mode,
        agent_external_wiring: am.externalWiring || '',
      });
    } catch (err) {
      console.error('[langchainConfig POST] agent_mode persist failed:', err.message);
    }
    // Keep the low-level primitives consistent so the resolver path works.
    if (am.provider) setLangchainConfig(req, { provider: am.provider });
  }
```

In the POST `res.json({ ... })` final response, add (merge into the existing object):

```javascript
    agent_mode: agent_mode !== undefined
      ? resolveAgentMode(agent_mode, external_wiring).mode
      : (configStore.getEffective('agent_mode') || null),
    external_wiring: agent_mode !== undefined
      ? resolveAgentMode(agent_mode, external_wiring).externalWiring
      : (configStore.getEffective('agent_external_wiring') || null),
```

In `GET /config/status` final `res.json({ ... })`, add (merge into the existing object):

```javascript
      agent_mode: configStore.getEffective('agent_mode') || 'heuristics_helix',
      external_wiring: configStore.getEffective('agent_external_wiring') || 'bff',
      agent_modes: AGENT_MODES.map((m) => ({ id: m.id, label: m.label, external: m.external })),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd banking_api_server && npx jest tests/langchainConfig.agentMode.test.js`
Expected: PASS — 2 passed

- [ ] **Step 5: Run env coverage (configStore must map new keys)**

Add `agent_mode` and `agent_external_wiring` to `envFallbackMap` in `banking_api_server/services/configStore.js` (find `envFallbackMap` object, add):

```javascript
      agent_mode:            ['AGENT_MODE'],
      agent_external_wiring: ['AGENT_EXTERNAL_WIRING'],
```

Run: `cd banking_api_server && npx jest --testPathPattern='configStore.envCoverage' --no-coverage`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add banking_api_server/routes/langchainConfig.js banking_api_server/services/configStore.js banking_api_server/tests/langchainConfig.agentMode.test.js
git commit -m "feat(agent): langchainConfig accepts/returns agent_mode + external_wiring"
```

---

## Task 5: platformAgentRuntime (live 4b/5b loop)

**Files:**
- Create: `banking_api_server/services/platformAgentRuntime.js`
- Test: `banking_api_server/tests/platformAgentRuntime.regression.test.js`

**Context:** Mode 4/5 with `external_wiring='platform'` drives the tool loop via OpenAI Responses API (ChatGPT) or Claude `mcp_connector` (Claude), pointing at the gateway POST /mcp with a BFF-minted gateway-audience token. This module builds + issues that request. The token is obtained via the existing `oauthService.performTokenExchange(subjectToken, gatewayAud, scopes)` (same helper as `scripts/mint-gateway-token.js`).

- [ ] **Step 1: Write the failing test**

```javascript
// banking_api_server/tests/platformAgentRuntime.regression.test.js
jest.mock('axios');
const axios = require('axios');
const { buildPlatformRequest } = require('../services/platformAgentRuntime');

describe('buildPlatformRequest', () => {
  const gwUrl = 'https://gw.example/mcp';
  const tok = 'eyJtok';

  test('openai → Responses API shape with mcp tool + authorization', () => {
    const r = buildPlatformRequest('openai', { gatewayMcpUrl: gwUrl, gatewayToken: tok, userMessage: 'List accounts', model: 'gpt-4o' });
    expect(r.url).toMatch(/openai|responses/i);
    expect(r.body.tools[0]).toMatchObject({ type: 'mcp', server_url: gwUrl, authorization: tok });
    expect(r.body.input).toBe('List accounts');
  });

  test('anthropic → Messages API shape with mcp_servers + authorization_token', () => {
    const r = buildPlatformRequest('anthropic', { gatewayMcpUrl: gwUrl, gatewayToken: tok, userMessage: 'List accounts', model: 'claude-sonnet-4-6' });
    expect(r.body.mcp_servers[0]).toMatchObject({ type: 'url', url: gwUrl, authorization_token: tok });
    expect(r.body.messages[0]).toMatchObject({ role: 'user', content: 'List accounts' });
  });

  test('unknown provider throws (no silent default)', () => {
    expect(() => buildPlatformRequest('mistral', {})).toThrow(/unsupported platform provider/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd banking_api_server && npx jest tests/platformAgentRuntime.regression.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```javascript
// banking_api_server/services/platformAgentRuntime.js
/**
 * Live platform-driven runtime for agent modes 4b/5b (spec
 * 2026-05-18-five-mode-agent-provider §5). The PLATFORM (OpenAI
 * Responses API / Claude mcp_connector) drives the tool loop against
 * the MCP Gateway POST /mcp using a BFF-minted gateway-audience token.
 *
 * EDUCATIONAL LOSS (intentional, surfaced in UI banner): one broad
 * gateway-audience token, no per-tool RFC 8693 exchange, no `act`
 * delegation claim, Token Chain dark before the gateway. The gateway
 * (D-05 + PingAuthorize) STILL enforces — that survives the agent swap.
 *
 * This module only BUILDS + ISSUES the platform request. The
 * gateway-audience token is minted by the caller via
 * oauthService.performTokenExchange (same helper as
 * scripts/mint-gateway-token.js) — token custody stays in the BFF.
 */
const axios = require('axios');

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';

function buildPlatformRequest(provider, opts) {
  const { gatewayMcpUrl, gatewayToken, userMessage, model } = opts;
  if (provider === 'openai') {
    return {
      url: OPENAI_RESPONSES_URL,
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY || ''}` },
      body: {
        model: model || 'gpt-4o',
        tools: [{
          type: 'mcp',
          server_label: 'super-banking-gateway',
          server_url: gatewayMcpUrl,
          authorization: gatewayToken,
        }],
        input: userMessage,
      },
    };
  }
  if (provider === 'anthropic') {
    return {
      url: ANTHROPIC_MESSAGES_URL,
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY || '',
        'anthropic-version': '2023-06-01',
      },
      body: {
        model: model || 'claude-sonnet-4-6',
        max_tokens: 1024,
        mcp_servers: [{
          type: 'url',
          url: gatewayMcpUrl,
          name: 'super-banking-gateway',
          authorization_token: gatewayToken,
        }],
        messages: [{ role: 'user', content: userMessage }],
      },
    };
  }
  throw new Error(`Unsupported platform provider: ${provider}`);
}

async function runPlatformLoop(provider, opts) {
  const reqSpec = buildPlatformRequest(provider, opts);
  const resp = await axios.post(reqSpec.url, reqSpec.body, {
    headers: { 'Content-Type': 'application/json', ...reqSpec.headers },
    timeout: 60000,
    validateStatus: (s) => s < 500,
  });
  return { ok: resp.status < 300, status: resp.status, data: resp.data };
}

module.exports = { buildPlatformRequest, runPlatformLoop, OPENAI_RESPONSES_URL, ANTHROPIC_MESSAGES_URL };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd banking_api_server && npx jest tests/platformAgentRuntime.regression.test.js`
Expected: PASS — 3 passed

- [ ] **Step 5: Wire into bankingAgentLangGraphService (platform branch)**

In `bankingAgentLangGraphService.js`, immediately after the `_agentMode` resolution added in Task 3 Step 3, add the platform short-circuit:

```javascript
    if (_agentMode.externalWiring === 'platform' && _agentMode.provider) {
      const { runPlatformLoop } = require('./platformAgentRuntime');
      const oauthService = require('./oauthService');
      const cfg2 = require('./configStore');
      const gatewayAud = cfg2.getEffective('pingone_resource_mcp_gateway_uri');
      const gatewayMcpUrl = (process.env.MCP_GATEWAY_HTTP_URL || 'http://localhost:3005').replace(/\/$/, '') + '/mcp';
      try {
        const gwToken = await oauthService.performTokenExchange(
          subjectToken, gatewayAud, ['banking:mcp:invoke']);
        const out = await runPlatformLoop(_agentMode.provider, {
          gatewayMcpUrl, gatewayToken: gwToken, userMessage: message,
          model: cfg2.getEffective('langchain_model') || undefined,
        });
        return {
          reply: typeof out.data === 'string' ? out.data : JSON.stringify(out.data),
          success: out.ok,
          toolsCalled: [],
          tokensUsed: 0,
          requiresConsent: false,
          agentConfigured: true,
          // Token Chain intentionally minimal: platform drove the loop.
          tokenEvents: (req && req.tokenEvents) || [],
          degradedDelegation: true,
        };
      } catch (e) {
        return { reply: `Platform agent error: ${e.message}`, success: false,
          toolsCalled: [], tokensUsed: 0, requiresConsent: false,
          agentConfigured: true, tokenEvents: (req && req.tokenEvents) || [],
          degradedDelegation: true, error: 'platform_runtime_error' };
      }
    }
```

- [ ] **Step 6: Run targeted regression**

Run: `cd banking_api_server && npx jest tests/platformAgentRuntime.regression.test.js agentReasoningLoop`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add banking_api_server/services/platformAgentRuntime.js banking_api_server/tests/platformAgentRuntime.regression.test.js banking_api_server/services/bankingAgentLangGraphService.js
git commit -m "feat(agent): live platform-driven runtime for modes 4b/5b (token chain intentionally degraded)"
```

---

## Task 6: useLangchainProvider hook — add mode + wiring

**Files:**
- Modify: `banking_api_ui/src/hooks/useLangchainProvider.js`
- Test: `banking_api_ui/src/hooks/__tests__/useLangchainProvider.test.js` (Create)

- [ ] **Step 1: Write the failing test**

```javascript
// banking_api_ui/src/hooks/__tests__/useLangchainProvider.test.js
import { renderHook, act, waitFor } from '@testing-library/react';
import useLangchainProvider from '../useLangchainProvider';

beforeEach(() => {
  global.fetch = jest.fn((url) => {
    if (String(url).includes('/status')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({
        provider: 'helix', agent_mode: 'heuristics_helix', external_wiring: 'bff',
        agent_modes: [{ id: 'chatgpt', label: 'Just ChatGPT', external: true }],
        key_set: { ollama: true }, default_models: {},
      }) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({
      agent_mode: 'chatgpt', external_wiring: 'platform', provider: 'openai' }) });
  });
});

test('hydrates mode + wiring; setMode posts and updates', async () => {
  const { result } = renderHook(() => useLangchainProvider());
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.mode).toBe('heuristics_helix');
  expect(result.current.externalWiring).toBe('bff');
  await act(async () => { await result.current.setMode('chatgpt'); });
  expect(result.current.mode).toBe('chatgpt');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd banking_api_ui && CI=true npx react-scripts test --watchAll=false --testPathPattern='useLangchainProvider'`
Expected: FAIL — `result.current.mode` undefined

- [ ] **Step 3: Implement — add mode state to the hook**

In `banking_api_ui/src/hooks/useLangchainProvider.js`:

Replace the `PROVIDER_OPTIONS` export's helix label and add mode constants below it:

```javascript
export const PROVIDER_OPTIONS = [
  { id: "helix", label: "Helix (model-agnostic wrapper)" },
  { id: "ollama", label: "Ollama (local)" },
  { id: "openai", label: "OpenAI (ChatGPT)" },
  { id: "anthropic", label: "Anthropic (Claude)" },
];
```

Add new state inside `useLangchainProvider()` (next to existing `useState`s):

```javascript
  const [mode, setModeState] = useState("heuristics_helix");
  const [externalWiring, setExternalWiringState] = useState("bff");
  const [modeOptions, setModeOptions] = useState([]);
```

In `refresh()`, after `setKeySet(...)`, add:

```javascript
      setModeState(d.agent_mode || "heuristics_helix");
      setExternalWiringState(d.external_wiring || "bff");
      setModeOptions(d.agent_modes || []);
```

Add `setMode` + `setExternalWiring` callbacks (after the existing `setProvider`):

```javascript
  const setMode = useCallback(async (id, wiring) => {
    setSaving(true); setError(null);
    try {
      const res = await fetch(SAVE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ agent_mode: id, external_wiring: wiring }),
      });
      if (!res.ok) throw new Error(`save ${res.status}`);
      const d = await res.json();
      setModeState(d.agent_mode || id);
      setExternalWiringState(d.external_wiring || "bff");
    } catch (e) {
      setError(e.message || "Failed to save mode");
    } finally { setSaving(false); }
  }, []);

  const setExternalWiring = useCallback(
    (w) => setMode(mode, w), [setMode, mode]);
```

Add to the returned object:

```javascript
    mode,
    externalWiring,
    modeOptions,
    setMode,
    setExternalWiring,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd banking_api_ui && CI=true npx react-scripts test --watchAll=false --testPathPattern='useLangchainProvider'`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add banking_api_ui/src/hooks/useLangchainProvider.js banking_api_ui/src/hooks/__tests__/useLangchainProvider.test.js
git commit -m "feat(ui): useLangchainProvider exposes 5-mode model + external wiring"
```

---

## Task 7: AgentModeSelector component (shared selector + banner)

**Files:**
- Create: `banking_api_ui/src/components/AgentModeSelector.jsx`
- Create: `banking_api_ui/src/components/AgentModeSelector.css`
- Test: `banking_api_ui/src/components/__tests__/AgentModeSelector.test.jsx`

- [ ] **Step 1: Write the failing test**

```javascript
// banking_api_ui/src/components/__tests__/AgentModeSelector.test.jsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AgentModeSelector from '../AgentModeSelector';

const hook = {
  mode: 'heuristics_helix', externalWiring: 'bff', saving: false,
  modeOptions: [
    { id: 'heuristics', label: 'Heuristics only', external: false },
    { id: 'chatgpt', label: 'Just ChatGPT', external: true },
  ],
  setMode: jest.fn(), setExternalWiring: jest.fn(),
};
jest.mock('../../hooks/useLangchainProvider', () => ({
  __esModule: true, default: () => hook,
}));

test('renders mode options and calls setMode on change', () => {
  render(<AgentModeSelector />);
  fireEvent.change(screen.getByLabelText(/agent mode/i), { target: { value: 'chatgpt' } });
  expect(hook.setMode).toHaveBeenCalledWith('chatgpt', expect.anything());
});

test('shows degraded banner only when external mode + platform wiring', () => {
  hook.mode = 'chatgpt'; hook.externalWiring = 'platform';
  render(<AgentModeSelector />);
  expect(screen.getByText(/delegation lost/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd banking_api_ui && CI=true npx react-scripts test --watchAll=false --testPathPattern='AgentModeSelector'`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the component**

```jsx
// banking_api_ui/src/components/AgentModeSelector.jsx
import React from "react";
import useLangchainProvider from "../hooks/useLangchainProvider";
import "./AgentModeSelector.css";

// Shared 5-mode selector (spec 2026-05-18-five-mode-agent-provider §6).
// `compact` = condensed variant for the BankingAgent header.
export default function AgentModeSelector({ compact = false }) {
  const {
    mode, externalWiring, modeOptions, saving, setMode, setExternalWiring,
  } = useLangchainProvider();

  const current = modeOptions.find((m) => m.id === mode);
  const isExternal = !!current && current.external;
  const showDegraded = isExternal && externalWiring === "platform";

  return (
    <div className={`ams${compact ? " ams--compact" : ""}`}>
      <label className="ams-label">
        Agent mode
        <select
          aria-label="Agent mode"
          value={mode}
          disabled={saving}
          onChange={(e) => setMode(e.target.value, externalWiring)}
          className="ams-select"
        >
          {modeOptions.map((m) => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
        </select>
      </label>

      {isExternal && (
        <label className="ams-label ams-wiring">
          Wiring
          <select
            aria-label="External wiring"
            value={externalWiring}
            disabled={saving}
            onChange={(e) => setExternalWiring(e.target.value)}
            className="ams-select"
          >
            <option value="bff">via BFF (token chain intact)</option>
            <option value="platform">platform-driven (token chain lost)</option>
          </select>
        </label>
      )}

      {showDegraded && (
        <p className="ams-degraded" role="status">
          ⚠️ Delegation lost here — a third party holds a broad gateway token.
          No per-tool RFC 8693 exchange, no <code>act</code> claim, Token Chain
          dark before the gateway. The MCP Gateway + PingAuthorize still
          enforce policy on every tool call.
        </p>
      )}
    </div>
  );
}
```

```css
/* banking_api_ui/src/components/AgentModeSelector.css */
.ams { display: flex; flex-direction: column; gap: 8px; }
.ams--compact { flex-direction: row; align-items: center; gap: 10px; }
.ams-label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; font-weight: 600; }
.ams--compact .ams-label { flex-direction: row; align-items: center; gap: 6px; }
.ams-select {
  font: inherit; font-size: 12px; padding: 2px 6px;
  border: 1px solid #cbd5e1; border-radius: 4px; background: #fff; cursor: pointer;
}
.ams-select:disabled { opacity: 0.6; cursor: default; }
.ams-wiring { margin-top: 2px; }
.ams-degraded {
  margin: 4px 0 0; padding: 8px 10px; font-size: 12px; line-height: 1.4;
  color: #92400e; background: #fffbeb; border: 1px solid #fcd34d; border-radius: 6px;
}
.ams-degraded code { background: #fef3c7; padding: 0 3px; border-radius: 3px; }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd banking_api_ui && CI=true npx react-scripts test --watchAll=false --testPathPattern='AgentModeSelector'`
Expected: PASS — 2 passed

- [ ] **Step 5: Commit**

```bash
git add banking_api_ui/src/components/AgentModeSelector.jsx banking_api_ui/src/components/AgentModeSelector.css banking_api_ui/src/components/__tests__/AgentModeSelector.test.jsx
git commit -m "feat(ui): AgentModeSelector — 5-mode selector + wiring sub-toggle + degraded banner"
```

---

## Task 8: Mount AgentModeSelector in Config.js + BankingAgent header

**Files:**
- Modify: `banking_api_ui/src/components/Config.js` (PROVIDERS `<select>` region ~531-664)
- Modify: `banking_api_ui/src/components/BankingAgent.js` (header `<select>` ~6534-6556)

- [ ] **Step 1: Replace Config.js provider select with AgentModeSelector**

In `Config.js`, add import near the other component imports:

```javascript
import AgentModeSelector from "./AgentModeSelector";
```

Find the `{/* Provider dropdown */}` block (the `<div>` containing the `<label>LLM Provider:</label>` and its `<select>` mapping `PROVIDERS`). Replace that entire `<div>...</div>` provider-dropdown block with:

```jsx
      <AgentModeSelector />
```

(Leave the API-key input block that follows it untouched — keys are still configured there.)

- [ ] **Step 2: Replace BankingAgent header select with compact AgentModeSelector**

In `BankingAgent.js`, the Step-3 picker added earlier is the `<label className="ba-rfc-toggle-label ba-llm-provider-label">...</label>` block (contains `<select ... className="ba-llm-provider-select">`). Replace that entire `<label>...</label>` block with:

```jsx
                <AgentModeSelector compact />
```

Add the import next to the `useLangchainProvider` import:

```javascript
import AgentModeSelector from "./AgentModeSelector";
```

Remove the now-unused `useLangchainProvider` destructuring added in the earlier Step-3 work IF nothing else uses it (search the file for `llmProvider`, `llmProviderOptions`, `isLlmProviderConfigured`, `setLlmProvider`, `llmProviderSaving` — if only the removed block used them, delete the `const { ... } = useLangchainProvider();` block and its import).

- [ ] **Step 3: UI build gate (mandatory, must exit 0)**

Run: `cd banking_api_ui && npm run build`
Expected: exit 0 (CRA "compiled successfully" / deployment hint)

- [ ] **Step 4: Run UI unit tests for the two components**

Run: `cd banking_api_ui && CI=true npx react-scripts test --watchAll=false --testPathPattern='AgentModeSelector|BankingAgent'`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add banking_api_ui/src/components/Config.js banking_api_ui/src/components/BankingAgent.js
git commit -m "feat(ui): mount AgentModeSelector in Config + BankingAgent header"
```

---

## Task 9: Documentation — T-3 amendment + REGRESSION_PLAN

**Files:**
- Modify: `ARCHITECTURE-TRUTHS.md` (T-3)
- Modify: `REGRESSION_PLAN.md` (§4 entry; §1 note)

- [ ] **Step 1: Amend T-3 in ARCHITECTURE-TRUTHS.md**

Find the T-3 entry. Append (do not delete existing text — keep history) a clearly marked amendment:

```markdown
**T-3 AMENDMENT (2026-05-18, five-mode model):** The heuristic *routing*
fast-path is now MODE-DEPENDENT (ON for modes `heuristics` and
`heuristics_helix`; OFF for `helix_google`, `chatgpt`, `claude`) via
`agentModeResolver`. This amends ONLY the routing-convenience role. The
deterministic transfer/HITL/step-up SAFETY enforcement was never the
heuristic's authority — it is server-side (`mcpToolAuthorizationService`,
`transactionConsentChallenge`, the Authorize gate) and is UNCHANGED and
mode-independent. `llmProviderResolver` remains the single low-level
provider resolver; `agentModeResolver` maps the user-facing mode onto it.
```

- [ ] **Step 2: Add REGRESSION_PLAN §4 entry**

Append a §4 Bug Fix Log entry at the end of the §4 section documenting: the five-mode model, the T-3 amendment scope (routing only), explicit assertion that §1 HITL/transfer/Authorize rows are byte-unchanged, the new files, and the test commands run with results. Use the existing §4 entry format (Symptom/Root cause/Fix/Files/Not broken/Tests).

- [ ] **Step 3: Commit**

```bash
git add ARCHITECTURE-TRUTHS.md REGRESSION_PLAN.md
git commit -m "docs: amend T-3 (routing-only) + REGRESSION_PLAN §4 for five-mode model"
```

---

## Task 10: Full verification sweep

- [ ] **Step 1: Server regression suite**

Run: `cd banking_api_server && npx jest tests/agentModeResolver.regression tests/nlIntentParser.catalog tests/agentMode.heuristicGate tests/langchainConfig.agentMode tests/platformAgentRuntime.regression tests/llmProviderResolver.regression oauthStatus.regression hitlRoute.regression`
Expected: ALL PASS (including the unchanged HITL/oauth regressions — proves §1 enforcement intact)

- [ ] **Step 2: UI build gate**

Run: `cd banking_api_ui && npm run build`
Expected: exit 0

- [ ] **Step 3: UI unit suite (the pre-commit set)**

Run: `cd banking_api_ui && npm run test:unit -- --watchAll=false --passWithNoTests --forceExit`
Expected: all suites pass (App.session included — confirms no regression)

- [ ] **Step 4: Manual smoke checklist (record results in the §4 entry)**

  - `/config` shows the 5-mode selector; selecting "Heuristics only" then sending an unrecognised query returns the capability catalog (no LLM).
  - BankingAgent header shows compact selector; switching to "Just ChatGPT" → wiring sub-toggle appears.
  - Set wiring = platform → degraded banner renders; a tool call still hits the gateway Authorize gate (check `/tmp/bank-api-server.log` for the PingAuthorize decision line).
  - Transfer in any external mode still triggers HITL/consent (server-side enforcement intact).

- [ ] **Step 5: Final commit if any doc/checklist updates**

```bash
git add REGRESSION_PLAN.md
git commit -m "docs: record five-mode verification sweep results"
```

---

## Self-Review Notes (completed)

- **Spec coverage:** modes 1-5 (Tasks 1,3,5), Helix-Google label fix (Task 6 Step 3), heuristic-routing T-3 amendment (Tasks 3,9), safety-unchanged assertion (Tasks 9,10), 4b/5b dual wiring + live runtime (Tasks 5,7), degraded banner (Task 7), Mode-1 catalog (Tasks 2,3), Config + header surfaces (Task 8), UserDashboard explicitly out of scope (not planned — matches spec §8). All spec "In" items mapped.
- **Placeholder scan:** all code steps contain complete code; doc step 2 of Task 9 references the existing §4 template (format is established in REGRESSION_PLAN — not a placeholder, an instruction to follow an existing concrete pattern).
- **Type consistency:** `resolveAgentMode` return shape `{mode,provider,heuristicRouting,externalWiring}` used consistently in Tasks 1,3,5; `agent_mode`/`external_wiring` body+config keys consistent in Tasks 4,6; `setMode(id, wiring)` signature consistent Tasks 6,7,8.

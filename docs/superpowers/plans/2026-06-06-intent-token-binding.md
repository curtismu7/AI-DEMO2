# Intent Token Binding — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cryptographically bind the user's original prompt to every downstream MCP tool call so that the authorization gate can verify a tool invocation actually matches the stated intent — and the agent cannot forge or alter that binding.

**Architecture:** The BFF mints a signed Intent Token (HMAC-SHA256 JWT) at prompt-receipt time, before the agent runs. The token is stored server-side in `req.intentToken`, propagated as an `X-Intent-Token` header on every gateway HTTP call, and validated at the MCP gateway: signature check + "is the requested tool in `permitted_tools`?". The gateway passes `IntentTokenValid` and `IntentMatchesTool` flags to PingAuthorize so the policy can deny any tool call that strays from the declared intent.

**Tech Stack:** Node.js (CommonJS) BFF · TypeScript MCP Gateway · `node:crypto` HMAC-SHA256 · existing `SESSION_SECRET` / new `INTENT_TOKEN_SECRET` env var · PingAuthorize (+ mock authz server parity)

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `demo_api_server/services/intentTokenService.js` | Mint + verify intent tokens (BFF) |
| Create | `demo_api_server/src/__tests__/intentTokenService.test.js` | Unit tests for token service |
| Create | `demo_mcp_gateway/src/intentTokenValidator.ts` | Validate intent token at gateway |
| Create | `demo_mcp_gateway/src/__tests__/intentTokenValidator.test.ts` | Unit tests for gateway validator |
| Modify | `demo_api_server/routes/agentInvokeRoute.js` | Mint IT after prompt guard, attach to req |
| Modify | `demo_api_server/services/mcpToolPipeline.js` | Read `req.intentToken`, pass to gateway client |
| Modify | `demo_api_server/services/mcpGatewayClient.js` | Add `X-Intent-Token` header when opts.intentToken set |
| Modify | `demo_mcp_gateway/src/middleware/authorizeMcpRequest.ts` | Read X-Intent-Token, validate, add to authorize call |
| Modify | `demo_mcp_gateway/src/auth/PingOneAuthorizeClient.ts` | Extend `buildAuthorizeParameters` with intent fields |
| Modify | `demo_authz_server/routes/decision.js` | Handle `IntentTokenValid + IntentMatchesTool`, deny on mismatch |

---

## Task 1: Intent Token Service (BFF)

**Files:**
- Create: `demo_api_server/services/intentTokenService.js`

- [ ] **Step 1: Write the failing test** (Task 2 — write test file first; come back here to implement)

- [ ] **Step 2: Create `intentTokenService.js`**

```javascript
'use strict';

const crypto = require('node:crypto');

const INTENT_TTL_SECONDS = 300; // 5-minute window per agent run

function getSigningKey() {
  const key = process.env.INTENT_TOKEN_SECRET || process.env.SESSION_SECRET;
  if (!key) throw new Error('[intentTokenService] INTENT_TOKEN_SECRET (or SESSION_SECRET) not set');
  return key;
}

function sign(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sigInput = `${header}.${body}`;
  const sig = crypto.createHmac('sha256', getSigningKey()).update(sigInput).digest('base64url');
  return `${sigInput}.${sig}`;
}

function verifySignature(token) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('malformed intent token: expected 3 parts');
  const [headerB64, bodyB64, sig] = parts;
  const expectedSig = crypto
    .createHmac('sha256', getSigningKey())
    .update(`${headerB64}.${bodyB64}`)
    .digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (
    sigBuf.length !== expectedBuf.length ||
    !crypto.timingSafeEqual(sigBuf, expectedBuf)
  ) {
    throw new Error('intent token signature invalid');
  }
  return JSON.parse(Buffer.from(bodyB64, 'base64url').toString('utf8'));
}

// Map from intent label → tools the agent is permitted to call.
// Unknown intents fall back to all read-only tools (no write access).
const INTENT_TO_PERMITTED_TOOLS = {
  view_balance:             ['get_account_balance', 'get_my_accounts'],
  view_accounts:            ['get_my_accounts', 'get_account_balance'],
  view_transactions:        ['get_my_transactions', 'get_my_accounts'],
  view_sensitive_account:   ['get_sensitive_account_details', 'get_my_accounts'],
  transfer:                 ['create_transfer', 'get_my_accounts', 'get_account_balance'],
  deposit:                  ['create_deposit', 'get_my_accounts', 'get_account_balance'],
  withdraw:                 ['create_withdrawal', 'get_my_accounts', 'get_account_balance'],
  view_coverage:            ['show_health_record'],
  list_appointments:        ['show_health_record'],
  list_orders:              ['show_gear_order', 'show_large_purchase'],
  pto_balance:              ['show_expense_report'],
  view_benefits:            ['show_expense_report'],
  list_gear:                ['show_gear_order'],
};

const READ_ONLY_TOOLS = [
  'get_my_accounts', 'get_account_balance', 'get_my_transactions',
  'get_investment_balance', 'get_investment_accounts', 'get_portfolio_summary',
  'get_sensitive_account_details', 'query_user_by_email',
  'sequential_think',
];

function permittedToolsForIntent(intent) {
  return INTENT_TO_PERMITTED_TOOLS[intent] || READ_ONLY_TOOLS;
}

/**
 * Mint a signed Intent Token for the given prompt/intent.
 *
 * @param {object} params
 *   userId:     PingOne sub of the authenticated user
 *   sessionId:  BFF session ID
 *   prompt:     Raw user prompt (stored as SHA-256 hash only, not plaintext)
 *   intent:     Normalized intent label from nlIntentParser (e.g. "transfer")
 *   confidence: 0–1 confidence score
 *   vertical:   Active vertical (e.g. "banking")
 *
 * @returns {{ token: string, payload: object }}
 */
function mintIntentToken({ userId, sessionId, prompt, intent, confidence, vertical }) {
  const now = Math.floor(Date.now() / 1000);
  const promptHash = crypto.createHash('sha256').update(String(prompt)).digest('hex');
  const payload = {
    jti:             crypto.randomUUID(),
    iss:             'bff:intent-token',
    sub:             userId || '',
    sid:             sessionId || '',
    iat:             now,
    exp:             now + INTENT_TTL_SECONDS,
    prompt_hash:     promptHash,
    intent:          intent || 'unknown',
    confidence:      typeof confidence === 'number' ? confidence : 0,
    permitted_tools: permittedToolsForIntent(intent),
    vertical:        vertical || 'banking',
  };
  return { token: sign(payload), payload };
}

/**
 * Verify a signed Intent Token.
 * Throws if signature is invalid or token is expired.
 *
 * @param {string} token
 * @returns {object} decoded payload
 */
function verifyIntentToken(token) {
  const payload = verifySignature(token);
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp < now) throw new Error('intent token expired');
  return payload;
}

module.exports = { mintIntentToken, verifyIntentToken, permittedToolsForIntent };
```

- [ ] **Step 3: Verify module loads without error**

```bash
cd demo_api_server
SESSION_SECRET=test-key node -e "const s = require('./services/intentTokenService'); const {token, payload} = s.mintIntentToken({userId:'u1',sessionId:'s1',prompt:'hi',intent:'transfer',confidence:0.9,vertical:'banking'}); console.log('token parts:', token.split('.').length); console.log('payload intent:', payload.intent);"
```

Expected output:
```
token parts: 3
payload intent: transfer
```

---

## Task 2: Intent Token Service Tests

**Files:**
- Create: `demo_api_server/src/__tests__/intentTokenService.test.js`

- [ ] **Step 1: Create the test file**

```javascript
'use strict';

// Must set before require so the module picks up the key
process.env.SESSION_SECRET = 'test-secret-for-intent-tests-32chars!!';

const {
  mintIntentToken,
  verifyIntentToken,
  permittedToolsForIntent,
} = require('../../services/intentTokenService');

const BASE_PARAMS = {
  userId: 'user-abc',
  sessionId: 'sess-123',
  prompt: 'transfer $100 to alice',
  intent: 'transfer',
  confidence: 0.95,
  vertical: 'banking',
};

describe('mintIntentToken', () => {
  test('returns a 3-part JWT string', () => {
    const { token } = mintIntentToken(BASE_PARAMS);
    expect(token.split('.').length).toBe(3);
  });

  test('payload contains expected fields', () => {
    const { payload } = mintIntentToken(BASE_PARAMS);
    expect(payload.intent).toBe('transfer');
    expect(payload.sub).toBe('user-abc');
    expect(payload.sid).toBe('sess-123');
    expect(payload.permitted_tools).toContain('create_transfer');
    expect(typeof payload.jti).toBe('string');
    expect(typeof payload.prompt_hash).toBe('string');
    expect(payload.prompt_hash.length).toBe(64); // sha256 hex
    expect(payload.exp).toBeGreaterThan(payload.iat);
  });

  test('unknown intent falls back to read-only tools', () => {
    const { payload } = mintIntentToken({ ...BASE_PARAMS, intent: 'unknown' });
    expect(payload.permitted_tools).toContain('get_my_accounts');
    expect(payload.permitted_tools).not.toContain('create_transfer');
  });
});

describe('verifyIntentToken', () => {
  test('round-trips correctly', () => {
    const { token } = mintIntentToken(BASE_PARAMS);
    const payload = verifyIntentToken(token);
    expect(payload.intent).toBe('transfer');
    expect(payload.sub).toBe('user-abc');
  });

  test('rejects tampered payload', () => {
    const { token } = mintIntentToken(BASE_PARAMS);
    const [h, b, s] = token.split('.');
    const original = JSON.parse(Buffer.from(b, 'base64url').toString());
    const tampered = Buffer.from(
      JSON.stringify({ ...original, intent: 'withdraw' })
    ).toString('base64url');
    expect(() => verifyIntentToken(`${h}.${tampered}.${s}`)).toThrow('intent token signature invalid');
  });

  test('rejects wrong number of parts', () => {
    expect(() => verifyIntentToken('aaa.bbb')).toThrow('malformed intent token');
  });

  test('rejects expired token', () => {
    const now = Math.floor(Date.now() / 1000);
    // Manually build an already-expired payload to avoid waiting
    const expiredPayload = { ...mintIntentToken(BASE_PARAMS).payload, iat: now - 400, exp: now - 100 };
    // We need to sign it ourselves to produce a valid-sig but expired token
    const crypto = require('node:crypto');
    const key = process.env.SESSION_SECRET;
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify(expiredPayload)).toString('base64url');
    const sig = crypto.createHmac('sha256', key).update(`${header}.${body}`).digest('base64url');
    const expiredToken = `${header}.${body}.${sig}`;
    expect(() => verifyIntentToken(expiredToken)).toThrow('intent token expired');
  });

  test('rejects wrong signing key', () => {
    const { token } = mintIntentToken(BASE_PARAMS);
    process.env.SESSION_SECRET = 'different-key-will-fail-verification!!';
    expect(() => verifyIntentToken(token)).toThrow('intent token signature invalid');
    process.env.SESSION_SECRET = 'test-secret-for-intent-tests-32chars!!';
  });
});

describe('permittedToolsForIntent', () => {
  test('transfer includes create_transfer', () => {
    expect(permittedToolsForIntent('transfer')).toContain('create_transfer');
  });

  test('view_balance does not include create_transfer', () => {
    expect(permittedToolsForIntent('view_balance')).not.toContain('create_transfer');
  });
});
```

- [ ] **Step 2: Run the tests — they must all pass**

```bash
cd demo_api_server
npx jest intentTokenService --no-coverage
```

Expected: all tests PASS

- [ ] **Step 3: Commit**

```bash
git add demo_api_server/services/intentTokenService.js demo_api_server/src/__tests__/intentTokenService.test.js
git commit -m "feat(intent-token): BFF intent token service — mint + verify HMAC-SHA256 JWTs"
```

---

## Task 3: Mint Intent Token at Prompt Receipt

**Files:**
- Modify: `demo_api_server/routes/agentInvokeRoute.js:1-30`

- [ ] **Step 1: Write a failing test for the route minting behavior**

Create `demo_api_server/src/__tests__/agentInvokeRoute.intentToken.test.js`:

```javascript
'use strict';

process.env.SESSION_SECRET = 'test-secret-for-intent-tests-32chars!!';

jest.mock('../../services/demoAgentLangGraphService', () => ({
  processAgentMessage: jest.fn(async (opts) => {
    // Capture what intentToken was set on req so we can assert it
    return {
      toolsCalled: ['get_my_accounts'],
      response: 'Here are your accounts.',
      tokenEvents: [],
      agentPath: 'heuristic',
      confidence: 0.95,
      _capturedIntentToken: opts.req?.intentToken || null,
    };
  }),
}));
jest.mock('../../middleware/auth', () => ({
  authenticateToken: (req, res, next) => {
    req.user = { sub: 'user-test-123' };
    req.session = { id: 'sess-test', oauthTokens: { accessToken: 'tok' } };
    next();
  },
}));
jest.mock('../../services/configStore', () => ({
  getEffective: jest.fn(() => null),
}));
jest.mock('../../services/promptGuard', () => ({
  guardPromptInput: jest.fn(() => null),
}));
jest.mock('../../services/lmdb/reportStore.lmdb', () => ({
  saveRun: jest.fn(),
}));

const request = require('supertest');
const express = require('express');
const router = require('../../routes/agentInvokeRoute');

const app = express();
app.use(express.json());
app.use('/api', router);

test('POST /api/agent/invoke mints an intent token and attaches it to req', async () => {
  const { processAgentMessage } = require('../../services/demoAgentLangGraphService');
  await request(app)
    .post('/api/agent/invoke')
    .send({ prompt: 'show me my accounts' })
    .expect(200);

  const call = processAgentMessage.mock.calls[0][0];
  expect(call.req.intentToken).toBeDefined();
  expect(typeof call.req.intentToken).toBe('string');
  expect(call.req.intentToken.split('.').length).toBe(3);
});
```

- [ ] **Step 2: Run the test — it must FAIL** (intentToken not yet attached)

```bash
cd demo_api_server
npx jest agentInvokeRoute.intentToken --no-coverage
```

Expected: FAIL — `call.req.intentToken` is undefined.

- [ ] **Step 3: Add intent token minting to `agentInvokeRoute.js`**

At the top of the file, add the require:
```javascript
const { mintIntentToken } = require('../services/intentTokenService');
```

After the `guardPromptInput` block (around line 108) and before `processAgentMessage`, add:

```javascript
    // ── INTENT TOKEN: mint at prompt receipt, before agent runs ──────────────
    // Cryptographically binds the original intent so downstream tool calls
    // can be validated against it at the MCP gateway.
    const { intent: _itIntent, confidence: _itConf } = extractIntentFromPrompt(prompt);
    const { token: _intentToken } = mintIntentToken({
      userId,
      sessionId: req.session.id,
      prompt,
      intent: _itIntent,
      confidence: _itConf,
      vertical,
    });
    req.intentToken = _intentToken;
    // ─────────────────────────────────────────────────────────────────────────
```

- [ ] **Step 4: Run the test — it must PASS**

```bash
cd demo_api_server
npx jest agentInvokeRoute.intentToken --no-coverage
```

Expected: PASS

- [ ] **Step 5: Run existing agent invoke tests to check for regressions**

```bash
cd demo_api_server
npx jest agentInvokeRoute --no-coverage 2>/dev/null || npx jest demoAgentNl --no-coverage
```

Expected: all pass

- [ ] **Step 6: Commit**

```bash
git add demo_api_server/routes/agentInvokeRoute.js demo_api_server/src/__tests__/agentInvokeRoute.intentToken.test.js
git commit -m "feat(intent-token): mint IT at prompt receipt in agentInvokeRoute, attach to req"
```

---

## Task 4: Propagate Intent Token Through Gateway Client

**Files:**
- Modify: `demo_api_server/services/mcpToolPipeline.js:555-570`
- Modify: `demo_api_server/services/mcpGatewayClient.js:57-82`

- [ ] **Step 1: Write a failing test for the propagation**

Create `demo_api_server/src/__tests__/mcpGatewayClient.intentToken.test.js`:

```javascript
'use strict';

jest.mock('axios');
jest.mock('../services/configStore', () => ({
  getEffective: jest.fn((k) => k === 'mcp_gateway_timeout_ms' ? null : null),
}));

const axios = require('axios');
const { callToolViaGateway } = require('../../services/mcpGatewayClient');

beforeEach(() => {
  axios.post.mockResolvedValue({
    status: 200,
    data: { jsonrpc: '2.0', id: '1', result: { content: [{ text: '{}' }] } },
  });
});

test('attaches X-Intent-Token header when opts.intentToken is set', async () => {
  await callToolViaGateway(
    'https://api.ping.demo:3005',
    'bearer-tok',
    'get_my_accounts',
    {},
    { intentToken: 'header.payload.sig' },
  );
  const headers = axios.post.mock.calls[0][2].headers;
  expect(headers['X-Intent-Token']).toBe('header.payload.sig');
});

test('omits X-Intent-Token header when opts.intentToken is absent', async () => {
  await callToolViaGateway(
    'https://api.ping.demo:3005',
    'bearer-tok',
    'get_my_accounts',
    {},
    {},
  );
  const headers = axios.post.mock.calls[0][2].headers;
  expect(headers['X-Intent-Token']).toBeUndefined();
});
```

- [ ] **Step 2: Run the test — it must FAIL**

```bash
cd demo_api_server
npx jest mcpGatewayClient.intentToken --no-coverage
```

Expected: FAIL — `X-Intent-Token` header is not set.

- [ ] **Step 3: Add `X-Intent-Token` header to `mcpGatewayClient.js`**

In `callToolViaGateway`, after the existing `if (opts.tratContextHeader)` block (around line 79), add:

```javascript
    if (opts.intentToken) {
        headers['X-Intent-Token'] = opts.intentToken;
    }
```

- [ ] **Step 4: Pass `req.intentToken` from `mcpToolPipeline.js`**

In `mcpToolPipeline.js`, find the line that calls `deps.callToolViaGateway` (around line 563):

```javascript
({ result, gwAuditTrail } = await deps.callToolViaGateway(gatewayHttpUrl, mcpAccessToken, tool, params || {}, { correlationId: req.correlationId, tratContextHeader }));
```

Change it to:

```javascript
({ result, gwAuditTrail } = await deps.callToolViaGateway(gatewayHttpUrl, mcpAccessToken, tool, params || {}, { correlationId: req.correlationId, tratContextHeader, intentToken: req.intentToken || null }));
```

- [ ] **Step 5: Run the test — it must PASS**

```bash
cd demo_api_server
npx jest mcpGatewayClient.intentToken --no-coverage
```

Expected: PASS

- [ ] **Step 6: Build the UI (required after any BFF change that runs through the build pipeline)**

```bash
cd demo_api_ui && npm run build
```

Expected: exit 0

- [ ] **Step 7: Commit**

```bash
git add demo_api_server/services/mcpToolPipeline.js demo_api_server/services/mcpGatewayClient.js demo_api_server/src/__tests__/mcpGatewayClient.intentToken.test.js
git commit -m "feat(intent-token): propagate X-Intent-Token header through tool pipeline to gateway"
```

---

## Task 5: Gateway Intent Token Validator

**Files:**
- Create: `demo_mcp_gateway/src/intentTokenValidator.ts`
- Create: `demo_mcp_gateway/src/__tests__/intentTokenValidator.test.ts`

- [ ] **Step 1: Create the test file**

```typescript
// demo_mcp_gateway/src/__tests__/intentTokenValidator.test.ts
import * as crypto from 'node:crypto';
import { validateIntentToken } from '../intentTokenValidator';

const TEST_SECRET = 'gateway-test-secret-at-least-32-chars';

function makeToken(payload: Record<string, unknown>, secret = TEST_SECRET): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

const VALID_PAYLOAD = {
  jti: 'test-jti-1',
  iss: 'bff:intent-token',
  sub: 'user-123',
  sid: 'sess-abc',
  iat: Math.floor(Date.now() / 1000) - 10,
  exp: Math.floor(Date.now() / 1000) + 290,
  prompt_hash: 'abc123',
  intent: 'transfer',
  confidence: 0.95,
  permitted_tools: ['create_transfer', 'get_my_accounts'],
  vertical: 'banking',
};

describe('validateIntentToken', () => {
  beforeEach(() => {
    process.env.INTENT_TOKEN_SECRET = TEST_SECRET;
  });

  test('returns valid=true and toolPermitted=true when tool is in permitted_tools', () => {
    const token = makeToken(VALID_PAYLOAD);
    const result = validateIntentToken(token, 'create_transfer');
    expect(result.valid).toBe(true);
    expect(result.toolPermitted).toBe(true);
    expect(result.payload?.intent).toBe('transfer');
  });

  test('returns valid=true but toolPermitted=false when tool not in permitted_tools', () => {
    const token = makeToken(VALID_PAYLOAD);
    const result = validateIntentToken(token, 'create_withdrawal');
    expect(result.valid).toBe(true);
    expect(result.toolPermitted).toBe(false);
  });

  test('returns valid=false when token is absent', () => {
    const result = validateIntentToken(undefined, 'create_transfer');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('no_intent_token');
  });

  test('returns valid=false for tampered payload', () => {
    const token = makeToken(VALID_PAYLOAD);
    const [h, b, s] = token.split('.');
    const original = JSON.parse(Buffer.from(b, 'base64url').toString());
    const tampered = Buffer.from(JSON.stringify({ ...original, intent: 'withdraw' })).toString('base64url');
    const result = validateIntentToken(`${h}.${tampered}.${s}`, 'create_transfer');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('invalid_signature');
  });

  test('returns valid=false for expired token', () => {
    const expiredPayload = { ...VALID_PAYLOAD, exp: Math.floor(Date.now() / 1000) - 5 };
    const token = makeToken(expiredPayload);
    const result = validateIntentToken(token, 'create_transfer');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('expired');
  });

  test('returns valid=false for malformed token', () => {
    const result = validateIntentToken('not.a.valid.jwt.parts', 'create_transfer');
    expect(result.valid).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test — it must FAIL** (file doesn't exist yet)

```bash
cd demo_mcp_gateway
npx jest intentTokenValidator --no-coverage 2>&1 | head -20
```

Expected: error — cannot find module `../intentTokenValidator`

- [ ] **Step 3: Create `intentTokenValidator.ts`**

```typescript
'use strict';

/**
 * intentTokenValidator — gateway-side validation for BFF-minted Intent Tokens.
 *
 * Intent Tokens are HMAC-SHA256 JWTs minted by the BFF at prompt-receipt time.
 * They bind the user's original intent to a cryptographic token that the agent
 * cannot modify. The gateway validates the signature and checks that the
 * requested tool is in the `permitted_tools` claim before sending the
 * authorization decision to PingAuthorize.
 *
 * Env var: INTENT_TOKEN_SECRET (shared between BFF and gateway).
 * Fallback: SESSION_SECRET (for local dev where both run from the same .env).
 */

import * as crypto from 'node:crypto';

export interface IntentTokenPayload {
  jti: string;
  iss: string;
  sub: string;
  sid: string;
  iat: number;
  exp: number;
  prompt_hash: string;
  intent: string;
  confidence: number;
  permitted_tools: string[];
  vertical: string;
}

export interface IntentValidationResult {
  valid: boolean;
  payload?: IntentTokenPayload;
  error?: string;
  toolPermitted?: boolean;
}

function getSigningKey(): string {
  const key = process.env.INTENT_TOKEN_SECRET || process.env.SESSION_SECRET;
  if (!key) throw new Error('[intentTokenValidator] INTENT_TOKEN_SECRET not configured');
  return key;
}

/**
 * Validate an Intent Token and check whether `toolName` is in its permitted_tools.
 *
 * @param token     - raw JWT string from X-Intent-Token header (may be undefined)
 * @param toolName  - the MCP tool name the agent wants to call
 */
export function validateIntentToken(
  token: string | undefined,
  toolName: string,
): IntentValidationResult {
  if (!token) {
    return { valid: false, error: 'no_intent_token', toolPermitted: false };
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    return { valid: false, error: 'malformed', toolPermitted: false };
  }

  const [headerB64, bodyB64, sig] = parts;

  let key: string;
  try {
    key = getSigningKey();
  } catch {
    return { valid: false, error: 'no_signing_key', toolPermitted: false };
  }

  const expectedSig = crypto
    .createHmac('sha256', key)
    .update(`${headerB64}.${bodyB64}`)
    .digest('base64url');

  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (
    sigBuf.length !== expectedBuf.length ||
    !crypto.timingSafeEqual(sigBuf, expectedBuf)
  ) {
    return { valid: false, error: 'invalid_signature', toolPermitted: false };
  }

  let payload: IntentTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(bodyB64, 'base64url').toString('utf8')) as IntentTokenPayload;
  } catch {
    return { valid: false, error: 'malformed_payload', toolPermitted: false };
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (payload.exp < nowSec) {
    return { valid: false, error: 'expired', toolPermitted: false };
  }

  const toolPermitted =
    Array.isArray(payload.permitted_tools) && payload.permitted_tools.includes(toolName);

  return { valid: true, payload, toolPermitted };
}
```

- [ ] **Step 4: Run the tests — they must all PASS**

```bash
cd demo_mcp_gateway
npx jest intentTokenValidator --no-coverage
```

Expected: all PASS

- [ ] **Step 5: Build the gateway (TypeScript compile)**

```bash
cd demo_mcp_gateway && npm run build
```

Expected: exit 0, no TS errors

- [ ] **Step 6: Commit**

```bash
git add demo_mcp_gateway/src/intentTokenValidator.ts demo_mcp_gateway/src/__tests__/intentTokenValidator.test.ts
git commit -m "feat(intent-token): gateway intent token validator with HMAC-SHA256 signature check"
```

---

## Task 6: Wire Intent Validation Into Gateway Authorization Pipeline

**Files:**
- Modify: `demo_mcp_gateway/src/auth/PingOneAuthorizeClient.ts:65-108`
- Modify: `demo_mcp_gateway/src/middleware/authorizeMcpRequest.ts:80-100`

- [ ] **Step 1: Extend `buildAuthorizeParameters` in `PingOneAuthorizeClient.ts`**

Add `IntentValidationResult` import at the top of the file:

```typescript
import { validateIntentToken, type IntentValidationResult } from '../intentTokenValidator';
```

Add `intentValidation` parameter to `buildAuthorizeParameters` signature (after `hitlApproved`):

```typescript
export function buildAuthorizeParameters(
  decoded: DecodedGatewayToken,
  method: string,
  gatewayResourceUri: string,
  toolName?: string,
  toolArgs?: ToolArgs,
  tratClaims?: TratClaims | null,
  hitlApproved?: boolean,
  intentValidation?: IntentValidationResult | null,   // ← ADD
): Record<string, string> {
```

At the end of the function body, before `return base;`, add:

```typescript
  if (intentValidation) {
    base['IntentTokenValid']    = String(intentValidation.valid);
    base['IntentMatchesTool']   = String(intentValidation.toolPermitted ?? false);
    base['IntentJti']           = intentValidation.payload?.jti ?? '';
    base['IntentIntent']        = intentValidation.payload?.intent ?? '';
    base['IntentConfidence']    = String(intentValidation.payload?.confidence ?? 0);
  }
```

- [ ] **Step 2: Read `X-Intent-Token` in `authorizeMcpRequest.ts` and pass to authorize**

In `buildAuthorizeMcpRequest`, the middleware receives `_req: IncomingMessage`. After the body is parsed (where `toolName` is extracted), add:

```typescript
    // Read and validate the intent token header (present when BFF sends it)
    const xIntentToken = _req.headers['x-intent-token'] as string | undefined;
    const intentValidation = xIntentToken
      ? validateIntentToken(xIntentToken, parsedBody.params?.name ?? '')
      : null;

    if (intentValidation && !intentValidation.valid) {
      console.warn('[GW] Intent token validation failed:', intentValidation.error, 'tool:', parsedBody.params?.name);
    }
    if (intentValidation?.valid && intentValidation.toolPermitted === false) {
      console.warn('[GW] Intent token valid but tool not in permitted_tools. tool:', parsedBody.params?.name, 'intent:', intentValidation.payload?.intent);
    }
```

Then update the `authorize` call to pass `intentValidation`. Find where `authorizeClient.evaluate()` is called and update:

```typescript
    const authorizeResult = await (deps
      ? deps.authorize(decoded, parsedBody.method ?? '', parsedBody.params?.name, parsedBody.params?.arguments, false, intentValidation)
      : authorizeClient.evaluate(decoded, parsedBody.method ?? '', parsedBody.params?.name, parsedBody.params?.arguments, false, intentValidation));
```

Also add `intentValidation` to the `AuthorizeMcpRequestDeps.authorize` type:

```typescript
  authorize: (decoded: any, method: string, toolName?: string, toolArgs?: any, hitlApproved?: boolean, intentValidation?: any) =>
    Promise<{ decision: 'PERMIT' | 'DENY' | 'INDETERMINATE'; reason?: string }>;
```

- [ ] **Step 3: Update `PingOneAuthorizeClient.evaluate` to accept and forward intentValidation**

In `PingOneAuthorizeClient.evaluate`, add `intentValidation` parameter:

```typescript
  async evaluate(
    decoded: DecodedGatewayToken,
    method: string,
    toolName?: string,
    toolArgs?: ToolArgs,
    hitlApproved?: boolean,
    intentValidation?: IntentValidationResult | null,   // ← ADD
  ): Promise<AuthzDecision> {
```

And update the `buildAuthorizeParameters` call inside `evaluate`:

```typescript
      const body = {
        parameters: buildAuthorizeParameters(
          decoded,
          method,
          this.config.gatewayResourceUri,
          toolName,
          toolArgs,
          null,
          hitlApproved,
          intentValidation,   // ← ADD
        ),
      };
```

- [ ] **Step 4: Build the gateway**

```bash
cd demo_mcp_gateway && npm run build
```

Expected: exit 0, no TS errors

- [ ] **Step 5: Run gateway tests**

```bash
cd demo_mcp_gateway && npx jest --no-coverage 2>&1 | tail -20
```

Expected: all pass (or pre-existing failures only — do not introduce new ones)

- [ ] **Step 6: Commit**

```bash
git add demo_mcp_gateway/src/auth/PingOneAuthorizeClient.ts demo_mcp_gateway/src/middleware/authorizeMcpRequest.ts demo_mcp_gateway/src/intentTokenValidator.ts
git commit -m "feat(intent-token): wire intent validation into gateway authorize pipeline"
```

---

## Task 7: Update Mock Authz Server (Parity Rule)

> **Rule:** Any change to PingAuthorize decision parameters MUST be mirrored in `demo_authz_server`. It is a drop-in replacement — divergence breaks the demo when pointing at mock.

**Files:**
- Modify: `demo_authz_server/routes/decision.js:52-70`

- [ ] **Step 1: Add `IntentTokenValid` / `IntentMatchesTool` to the destructured params**

In `demo_authz_server/routes/decision.js`, update the destructured params block (around line 54):

```javascript
  const {
    DecisionContext = '',
    ToolName = '',
    ClientId = '',
    ActClientId = '',
    TokenScopes = '',
    TokenAudience = '',
    TokenAudActual = '',
    TokenExp = '',
    TokenIat = '',
    TokenNbf = '',
    TokenIss = '',
    TransactionAmount = '',
    HitlApproved = '',
    IntentTokenValid = '',    // ← ADD
    IntentMatchesTool = '',   // ← ADD
    IntentIntent = '',        // ← ADD
  } = params;
```

- [ ] **Step 2: Add intent mismatch rule (after the actor check, before PERMIT)**

Find the actor check section (around line 185). After the actor check and scope check, before the final PERMIT block, add:

```javascript
  // ── Rule: intent token mismatch → DENY ────────────────────────────────────
  // When the BFF mints an intent token (IntentTokenValid=true), the called tool
  // must appear in the token's permitted_tools (IntentMatchesTool=true).
  // A valid intent token saying "transfer" that tries to call "create_withdrawal"
  // is a mismatch and must be denied. If IntentTokenValid is absent/false, this
  // rule does not fire (intent token is optional in this demo).
  if (IntentTokenValid === 'true' && IntentMatchesTool === 'false') {
    console.warn(`[AuthzServer/decision] DENY — intent mismatch: tool="${ToolName}" intent="${IntentIntent}" (permitted_tools does not include tool)`);
    return deny(res, `intent_mismatch: tool "${ToolName}" not permitted by signed intent "${IntentIntent}"`);
  }
```

- [ ] **Step 3: Update the PERMIT log line to include intent fields (observability)**

Find the `console.log` at the PERMIT block (around line 211):

```javascript
  console.log(`[AuthzServer/decision] PERMIT — tool="${ToolName}" actor="${ActClientId}"`);
```

Change it to:

```javascript
  console.log(`[AuthzServer/decision] PERMIT — tool="${ToolName}" actor="${ActClientId}" intentValid="${IntentTokenValid}" intentMatch="${IntentMatchesTool}"`);
```

- [ ] **Step 4: Restart the demo and test the happy path (manual)**

Start with `./run.sh`. Log in and submit prompt "show me my accounts". Check:
- BFF log: `[intentTokenService]` — should NOT appear (no verbose logging yet)
- Gateway request succeeds
- Balance appears in UI

- [ ] **Step 5: Test the mismatch path (manual)**

To trigger a mismatch, temporarily hardcode `permitted_tools: []` in `mintIntentToken` and submit a tool-calling prompt. The authz server should log `DENY — intent mismatch`.

Revert the hardcode after verifying.

- [ ] **Step 6: Run full test suite**

```bash
cd demo_api_server && npm test -- --passWithNoTests 2>&1 | tail -10
cd demo_mcp_gateway && npm test -- --passWithNoTests 2>&1 | tail -10
```

Expected: all pass

- [ ] **Step 7: Commit**

```bash
git add demo_authz_server/routes/decision.js
git commit -m "feat(intent-token): mock authz server — deny intent_mismatch per parity rule"
```

---

## Task 8: Add Intent Token to Token Chain UI Events

**Files:**
- Modify: `demo_api_server/routes/agentInvokeRoute.js` (small addition)

> **Context:** Token events are arrays of event objects accumulated during the agent run and returned in the response for the Token Chain panel. The IT is minted in the route, so we add its event there.

- [ ] **Step 1: Build the IT token event and merge it into the agent response**

In `agentInvokeRoute.js`, after minting the intent token (Task 3 Step 3), add:

```javascript
    const _itEvent = {
      id: 'intent-token',
      label: 'Intent Token (BFF-signed)',
      status: 'active',
      claims: {
        jti:             intentPayload.jti,
        intent:          intentPayload.intent,
        confidence:      intentPayload.confidence,
        permitted_tools: intentPayload.permitted_tools.join(', '),
        vertical:        intentPayload.vertical,
        exp:             intentPayload.exp,
      },
      explanation:
        `BFF minted a signed Intent Token (HMAC-SHA256) binding the declared intent ` +
        `"${intentPayload.intent}" (confidence ${intentPayload.confidence.toFixed(2)}) ` +
        `to this agent run. Permitted tools: ${intentPayload.permitted_tools.join(', ')}. ` +
        `Propagated as X-Intent-Token to the MCP gateway for downstream validation.`,
    };
```

Then, after `agentResponse` is received, prepend the event:

```javascript
    agentResponse.tokenEvents = [_itEvent, ...(agentResponse.tokenEvents || [])];
```

- [ ] **Step 2: Build the UI**

```bash
cd demo_api_ui && npm run build
```

Expected: exit 0

- [ ] **Step 3: Manually verify the token chain shows "Intent Token (BFF-signed)"**

Start `./run.sh`. Open the dashboard. Click a banking tool chip or type a prompt. Open the Token Chain panel. Verify the first event is "Intent Token (BFF-signed)" with the correct intent, confidence, and permitted tools.

- [ ] **Step 4: Run the full test suite**

```bash
npm test 2>&1 | tail -20
```

Expected: all pass (or only pre-existing failures)

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/routes/agentInvokeRoute.js
git commit -m "feat(intent-token): add IT to Token Chain token events for UI visibility"
```

---

## Task 9: Environment Variable Setup

**Files:**
- Modify: `demo_api_server/.env.example` (if it exists)
- Modify: `demo_mcp_gateway/.env.example` (if it exists)
- Modify: `docs/ENV_VARS.md`

- [ ] **Step 1: Document the new env var in `docs/ENV_VARS.md`**

Add an entry to the table:

```
INTENT_TOKEN_SECRET
  Purpose: HMAC-SHA256 signing key for Intent Tokens (JWTs minted by BFF at prompt-receipt
           time to bind the user's intent to downstream MCP tool calls).
  Used by: demo_api_server (mintIntentToken), demo_mcp_gateway (validateIntentToken)
  Required: No (falls back to SESSION_SECRET for local dev; production should set this separately)
  Default: falls back to SESSION_SECRET
  Notes: Must be identical in BFF and gateway so the gateway can verify the BFF's signature.
         Use a random 32+ byte secret. Never share SESSION_SECRET in production; use a
         dedicated key so compromise of one doesn't affect the other.
```

- [ ] **Step 2: Add `INTENT_TOKEN_SECRET` to each `.env.example`** (if those files exist)

```bash
grep -l "SESSION_SECRET\|INTENT_TOKEN_SECRET" \
  demo_api_server/.env.example demo_mcp_gateway/.env.example 2>/dev/null
```

If the files exist, add a line: `# INTENT_TOKEN_SECRET=<generate with: openssl rand -hex 32>`

- [ ] **Step 3: Commit**

```bash
git add docs/ENV_VARS.md
git commit -m "docs(intent-token): document INTENT_TOKEN_SECRET env var"
```

---

## Task 10: WS Path — Known Limitation Note

The intent token is currently validated on the **HTTP path only** (BFF → gateway HTTP `/mcp` endpoint). The legacy WebSocket path (`index.ts` → `guardToolCall`) does not yet receive the intent token because the WS transport carries it only on the initial HTTP upgrade request, not on individual JSON-RPC messages.

- [ ] **Step 1: Add a TODO comment in `demo_mcp_gateway/src/index.ts` near the `guardToolCall` call (line ~551)**

```typescript
    // TODO(intent-token): WS path does not yet validate X-Intent-Token.
    // The intent token arrives as an HTTP header on the upgrade request; to
    // enforce it here, extract it from the per-socket context set up during
    // the WS handshake and pass it to guardToolCall as a 7th argument.
    const authz = await guardToolCall(toolName, decoded, config, toolArgs, undefined, hitlApproved);
```

- [ ] **Step 2: Build the gateway**

```bash
cd demo_mcp_gateway && npm run build
```

Expected: exit 0

- [ ] **Step 3: Commit**

```bash
git add demo_mcp_gateway/src/index.ts
git commit -m "docs(intent-token): note WS path as known gap for intent token validation"
```

---

## Post-Plan Self-Review

**Spec coverage check:**

| Requirement | Covered by |
|-------------|------------|
| Capture prompt in a token the agent can't modify | Task 1 — minted at BFF, before agent runs; stored as `req.intentToken` in server-side Express request |
| Cryptographically signed | Task 1 — HMAC-SHA256, `SESSION_SECRET` / `INTENT_TOKEN_SECRET` |
| Propagate to authorization decision | Tasks 4, 6 — `X-Intent-Token` header → gateway reads it before PingAuthorize call |
| Validate tool call matches original intent | Task 6 — `permitted_tools` check → `IntentMatchesTool` param → PingAuthorize / mock authz |
| Mock authz server parity | Task 7 |
| UI visibility of the token binding | Task 8 |

**Placeholder scan:** No TBDs or "add later" items found. The WS gap is documented as a known limitation, not left implicit.

**Type consistency:** `IntentValidationResult` is exported from `intentTokenValidator.ts` and imported by both `PingOneAuthorizeClient.ts` and `authorizeMcpRequest.ts`. The `buildAuthorizeParameters` signature is updated in one place; both callers (HTTP middleware and WS path) use this function. ✅

---

## Verification Checklist

Before marking this feature complete:

- [ ] `cd demo_api_ui && npm run build` → exit 0
- [ ] `cd demo_mcp_gateway && npm run build` → exit 0
- [ ] `npm test` (from repo root) → no new failures
- [ ] Happy path: login → type "show my balance" → Token Chain shows "Intent Token (BFF-signed)" → balance appears
- [ ] Mismatch path: temporarily set `permitted_tools: []` in `mintIntentToken`, call any tool → authz server log shows `DENY — intent mismatch` → revert
- [ ] Check `demo-api.log` for no unhandled errors during a normal agent run

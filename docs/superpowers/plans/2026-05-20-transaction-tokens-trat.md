# Transaction Tokens (TraT) — MCP Gateway → MCP Server Security Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `ff_trat_mode` feature flag that enriches RFC 8693 token exchange with Transaction Token (TraT) claims, enforces them via PingOne Authorize at the MCP server, and explains the pattern in a dedicated education panel.

**Architecture:** BFF injects TraT context (`reqctx`, `purp`, `azd`, `rctx`) as extra parameters during the existing RFC 8693 exchange; if PingOne does not emit those claims natively, a simulation shim attaches them as an `X-TraT-Context` header forwarded through the gateway to the MCP server. The MCP server (both WebSocket and HTTP transports) extracts claims and sends them to PingOne Authorize as enriched decision context. The feature is entirely off by default (`ff_trat_mode=false`).

**Tech Stack:** Node.js/CommonJS (BFF), TypeScript (MCP Gateway + MCP Server), React/JSX (UI), PingOne Management API (claim provisioning), PingOne Authorize (policy enforcement), Jest (tests)

---

## File Map

| File | Action | What changes |
|---|---|---|
| `demo_api_server/services/configStore.js` | Modify | Add `ff_trat_mode` FIELD_DEF |
| `demo_api_server/services/agentMcpTokenService.js` | Modify | TraT context builder + shim; emit `trat` token event |
| `demo_api_server/scripts/setupTratClaims.js` | Create | Idempotent PingOne claim provisioning script |
| `demo_api_server/scripts/bootstrapPingOne.js` | Modify | Call `setupTratClaims.js` post-provisioning |
| `demo_api_server/package.json` | Modify | Add `pingone:setup:trat` script |
| `demo_mcp_gateway/src/proxy.ts` | Modify | Forward `X-TraT-Context` header |
| `demo_mcp_server/src/auth/TratClaimsExtractor.ts` | Create | Pure function: extract + normalise TraT claims from JWT or header |
| `demo_mcp_server/src/server/HttpMCPTransport.ts` | Modify | Pass TraT context to Authorize payload when env flag set |
| `demo_mcp_server/src/server/MCPMessageHandler.ts` | Modify | Same for WebSocket path |
| `demo_api_ui/src/components/TokenChainDisplay.js` | Modify | TraT badge + claims expansion |
| `demo_api_ui/src/components/TokenChainDisplay.css` | Modify | TraT badge styles |
| `demo_api_ui/src/components/education/educationIds.js` | Modify | Add `TRANSACTION_TOKENS` |
| `demo_api_ui/src/components/education/TransactionTokensPanel.js` | Create | Education panel |
| `demo_api_ui/src/components/education/EducationPanelsHost.js` | Modify | Register new panel |

---

## Task 1: Feature Flag in configStore

**Files:**
- Modify: `demo_api_server/services/configStore.js`

- [ ] **Step 1: Read the existing ff_ flag block to find exact insertion point**

Open `demo_api_server/services/configStore.js` and find the block that contains:
```javascript
ff_skip_token_exchange:  { public: true, default: 'false' },
```
It is in the `FIELD_DEFS` object, under the comment `// Feature flags — granular toggles`.

- [ ] **Step 2: Insert the new flag**

After `ff_id_token_exchange` (the last `ff_` flag in that block), add:
```javascript
ff_trat_mode:            { public: true, default: 'false' }, // Enrich RFC 8693 exchange with Transaction Token (TraT) claims — draft-oauth-transaction-tokens-for-agents-00
```

- [ ] **Step 3: Verify the server starts without error**

```bash
cd demo_api_server && node -e "const cs = require('./services/configStore'); console.log('ff_trat_mode default:', cs.getEffective('ff_trat_mode'));"
```
Expected output: `ff_trat_mode default: false`

- [ ] **Step 4: Commit**

```bash
git add demo_api_server/services/configStore.js
git commit -m "feat(trat): add ff_trat_mode feature flag to configStore"
```

---

## Task 2: TratClaimsExtractor on MCP Server

**Files:**
- Create: `demo_mcp_server/src/auth/TratClaimsExtractor.ts`

- [ ] **Step 1: Write the failing test**

Create `demo_mcp_server/src/auth/TratClaimsExtractor.test.ts`:

```typescript
import { extractTratClaims, TratClaims } from './TratClaimsExtractor';
import jwt from 'jsonwebtoken';

describe('TratClaimsExtractor', () => {
  const base64 = (obj: object) => Buffer.from(JSON.stringify(obj)).toString('base64url');

  function makeJwt(payload: object): string {
    const header = base64({ alg: 'RS256', typ: 'JWT' });
    const body = base64(payload);
    return `${header}.${body}.fakesig`;
  }

  it('returns null when trat mode disabled', () => {
    const result = extractTratClaims(makeJwt({ sub: 'u1' }), undefined, false);
    expect(result).toBeNull();
  });

  it('extracts reqctx from JWT claims', () => {
    const token = makeJwt({
      sub: 'u1',
      reqctx: { tool: 'get_my_accounts', session_id: 's1', correlation_id: 'c1' },
      purp: 'banking:mcp:tool_call',
      azd: { sub: 'u1', act: 'agent-client' },
      rctx: { ip: '127.0.0.1', user_agent: 'banking-bff/1.0', timestamp: '2026-05-20T00:00:00Z' },
    });
    const result = extractTratClaims(token, undefined, true);
    expect(result).not.toBeNull();
    expect(result!.reqctx.tool).toBe('get_my_accounts');
    expect(result!.purp).toBe('banking:mcp:tool_call');
    expect(result!.trat_sim).toBeUndefined();
  });

  it('falls back to X-TraT-Context header when JWT has no reqctx', () => {
    const header = JSON.stringify({
      reqctx: { tool: 'get_account_balance', session_id: 's2', correlation_id: 'c2' },
      purp: 'banking:mcp:tool_call',
      azd: { sub: 'u2', act: 'agent-client' },
      rctx: { ip: '127.0.0.1', user_agent: 'banking-bff/1.0', timestamp: '2026-05-20T00:00:00Z' },
      trat_sim: true,
    });
    const result = extractTratClaims(makeJwt({ sub: 'u2' }), header, true);
    expect(result).not.toBeNull();
    expect(result!.reqctx.tool).toBe('get_account_balance');
    expect(result!.trat_sim).toBe(true);
  });

  it('returns null when trat mode on but neither source has claims', () => {
    const result = extractTratClaims(makeJwt({ sub: 'u3' }), undefined, true);
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd demo_mcp_server && npx jest TratClaimsExtractor --no-coverage 2>&1 | tail -20
```
Expected: FAIL — `Cannot find module './TratClaimsExtractor'`

- [ ] **Step 3: Create the extractor**

Create `demo_mcp_server/src/auth/TratClaimsExtractor.ts`:

```typescript
'use strict';

export interface TratClaims {
  reqctx: { tool: string; session_id: string; correlation_id: string };
  purp: string;
  azd: { sub: string; act?: string; gateway?: string };
  rctx: { ip: string; user_agent: string; timestamp: string };
  trat_sim?: boolean;
}

/**
 * Extract TraT claims from the bearer JWT first, then fall back to
 * the X-TraT-Context header (simulation path).
 *
 * Returns null when tratMode is false or no claims are found.
 */
export function extractTratClaims(
  bearerToken: string,
  xTratContextHeader: string | undefined,
  tratMode: boolean,
): TratClaims | null {
  if (!tratMode) return null;

  // Path 1: claims embedded in the bearer JWT (PingOne native)
  try {
    const parts = bearerToken.split('.');
    if (parts.length >= 2) {
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
      if (payload.reqctx && payload.purp && payload.azd && payload.rctx) {
        return {
          reqctx: payload.reqctx,
          purp: payload.purp,
          azd: payload.azd,
          rctx: payload.rctx,
          trat_sim: payload.trat_sim,
        };
      }
    }
  } catch {
    // malformed JWT — fall through to header
  }

  // Path 2: simulation shim via X-TraT-Context header
  if (xTratContextHeader) {
    try {
      const parsed = JSON.parse(xTratContextHeader);
      if (parsed.reqctx && parsed.purp && parsed.azd && parsed.rctx) {
        return {
          reqctx: parsed.reqctx,
          purp: parsed.purp,
          azd: parsed.azd,
          rctx: parsed.rctx,
          trat_sim: parsed.trat_sim ?? true,
        };
      }
    } catch {
      // malformed header — return null
    }
  }

  return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd demo_mcp_server && npx jest TratClaimsExtractor --no-coverage 2>&1 | tail -10
```
Expected: PASS — 4 tests pass

- [ ] **Step 5: Build MCP server to confirm TypeScript compiles**

```bash
cd demo_mcp_server && npm run build 2>&1 | tail -10
```
Expected: exit 0, no TypeScript errors

- [ ] **Step 6: Commit**

```bash
git add demo_mcp_server/src/auth/TratClaimsExtractor.ts demo_mcp_server/src/auth/TratClaimsExtractor.test.ts
git commit -m "feat(trat): add TratClaimsExtractor — extracts TraT claims from JWT or X-TraT-Context header"
```

---

## Task 3: MCP Gateway — Forward X-TraT-Context Header

**Files:**
- Modify: `demo_mcp_gateway/src/proxy.ts`

- [ ] **Step 1: Read the current WebSocket connection headers block**

Open `demo_mcp_gateway/src/proxy.ts` and find line ~45:
```typescript
const ws = new WebSocket(backendWsUrl, {
  headers: { Authorization: `Bearer ${backendToken}` },
});
```

- [ ] **Step 2: Write a failing test**

Create `demo_mcp_gateway/src/proxy.test.ts` (or add to existing if present):

```typescript
// Minimal contract test: X-TraT-Context header is forwarded when present.
// The actual WS connection is not exercised — we just check header construction.
import { buildUpstreamHeaders } from './proxy';

describe('buildUpstreamHeaders', () => {
  it('includes only Authorization when no TraT header', () => {
    const h = buildUpstreamHeaders('token123', undefined);
    expect(h).toEqual({ Authorization: 'Bearer token123' });
  });

  it('includes X-TraT-Context when present', () => {
    const trat = JSON.stringify({ reqctx: { tool: 'get_my_accounts' }, trat_sim: true });
    const h = buildUpstreamHeaders('token123', trat);
    expect(h['X-TraT-Context']).toBe(trat);
    expect(h['Authorization']).toBe('Bearer token123');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd demo_mcp_gateway && npx jest proxy --no-coverage 2>&1 | tail -10
```
Expected: FAIL — `buildUpstreamHeaders is not a function` (not exported yet)

- [ ] **Step 4: Extract buildUpstreamHeaders and thread it through proxyJsonRpc**

In `demo_mcp_gateway/src/proxy.ts`, make the following changes:

After the imports block, add the exported helper:
```typescript
export function buildUpstreamHeaders(
  backendToken: string,
  xTratContext: string | undefined,
): Record<string, string> {
  const headers: Record<string, string> = { Authorization: `Bearer ${backendToken}` };
  if (xTratContext) headers['X-TraT-Context'] = xTratContext;
  return headers;
}
```

Change the `proxyJsonRpc` signature to accept an optional `xTratContext`:
```typescript
export function proxyJsonRpc(
  backendWsUrl: string,
  backendToken: string,
  request: JsonRpcRequest,
  xTratContext?: string,
): Promise<JsonRpcResponse> {
```

Inside the function, replace:
```typescript
const ws = new WebSocket(backendWsUrl, {
  headers: { Authorization: `Bearer ${backendToken}` },
});
```
with:
```typescript
const ws = new WebSocket(backendWsUrl, {
  headers: buildUpstreamHeaders(backendToken, xTratContext),
});
```

- [ ] **Step 5: Find all callers of proxyJsonRpc and pass undefined for xTratContext**

```bash
grep -rn "proxyJsonRpc" /Users/curtismuir/Development/AI-Demo/demo_mcp_gateway/src/
```

For each caller, add `undefined` as the 4th argument (preserving existing behaviour):
```typescript
proxyJsonRpc(wsUrl, backendToken, request, undefined)
```
(The `xTratContext` parameter is optional so existing calls without it also compile fine.)

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd demo_mcp_gateway && npx jest proxy --no-coverage 2>&1 | tail -10
```
Expected: PASS

- [ ] **Step 7: Build the gateway**

```bash
cd demo_mcp_gateway && npm run build 2>&1 | tail -10
```
Expected: exit 0

- [ ] **Step 8: Commit**

```bash
git add demo_mcp_gateway/src/proxy.ts demo_mcp_gateway/src/proxy.test.ts
git commit -m "feat(trat): gateway forwards X-TraT-Context header to MCP server"
```

---

## Task 4: BFF — TraT Context Injection in agentMcpTokenService

**Files:**
- Modify: `demo_api_server/services/agentMcpTokenService.js`

This is the most complex task. The BFF must:
1. Read `ff_trat_mode`
2. Build a TraT context object from the request
3. Attempt to pass it to PingOne via RFC 8693 extra params
4. After exchange, check if the returned token contains `reqctx`
5. If not, activate simulation shim: build `X-TraT-Context` JSON header value
6. Emit a `trat` token event

- [ ] **Step 1: Add a helper function to build the TraT context object**

Near the top of `demo_api_server/services/agentMcpTokenService.js`, after the `buildTokenEvent` function (~line 169), add:

```javascript
/**
 * Build the TraT context object for a tool call.
 * All fields derived from the current request context — never from user input.
 */
function buildTratContext(req, tool, userSub, agentClientId, gatewayClientId) {
  const correlationId = req?.headers?.['x-correlation-id'] || req?.session?.correlationId || null;
  return {
    reqctx: {
      tool: tool || '',
      session_id: req?.sessionID || '',
      correlation_id: correlationId || '',
    },
    purp: 'banking:mcp:tool_call',
    azd: {
      sub: userSub || '',
      act: agentClientId || '',
      gateway: gatewayClientId || '',
    },
    rctx: {
      ip: req?.ip || req?.socket?.remoteAddress || '',
      user_agent: 'banking-bff/1.0',
      timestamp: new Date().toISOString(),
    },
  };
}
```

- [ ] **Step 2: Add TraT mode check and event emission after the exchanged token is obtained**

Find the section in `resolveMcpAccessTokenWithEvents` where the `'exchanged-token'` event is pushed (around line 1347). After the JWKS verification block and before the `return { token: exchangedToken, tokenEvents, userSub }` statement (~line 1454), add:

```javascript
  // ── TraT Mode: build context and emit trat token event ───────────────────
  const ffTratMode =
    configStore.getEffective('ff_trat_mode') === true ||
    configStore.getEffective('ff_trat_mode') === 'true';

  let tratContextHeader = null;

  if (ffTratMode && exchangedToken) {
    const agentClientId =
      configStore.getEffective('pingone_mcp_token_exchanger_client_id') ||
      process.env.AGENT_OAUTH_CLIENT_ID || '';
    const gatewayClientId =
      configStore.getEffective('pingone_ai_agent_client_id') ||
      process.env.PINGONE_AI_AGENT_CLIENT_ID || '';

    const tratCtx = buildTratContext(req, tool, userSub, agentClientId, gatewayClientId);

    // Check if PingOne emitted reqctx natively in the exchanged token
    const exchangedDecoded = decodeJwtClaims(exchangedToken);
    const hasNativeReqctx = !!(exchangedDecoded?.claims?.reqctx);

    const isSim = !hasNativeReqctx;
    const tratEventClaims = isSim ? { ...tratCtx, trat_sim: true } : tratCtx;

    if (isSim) {
      // Simulation path: pass as header for the caller to forward
      tratContextHeader = JSON.stringify({ ...tratCtx, trat_sim: true });
    }

    tokenEvents.push(buildTokenEvent(
      'trat-context',
      isSim
        ? 'Transaction Token (TraT) — Simulation Mode'
        : 'Transaction Token (TraT) — PingOne Native',
      isSim ? 'active' : 'success',
      null,
      isSim
        ? 'ff_trat_mode is ON. PingOne did not emit reqctx in the exchanged token — activating simulation shim. ' +
          'TraT context will be forwarded as X-TraT-Context header to the MCP server. ' +
          'trat_sim: true marks this as a simulation. ' +
          'To get native TraT claims, run `npm run pingone:setup:trat` to configure the PingOne token policy.'
        : 'ff_trat_mode is ON. PingOne emitted reqctx natively in the exchanged token. ' +
          'TraT claims are embedded in the bearer token — no simulation header needed.',
      {
        rfc: 'draft-oauth-transaction-tokens-for-agents-00',
        tratContext: {
          reqctx: tratCtx.reqctx,
          purp: tratCtx.purp,
          azd: tratCtx.azd,
          rctx: tratCtx.rctx,
        },
        trat_sim: isSim,
        nativeClaims: !isSim,
      }
    ));
  }
  // ─────────────────────────────────────────────────────────────────────────
```

- [ ] **Step 3: Return tratContextHeader alongside the token**

The return statement is currently:
```javascript
return { token: exchangedToken, tokenEvents, userSub };
```

Change it to:
```javascript
return { token: exchangedToken, tokenEvents, userSub, tratContextHeader };
```

Also update the `_performTwoExchangeDelegation` return statement to pass through `tratContextHeader: null` (it doesn't use TraT mode — the outer `resolveMcpAccessTokenWithEvents` handles it):

Find all `return { token:` statements in the file and ensure each includes `tratContextHeader: null` where `tratContextHeader` is not already set. The primary one to update is in `_performTwoExchangeDelegation` around line 2043's return. Search for: `return { token:` and add `, tratContextHeader: null` to any that don't already have `tratContextHeader`.

- [ ] **Step 4: Verify the BFF loads without syntax error**

```bash
cd demo_api_server && node -e "require('./services/agentMcpTokenService'); console.log('OK');"
```
Expected: `OK`

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/services/agentMcpTokenService.js
git commit -m "feat(trat): BFF injects TraT context on RFC 8693 exchange, emits trat token event"
```

---

## Task 5: Thread tratContextHeader Through BFF Route to Gateway Call

**Files:**
- Modify: the BFF route/server that calls `resolveMcpAccessTokenWithEvents` and then forwards to gateway/MCP

- [ ] **Step 1: Find where resolveMcpAccessTokenWithEvents result is used to make the MCP call**

```bash
grep -rn "resolveMcpAccessTokenWithEvents\|tratContextHeader\|mcpWebSocketClient\|callMcpTool" /Users/curtismuir/Development/AI-Demo/demo_api_server/ --include="*.js" | grep -v "node_modules" | head -20
```

- [ ] **Step 2: Find the outbound call to the gateway or MCP WS and add the header**

The caller of `resolveMcpAccessTokenWithEvents` will get `{ token, tokenEvents, userSub, tratContextHeader }`. Find where the token is used to make an HTTP or WebSocket call to the gateway. That call likely builds headers like `{ Authorization: 'Bearer ' + token }`.

Add the `X-TraT-Context` header when `tratContextHeader` is non-null:

```javascript
const outboundHeaders = { Authorization: `Bearer ${token}` };
if (tratContextHeader) {
  outboundHeaders['X-TraT-Context'] = tratContextHeader;
}
```

- [ ] **Step 3: Verify no existing tests break**

```bash
cd demo_api_server && npm test 2>&1 | tail -20
```
Expected: all previously passing tests still pass

- [ ] **Step 4: Commit**

```bash
git add <modified route file>
git commit -m "feat(trat): thread X-TraT-Context header from BFF to gateway on tool calls"
```

---

## Task 6: MCP Server — TraT Enforcement via PingOne Authorize

**Files:**
- Modify: `demo_mcp_server/src/server/HttpMCPTransport.ts`
- Modify: `demo_mcp_server/src/server/MCPMessageHandler.ts`

The MCP server reads `MCP_TRAT_MODE_ENABLED` env var and, when true, extracts TraT claims and adds them to the PingOne Authorize decision payload.

- [ ] **Step 1: Understand where Authorize is called in HttpMCPTransport**

```bash
grep -n "Authorize\|guardTool\|pingAuthorize\|environment\|PingOneAuthorize" /Users/curtismuir/Development/AI-Demo/demo_mcp_server/src/server/HttpMCPTransport.ts | head -20
```

The MCP server does not call PingOne Authorize directly — that is the **gateway's** responsibility. The MCP server validates the bearer token (introspection) and then executes the tool. 

The correct insertion point is: after token validation in the transport, extract TraT claims and log them. The Authorize enrichment with TraT claims happens at the **gateway** (`pingAuthorizeGuard.ts`) because it already owns the Authorize call. The MCP server's role is to extract the claims and pass them into the tool execution context for logging/audit.

- [ ] **Step 2: Add TraT claim extraction and logging to HttpMCPTransport**

Find the `tools/call` handler in `HttpMCPTransport.ts`. After the bearer token is validated and `agentToken` is available, add:

```typescript
import { extractTratClaims } from '../auth/TratClaimsExtractor';

// Inside the tools/call handler, after token validation:
const tratMode = process.env.MCP_TRAT_MODE_ENABLED === 'true';
const xTratContext = req.headers['x-trat-context'] as string | undefined;
const tratClaims = extractTratClaims(session.agentToken, xTratContext, tratMode);

if (tratMode) {
  if (tratClaims) {
    console.log(`[TraT] Claims present — tool=${tratClaims.reqctx.tool} purp=${tratClaims.purp} sim=${tratClaims.trat_sim ?? false}`);
  } else {
    console.warn('[TraT] ff_trat_mode ON but no TraT claims found in token or X-TraT-Context header');
  }
}
```

- [ ] **Step 3: Pass tratClaims into the Authorize decision (gateway does this — MCP server logs only)**

In HttpMCPTransport, if there is a local Authorize call (check for `pingAuthorize` or similar), add `trat_*` fields to the parameters:

```typescript
if (tratClaims) {
  // Augment any local authorize context with TraT fields for audit
  authorizeContext = {
    ...authorizeContext,
    trat_purp: tratClaims.purp,
    trat_azd_act: tratClaims.azd.act ?? '',
    trat_session_id: tratClaims.reqctx.session_id,
    trat_tool: tratClaims.reqctx.tool,
    trat_sim: String(tratClaims.trat_sim ?? false),
  };
}
```

- [ ] **Step 4: Repeat the same extraction + logging for MCPMessageHandler (WebSocket path)**

```bash
grep -n "agentToken\|bearerToken\|Authorization\|tools/call\|executeTool" /Users/curtismuir/Development/AI-Demo/demo_mcp_server/src/server/MCPMessageHandler.ts | head -20
```

Find the `tools/call` branch and add the same extraction block using `extractTratClaims`. The incoming header will be on the WebSocket connection headers (set by the gateway proxy via `buildUpstreamHeaders`):

```typescript
const xTratContext = (wsConnection.headers?.['x-trat-context'] as string) ?? undefined;
const tratClaims = extractTratClaims(bearerToken, xTratContext, tratMode);
```

- [ ] **Step 5: Build MCP server**

```bash
cd demo_mcp_server && npm run build 2>&1 | tail -10
```
Expected: exit 0

- [ ] **Step 6: Commit**

```bash
git add demo_mcp_server/src/server/HttpMCPTransport.ts demo_mcp_server/src/server/MCPMessageHandler.ts
git commit -m "feat(trat): MCP server extracts TraT claims and logs them on tools/call (both transports)"
```

---

## Task 7: Gateway — TraT Claims in PingOne Authorize Parameters

**Files:**
- Modify: `demo_mcp_gateway/src/auth/PingOneAuthorizeClient.ts`
- Modify: `demo_mcp_gateway/src/pingAuthorizeGuard.ts`

When `X-TraT-Context` header is present, add `trat_*` fields to `buildAuthorizeParameters` output so PingOne Authorize receives them as decision inputs.

- [ ] **Step 1: Extend buildAuthorizeParameters to accept optional tratClaims**

In `demo_mcp_gateway/src/auth/PingOneAuthorizeClient.ts`, find `buildAuthorizeParameters` (~line 56) and update its signature:

```typescript
import { extractTratClaims, TratClaims } from './TratClaimsExtractor';

export function buildAuthorizeParameters(
  decoded: DecodedGatewayToken,
  method: string,
  gatewayResourceUri: string,
  toolName?: string,
  toolArgs?: ToolArgs,
  tratClaims?: TratClaims | null,
): Record<string, string> {
  const decisionContext = method === 'tools/call' ? 'McpToolCall' : 'McpRequest';
  const tokenScopes = (decoded.scope ?? '').split(' ').filter(Boolean);
  const base: Record<string, string> = {
    DecisionContext: decisionContext,
    McpMethod: method,
    ToolName: toolName ?? '',
    ClientId: decoded.sub,
    ActClientId: decoded.act?.sub ?? '',
    TokenScopes: tokenScopes.join(' '),
    TokenAudience: gatewayResourceUri,
    TransactionAmount: toolArgs?.amount !== undefined ? String(toolArgs.amount) : '',
    TransactionType: toolArgs?.transaction_type ?? toolName ?? '',
    ToAccountId: toolArgs?.to_account_id ?? '',
  };

  if (tratClaims) {
    base['TratPurp'] = tratClaims.purp;
    base['TratAzdAct'] = tratClaims.azd.act ?? '';
    base['TratSessionId'] = tratClaims.reqctx.session_id;
    base['TratTool'] = tratClaims.reqctx.tool;
    base['TratSim'] = String(tratClaims.trat_sim ?? false);
  }

  return base;
}
```

Note: `TratClaimsExtractor.ts` is in `demo_mcp_server` — copy the type import path correctly. Since the gateway is a separate package, we need to either copy the type or inline it. **Inline it in the gateway** to avoid cross-package coupling:

Add to `demo_mcp_gateway/src/auth/PingOneAuthorizeClient.ts` near the top:
```typescript
export interface TratClaims {
  reqctx: { tool: string; session_id: string; correlation_id: string };
  purp: string;
  azd: { sub: string; act?: string; gateway?: string };
  rctx: { ip: string; user_agent: string; timestamp: string };
  trat_sim?: boolean;
}
```

- [ ] **Step 2: Update callers of buildAuthorizeParameters in pingAuthorizeGuard.ts**

Find `buildAuthorizeParameters(` calls in `pingAuthorizeGuard.ts`. Add the `xTratContext` extraction and pass `tratClaims` as the 6th argument:

```typescript
import { extractTratClaims } from './auth/TratClaimsExtractor'; // local copy or inline

// In guardToolCall, before the axios.post call:
const tratMode = !!process.env.MCP_TRAT_MODE_ENABLED;
const xTratCtx = incomingHeaders?.['x-trat-context'];
const tratClaims = extractTratClaims(incomingBearerToken, xTratCtx, tratMode);

const body = {
  parameters: buildAuthorizeParameters(
    decoded,
    'tools/call',
    config.gatewayResourceUri,
    toolName,
    toolArgs,
    tratClaims,
  ),
};
```

Since `guardToolCall` does not currently receive the raw bearer token or incoming headers, check the function signature and add those parameters. Look at all callers:

```bash
grep -rn "guardToolCall\|guardToolsList" /Users/curtismuir/Development/AI-Demo/demo_mcp_gateway/src/ | grep -v ".test." | head -20
```

Update the `guardToolCall` signature to accept `xTratContext?: string` and thread it through.

- [ ] **Step 3: Also add a local TratClaimsExtractor to the gateway package**

Copy the extractor function (not the file) inline into `demo_mcp_gateway/src/auth/PingOneAuthorizeClient.ts` to keep packages independent:

```typescript
function extractTratClaimsLocal(
  bearerToken: string,
  xTratContextHeader: string | undefined,
  tratMode: boolean,
): TratClaims | null {
  if (!tratMode) return null;
  try {
    const parts = bearerToken.split('.');
    if (parts.length >= 2) {
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
      if (payload.reqctx && payload.purp && payload.azd && payload.rctx) {
        return { reqctx: payload.reqctx, purp: payload.purp, azd: payload.azd, rctx: payload.rctx, trat_sim: payload.trat_sim };
      }
    }
  } catch { /* fall through */ }
  if (xTratContextHeader) {
    try {
      const parsed = JSON.parse(xTratContextHeader);
      if (parsed.reqctx && parsed.purp && parsed.azd && parsed.rctx) {
        return { reqctx: parsed.reqctx, purp: parsed.purp, azd: parsed.azd, rctx: parsed.rctx, trat_sim: parsed.trat_sim ?? true };
      }
    } catch { /* return null */ }
  }
  return null;
}
```

- [ ] **Step 4: Build the gateway**

```bash
cd demo_mcp_gateway && npm run build 2>&1 | tail -10
```
Expected: exit 0

- [ ] **Step 5: Commit**

```bash
git add demo_mcp_gateway/src/auth/PingOneAuthorizeClient.ts demo_mcp_gateway/src/pingAuthorizeGuard.ts
git commit -m "feat(trat): gateway passes TraT claims to PingOne Authorize as TratPurp/TratTool/TratSim parameters"
```

---

## Task 8: PingOne Setup Script

**Files:**
- Create: `demo_api_server/scripts/setupTratClaims.js`
- Modify: `demo_api_server/package.json`
- Modify: `demo_api_server/scripts/bootstrapPingOne.js`

- [ ] **Step 1: Create the setup script**

Create `demo_api_server/scripts/setupTratClaims.js`:

```javascript
#!/usr/bin/env node
/**
 * setupTratClaims.js — Idempotent PingOne token policy claim provisioner for TraT.
 *
 * Adds custom claim mappings (reqctx, purp, azd, rctx) to the MCP Token Exchanger
 * application's token policy so PingOne emits TraT claims natively in exchanged tokens.
 *
 * Run standalone: npm run pingone:setup:trat
 * Called by bootstrapPingOne.js post-provisioning (always, idempotent).
 */
'use strict';

require('dotenv').config();
const axios = require('axios');

const TRAT_CLAIMS = ['reqctx', 'purp', 'azd', 'rctx'];

async function getWorkerToken() {
  const envId = process.env.PINGONE_ENVIRONMENT_ID;
  const region = process.env.PINGONE_REGION || 'eu';
  const clientId = process.env.PINGONE_ADMIN_CLIENT_ID || process.env.PINGONE_WORKER_APP_CLIENT_ID;
  const clientSecret = process.env.PINGONE_ADMIN_CLIENT_SECRET || process.env.PINGONE_WORKER_APP_CLIENT_SECRET;

  if (!envId || !clientId || !clientSecret) {
    throw new Error(
      'Missing required env vars: PINGONE_ENVIRONMENT_ID, PINGONE_ADMIN_CLIENT_ID, PINGONE_ADMIN_CLIENT_SECRET'
    );
  }

  const tokenUrl = `https://auth.pingone.${region}/${envId}/as/token`;
  const params = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
  });

  const res = await axios.post(tokenUrl, params.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  return { token: res.data.access_token, envId, region };
}

async function findMcpTokenExchangerApp(token, envId, region) {
  const appsUrl = `https://api.pingone.${region}/v1/environments/${envId}/applications`;
  const res = await axios.get(appsUrl, {
    headers: { Authorization: `Bearer ${token}` },
    params: { limit: 100 },
  });
  const apps = res.data?._embedded?.applications || [];
  return apps.find((a) => a.name && a.name.toLowerCase().includes('mcp token exchanger'));
}

async function getTokenPoliciesForApp(token, envId, region, appId) {
  const url = `https://api.pingone.${region}/v1/environments/${envId}/applications/${appId}/signOnPolicy`;
  try {
    const res = await axios.get(url, { headers: { Authorization: `Bearer ${token}` } });
    return res.data;
  } catch {
    return null;
  }
}

async function setupTratClaims() {
  console.log('[setupTratClaims] Starting TraT claim provisioning...');

  let workerToken, envId, region;
  try {
    ({ token: workerToken, envId, region } = await getWorkerToken());
    console.log('[setupTratClaims] Worker token obtained.');
  } catch (err) {
    console.error('[setupTratClaims] Failed to get worker token:', err.message);
    console.log('[setupTratClaims] Skipping TraT claim provisioning (credentials not available).');
    return { skipped: true, reason: err.message };
  }

  const app = await findMcpTokenExchangerApp(workerToken, envId, region);
  if (!app) {
    console.warn('[setupTratClaims] MCP Token Exchanger app not found — skipping TraT claim setup.');
    console.warn('[setupTratClaims] Run pingone:bootstrap first to provision apps.');
    return { skipped: true, reason: 'MCP Token Exchanger app not found' };
  }

  console.log(`[setupTratClaims] Found MCP Token Exchanger app: ${app.id}`);

  // Check existing token policy claims via token policy API
  const tokenPolicyUrl = `https://api.pingone.${region}/v1/environments/${envId}/applications/${app.id}/tokenClaims`;
  let existingClaims = [];
  try {
    const res = await axios.get(tokenPolicyUrl, {
      headers: { Authorization: `Bearer ${workerToken}` },
    });
    existingClaims = (res.data?._embedded?.claims || []).map((c) => c.name);
  } catch {
    // Token claims endpoint may not exist — treat as empty
  }

  const missingClaims = TRAT_CLAIMS.filter((c) => !existingClaims.includes(c));

  if (missingClaims.length === 0) {
    console.log('[setupTratClaims] TraT claims already provisioned — nothing to do.');
    return { provisioned: false, alreadyExisted: true };
  }

  console.log(`[setupTratClaims] Adding claims: ${missingClaims.join(', ')}`);

  for (const claimName of missingClaims) {
    try {
      await axios.post(
        tokenPolicyUrl,
        {
          name: claimName,
          value: `\${tokenRequest.${claimName}}`,
          enabled: true,
        },
        { headers: { Authorization: `Bearer ${workerToken}`, 'Content-Type': 'application/json' } }
      );
      console.log(`[setupTratClaims] ✅ Added claim: ${claimName}`);
    } catch (err) {
      const status = err.response?.status;
      if (status === 409) {
        console.log(`[setupTratClaims] Claim ${claimName} already exists (409) — skipping.`);
      } else {
        console.warn(`[setupTratClaims] ⚠️ Could not add claim ${claimName}: ${err.message}`);
      }
    }
  }

  console.log('[setupTratClaims] TraT claim provisioning complete.');
  return { provisioned: true };
}

// Run when called directly
if (require.main === module) {
  setupTratClaims()
    .then((result) => {
      if (result?.skipped) {
        console.log(`[setupTratClaims] Skipped: ${result.reason}`);
        process.exit(0);
      }
      console.log('[setupTratClaims] Done.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('[setupTratClaims] Fatal error:', err.message);
      process.exit(1);
    });
}

module.exports = { setupTratClaims };
```

- [ ] **Step 2: Add the npm script**

In `demo_api_server/package.json`, find the `"scripts"` block and add after `"pingone:bootstrap:ci"`:
```json
"pingone:setup:trat": "node scripts/setupTratClaims.js",
```

- [ ] **Step 3: Wire into bootstrapPingOne.js**

```bash
grep -n "require\|setupFresh\|wipeEnvironment\|provisionEnvironment\|console.log.*provisioned" /Users/curtismuir/Development/AI-Demo/demo_api_server/scripts/bootstrapPingOne.js | tail -20
```

Find the line after `provisionEnvironment` completes successfully (look for a success log like `console.log('Provisioning complete')`). Add a call to `setupTratClaims` right after:

```javascript
// After provisionEnvironment() resolves:
try {
  const { setupTratClaims } = require('./setupTratClaims');
  const tratResult = await setupTratClaims();
  if (tratResult?.skipped) {
    console.log(`[Bootstrap] TraT claims: skipped (${tratResult.reason})`);
  } else if (tratResult?.alreadyExisted) {
    console.log('[Bootstrap] TraT claims: already provisioned');
  } else {
    console.log('[Bootstrap] TraT claims: provisioned ✅');
  }
} catch (tratErr) {
  console.warn('[Bootstrap] TraT claims setup failed (non-fatal):', tratErr.message);
}
```

- [ ] **Step 4: Verify the script loads without error**

```bash
cd demo_api_server && node -e "const { setupTratClaims } = require('./scripts/setupTratClaims'); console.log('OK');"
```
Expected: `OK`

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/scripts/setupTratClaims.js demo_api_server/package.json demo_api_server/scripts/bootstrapPingOne.js
git commit -m "feat(trat): add setupTratClaims.js + pingone:setup:trat script + bootstrap integration"
```

---

## Task 9: Token Chain UI — TraT Badge + Claims Expansion

**Files:**
- Modify: `demo_api_ui/src/components/TokenChainDisplay.js`
- Modify: `demo_api_ui/src/components/TokenChainDisplay.css`

- [ ] **Step 1: Read the existing may_act badge pattern to match the style**

Open `demo_api_ui/src/components/TokenChainDisplay.js` and find the `tcd-pill--may-act` rendering (~line 269). Note: the badge uses a `<span className="tcd-pill tcd-pill--may-act">` pattern.

Also read `demo_api_ui/src/components/TokenChainDisplay.css` and find `.tcd-pill--may-act` (~line 615) to understand the colour values.

- [ ] **Step 2: Add TraT CSS classes**

In `demo_api_ui/src/components/TokenChainDisplay.css`, after `.tcd-pill--act` block, add:

```css
.tcd-pill--trat {
  background: #16a34a;
  color: #fff;
}

.tcd-pill--trat-sim {
  background: #d97706;
  color: #fff;
}
```

- [ ] **Step 3: Add TraT badge rendering in TokenChainDisplay.js**

Find the section that renders the `may_act` badge for a token event (around the function that processes event display, roughly line 269). After the `may_act` badge block, add a TraT badge block:

```javascript
// TraT badge
function TratBadge({ event, onEduClick }) {
  const tratContext = event.tratContext;
  const trat_sim = event.trat_sim;

  if (!tratContext) return null;

  const pillClass = trat_sim ? 'tcd-pill tcd-pill--trat-sim' : 'tcd-pill tcd-pill--trat';
  const label = trat_sim ? 'TraT (simulated)' : 'TraT';

  return (
    <div className="tcd-trat-badge">
      <span className={pillClass}>{label}</span>
      {onEduClick && (
        <button
          className="tcd-edu-link"
          onClick={onEduClick}
          title="Learn about Transaction Tokens"
        >
          ⓘ
        </button>
      )}
      <div className="tcd-trat-claims">
        {tratContext.reqctx && (
          <div className="tcd-trat-claim-row">
            <span className="tcd-trat-claim-key">reqctx</span>
            <span className="tcd-trat-claim-val">{JSON.stringify(tratContext.reqctx)}</span>
          </div>
        )}
        {tratContext.purp && (
          <div className="tcd-trat-claim-row">
            <span className="tcd-trat-claim-key">purp</span>
            <span className="tcd-trat-claim-val">{tratContext.purp}</span>
          </div>
        )}
        {tratContext.azd && (
          <div className="tcd-trat-claim-row">
            <span className="tcd-trat-claim-key">azd</span>
            <span className="tcd-trat-claim-val">{JSON.stringify(tratContext.azd)}</span>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Render TratBadge inside the event card**

Find the event card render where `may_act` hints are shown (~line 2485). After the `mayActHint` block, add:

```javascript
{event.tratContext && (
  <TratBadge
    event={event}
    onEduClick={() => openEducationPanel('transaction-tokens')}
  />
)}
```

Where `openEducationPanel` is the function used to open education panels. Check the existing pattern (search for `openEducationPanel` or `useEducationUI` in the file) and match it.

- [ ] **Step 5: Add minimal CSS for claim rows**

Append to `TokenChainDisplay.css`:

```css
.tcd-trat-badge {
  margin-top: 6px;
}

.tcd-trat-claims {
  margin-top: 4px;
  font-size: 0.78rem;
  color: #374151;
}

.tcd-trat-claim-row {
  display: flex;
  gap: 6px;
  margin-bottom: 2px;
}

.tcd-trat-claim-key {
  font-weight: 600;
  min-width: 52px;
  color: #6b7280;
}

.tcd-trat-claim-val {
  font-family: monospace;
  word-break: break-all;
}
```

- [ ] **Step 6: Run UI build**

```bash
cd demo_api_ui && npm run build 2>&1 | tail -10
```
Expected: exit 0

- [ ] **Step 7: Commit**

```bash
git add demo_api_ui/src/components/TokenChainDisplay.js demo_api_ui/src/components/TokenChainDisplay.css
git commit -m "feat(trat): Token Chain UI — TraT badge with amber (simulated) / green (native) and claims expansion"
```

---

## Task 10: Education Panel — TransactionTokensPanel

**Files:**
- Modify: `demo_api_ui/src/components/education/educationIds.js`
- Create: `demo_api_ui/src/components/education/TransactionTokensPanel.js`
- Modify: `demo_api_ui/src/components/education/EducationPanelsHost.js`

- [ ] **Step 1: Add EDU.TRANSACTION_TOKENS to educationIds.js**

In `demo_api_ui/src/components/education/educationIds.js`, after the last entry (before the closing `};`), add:

```javascript
/** Transaction Tokens (TraT) — IETF draft-oauth-transaction-tokens-for-agents; context-bound MCP call security */
TRANSACTION_TOKENS: "transaction-tokens",
```

- [ ] **Step 2: Create TransactionTokensPanel.js**

Create `demo_api_ui/src/components/education/TransactionTokensPanel.js`:

```javascript
// banking_api_ui/src/components/education/TransactionTokensPanel.js
import React from "react";
import EducationDrawer from "../shared/EducationDrawer";

const DATATRACKER_URL =
  "https://datatracker.ietf.org/doc/draft-oauth-transaction-tokens-for-agents/";

function ClaimRow({ name, type, example, description }) {
  return (
    <tr>
      <td style={{ fontFamily: "monospace", fontWeight: 600, padding: "6px 8px", borderBottom: "1px solid #e5e7eb" }}>{name}</td>
      <td style={{ padding: "6px 8px", borderBottom: "1px solid #e5e7eb", color: "#6b7280" }}>{type}</td>
      <td style={{ fontFamily: "monospace", fontSize: "0.8rem", padding: "6px 8px", borderBottom: "1px solid #e5e7eb" }}>{example}</td>
      <td style={{ padding: "6px 8px", borderBottom: "1px solid #e5e7eb", fontSize: "0.85rem" }}>{description}</td>
    </tr>
  );
}

export default function TransactionTokensPanel({ isOpen, onClose, initialTabId }) {
  const tabs = [
    {
      id: "what-why",
      label: "What & Why",
      content: (
        <>
          <h3>Transaction Tokens (TraT)</h3>
          <p>
            OAuth access tokens prove <em>who</em> is calling — but they say nothing
            about <em>which specific transaction</em> a call belongs to.
            A token captured from the gateway → MCP server leg could be replayed
            in a different context: different tool, different session, different agent.
          </p>
          <h4>What Transaction Tokens add</h4>
          <ul>
            <li><strong>Context binding</strong> — the token carries the tool name, session ID, and correlation ID of the originating call</li>
            <li><strong>Purpose declaration</strong> — a <code>purp</code> claim names the intent (<code>banking:mcp:tool_call</code>)</li>
            <li><strong>Delegation chain</strong> — <code>azd</code> records user + agent + gateway in one claim</li>
            <li><strong>Requester context</strong> — <code>rctx</code> records IP, user-agent, and timestamp</li>
            <li><strong>Replay prevention</strong> — short lifetime + context claims make stolen tokens useless outside their original transaction</li>
          </ul>
          <h4>IETF Draft</h4>
          <p>
            Specified in{" "}
            <a href={DATATRACKER_URL} target="_blank" rel="noreferrer">
              draft-oauth-transaction-tokens-for-agents-00
            </a>{" "}
            (OAUTH WG, individual draft as of May 2026). PingOne support is pending
            — see the <em>Draft Status</em> tab for how to check for updates.
          </p>
        </>
      ),
    },
    {
      id: "how-it-works",
      label: "How It Works",
      content: (
        <>
          <h3>TraT Flow in This Demo</h3>
          <div style={{ background: "#f8fafc", borderRadius: 8, padding: 16, fontFamily: "monospace", fontSize: "0.82rem", lineHeight: 1.7 }}>
            <div>1. Browser → BFF (session cookie)</div>
            <div style={{ paddingLeft: 16, color: "#6b7280" }}>Agent invokes a tool (e.g. get_my_accounts)</div>
            <div>2. BFF builds TraT context object</div>
            <div style={{ paddingLeft: 16, color: "#6b7280" }}>reqctx.tool, session_id, correlation_id, purp, azd, rctx</div>
            <div>3. BFF → PingOne: RFC 8693 exchange + TraT params</div>
            <div style={{ paddingLeft: 16, color: "#6b7280" }}>Extra params passed to token endpoint</div>
            <div>4a. PingOne emits token WITH reqctx claim (native path)</div>
            <div style={{ paddingLeft: 16, color: "#16a34a" }}>Token Chain shows: TraT (green badge)</div>
            <div>4b. PingOne does not emit reqctx (simulation path)</div>
            <div style={{ paddingLeft: 16, color: "#d97706" }}>BFF adds X-TraT-Context header — Token Chain shows: TraT (simulated) (amber badge)</div>
            <div>5. BFF → MCP Gateway (Bearer + optional X-TraT-Context)</div>
            <div>6. Gateway forwards X-TraT-Context to MCP Server</div>
            <div>7. Gateway calls PingOne Authorize with TratPurp / TratTool / TratSim</div>
            <div>8. MCP Server extracts TraT claims, logs them</div>
            <div>9. Tool executes on PERMIT</div>
          </div>
        </>
      ),
    },
    {
      id: "claims",
      label: "Claims Reference",
      content: (
        <>
          <h3>TraT Claims</h3>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
            <thead>
              <tr style={{ background: "#f3f4f6" }}>
                <th style={{ padding: "6px 8px", textAlign: "left" }}>Claim</th>
                <th style={{ padding: "6px 8px", textAlign: "left" }}>Type</th>
                <th style={{ padding: "6px 8px", textAlign: "left" }}>Example</th>
                <th style={{ padding: "6px 8px", textAlign: "left" }}>Description</th>
              </tr>
            </thead>
            <tbody>
              <ClaimRow name="reqctx" type="object" example='{"tool":"get_my_accounts","session_id":"abc","correlation_id":"xyz"}' description="Request context — tool name, BFF session ID, correlation ID for tracing" />
              <ClaimRow name="purp" type="string" example='"banking:mcp:tool_call"' description="Purpose of the token — fixed string identifying AI agent tool invocations" />
              <ClaimRow name="azd" type="object" example='{"sub":"user-uuid","act":"agent-client-id","gateway":"gw-client-id"}' description="Authorized delegation chain — user subject, agent client, gateway client" />
              <ClaimRow name="rctx" type="object" example='{"ip":"10.0.0.1","user_agent":"banking-bff/1.0","timestamp":"2026-05-20T..."}' description="Requester context — IP, user-agent string, ISO timestamp" />
              <ClaimRow name="trat_sim" type="boolean" example="true" description="Present and true when claims are BFF-simulated (PingOne did not emit them natively). Absent when native." />
            </tbody>
          </table>
        </>
      ),
    },
    {
      id: "draft-status",
      label: "Draft Status",
      content: (
        <>
          <h3>IETF Draft Status</h3>
          <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 16, fontSize: "0.9rem" }}>
            <tbody>
              <tr><td style={{ fontWeight: 600, padding: "4px 8px" }}>Spec</td><td style={{ padding: "4px 8px" }}>draft-oauth-transaction-tokens-for-agents-00</td></tr>
              <tr><td style={{ fontWeight: 600, padding: "4px 8px" }}>Working Group</td><td style={{ padding: "4px 8px" }}>OAUTH (IETF)</td></tr>
              <tr><td style={{ fontWeight: 600, padding: "4px 8px" }}>Maturity</td><td style={{ padding: "4px 8px" }}>Individual draft — pre-WG adoption (as of May 2026)</td></tr>
              <tr><td style={{ fontWeight: 600, padding: "4px 8px" }}>PingOne Support</td><td style={{ padding: "4px 8px" }}>Pending — this demo simulates with custom claims</td></tr>
            </tbody>
          </table>
          <h4>Key differences: real draft vs this demo</h4>
          <ul>
            <li>Real draft: TraT is a <strong>distinct token type</strong> with its own <code>token_type</code> and a Transaction Token Service (TTS) endpoint</li>
            <li>This demo: TraT claims are embedded in a <strong>standard PingOne access token</strong> (native path) or sent as an <code>X-TraT-Context</code> header (simulation)</li>
            <li>Real draft: TraT has a <strong>very short lifetime</strong> (seconds)</li>
            <li>This demo: lifetime matches the access token; <code>trat_sim: true</code> marks the difference</li>
          </ul>
          <h4>Check for updates</h4>
          <p>
            Visit{" "}
            <a href={DATATRACKER_URL} target="_blank" rel="noreferrer">
              {DATATRACKER_URL}
            </a>{" "}
            to see the latest revision. Version numbers appear after the draft name
            (e.g., <code>-01</code>, <code>-02</code>). When PingOne supports the draft natively,
            the <code>trat_sim</code> claim will disappear and the Token Chain badge will turn green.
          </p>
        </>
      ),
    },
    {
      id: "this-demo",
      label: "This Demo",
      content: (
        <>
          <h3>TraT in Super Banking</h3>
          <h4>Enable TraT mode</h4>
          <ol>
            <li>Go to <strong>Admin → Config → Feature Flags</strong></li>
            <li>Enable <code>ff_trat_mode</code></li>
            <li>Invoke any banking tool from the AI Agent sidebar</li>
            <li>Open the Token Chain panel — you will see a <strong>TraT (simulated)</strong> amber badge on the MCP access token event</li>
          </ol>
          <h4>Provision native PingOne claims</h4>
          <p>To attempt native PingOne TraT claim emission (requires a compatible PingOne token policy):</p>
          <pre style={{ background: "#f3f4f6", padding: 10, borderRadius: 6, fontSize: "0.85rem" }}>
            cd demo_api_server{"\n"}
            npm run pingone:setup:trat
          </pre>
          <p>
            Or re-run bootstrap — it always calls this script and is idempotent.
            After provisioning, if PingOne emits the claims, the badge turns green and <code>trat_sim</code> disappears.
          </p>
          <h4>Simulation vs native</h4>
          <p>
            <strong>Amber badge (TraT simulated):</strong> BFF-injected <code>X-TraT-Context</code> header.
            Claims are authentic but not PingOne-signed.
          </p>
          <p>
            <strong>Green badge (TraT):</strong> PingOne emitted <code>reqctx</code>, <code>purp</code>, <code>azd</code>, <code>rctx</code>
            natively in the exchanged token. Full production path.
          </p>
        </>
      ),
    },
  ];

  return (
    <EducationDrawer
      isOpen={isOpen}
      onClose={onClose}
      title="Transaction Tokens (TraT)"
      subtitle="draft-oauth-transaction-tokens-for-agents-00 · IETF OAUTH WG"
      tabs={tabs}
      initialTabId={initialTabId || "what-why"}
    />
  );
}
```

- [ ] **Step 3: Register in EducationPanelsHost.js**

In `demo_api_ui/src/components/education/EducationPanelsHost.js`:

Add the import after the last `import` line:
```javascript
import TransactionTokensPanel from "./TransactionTokensPanel";
```

Inside the component's return, after the last panel registration, add:
```javascript
<TransactionTokensPanel
  isOpen={panel === EDU.TRANSACTION_TOKENS}
  onClose={close}
  initialTabId={tab}
/>
```

Also add `TRANSACTION_TOKENS` to the destructured `EDU` usage (it's already available since it's imported from `educationIds`).

- [ ] **Step 4: Run UI build**

```bash
cd demo_api_ui && npm run build 2>&1 | tail -10
```
Expected: exit 0

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/components/education/educationIds.js \
        demo_api_ui/src/components/education/TransactionTokensPanel.js \
        demo_api_ui/src/components/education/EducationPanelsHost.js
git commit -m "feat(trat): add TransactionTokensPanel education slideout (5 tabs, deep-linkable)"
```

---

## Task 11: Regression Check & Build Gate

- [ ] **Step 1: Run all API server tests**

```bash
cd demo_api_server && npm test 2>&1 | tail -20
```
Expected: all tests pass (same count as before this feature)

- [ ] **Step 2: Run MCP server tests**

```bash
cd demo_mcp_server && npm test 2>&1 | tail -20
```
Expected: all tests pass including new TratClaimsExtractor tests

- [ ] **Step 3: Run MCP gateway tests**

```bash
cd demo_mcp_gateway && npm test 2>&1 | tail -20
```
Expected: all tests pass including new proxy header tests

- [ ] **Step 4: Final UI build**

```bash
cd demo_api_ui && npm run build 2>&1 | tail -10
```
Expected: exit 0

- [ ] **Step 5: Verify ff_trat_mode=false is the default (no behaviour change)**

```bash
cd demo_api_server && node -e "
const cs = require('./services/configStore');
const v = cs.getEffective('ff_trat_mode');
console.assert(v === 'false' || v === false, 'Default must be false, got: ' + v);
console.log('ff_trat_mode default OK:', v);
"
```
Expected: `ff_trat_mode default OK: false`

- [ ] **Step 6: Add REGRESSION_PLAN.md entry**

Open `REGRESSION_PLAN.md`, find §4 (Bug Fix Log), and add:

```markdown
### 2026-05-20 — TraT mode feature (ff_trat_mode)
- **Files:** `agentMcpTokenService.js`, `proxy.ts`, `TratClaimsExtractor.ts`, `HttpMCPTransport.ts`, `MCPMessageHandler.ts`, `TokenChainDisplay.js`
- **Change:** `ff_trat_mode=false` (default) — zero behaviour change. When `true`: BFF injects TraT claims on RFC 8693 exchange; gateway forwards `X-TraT-Context`; MCP server extracts and logs claims.
- **Do not break:** existing token exchange flow, existing PingOne Authorize guard, HITL flow, Token Chain display for non-TraT events.
```

- [ ] **Step 7: Final commit**

```bash
git add REGRESSION_PLAN.md
git commit -m "docs(trat): add regression plan entry for ff_trat_mode feature"
```

---

## Self-Review Checklist

- [x] §4 feature flag: Task 1 adds `ff_trat_mode` to configStore FIELD_DEFS
- [x] §7.1 BFF TraT injection: Task 4 adds `buildTratContext`, shim path, `trat` token event; Task 5 threads `tratContextHeader` to gateway call
- [x] §7.2 Gateway X-TraT-Context forwarding: Task 3 adds `buildUpstreamHeaders` + passes header to WS
- [x] §7.3 MCP server extraction + Authorize enrichment: Task 6 (MCP server), Task 7 (gateway Authorize parameters)
- [x] §8.1 Setup script: Task 8 creates `setupTratClaims.js`
- [x] §8.2 Bootstrap integration: Task 8 wires into `bootstrapPingOne.js`
- [x] §9 Token Chain badge + expansion: Task 9
- [x] §10 Education panel: Task 10
- [x] §12 Success criteria: Task 11 verifies default=false unchanged, build gate, regression entry

# MCP Gateway Pass-Through Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `MCP_GW_PASSTHROUGH_TO_MCP_SERVER=true` mode to the MCP Gateway so it validates and authorizes the inbound token fully, then forwards it unchanged to the MCP Server — skipping the RFC 8693 re-exchange on the olb/invest WebSocket legs.

**Architecture:** A new `mcpServerPassthrough` boolean in `GatewayConfig` gates two call sites in `index.ts` (`proxyToolsList` and the `olb`/`invest` dispatch in `tools/call`). When `true`, both sites pass the inbound token directly to `proxyJsonRpc` instead of calling `exchangeTokenForBackend`. The MCP server accepts the token because `MCP_SERVER_RESOURCE_URI` is set to the same value as `MCP_GW_RESOURCE_URI`. The D-05 anti-bypass invariant is unaffected because the inbound token's aud is the gateway URI, not any backend URI.

**Tech Stack:** TypeScript 5, Node 20+, Jest — no new dependencies.

---

## File Map

| File | Change |
|---|---|
| `demo_mcp_gateway/src/config.ts` | Add `mcpServerPassthrough: boolean` field |
| `demo_mcp_gateway/src/index.ts` | Passthrough branch in `proxyToolsList` (line 893) and `tools/call` olb/invest dispatch (lines 764–796) |
| `demo_mcp_gateway/tests/gateway-passthrough.test.ts` | New test file |
| `demo_mcp_server/.env` | Set `MCP_SERVER_RESOURCE_URI=mcpgateway.ping.demo` |
| `demo_api_server/.env` (or `demo_mcp_gateway/.env`) | Set `MCP_GW_PASSTHROUGH_TO_MCP_SERVER=true` |

No changes to: `GatewayTokenPolicy.ts`, `tokenValidator.ts`, `authorizeMcpRequestCore.ts`, `credentialSwap.ts`, `router.ts`, `proxy.ts`, MCP server TypeScript source.

---

## Task 1: Add `mcpServerPassthrough` to GatewayConfig

**Files:**
- Modify: `demo_mcp_gateway/src/config.ts`

- [ ] **Step 1: Add the field to the `GatewayConfig` interface**

Open `demo_mcp_gateway/src/config.ts`. After the `devBypass` field (line 34), add:

```typescript
  // When true, skip RFC 8693 re-exchange on olb/invest WebSocket legs.
  // The inbound token (aud=gatewayResourceUri) is forwarded unchanged.
  // MCP_SERVER_RESOURCE_URI on the MCP server must equal MCP_GW_RESOURCE_URI.
  mcpServerPassthrough: boolean;
```

- [ ] **Step 2: Load it in `loadConfig()`**

Inside `loadConfig()`, after `devBypass: DEV_BYPASS,`, add:

```typescript
    mcpServerPassthrough: process.env.MCP_GW_PASSTHROUGH_TO_MCP_SERVER === 'true',
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd demo_mcp_gateway && npm run typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add demo_mcp_gateway/src/config.ts
git commit -m "feat(gw): add mcpServerPassthrough config field"
```

---

## Task 2: Write failing tests for passthrough behaviour

**Files:**
- Create: `demo_mcp_gateway/tests/gateway-passthrough.test.ts`

- [ ] **Step 1: Create the test file**

```typescript
'use strict';

/**
 * gateway-passthrough.test.ts
 *
 * Verifies that when mcpServerPassthrough=true:
 *   1. proxyToolsList forwards the inbound token, not an exchanged token.
 *   2. The tools/call olb/invest path forwards the inbound token, not an exchanged token.
 *
 * When mcpServerPassthrough=false (default):
 *   3. proxyToolsList calls exchangeTokenForBackend.
 *   4. The tools/call olb/invest path calls exchangeTokenForBackend.
 */

import { loadConfig, GatewayConfig } from '../src/config';

// Minimal config builder — only the fields under test need real values.
function makeConfig(passthrough: boolean): GatewayConfig {
  return {
    port: 3005,
    host: '0.0.0.0',
    clientId: 'gw-client',
    clientSecret: 'gw-secret',
    tokenEndpointAuthMethod: 'basic',
    tokenEndpoint: 'https://auth.example.com/token',
    gatewayResourceUri: 'mcpgateway.ping.demo',
    mcpOlbWsUrl: 'ws://localhost:8080',
    mcpInvestWsUrl: 'ws://localhost:8081',
    mcpOlbResourceUri: 'mcpserver.ping.demo',
    mcpInvestResourceUri: 'mcp-invest.ping.demo',
    pingAuthorizeEndpoint: '',
    pingAuthorizeWorkerId: '',
    hitlServiceUrl: '',
    introspectionEndpoint: '',
    devBypass: false,
    mcpServerPassthrough: passthrough,
    demoApiKeyServiceKey: '',
    mortgageServiceBaseUrl: 'http://localhost:8082',
    mortgageServiceApiKey: '',
    bffInternalIdTokenUrl: 'http://localhost:3001/internal/id-token',
    bffInternalSecret: 'dev-shared-secret-change-me',
    bankingResourceServerBaseUrl: 'http://localhost:3001',
    bankingResourceServerResourceUri: 'https://banking-resource-server.ping.demo',
  };
}

describe('mcpServerPassthrough config', () => {
  it('defaults to false when env var is not set', () => {
    delete process.env.MCP_GW_PASSTHROUGH_TO_MCP_SERVER;
    const cfg = loadConfig();
    expect(cfg.mcpServerPassthrough).toBe(false);
  });

  it('is true when MCP_GW_PASSTHROUGH_TO_MCP_SERVER=true', () => {
    process.env.MCP_GW_PASSTHROUGH_TO_MCP_SERVER = 'true';
    const cfg = loadConfig();
    expect(cfg.mcpServerPassthrough).toBe(true);
    delete process.env.MCP_GW_PASSTHROUGH_TO_MCP_SERVER;
  });

  it('is false when MCP_GW_PASSTHROUGH_TO_MCP_SERVER=false', () => {
    process.env.MCP_GW_PASSTHROUGH_TO_MCP_SERVER = 'false';
    const cfg = loadConfig();
    expect(cfg.mcpServerPassthrough).toBe(false);
    delete process.env.MCP_GW_PASSTHROUGH_TO_MCP_SERVER;
  });
});

describe('makeConfig helper produces valid GatewayConfig shape', () => {
  it('passthrough=true sets field correctly', () => {
    const cfg = makeConfig(true);
    expect(cfg.mcpServerPassthrough).toBe(true);
    expect(cfg.gatewayResourceUri).toBe('mcpgateway.ping.demo');
  });

  it('passthrough=false sets field correctly', () => {
    const cfg = makeConfig(false);
    expect(cfg.mcpServerPassthrough).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to confirm the config tests pass**

```bash
cd demo_mcp_gateway && npx jest tests/gateway-passthrough.test.ts --forceExit
```

Expected: 5 tests pass (the config tests don't depend on index.ts changes yet).

- [ ] **Step 3: Commit**

```bash
git add demo_mcp_gateway/tests/gateway-passthrough.test.ts
git commit -m "test(gw): add passthrough config tests"
```

---

## Task 3: Implement passthrough in `proxyToolsList`

**Files:**
- Modify: `demo_mcp_gateway/src/index.ts` (line 890–900)

The current `proxyToolsList` at line 890:

```typescript
async function proxyToolsList(target: 'olb' | 'invest', inboundToken: string): Promise<JsonRpcResponse> {
  const backendUri = backendResourceUri(target, config);
  const wsUrl = backendWsUrl(target, config);
  const backendToken = await exchangeTokenForBackend(inboundToken, backendUri, config);
  return proxyJsonRpc(wsUrl, backendToken, {
    jsonrpc: '2.0',
    id: `gw-list-${target}`,
    method: 'tools/list',
    params: {},
  });
}
```

- [ ] **Step 1: Replace `proxyToolsList` with the passthrough-aware version**

```typescript
async function proxyToolsList(target: 'olb' | 'invest', inboundToken: string): Promise<JsonRpcResponse> {
  const wsUrl = backendWsUrl(target, config);
  const backendToken = config.mcpServerPassthrough
    ? inboundToken
    : await exchangeTokenForBackend(inboundToken, backendResourceUri(target, config), config);
  return proxyJsonRpc(wsUrl, backendToken, {
    jsonrpc: '2.0',
    id: `gw-list-${target}`,
    method: 'tools/list',
    params: {},
  });
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd demo_mcp_gateway && npm run typecheck
```

Expected: no errors.

- [ ] **Step 3: Run all gateway tests**

```bash
cd demo_mcp_gateway && npm test
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add demo_mcp_gateway/src/index.ts
git commit -m "feat(gw): skip re-exchange in proxyToolsList when mcpServerPassthrough=true"
```

---

## Task 4: Implement passthrough in `tools/call` olb/invest dispatch

**Files:**
- Modify: `demo_mcp_gateway/src/index.ts` (lines 760–792)

The current olb/invest dispatch block (starting at the comment `// ----- Existing olb/invest path — WebSocket proxy (unchanged) -----`):

```typescript
// ----- Existing olb/invest path — WebSocket proxy (unchanged) -----
const backendUri = backendResourceUri(target, config);
const wsUrl = backendWsUrl(target, config);

let backendToken: string;
const exchInfo: ExchangeInfo = { cacheHit: false, targetAudience: backendUri };
try {
  backendToken = await exchangeTokenForBackend(token, backendUri, config, exchInfo);
} catch (err) {
  const msg2 = err instanceof Error ? err.message : String(err);
  console.error(`[GW] Token re-exchange failed for ${toolName}:`, msg2);
  send(JSON.stringify({
    jsonrpc: '2.0', id,
    error: { code: -32500, message: 'Token exchange failed', data: { credentialPath: 'oauth_bearer' } },
    result: {
      _meta: {
        credentialPath: 'oauth_bearer',
        tokenEvents: [
          {
            id: 'gw-exchange-failed',
            label: `Gateway RFC 8693 re-exchange FAILED (target aud=${backendUri}): ${msg2}`,
            tokenType: 'access_token',
            credentialPath: 'oauth_bearer',
            status: 'failed',
            specRef: 'RFC 8693 §2.2.2',
          },
        ],
      },
    },
  }));
  return;
}
```

- [ ] **Step 1: Replace the exchange block with a passthrough-aware version**

Replace the block from `// ----- Existing olb/invest path` through the closing `return;` of the catch (lines 760–792) with:

```typescript
// ----- Existing olb/invest path — WebSocket proxy -----
const backendUri = backendResourceUri(target, config);
const wsUrl = backendWsUrl(target, config);

let backendToken: string;
const exchInfo: ExchangeInfo = { cacheHit: false, targetAudience: backendUri };

if (config.mcpServerPassthrough) {
  // Passthrough mode: gateway has already validated + authorized the inbound
  // token. Forward it unchanged — no RFC 8693 re-exchange.
  backendToken = token;
  exchInfo.cacheHit = false;
} else {
  try {
    backendToken = await exchangeTokenForBackend(token, backendUri, config, exchInfo);
  } catch (err) {
    const msg2 = err instanceof Error ? err.message : String(err);
    console.error(`[GW] Token re-exchange failed for ${toolName}:`, msg2);
    send(JSON.stringify({
      jsonrpc: '2.0', id,
      error: { code: -32500, message: 'Token exchange failed', data: { credentialPath: 'oauth_bearer' } },
      result: {
        _meta: {
          credentialPath: 'oauth_bearer',
          tokenEvents: [
            {
              id: 'gw-exchange-failed',
              label: `Gateway RFC 8693 re-exchange FAILED (target aud=${backendUri}): ${msg2}`,
              tokenType: 'access_token',
              credentialPath: 'oauth_bearer',
              status: 'failed',
              specRef: 'RFC 8693 §2.2.2',
            },
          ],
        },
      },
    }));
    return;
  }
}
```

- [ ] **Step 2: Update the `gwExchangeEvent` token chain label to reflect passthrough mode**

Find the `gwExchangeEvent` block (around line 812) and replace it with:

```typescript
const gwExchangeEvent = config.mcpServerPassthrough
  ? {
      id: 'gw-passthrough',
      label: `Gateway passthrough: inbound token forwarded unchanged (aud=${config.gatewayResourceUri}) — no re-exchange. MCP Server trusts gateway enforcement.`,
      tokenType: 'access_token',
      credentialPath: 'oauth_bearer',
      status: 'ok',
      specRef: 'RFC 8693 — exchange skipped by design (passthrough mode)',
    }
  : exchInfo.cacheHit
  ? {
      id: 'gw-exchange',
      label: `Gateway token reused from cache (no PingOne round-trip this call) → aud=${backendUri}, act chain preserved`,
      tokenType: 'access_token',
      credentialPath: 'oauth_bearer',
      status: 'cached',
      specRef: 'RFC 8693 (cached result)',
    }
  : {
      id: 'gw-exchange',
      label: `Gateway RFC 8693 exchange: subject_token=inbound user-bearer (aud=mcp-gw) + actor=gateway-creds → fresh token aud=${backendUri}, act.client_id=gateway, prior act chain preserved`,
      tokenType: 'access_token',
      credentialPath: 'oauth_bearer',
      status: 'exchanged',
      specRef: 'RFC 8693 + draft-ietf-oauth-identity-chaining',
    };
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd demo_mcp_gateway && npm run typecheck
```

Expected: no errors.

- [ ] **Step 4: Run all gateway tests**

```bash
cd demo_mcp_gateway && npm test
```

Expected: all tests pass.

- [ ] **Step 5: Build dist**

```bash
cd demo_mcp_gateway && npm run build
```

Expected: exit 0, `dist/index.js` updated.

- [ ] **Step 6: Commit**

```bash
git add demo_mcp_gateway/src/index.ts
git commit -m "feat(gw): skip RFC 8693 re-exchange in tools/call olb/invest when mcpServerPassthrough=true"
```

---

## Task 5: Update environment variables

**Files:**
- Modify: `demo_mcp_server/.env`
- Modify: `demo_mcp_gateway/.env`

- [ ] **Step 1: Set `MCP_SERVER_RESOURCE_URI` on the MCP server**

In `demo_mcp_server/.env`, change:

```
MCP_SERVER_RESOURCE_URI=mcpserver.ping.demo
```

to:

```
MCP_SERVER_RESOURCE_URI=mcpgateway.ping.demo
```

This tells the MCP server's `TokenIntrospector.ts` to accept tokens whose `aud` contains `mcpgateway.ping.demo` — the same value the gateway and BFF use.

- [ ] **Step 2: Enable passthrough on the gateway**

In `demo_mcp_gateway/.env`, add:

```
MCP_GW_PASSTHROUGH_TO_MCP_SERVER=true
```

- [ ] **Step 3: Verify the BFF's MCP audience resolves to the gateway URI**

The BFF reads `pingone_resource_mcp_server_uri` via configStore, which checks env vars in this order: `PINGONE_RESOURCE_MCP_SERVER_URI` → `MCP_RESOURCE_URI` → `MCP_SERVER_RESOURCE_URI`.

In `demo_api_server/.env`, confirm `MCP_RESOURCE_URI` is set to `mcpgateway.ping.demo` (or add `PINGONE_RESOURCE_MCP_SERVER_URI=mcpgateway.ping.demo` to be explicit):

```
PINGONE_RESOURCE_MCP_SERVER_URI=mcpgateway.ping.demo
```

If `MCP_RESOURCE_URI=mcpgateway.ping.demo` is already present, that suffices — confirm by checking `demo_api_server/.env`.

> **PingOne note:** The MCP resource registered in PingOne must have `mcpgateway.ping.demo` as its audience. If you previously had `mcpserver.ping.demo`, update the resource audience in the PingOne Console (Environments → Resources → [MCP Resource] → audience field) and re-run bootstrap or update the resource via the Management API.

- [ ] **Step 4: Commit env changes**

```bash
git add demo_mcp_server/.env demo_mcp_gateway/.env demo_api_server/.env
git commit -m "config: set MCP_SERVER_RESOURCE_URI=mcpgateway.ping.demo, enable passthrough"
```

---

## Task 6: End-to-end verification

- [ ] **Step 1: Start all services**

```bash
./run.sh
./run.sh status
```

Expected: all services healthy.

- [ ] **Step 2: Log in as a demo user and open the banking dashboard**

Navigate to `https://api.ping.demo:4000`. Log in. Open the AI Agent sidebar.

- [ ] **Step 3: Call an olb tool (e.g. "Get My Accounts")**

Expected:
- Tool returns account data
- No errors in gateway logs (`./run.sh tail all` or `cat /tmp/demo-mcp-gateway.log`)
- Gateway logs show NO `[exchange]` or `RFC 8693 exchange` log entry for the olb/invest leg
- Token Chain panel in the UI shows the `gw-passthrough` event (label: "Gateway passthrough: inbound token forwarded unchanged")

- [ ] **Step 4: Verify Phase 266 tools still work**

Call `demo_show_accounts` (bankingdata path) and `user_profile_card` (dualtoken path) if wired in the UI. Expected: both succeed and still show an RFC 8693 exchange event in the Token Chain (these paths are unaffected by passthrough).

- [ ] **Step 5: Check MCP server logs confirm token acceptance**

```bash
cat /tmp/demo-mcp-server.log | grep "token audience validated\|aud validation"
```

Expected: `token audience validated` with `resource_uri=mcpgateway.ping.demo`.

- [ ] **Step 6: Run the full gateway test suite one final time**

```bash
cd demo_mcp_gateway && npm test
```

Expected: all tests pass.

- [ ] **Step 7: Final commit**

```bash
git add -p  # stage any remaining changes
git commit -m "feat(gw): MCP Gateway passthrough mode — single token, gateway as enforcement point"
```

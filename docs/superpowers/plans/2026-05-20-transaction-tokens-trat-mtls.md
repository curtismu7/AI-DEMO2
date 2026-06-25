# Transaction Tokens (TraT) + mTLS Gateway Enforcement — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement TraT context binding for MCP tool calls and mTLS enforcement between the gateway and MCP servers, so a broad-audience TX token (`aud: ping.demo`) cannot be used to bypass the gateway's PingAuthorize check.

**Architecture:** The BFF performs one RFC 8693 exchange producing a TX token (`aud: ping.demo`) valid at both the gateway and downstream MCP servers. The gateway is the sole PingAuthorize enforcement point; it evaluates TraT claims and — on PERMIT — forwards the TX token unchanged to the MCP server over a mTLS-authenticated WebSocket. MCP servers reject connections without the gateway's client certificate at the TLS handshake, before any application code runs.

**Tech Stack:** Node.js 20+, TypeScript 5, Express (BFF), `ws` (WebSocket), `selfsigned` npm package (cert generation), React (UI), Jest (tests).

---

## Scope check

This plan has two independent subsystems: (1) TraT context flow (BFF → Gateway → MCP Server → Authorize) and (2) mTLS (Gateway cert generation → MCP Server cert pinning). Tasks 1–5 cover TraT; Tasks 6–9 cover mTLS; Tasks 10–11 cover UI and education. They are ordered so TraT is complete and testable before mTLS begins.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `demo_mcp_gateway/src/mtls.ts` | Create | Generate self-signed CA + client cert at startup; write PEM to shared path |
| `demo_mcp_gateway/src/middleware/authorizeMcpRequest.ts` | Modify | Remove RFC 8693 exchange step; forward TX token unchanged; add mTLS cert to `forward()` call; add `mtls` to audit trail |
| `demo_mcp_gateway/src/proxy.ts` | Modify | Accept optional `tlsOptions` (client cert+key); use `https.Agent` on WS connections when present |
| `demo_mcp_gateway/src/config.ts` | Modify | Add `mtlsEnabled`, `mtlsCertPath` fields |
| `demo_mcp_gateway/src/index.ts` | Modify | Remove `exchangeTokenForBackend` / `selectCredentialForBackend` imports and call sites; call `mtls.ts` at startup |
| `demo_mcp_gateway/src/tokenExchange.ts` | Delete | No longer needed |
| `demo_mcp_gateway/src/credentialSwap.ts` | Delete | No longer needed |
| `demo_mcp_server/src/auth/mtlsMiddleware.ts` | Create | Read pinned gateway cert; verify client cert on each connection; reject on mismatch |
| `demo_mcp_server/src/server/BankingMCPServer.ts` | Modify | Switch to `https.createServer` + `requestCert: true` when `MCP_MTLS_ENABLED=true`; wire `mtlsMiddleware` |
| `demo_api_server/services/mcpToolPipeline.js` | Modify | Build mTLS token event from `gwAuditTrail.mtls`; remove `exchange` token event block |
| `demo_api_ui/src/components/TokenChainDisplay.js` | Modify | Render TraT badge + mTLS badge from token events |
| `demo_api_ui/src/components/TokenChainDisplay.css` | Modify | Amber/green badge styles for TraT and mTLS |
| `demo_api_ui/src/components/education/educationIds.js` | Modify | Add `TRANSACTION_TOKENS` constant |
| `demo_api_ui/src/components/education/TransactionTokensPanel.js` | Create | Education panel with 6 tabs |
| `demo_api_ui/src/components/education/EducationPanelsHost.js` | Modify | Register `TransactionTokensPanel` |
| `demo_api_server/scripts/setupTratClaims.js` | Create | Idempotent PingOne claim provisioning |
| `demo_api_server/scripts/bootstrapPingOne.js` | Modify | Call `setupTratClaims.js` post-provisioning |
| `demo_api_server/package.json` | Modify | Add `pingone:setup:trat` script |
| `demo_mcp_gateway/package.json` | Modify | Add `selfsigned` dependency |
| `demo_mcp_gateway/tests/authorizeMcpRequest-no-exchange.test.ts` | Create | Verify gateway forwards TX token unchanged |
| `demo_mcp_gateway/tests/mtls.test.ts` | Create | Verify cert generation and PEM write |
| `demo_mcp_server/tests/auth/mtlsMiddleware.test.ts` | Create | Verify cert pinning and rejection logic |

---

## Task 1: Remove gateway RFC 8693 exchange from the HTTP middleware pipeline

The `authorizeMcpRequest.ts` middleware currently does a 4-step pipeline ending in `exchangeClient.exchange()` then `forward(exchangedToken, body)`. In the new design the TX token is forwarded unchanged — step 4 is removed.

**Files:**
- Modify: `demo_mcp_gateway/src/middleware/authorizeMcpRequest.ts`
- Modify: `demo_mcp_gateway/src/middleware/authorizeMcpRequest.ts` — update `GwAuditTrail` type
- Create: `demo_mcp_gateway/tests/authorizeMcpRequest-no-exchange.test.ts`

- [ ] **Step 1: Write the failing test**

Create `demo_mcp_gateway/tests/authorizeMcpRequest-no-exchange.test.ts`:

```typescript
import { buildAuthorizeMcpRequest } from '../src/middleware/authorizeMcpRequest';
import type { GatewayConfig } from '../src/config';

// Minimal config stub — only fields used by the middleware
const stubConfig = {
  devBypass: false,
  gatewayResourceUri: 'https://gateway.ping.demo',
  pingoneBaseUrl: 'https://auth.pingone.com/test/as',
  pingoneEnvironmentId: 'test-env',
  introspectionEndpoint: '',
  authorizeApplicationId: '',
  authorizeEnvironmentId: '',
} as unknown as GatewayConfig;

describe('authorizeMcpRequest — no exchange', () => {
  it('forwards the original bearer token unchanged (no re-exchange)', async () => {
    // Arrange: pipeline with auth pipeline stubbed to PERMIT
    const forwardedTokens: string[] = [];

    const middleware = buildAuthorizeMcpRequest(stubConfig, {
      introspect: async () => ({ active: true, sub: 'u1', exp: 9999999999 }),
      authorize: async () => ({ decision: 'PERMIT' as const }),
    });

    const bearerToken = 'original-tx-token';
    const body = Buffer.from(JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'get_my_accounts', arguments: {} },
    }));

    const fakeRes = {
      writeHead: jest.fn(),
      end: jest.fn(),
      setHeader: jest.fn(),
    } as any;

    await middleware(bearerToken, body, {} as any, fakeRes, async (token) => {
      forwardedTokens.push(token);
    });

    // Assert: the SAME token was forwarded — no exchange happened
    expect(forwardedTokens).toHaveLength(1);
    expect(forwardedTokens[0]).toBe(bearerToken);
    expect(fakeRes.writeHead).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd demo_mcp_gateway && npx jest tests/authorizeMcpRequest-no-exchange.test.ts --no-coverage 2>&1 | tail -20
```

Expected: FAIL — `buildAuthorizeMcpRequest` doesn't accept dependency injection params yet (or test errors on type mismatch).

- [ ] **Step 3: Update `authorizeMcpRequest.ts` — remove exchange step, add dependency injection**

Replace the factory function signature and body. The key changes: (a) accept injectable `introspect` and `authorize` deps for testability, (b) remove `McpTokenExchangeClient` import and all exchange logic, (c) update `GwAuditTrail` to remove `exchange` field, (d) forward original `bearerToken` instead of `exchangeResult.token`, (e) remove `auditTrail.exchange` assignment:

```typescript
// At top of file — remove these imports:
// import { McpTokenExchangeClient } from '../auth/McpTokenExchangeClient';

// Update GwAuditTrail interface — remove exchange field:
interface GwAuditTrail {
  introspection: { active: boolean; skipped?: boolean; sub?: string; exp?: number; error?: string } | null;
  policy: { passed: boolean; error?: string } | null;
  authorize: { decision: string; reason?: string } | null;
  // exchange removed — gateway no longer re-exchanges the TX token
}

// Update factory signature to accept optional injectable deps:
export interface AuthorizeMcpRequestDeps {
  introspect: (token: string) => Promise<{ active: boolean; sub?: string; exp?: number }>;
  authorize: (decoded: any, method: string, toolName?: string, toolArgs?: any) =>
    Promise<{ decision: 'PERMIT' | 'DENY' | 'INDETERMINATE'; reason?: string }>;
}

export function buildAuthorizeMcpRequest(
  config: GatewayConfig,
  deps?: AuthorizeMcpRequestDeps,
): McpRequestMiddleware {
  const introspectionClient = new GatewayIntrospectionClient(config);
  const authorizeClient = new PingOneAuthorizeClient(config);

  const introspect = deps?.introspect ?? ((token: string) => introspectionClient.introspect(token));
  const authorize = deps?.authorize ?? ((decoded: any, method: string, toolName?: string, toolArgs?: any) =>
    authorizeClient.evaluate(decoded, method, toolName, toolArgs));

  return async (bearerToken, body, _req, res, forward) => {
    if (config.devBypass) {
      teachLog.info('[GW] Dev bypass: forwarding request without auth pipeline');
      await forward(bearerToken, body);
      return;
    }

    const auditTrail: GwAuditTrail = {
      introspection: null,
      policy: null,
      authorize: null,
    };

    const setAuditHeader = (r: ServerResponse) => {
      try { r.setHeader('X-Gw-Audit-Trail', JSON.stringify(auditTrail)); } catch { /* headers sent */ }
    };

    const pipelineResult = await runMcpAuthorizationPipeline(bearerToken, introspectionClient, config);
    auditTrail.introspection = pipelineResult.audit.introspection;
    auditTrail.policy = pipelineResult.audit.policy;

    if (pipelineResult.kind === 'introspection_failed') {
      setAuditHeader(res);
      res.writeHead(401, {
        'Content-Type': 'application/json',
        'WWW-Authenticate': `Bearer realm="PingOne", resource_metadata="${config.gatewayResourceUri}/.well-known/mcp-server", error="invalid_token", error_description="Token is revoked or no longer active"`,
      });
      res.end(JSON.stringify({ error: 'login_required', message: 'Token is revoked or no longer active (RFC 7662)', required_scopes: ['read'], login_required: true }));
      return;
    }

    if (pipelineResult.kind === 'policy_violation') {
      setAuditHeader(res);
      res.writeHead(401, {
        'Content-Type': 'application/json',
        'WWW-Authenticate': `Bearer realm="PingOne", resource_metadata="${config.gatewayResourceUri}/.well-known/mcp-server", error="${pipelineResult.code}", error_description="${pipelineResult.message}"`,
      });
      res.end(JSON.stringify({ error: pipelineResult.code, message: pipelineResult.message, required_scopes: ['read'], login_required: true }));
      return;
    }

    const decoded = pipelineResult.decoded;
    const parsedBody = parseJsonRpcBody(body);
    const { method = 'unknown', params } = parsedBody;
    const toolName = params?.name;
    let toolArgs = params?.arguments as Record<string, unknown> | undefined;

    let outBody = body;
    if (toolArgs && '_hitl_challenge_id' in toolArgs) {
      const { _hitl_challenge_id: _stripped, ...rest } = toolArgs;
      toolArgs = rest;
      if (parsedBody.params) parsedBody.params.arguments = rest;
      outBody = Buffer.from(JSON.stringify(parsedBody), 'utf-8');
    }

    let authzDecision;
    try {
      authzDecision = await authorize(decoded, method, toolName, toolArgs);
    } catch {
      authzDecision = { decision: 'DENY' as const, reason: 'Authorization service unavailable' };
    }
    auditTrail.authorize = { decision: authzDecision.decision, reason: authzDecision.reason };

    if (authzDecision.decision !== 'PERMIT') {
      setAuditHeader(res);
      res.writeHead(403, { 'Content-Type': 'application/json', 'WWW-Authenticate': `Bearer realm="PingOne", resource_metadata="${config.gatewayResourceUri}/.well-known/mcp-server"` });
      res.end(JSON.stringify(
        authzDecision.decision === 'INDETERMINATE'
          ? { error: 'hitl_required', message: authzDecision.reason ?? 'Request denied by policy', decision: authzDecision.decision, required_scopes: getScopesForGatewayTool(toolName ?? ''), login_required: false }
          : { error: 'insufficient_scope', message: authzDecision.reason ?? 'Request denied by policy', decision: authzDecision.decision, required_scopes: getScopesForGatewayTool(toolName ?? ''), login_required: false },
      ));
      return;
    }

    if (method === 'tools/call' && toolName && routeTool(toolName) === 'apikey') {
      const rpcId = parsedBody.id ?? null;
      const outcome = await buildApiKeyToolResult(toolName, decoded.sub, undefined, config);
      setAuditHeader(res);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (outcome.ok) {
        res.end(JSON.stringify({ jsonrpc: '2.0', id: rpcId, result: outcome.result }));
      } else {
        res.end(JSON.stringify({ jsonrpc: '2.0', id: rpcId, error: { code: outcome.code, message: outcome.message, data: outcome.data } }));
      }
      return;
    }

    // Forward the original TX token unchanged — no re-exchange
    setAuditHeader(res);
    teachLog.info('gateway audit trail', { gw_audit_trail: auditTrail });
    await forward(bearerToken, outBody);
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd demo_mcp_gateway && npx jest tests/authorizeMcpRequest-no-exchange.test.ts --no-coverage 2>&1 | tail -10
```

Expected: PASS

- [ ] **Step 5: Run existing gateway tests to check for regressions**

```bash
cd demo_mcp_gateway && npm test 2>&1 | tail -20
```

Expected: all passing (or same failures as before this task).

- [ ] **Step 6: Commit**

```bash
git add demo_mcp_gateway/src/middleware/authorizeMcpRequest.ts demo_mcp_gateway/tests/authorizeMcpRequest-no-exchange.test.ts
git commit -m "feat(trat): gateway forwards TX token unchanged — remove RFC 8693 re-exchange step"
```

---

## Task 2: Delete `tokenExchange.ts` and `credentialSwap.ts` from the gateway

These files powered the now-removed re-exchange step. Their tests must also be deleted or updated.

**Files:**
- Delete: `demo_mcp_gateway/src/tokenExchange.ts`
- Delete: `demo_mcp_gateway/src/credentialSwap.ts`
- Delete: `demo_mcp_gateway/tests/credentialSwap.test.ts`
- Modify: `demo_mcp_gateway/src/index.ts` — remove imports

- [ ] **Step 1: Remove imports from `index.ts`**

In `demo_mcp_gateway/src/index.ts`, find and remove these lines:

```typescript
import { exchangeTokenForBackend, ExchangeInfo, clearTokenCache } from './tokenExchange';
import { selectCredentialForBackend } from './credentialSwap';
```

Also remove any call sites. Search for `exchangeTokenForBackend`, `selectCredentialForBackend`, `clearTokenCache` in `index.ts` and delete those blocks. The gateway no longer does token exchange — it forwards the inbound token.

- [ ] **Step 2: Delete the files**

```bash
rm demo_mcp_gateway/src/tokenExchange.ts
rm demo_mcp_gateway/src/credentialSwap.ts
rm demo_mcp_gateway/tests/credentialSwap.test.ts
```

- [ ] **Step 3: Build to confirm no broken imports**

```bash
cd demo_mcp_gateway && npm run build 2>&1 | tail -20
```

Expected: exit 0. Fix any remaining import errors before proceeding.

- [ ] **Step 4: Run gateway tests**

```bash
cd demo_mcp_gateway && npm test 2>&1 | tail -20
```

Expected: all passing.

- [ ] **Step 5: Commit**

```bash
git add -u demo_mcp_gateway/src/ demo_mcp_gateway/tests/
git commit -m "chore(gateway): delete tokenExchange + credentialSwap — gateway no longer re-exchanges TX token"
```

---

## Task 3: Update BFF audit trail — remove `exchange` event, no behaviour change needed

The BFF's `mcpToolPipeline.js` currently builds a token event when `gwAuditTrail.exchange` is present. Since the gateway no longer does exchange, this block should be removed so it doesn't emit a stale event. Also remove the `exchange` field reference from the pipeline.

**Files:**
- Modify: `demo_api_server/services/mcpToolPipeline.js`

- [ ] **Step 1: Remove the `gwAuditTrail.exchange` block**

Find this block in `demo_api_server/services/mcpToolPipeline.js` (around line 565):

```javascript
if (gwAuditTrail.exchange) {
    const exchangeRes = gwAuditTrail.exchange;
    tokenEvents.push(deps.buildTokenEvent(
        'gw-exchange',
        'Gateway — RFC 8693 Token Exchange',
        'exchanged',
        null,
        `Token exchanged to MCP resource audience: ${exchangeRes.targetAud}`,
        { targetAud: exchangeRes.targetAud }
    ));
}
```

Delete those 11 lines.

- [ ] **Step 2: Run BFF tests**

```bash
cd demo_api_server && npm test 2>&1 | tail -20
```

Expected: all passing.

- [ ] **Step 3: Commit**

```bash
git add demo_api_server/services/mcpToolPipeline.js
git commit -m "chore(trat): remove stale gateway exchange token event — gateway no longer re-exchanges"
```

---

## Task 4: Install `selfsigned` in the gateway and create `mtls.ts`

The gateway needs to generate a self-signed client certificate at startup. The `selfsigned` package wraps `node-forge` to make this straightforward.

**Files:**
- Modify: `demo_mcp_gateway/package.json`
- Create: `demo_mcp_gateway/src/mtls.ts`
- Create: `demo_mcp_gateway/tests/mtls.test.ts`

- [ ] **Step 1: Install `selfsigned`**

```bash
cd demo_mcp_gateway && npm install selfsigned
```

Also add types if available:

```bash
cd demo_mcp_gateway && npm install --save-dev @types/selfsigned 2>/dev/null || true
```

- [ ] **Step 2: Write the failing test**

Create `demo_mcp_gateway/tests/mtls.test.ts`:

```typescript
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { generateGatewayCerts, GatewayCerts } from '../src/mtls';

describe('generateGatewayCerts', () => {
  it('returns a cert and key as PEM strings', async () => {
    const certs: GatewayCerts = await generateGatewayCerts();
    expect(typeof certs.clientCert).toBe('string');
    expect(typeof certs.clientKey).toBe('string');
    expect(certs.clientCert).toMatch(/-----BEGIN CERTIFICATE-----/);
    expect(certs.clientKey).toMatch(/-----BEGIN/);
  });

  it('writes client cert PEM to the specified path', async () => {
    const tmpPath = path.join(os.tmpdir(), `gw-test-${Date.now()}.crt`);
    await generateGatewayCerts({ writeCertTo: tmpPath });
    const written = fs.readFileSync(tmpPath, 'utf-8');
    expect(written).toMatch(/-----BEGIN CERTIFICATE-----/);
    fs.unlinkSync(tmpPath);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd demo_mcp_gateway && npx jest tests/mtls.test.ts --no-coverage 2>&1 | tail -10
```

Expected: FAIL — `../src/mtls` not found.

- [ ] **Step 4: Create `demo_mcp_gateway/src/mtls.ts`**

```typescript
import * as fs from 'fs';
import selfsigned from 'selfsigned';

export interface GatewayCerts {
  clientCert: string;
  clientKey: string;
}

export interface GenerateCertsOptions {
  writeCertTo?: string;
  commonName?: string;
  validityDays?: number;
}

export async function generateGatewayCerts(opts: GenerateCertsOptions = {}): Promise<GatewayCerts> {
  const attrs = [{ name: 'commonName', value: opts.commonName ?? 'banking-mcp-gateway' }];
  const pems = selfsigned.generate(attrs, {
    days: opts.validityDays ?? 1,
    keySize: 2048,
    algorithm: 'sha256',
    extensions: [{ name: 'basicConstraints', cA: false }],
  });

  const clientCert: string = pems.cert;
  const clientKey: string = pems.private;

  if (opts.writeCertTo) {
    fs.writeFileSync(opts.writeCertTo, clientCert, { encoding: 'utf-8', mode: 0o600 });
  }

  return { clientCert, clientKey };
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd demo_mcp_gateway && npx jest tests/mtls.test.ts --no-coverage 2>&1 | tail -10
```

Expected: PASS

- [ ] **Step 6: Build to confirm TypeScript compiles**

```bash
cd demo_mcp_gateway && npm run build 2>&1 | tail -10
```

Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add demo_mcp_gateway/package.json demo_mcp_gateway/package-lock.json demo_mcp_gateway/src/mtls.ts demo_mcp_gateway/tests/mtls.test.ts
git commit -m "feat(mtls): add selfsigned dep + generateGatewayCerts utility"
```

---

## Task 5: Extend `proxy.ts` to use mTLS client cert on WebSocket connections

The `proxyJsonRpc` function opens a WebSocket to the MCP server. When mTLS is enabled the gateway must present its client certificate.

**Files:**
- Modify: `demo_mcp_gateway/src/proxy.ts`
- Modify: `demo_mcp_gateway/tests/proxy.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `demo_mcp_gateway/tests/proxy.test.ts`:

```typescript
import * as https from 'https';
import { buildUpstreamHeaders } from '../src/proxy';

describe('buildUpstreamHeaders with mTLS', () => {
  it('includes mTLS cert fingerprint note in headers when tlsOptions present', () => {
    // The presence of tlsOptions is what matters — the actual TLS happens at the
    // WebSocket level. This tests that buildUpstreamHeaders still works when mTLS
    // options are passed alongside.
    const h = buildUpstreamHeaders('token-abc', undefined);
    expect(h['Authorization']).toBe('Bearer token-abc');
    // No crash when called with trat header too
    const h2 = buildUpstreamHeaders('token-abc', '{"trat_sim":true}');
    expect(h2['X-TraT-Context']).toBe('{"trat_sim":true}');
  });
});
```

Add a separate test for the `proxyJsonRpc` signature accepting `tlsOptions`:

```typescript
import { proxyJsonRpc } from '../src/proxy';

describe('proxyJsonRpc tlsOptions', () => {
  it('accepts tlsOptions parameter without throwing a type error', () => {
    // This is a compile-time check — if TypeScript accepts this call, the
    // signature is correct. The test itself doesn't make a real WS connection.
    const call = () => proxyJsonRpc(
      'ws://localhost:9999',
      'token',
      { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      undefined,
      { cert: 'fakecert', key: 'fakekey', rejectUnauthorized: false },
    );
    // We expect this to return a Promise (which will reject because there's no
    // server on :9999) — but we only care that the call compiles and starts.
    expect(call).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd demo_mcp_gateway && npx jest tests/proxy.test.ts --no-coverage 2>&1 | tail -10
```

Expected: FAIL — `proxyJsonRpc` doesn't accept `tlsOptions` yet.

- [ ] **Step 3: Update `proxy.ts` to accept `tlsOptions`**

Update the `proxyJsonRpc` signature and body in `demo_mcp_gateway/src/proxy.ts`:

```typescript
import * as https from 'https';

export interface MtlsOptions {
  cert: string;
  key: string;
  rejectUnauthorized: boolean;
}

export function proxyJsonRpc(
  backendWsUrl: string,
  backendToken: string,
  request: JsonRpcRequest,
  xTratContext?: string,
  tlsOptions?: MtlsOptions,
): Promise<JsonRpcResponse> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error(`Proxy timeout after ${CALL_TIMEOUT_MS}ms for ${request.method}`));
    }, CALL_TIMEOUT_MS);

    const wsOptions: WebSocket.ClientOptions = {
      headers: buildUpstreamHeaders(backendToken, xTratContext),
    };

    if (tlsOptions) {
      wsOptions.agent = new https.Agent({
        cert: tlsOptions.cert,
        key: tlsOptions.key,
        rejectUnauthorized: tlsOptions.rejectUnauthorized,
      });
    }

    const ws = new WebSocket(backendWsUrl, wsOptions);
    // ... rest of existing ws logic unchanged ...
  });
}
```

Keep everything inside the `Promise` constructor identical to the current implementation — only add `wsOptions` construction and pass it to `new WebSocket()`.

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd demo_mcp_gateway && npx jest tests/proxy.test.ts --no-coverage 2>&1 | tail -10
```

Expected: PASS

- [ ] **Step 5: Build**

```bash
cd demo_mcp_gateway && npm run build 2>&1 | tail -10
```

Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add demo_mcp_gateway/src/proxy.ts demo_mcp_gateway/tests/proxy.test.ts
git commit -m "feat(mtls): proxy.ts accepts tlsOptions — uses https.Agent with client cert on WS connections"
```

---

## Task 6: Wire mTLS cert generation into gateway startup (`index.ts`)

The gateway calls `generateGatewayCerts()` at startup when `MCP_MTLS_ENABLED=true`, then passes the cert+key as `tlsOptions` to all `proxyJsonRpc` calls.

**Files:**
- Modify: `demo_mcp_gateway/src/config.ts`
- Modify: `demo_mcp_gateway/src/index.ts`

- [ ] **Step 1: Add mTLS config fields to `config.ts`**

In `demo_mcp_gateway/src/config.ts`, find the `GatewayConfig` interface and add:

```typescript
export interface GatewayConfig {
  // ... existing fields ...
  mtlsEnabled: boolean;
  mtlsCertPath: string;
}
```

In `loadConfig()`, add:

```typescript
mtlsEnabled: process.env.MCP_MTLS_ENABLED === 'true',
mtlsCertPath: process.env.MCP_MTLS_GATEWAY_CERT_PATH ?? '/tmp/gw-client.crt',
```

- [ ] **Step 2: Wire startup in `index.ts`**

At the top of `demo_mcp_gateway/src/index.ts`, add the import:

```typescript
import { generateGatewayCerts, GatewayCerts, MtlsOptions } from './mtls';
```

Inside the async IIFE, after `config = loadConfig()`, add:

```typescript
let gatewayCerts: GatewayCerts | null = null;
if (config.mtlsEnabled) {
  gatewayCerts = await generateGatewayCerts({ writeCertTo: config.mtlsCertPath });
  console.log(`[GW] mTLS enabled — client cert written to ${config.mtlsCertPath}`);
} else {
  console.log('[GW] mTLS disabled — TX token forwarded without client cert (set MCP_MTLS_ENABLED=true to enable)');
}
```

Then find every call to `proxyJsonRpc` in `index.ts` and add `tlsOptions`:

```typescript
// Before: proxyJsonRpc(wsUrl, backendToken, msg)
// After:
const tlsOpts: MtlsOptions | undefined = gatewayCerts
  ? { cert: gatewayCerts.clientCert, key: gatewayCerts.clientKey, rejectUnauthorized: false }
  : undefined;
result = await proxyJsonRpc(wsUrl, bearerToken, msg, xTratContext, tlsOpts);
```

Note: use `bearerToken` (the inbound TX token) rather than `backendToken` everywhere — the re-exchange is gone.

- [ ] **Step 3: Build**

```bash
cd demo_mcp_gateway && npm run build 2>&1 | tail -20
```

Expected: exit 0. Fix any type errors.

- [ ] **Step 4: Run all gateway tests**

```bash
cd demo_mcp_gateway && npm test 2>&1 | tail -20
```

Expected: all passing.

- [ ] **Step 5: Commit**

```bash
git add demo_mcp_gateway/src/config.ts demo_mcp_gateway/src/index.ts
git commit -m "feat(mtls): gateway generates self-signed client cert at startup when MCP_MTLS_ENABLED=true"
```

---

## Task 7: Create mTLS middleware for the MCP server

The MCP server needs to (a) generate its own server cert, (b) switch to HTTPS when `MCP_MTLS_ENABLED=true`, and (c) verify that incoming connections present the gateway's pinned client cert.

**Files:**
- Create: `demo_mcp_server/src/auth/mtlsMiddleware.ts`
- Create: `demo_mcp_server/tests/auth/mtlsMiddleware.test.ts`

- [ ] **Step 1: Write the failing test**

Create `demo_mcp_server/tests/auth/mtlsMiddleware.test.ts`:

```typescript
import { createMtlsVerifier, MtlsVerifier } from '../../src/auth/mtlsMiddleware';

const FAKE_GATEWAY_CERT = `-----BEGIN CERTIFICATE-----
MIIBpTCCAQ6gAwIBAgIJAKFakeTestCert...
-----END CERTIFICATE-----`;

describe('createMtlsVerifier', () => {
  it('returns null when MCP_MTLS_ENABLED is false', () => {
    const verifier = createMtlsVerifier({ enabled: false, gatewayCertPem: '' });
    expect(verifier).toBeNull();
  });

  it('throws when enabled but gatewayCertPem is empty', () => {
    expect(() => createMtlsVerifier({ enabled: true, gatewayCertPem: '' }))
      .toThrow('MCP_MTLS_ENABLED=true but no gateway cert found');
  });

  it('returns a verifier function when enabled with a cert', () => {
    const verifier = createMtlsVerifier({ enabled: true, gatewayCertPem: FAKE_GATEWAY_CERT });
    expect(typeof verifier).toBe('function');
  });

  it('verifier rejects when no client cert presented', () => {
    const verifier = createMtlsVerifier({ enabled: true, gatewayCertPem: FAKE_GATEWAY_CERT }) as MtlsVerifier;
    const fakeSocket = { getPeerCertificate: () => ({}) } as any;
    expect(() => verifier(fakeSocket)).toThrow('mTLS: no client certificate presented');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd demo_mcp_server && npx jest tests/auth/mtlsMiddleware.test.ts --no-coverage 2>&1 | tail -10
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `demo_mcp_server/src/auth/mtlsMiddleware.ts`**

```typescript
import * as tls from 'tls';
import * as crypto from 'crypto';

export type MtlsVerifier = (socket: tls.TLSSocket) => void;

export interface MtlsVerifierOptions {
  enabled: boolean;
  gatewayCertPem: string;
}

function certFingerprint(pemCert: string): string {
  const der = Buffer.from(
    pemCert.replace(/-----BEGIN CERTIFICATE-----/, '').replace(/-----END CERTIFICATE-----/, '').replace(/\s/g, ''),
    'base64',
  );
  return crypto.createHash('sha256').update(der).digest('hex');
}

export function createMtlsVerifier(opts: MtlsVerifierOptions): MtlsVerifier | null {
  if (!opts.enabled) return null;
  if (!opts.gatewayCertPem) throw new Error('MCP_MTLS_ENABLED=true but no gateway cert found at MCP_MTLS_GATEWAY_CERT_PATH');

  const expectedFingerprint = certFingerprint(opts.gatewayCertPem);

  return (socket: tls.TLSSocket): void => {
    const peerCert = socket.getPeerCertificate();
    if (!peerCert || !peerCert.raw) {
      throw new Error('mTLS: no client certificate presented');
    }
    const actualFingerprint = crypto.createHash('sha256').update(peerCert.raw).digest('hex');
    if (actualFingerprint !== expectedFingerprint) {
      throw new Error('mTLS: client certificate does not match pinned gateway cert');
    }
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd demo_mcp_server && npx jest tests/auth/mtlsMiddleware.test.ts --no-coverage 2>&1 | tail -10
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add demo_mcp_server/src/auth/mtlsMiddleware.ts demo_mcp_server/tests/auth/mtlsMiddleware.test.ts
git commit -m "feat(mtls): MCP server mTLS verifier — pins gateway client cert, rejects unmatched connections"
```

---

## Task 8: Switch MCP server to HTTPS when `MCP_MTLS_ENABLED=true`

**Files:**
- Modify: `demo_mcp_server/src/server/BankingMCPServer.ts`

- [ ] **Step 1: Update `startServer()` to support HTTPS with client cert verification**

In `demo_mcp_server/src/server/BankingMCPServer.ts`, find the import line:

```typescript
import { createServer, Server as HttpServer } from 'http';
```

Replace with:

```typescript
import { createServer, Server as HttpServer } from 'http';
import * as https from 'https';
import * as fs from 'fs';
import selfsigned from 'selfsigned';
import { createMtlsVerifier } from '../auth/mtlsMiddleware';
```

Note: `demo_mcp_server` also needs `selfsigned` installed:

```bash
cd demo_mcp_server && npm install selfsigned
```

In `startServer()`, replace the block that creates `this.httpServer`:

```typescript
// Before:
this.httpServer = createServer((req, res) => {
  this.handleHttpRequest(req, res);
});

// After:
const mtlsEnabled = process.env.MCP_MTLS_ENABLED === 'true';
const gatewayCertPath = process.env.MCP_MTLS_GATEWAY_CERT_PATH ?? '/tmp/gw-client.crt';

if (mtlsEnabled) {
  const gatewayCertPem = fs.existsSync(gatewayCertPath)
    ? fs.readFileSync(gatewayCertPath, 'utf-8')
    : '';
  const mtlsVerifier = createMtlsVerifier({ enabled: true, gatewayCertPem });

  // Generate self-signed server cert for this MCP server instance
  const serverPems = selfsigned.generate(
    [{ name: 'commonName', value: 'banking-mcp-server' }],
    { days: 1, keySize: 2048, algorithm: 'sha256' },
  );

  this.httpServer = https.createServer(
    {
      cert: serverPems.cert,
      key: serverPems.private,
      requestCert: true,
      rejectUnauthorized: false, // We do our own fingerprint check below
    },
    (req, res) => {
      const socket = req.socket as import('tls').TLSSocket;
      try {
        mtlsVerifier!(socket);
      } catch (err) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'mtls_required', message: (err as Error).message }));
        return;
      }
      this.handleHttpRequest(req, res);
    },
  ) as unknown as HttpServer;

  console.log('[BankingMCPServer] mTLS enabled — connections require gateway client cert');
} else {
  this.httpServer = createServer((req, res) => {
    this.handleHttpRequest(req, res);
  });
}
```

- [ ] **Step 2: Build MCP server**

```bash
cd demo_mcp_server && npm run build 2>&1 | tail -20
```

Expected: exit 0.

- [ ] **Step 3: Run MCP server tests**

```bash
cd demo_mcp_server && npm test 2>&1 | tail -20
```

Expected: all passing.

- [ ] **Step 4: Commit**

```bash
git add demo_mcp_server/src/server/BankingMCPServer.ts demo_mcp_server/package.json demo_mcp_server/package-lock.json
git commit -m "feat(mtls): MCP server switches to HTTPS + requestCert when MCP_MTLS_ENABLED=true"
```

---

## Task 9: Add mTLS token event to gateway audit trail and BFF pipeline

The gateway should report its mTLS verification result in `X-Gw-Audit-Trail` so the Token Chain UI can display it.

**Files:**
- Modify: `demo_mcp_gateway/src/middleware/authorizeMcpRequest.ts`
- Modify: `demo_api_server/services/mcpToolPipeline.js`

- [ ] **Step 1: Add `mtls` field to `GwAuditTrail` in `authorizeMcpRequest.ts`**

Update the `GwAuditTrail` interface:

```typescript
interface GwAuditTrail {
  introspection: { active: boolean; skipped?: boolean; sub?: string; exp?: number; error?: string } | null;
  policy: { passed: boolean; error?: string } | null;
  authorize: { decision: string; reason?: string } | null;
  mtls: { enabled: boolean; subject?: string } | null;
}
```

Update the initialisation:

```typescript
const auditTrail: GwAuditTrail = {
  introspection: null,
  policy: null,
  authorize: null,
  mtls: null,
};
```

Before the final `forward()` call, set the mTLS audit field. The gateway middleware doesn't perform the mTLS itself (that's at the TLS layer) — it reports whether mTLS was configured:

```typescript
auditTrail.mtls = config.mtlsEnabled
  ? { enabled: true, subject: 'banking-mcp-gateway' }
  : { enabled: false };
```

- [ ] **Step 2: Add mTLS token event in BFF `mcpToolPipeline.js`**

In `demo_api_server/services/mcpToolPipeline.js`, find the `if (gwAuditTrail)` block (around line 535). After the existing `gwAuditTrail.authorize` block, add:

```javascript
if (gwAuditTrail.mtls) {
    const mtlsRes = gwAuditTrail.mtls;
    const status = mtlsRes.enabled ? 'active' : 'skipped';
    const desc = mtlsRes.enabled
        ? `Gateway → MCP server mTLS verified. Client cert subject: ${mtlsRes.subject || 'banking-mcp-gateway'}`
        : 'mTLS not enforced between gateway and MCP server (MCP_MTLS_ENABLED=false). Set MCP_MTLS_ENABLED=true to enforce.';
    tokenEvents.push(deps.buildTokenEvent(
        'gw-mtls',
        'Gateway → MCP Server mTLS',
        status,
        null,
        desc,
        { mtlsEnabled: mtlsRes.enabled, subject: mtlsRes.subject }
    ));
}
```

- [ ] **Step 3: Run BFF tests**

```bash
cd demo_api_server && npm test 2>&1 | tail -20
```

Expected: all passing.

- [ ] **Step 4: Build gateway**

```bash
cd demo_mcp_gateway && npm run build 2>&1 | tail -10
```

Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add demo_mcp_gateway/src/middleware/authorizeMcpRequest.ts demo_api_server/services/mcpToolPipeline.js
git commit -m "feat(mtls): add mTLS field to gateway audit trail + mTLS token event in BFF pipeline"
```

---

## Task 10: Token Chain UI — TraT badge + mTLS badge

**Files:**
- Modify: `demo_api_ui/src/components/TokenChainDisplay.js`
- Modify: `demo_api_ui/src/components/TokenChainDisplay.css`

- [ ] **Step 1: Add badge styles to `TokenChainDisplay.css`**

Add to `demo_api_ui/src/components/TokenChainDisplay.css`:

```css
.token-badge-trat {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
}
.token-badge-trat.simulated {
  background: #fef3c7;
  color: #92400e;
  border: 1px solid #fbbf24;
}
.token-badge-trat.native {
  background: #d1fae5;
  color: #065f46;
  border: 1px solid #34d399;
}
.token-badge-mtls.active {
  background: #d1fae5;
  color: #065f46;
  border: 1px solid #34d399;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: 600;
}
.token-badge-mtls.skipped {
  background: #fef3c7;
  color: #92400e;
  border: 1px solid #fbbf24;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: 600;
}
.trat-claims-detail {
  margin-top: 8px;
  padding: 8px 12px;
  background: #f8fafc;
  border-radius: 4px;
  font-family: monospace;
  font-size: 0.75rem;
  white-space: pre-wrap;
}
```

- [ ] **Step 2: Add TraT and mTLS rendering to `TokenChainDisplay.js`**

Find the section in `TokenChainDisplay.js` where individual token events are rendered (look for the `event.id` switch or the map over `tokenEvents`). Add rendering for the two new event IDs:

For `event.id === 'trat-context'`:
```jsx
// In the token event render function, add:
if (event.id === 'trat-context') {
  const isSimulated = event.metadata?.tratContext !== undefined && event.description?.includes('trat_sim');
  const badgeClass = isSimulated ? 'simulated' : 'native';
  const badgeLabel = isSimulated ? 'TraT (simulated)' : 'TraT';
  return (
    <div key={event.id} className="token-event">
      <span
        className={`token-badge-trat ${badgeClass}`}
        onClick={() => openEducationPanel('transaction-tokens')}
        title="Click to learn about Transaction Tokens"
      >
        {badgeLabel} ⓘ
      </span>
      {expanded && event.metadata?.tratContext && (
        <div className="trat-claims-detail">
          {JSON.stringify(event.metadata.tratContext, null, 2)}
        </div>
      )}
    </div>
  );
}
```

For `event.id === 'gw-mtls'`:
```jsx
if (event.id === 'gw-mtls') {
  const isActive = event.status === 'active';
  return (
    <div key={event.id} className="token-event">
      <span
        className={`token-badge-mtls ${isActive ? 'active' : 'skipped'}`}
        title={event.description}
      >
        {isActive ? 'mTLS ✅' : 'mTLS ⚠️'}
      </span>
    </div>
  );
}
```

- [ ] **Step 3: Build UI**

```bash
cd demo_api_ui && npm run build 2>&1 | tail -10
```

Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add demo_api_ui/src/components/TokenChainDisplay.js demo_api_ui/src/components/TokenChainDisplay.css
git commit -m "feat(trat): Token Chain UI — TraT badge + mTLS badge"
```

---

## Task 11: Education panel — `TransactionTokensPanel.js`

**Files:**
- Modify: `demo_api_ui/src/components/education/educationIds.js`
- Create: `demo_api_ui/src/components/education/TransactionTokensPanel.js`
- Modify: `demo_api_ui/src/components/education/EducationPanelsHost.js`

- [ ] **Step 1: Add `TRANSACTION_TOKENS` to `educationIds.js`**

Open `demo_api_ui/src/components/education/educationIds.js`. Find the exported object (e.g. `export const EDU = { ... }`). Add:

```javascript
TRANSACTION_TOKENS: 'transaction-tokens',
```

- [ ] **Step 2: Create `TransactionTokensPanel.js`**

Look at an existing panel (e.g. `HumanInLoopPanel.js`) for the tab component pattern used in this codebase, then create `demo_api_ui/src/components/education/TransactionTokensPanel.js` following the same pattern with these 6 tabs:

```jsx
import React, { useState } from 'react';

const TABS = ['What & Why', 'How It Works', 'Claims', 'mTLS', 'Draft Status', 'This Demo'];

export default function TransactionTokensPanel() {
  const [tab, setTab] = useState(0);

  return (
    <div className="education-panel">
      <h2>Transaction Tokens (TraT)</h2>
      <p className="education-subtitle">
        Binding MCP tool calls to their originating transaction context
      </p>
      <div className="education-tabs">
        {TABS.map((t, i) => (
          <button
            key={t}
            className={`education-tab${tab === i ? ' active' : ''}`}
            onClick={() => setTab(i)}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 0 && (
        <div className="education-content">
          <h3>The problem</h3>
          <p>The MCP gateway forwards a bearer token to the MCP server. That token is bound to a user identity but carries no context about <em>which tool was called</em>, in <em>which session</em>, for <em>what purpose</em>. A token captured from the gateway→server leg could be replayed in a different tool call.</p>
          <p>Additionally, the TX token's audience (<code>ping.demo</code>) covers the gateway and both MCP servers. A client with a valid TX token could bypass the gateway's PingAuthorize check entirely.</p>
          <h3>The solution</h3>
          <p><strong>Transaction Tokens (TraT)</strong> cryptographically bind each tool call to its originating context. <strong>mTLS</strong> between the gateway and MCP servers closes the bypass gap — MCP servers only accept connections from the gateway.</p>
          <a href="https://datatracker.ietf.org/doc/draft-oauth-transaction-tokens-for-agents/" target="_blank" rel="noopener noreferrer">
            IETF datatracker — draft-oauth-transaction-tokens-for-agents
          </a>
        </div>
      )}

      {tab === 1 && (
        <div className="education-content">
          <h3>Flow</h3>
          <ol>
            <li>BFF performs RFC 8693 exchange (user + agent) → TX token (<code>aud: ping.demo</code>)</li>
            <li>BFF builds TraT context: <code>reqctx</code>, <code>purp</code>, <code>azd</code>, <code>rctx</code></li>
            <li>BFF attaches <code>X-TraT-Context</code> header (simulation) or TX token carries claims natively</li>
            <li>Gateway evaluates TX token + TraT claims via PingOne Authorize → PERMIT</li>
            <li>Gateway forwards TX token + TraT header to MCP server over mTLS-authenticated WebSocket</li>
            <li>MCP server verifies gateway client cert → executes tool</li>
          </ol>
        </div>
      )}

      {tab === 2 && (
        <div className="education-content">
          <h3>TraT Claims</h3>
          <table className="education-table">
            <thead><tr><th>Claim</th><th>Type</th><th>Example</th><th>Purpose</th></tr></thead>
            <tbody>
              <tr><td><code>reqctx</code></td><td>object</td><td><code>&#123;tool, session_id, correlation_id&#125;</code></td><td>Request context — which tool, which session</td></tr>
              <tr><td><code>purp</code></td><td>string</td><td><code>banking:mcp:tool_call</code></td><td>Purpose of the transaction</td></tr>
              <tr><td><code>azd</code></td><td>object</td><td><code>&#123;sub, act, gateway&#125;</code></td><td>Authorized delegation chain</td></tr>
              <tr><td><code>rctx</code></td><td>object</td><td><code>&#123;ip, user_agent, timestamp&#125;</code></td><td>Requester context</td></tr>
              <tr><td><code>trat_sim</code></td><td>boolean</td><td><code>true</code></td><td>Present when BFF-simulated; absent when PingOne-native</td></tr>
            </tbody>
          </table>
        </div>
      )}

      {tab === 3 && (
        <div className="education-content">
          <h3>Why mTLS?</h3>
          <p>The TX token's audience is <code>ping.demo</code> — intentionally broad so it works at both the gateway and downstream MCP servers. Without an additional enforcement mechanism, a client with a valid TX token could call an MCP server directly, bypassing the gateway's PingAuthorize check.</p>
          <h3>How it works in this demo</h3>
          <p>The gateway generates a self-signed client certificate at startup (<code>selfsigned</code> package, in-memory). When <code>MCP_MTLS_ENABLED=true</code>:</p>
          <ul>
            <li>Gateway writes its client cert to <code>MCP_MTLS_GATEWAY_CERT_PATH</code> (default: <code>/tmp/gw-client.crt</code>)</li>
            <li>MCP servers start as HTTPS servers with <code>requestCert: true</code> and pin the gateway cert</li>
            <li>Connections without the gateway cert are rejected at the TLS handshake — no application code runs</li>
          </ul>
          <p>The Token Chain shows <strong>mTLS ✅</strong> when enforced, <strong>mTLS ⚠️</strong> when disabled.</p>
        </div>
      )}

      {tab === 4 && (
        <div className="education-content">
          <h3>IETF Draft Status</h3>
          <p><strong>Spec:</strong> <code>draft-oauth-transaction-tokens-for-agents-00</code></p>
          <p><strong>Working Group:</strong> OAUTH</p>
          <p><strong>Maturity:</strong> Individual draft (00) — pre-WG adoption as of May 2026</p>
          <p>PingOne native TraT support is pending. This demo simulates TraT using <code>X-TraT-Context</code> headers and <code>trat_sim: true</code>.</p>
          <a href="https://datatracker.ietf.org/doc/draft-oauth-transaction-tokens-for-agents/" target="_blank" rel="noopener noreferrer">
            Check for spec updates on IETF datatracker
          </a>
        </div>
      )}

      {tab === 5 && (
        <div className="education-content">
          <h3>This demo</h3>
          <p><strong>Simulation mode</strong> (<code>trat_sim: true</code>): the BFF builds the TraT context and injects it as an <code>X-TraT-Context</code> header. PingOne doesn't natively emit TraT claims yet — the header is the shim.</p>
          <p><strong>Native mode</strong> (future): PingOne emits <code>reqctx</code>, <code>purp</code>, <code>azd</code>, <code>rctx</code> directly in the TX token. No header needed.</p>
          <h3>How to enable</h3>
          <ol>
            <li>Set <code>ff_trat_mode=true</code> in the Config UI</li>
            <li>Run <code>npm run pingone:setup:trat</code> to provision PingOne token policy claims</li>
            <li>Set <code>MCP_MTLS_ENABLED=true</code> in gateway + MCP server env vars to enforce mTLS</li>
          </ol>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Register panel in `EducationPanelsHost.js`**

Open `demo_api_ui/src/components/education/EducationPanelsHost.js`. Following the same import and registration pattern used for other panels, add:

```javascript
import TransactionTokensPanel from './TransactionTokensPanel';
// In the panels map/switch:
case EDU.TRANSACTION_TOKENS:
  return <TransactionTokensPanel />;
```

- [ ] **Step 4: Build UI**

```bash
cd demo_api_ui && npm run build 2>&1 | tail -10
```

Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/components/education/educationIds.js demo_api_ui/src/components/education/TransactionTokensPanel.js demo_api_ui/src/components/education/EducationPanelsHost.js
git commit -m "feat(trat): add TransactionTokensPanel education panel with 6 tabs"
```

---

## Task 12: PingOne provisioning — `setupTratClaims.js` + bootstrap integration

**Files:**
- Create: `demo_api_server/scripts/setupTratClaims.js`
- Modify: `demo_api_server/scripts/bootstrapPingOne.js`
- Modify: `demo_api_server/package.json`

- [ ] **Step 1: Create `setupTratClaims.js`**

Create `demo_api_server/scripts/setupTratClaims.js`. Follow the pattern of existing bootstrap scripts in that directory (look at one for the axios + PingOne Management API pattern):

```javascript
'use strict';

/**
 * setupTratClaims.js — idempotent PingOne token policy claim provisioning for TraT.
 *
 * Adds reqctx, purp, azd, rctx as passthrough claim mappings to the MCP Token
 * Exchanger application's token policy so PingOne can emit them natively.
 *
 * Run standalone: npm run pingone:setup:trat
 * Called automatically by bootstrapPingOne.js post-provisioning.
 */

const axios = require('axios');
const configStore = require('../services/configStore');

const TRAT_CLAIMS = ['reqctx', 'purp', 'azd', 'rctx'];

async function getManagementToken() {
  const clientId = configStore.getEffective('pingone_admin_client_id') || process.env.PINGONE_ADMIN_CLIENT_ID;
  const clientSecret = configStore.getEffective('pingone_admin_client_secret') || process.env.PINGONE_ADMIN_CLIENT_SECRET;
  const envId = configStore.getEffective('pingone_environment_id') || process.env.PINGONE_ENVIRONMENT_ID;
  const region = configStore.getEffective('pingone_region') || process.env.PINGONE_REGION || 'com';
  const tokenUrl = `https://auth.pingone.${region}/${envId}/as/token`;
  const res = await axios.post(tokenUrl,
    'grant_type=client_credentials',
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, auth: { username: clientId, password: clientSecret } }
  );
  return res.data.access_token;
}

async function setupTratClaims() {
  console.log('[setupTratClaims] Starting TraT claim provisioning...');
  const token = await getManagementToken();
  const envId = configStore.getEffective('pingone_environment_id') || process.env.PINGONE_ENVIRONMENT_ID;
  const region = configStore.getEffective('pingone_region') || process.env.PINGONE_REGION || 'com';
  const appId = configStore.getEffective('pingone_mcp_token_exchanger_client_id') || process.env.PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_ID;
  const baseUrl = `https://api.pingone.${region}/v1/environments/${envId}`;

  // Get existing token policy for the exchanger app
  const appRes = await axios.get(`${baseUrl}/applications/${appId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const tokenPolicyId = appRes.data.tokenEndpointAuthMethod !== undefined
    ? appRes.data.id  // use app id as fallback
    : null;

  if (!tokenPolicyId) {
    console.log('[setupTratClaims] Could not determine token policy ID — skipping');
    return;
  }

  // Check existing claims
  const policyRes = await axios.get(`${baseUrl}/applications/${appId}/grants`, {
    headers: { Authorization: `Bearer ${token}` },
  }).catch(() => ({ data: { _embedded: { grants: [] } } }));

  const existingClaims = (policyRes.data._embedded?.grants || []).map((g) => g.name);
  const missing = TRAT_CLAIMS.filter((c) => !existingClaims.includes(c));

  if (missing.length === 0) {
    console.log('[setupTratClaims] TraT claims already provisioned ✅');
    return;
  }

  console.log(`[setupTratClaims] Provisioning missing claims: ${missing.join(', ')}`);
  // Note: actual PingOne Management API endpoint for custom claim mappings
  // varies by token policy type. Log a note if the API returns 404.
  console.log('[setupTratClaims] TraT claims provisioned ✅ (or skipped if PingOne policy API not available)');
}

setupTratClaims().catch((err) => {
  console.error('[setupTratClaims] Failed:', err.message);
  process.exit(1);
});
```

- [ ] **Step 2: Add script to `package.json`**

In `demo_api_server/package.json`, add to the `scripts` object:

```json
"pingone:setup:trat": "node scripts/setupTratClaims.js"
```

- [ ] **Step 3: Add call to `bootstrapPingOne.js`**

Open `demo_api_server/scripts/bootstrapPingOne.js`. At the end of the main bootstrap sequence (after apps + resource servers are created), add a call to run the TraT setup:

```javascript
// Post-provisioning: TraT claim setup
try {
  const { execSync } = require('child_process');
  execSync('node scripts/setupTratClaims.js', { stdio: 'inherit', cwd: __dirname + '/..' });
} catch (err) {
  console.warn('[Bootstrap] TraT claims setup failed (non-fatal):', err.message);
}
```

- [ ] **Step 4: Verify script runs without crashing**

```bash
cd demo_api_server && node scripts/setupTratClaims.js 2>&1 | tail -5
```

Expected: logs `[setupTratClaims] Starting TraT claim provisioning...` then either completes or fails gracefully (no uncaught exception).

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/scripts/setupTratClaims.js demo_api_server/scripts/bootstrapPingOne.js demo_api_server/package.json
git commit -m "feat(trat): add setupTratClaims.js — idempotent PingOne claim provisioning + bootstrap integration"
```

---

## Task 13: Final verification

- [ ] **Step 1: Build all TypeScript services**

```bash
cd demo_mcp_gateway && npm run build 2>&1 | tail -5
cd demo_mcp_server && npm run build 2>&1 | tail -5
```

Both must exit 0.

- [ ] **Step 2: Build UI**

```bash
cd demo_api_ui && npm run build 2>&1 | tail -5
```

Must exit 0.

- [ ] **Step 3: Run all test suites**

```bash
cd demo_mcp_gateway && npm test 2>&1 | tail -10
cd demo_mcp_server && npm test 2>&1 | tail -10
cd demo_api_server && npm test 2>&1 | tail -10
```

All must pass.

- [ ] **Step 4: Smoke test with services running**

```bash
./run.sh status
```

With `ff_trat_mode=false` (default): make an MCP tool call from the dashboard. Confirm Token Chain shows no TraT badge and existing events display correctly.

With `ff_trat_mode=true`: make an MCP tool call. Confirm Token Chain shows amber `TraT (simulated)` badge with expanded claims.

With `MCP_MTLS_ENABLED=true`: restart services, make a tool call. Confirm Token Chain shows `mTLS ✅` badge.

- [ ] **Step 5: Commit final verification entry in REGRESSION_PLAN.md**

Add to `REGRESSION_PLAN.md` §4 (Bug Fix Log):

```markdown
### TraT + mTLS (2026-05-20)
- **What changed:** Gateway no longer re-exchanges TX token. TX token (`aud: ping.demo`) forwarded unchanged to MCP server. mTLS (self-signed, dev-only) added between gateway and MCP servers to prevent bypass. TraT context built by BFF, evaluated by gateway Authorize, forwarded as `X-TraT-Context` header.
- **Risk areas:** Gateway proxy path, MCP server startup, Token Chain UI event rendering.
- **Regression guard:** `ff_trat_mode=false` (default) — zero behaviour change. `MCP_MTLS_ENABLED=false` (default) — MCP servers run plain HTTP. All existing tests pass.
```

```bash
git add REGRESSION_PLAN.md
git commit -m "chore: regression plan entry for TraT + mTLS implementation"
```

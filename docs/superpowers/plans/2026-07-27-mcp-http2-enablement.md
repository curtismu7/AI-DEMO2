# MCP HTTP/2 Enablement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `demo_mcp_server` a second, TLS+ALPN listener on a new port so the existing (dormant) `http2McpBridge.js` gets real HTTP/2 instead of negotiating down to 1.1 — without touching the default `ws://` deployment path at all.

**Architecture:** `BankingMCPServer.startServer()` gains an opt-in third branch (`MCP_TLS_ENABLED=true`) that starts `http2.createSecureServer({ allowHTTP1: true, ALPNProtocols: ['h2','http/1.1'] })` on a new port (`MCP_TLS_PORT`, default `8443`), reusing the existing `handleHttpRequest` handler and a fresh self-signed cert. `http2McpBridge.js` gains `rejectUnauthorized: false` for `https:` targets. No BFF dispatch code changes — `mcpToolPipeline.js` already routes to the bridge whenever `MCP_SERVER_URL` starts with `http`.

**Tech Stack:** TypeScript 5 + Jest/ts-jest (`demo_mcp_server`); CommonJS + Jest (`demo_api_server`); Node `http2`/`https` core modules; `selfsigned` package (already a dependency).

## Global Constraints

- Design doc: `~/Documents/2026-07-27-mcp-http2-enablement-design.md` (outside the repo — read it for full rationale, not reproduced here).
- Zero behavior change to the default deployment. The existing `http.createServer` listener, its port, and the WebSocket server attached to it must be byte-for-byte unaffected regardless of whether `MCP_TLS_ENABLED` is set.
- `demo_mcp_server` build gate is `tsc` — a typing mismatch fails the build, not just a lint warning. `this.httpServer` is `HttpServer | null`; `http2.createSecureServer()` returns a different type and needs its own field.
- `demo_api_server` tests require `CI=true` (`CI=true npx jest ... --forceExit`) — without it supertest-adjacent suites flake.
- Worktree required for all edits (already in one: `.claude/worktrees/mcp-http2-enablement`, branch `worktree-mcp-http2-enablement`). Stage explicitly, never `git add -A` — `demo_api_server/data/**` gets rewritten by running its jest suite; restore it (`git checkout -- demo_api_server/data`) before every commit.
- Do not share cert generation between the `MCP_MTLS_ENABLED` branch and the new `MCP_TLS_ENABLED` branch — two independent `selfsignedGenerate()` calls, per the design doc's explicit decision.
- Verify any live/manual check on an **isolated** container (distinct name, joined to the compose network), never by repointing the running stack — the pattern already used for the AAM work.

---

## Task 1: TLS+ALPN listener in BankingMCPServer

**Files:**
- Modify: `demo_mcp_server/src/server/BankingMCPServer.ts:56-64` (fields, constructor), `:109-210` (`startServer`), `:217-256` (`stopServer`), `:1095-1101` (`cleanup`)
- Test: `demo_mcp_server/tests/server/BankingMCPServer.test.ts`

**Interfaces:**
- Consumes: `process.env.MCP_TLS_ENABLED` (`'true'` to enable), `process.env.MCP_TLS_PORT` (default `'8443'`).
- Produces: `server.getActualTlsPort(): number | null` (mirrors the existing `getActualPort()`), consumed by Task 1's own tests and by Task 3's manual verification. `server.isServerRunning()` and `stopServer()` continue to cover both listeners — no new public method needed for shutdown.

- [ ] **Step 1: Write the failing test — listener starts only when the flag is set**

Add to `demo_mcp_server/tests/server/BankingMCPServer.test.ts`, inside a new `describe` block after the existing `'Server Lifecycle'` block (after line 105):

```typescript
describe('TLS+ALPN listener (MCP_TLS_ENABLED)', () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('does not start a TLS listener by default', async () => {
    delete process.env.MCP_TLS_ENABLED;
    await server.startServer();
    expect(server.getActualTlsPort()).toBeNull();
  });

  it('starts a TLS listener on MCP_TLS_PORT when enabled', async () => {
    process.env.MCP_TLS_ENABLED = 'true';
    process.env.MCP_TLS_PORT = '0'; // random port, matches the plain listener's test pattern
    const tlsServer = new BankingMCPServer(config, mockAuthManager, mockSessionManager, mockToolProvider);

    await tlsServer.startServer();
    try {
      expect(tlsServer.getActualTlsPort()).not.toBeNull();
      expect(tlsServer.getActualTlsPort()).not.toBe(tlsServer.getActualPort());
    } finally {
      await tlsServer.stopServer();
    }
  });

  it('serves real HTTP/2 (ALPN h2) and falls back to HTTP/1.1 on the TLS port', async () => {
    process.env.MCP_TLS_ENABLED = 'true';
    process.env.MCP_TLS_PORT = '0';
    const tlsServer = new BankingMCPServer(config, mockAuthManager, mockSessionManager, mockToolProvider);
    await tlsServer.startServer();
    const port = tlsServer.getActualTlsPort();

    try {
      // HTTP/1.1 fallback
      const https = require('https');
      const h1Body: string = await new Promise((resolve, reject) => {
        https.get(
          { hostname: 'localhost', port, path: '/health', rejectUnauthorized: false },
          (res: any) => {
            let body = '';
            res.on('data', (c: Buffer) => (body += c));
            res.on('end', () => resolve(body));
          },
        ).on('error', reject);
      });
      expect(h1Body).toBeTruthy();

      // Real HTTP/2
      const http2 = require('http2');
      const client = http2.connect(`https://localhost:${port}`, { rejectUnauthorized: false });
      const alpn: string = await new Promise((resolve, reject) => {
        client.on('error', reject);
        const req = client.request({ ':path': '/health' });
        req.on('response', () => resolve(client.alpnProtocol));
        req.on('error', reject);
        req.end();
      });
      client.close();
      expect(alpn).toBe('h2');
    } finally {
      await tlsServer.stopServer();
    }
  });

  it('leaves the default ws:// listener on the original port unaffected when TLS is enabled', async () => {
    process.env.MCP_TLS_ENABLED = 'true';
    process.env.MCP_TLS_PORT = '0';
    const tlsServer = new BankingMCPServer(config, mockAuthManager, mockSessionManager, mockToolProvider);
    await tlsServer.startServer();

    try {
      const plainPort = tlsServer.getActualPort();
      const ws = new WebSocket(`ws://localhost:${plainPort}`);
      await new Promise((resolve, reject) => {
        ws.once('open', resolve);
        ws.once('error', reject);
      });
      ws.close();
    } finally {
      await tlsServer.stopServer();
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd demo_mcp_server && npx jest tests/server/BankingMCPServer.test.ts -t "TLS"`
Expected: FAIL — `getActualTlsPort is not a function`.

- [ ] **Step 3: Add the field and import**

In `demo_mcp_server/src/server/BankingMCPServer.ts`, near the top imports (around line 7-8, beside the existing `http`/`https` imports):

```typescript
import * as http2 from 'http2';
```

Near the existing field declarations (around line 57-58):

```typescript
  private server: WebSocket.Server | null = null;
  private httpServer: HttpServer | null = null;
  private tlsServer: http2.Http2SecureServer | null = null;
```

- [ ] **Step 4: Start the TLS listener in `startServer()`**

In `startServer()`, after the existing `this.httpServer!.listen(...)` promise resolves (after line 187, before `this.isRunning = true;` at line 189) — the plain listener must be up first since the TLS branch does not gate the rest of startup:

```typescript
      // Second, TLS+ALPN listener — opt-in, additive. Does NOT replace or modify
      // the plain http.createServer listener above; ws:// on MCP_SERVER_PORT is
      // unaffected whether or not this branch runs.
      if (process.env.MCP_TLS_ENABLED === 'true') {
        const tlsPort = parseInt(process.env.MCP_TLS_PORT || '8443', 10);
        // Independent self-signed cert — NOT shared with the MCP_MTLS_ENABLED
        // branch above. Two unrelated concerns (peer-auth vs protocol
        // negotiation); sharing would couple them for no benefit.
        const notAfterDate = new Date();
        notAfterDate.setDate(notAfterDate.getDate() + 1);
        const tlsPems = await selfsignedGenerate(
          [{ name: 'commonName', value: 'banking-mcp-server-tls' }],
          { notAfterDate, keySize: 2048, algorithm: 'sha256' },
        );

        this.tlsServer = http2.createSecureServer(
          {
            key: tlsPems.private,
            cert: tlsPems.cert,
            allowHTTP1: true,
            ALPNProtocols: ['h2', 'http/1.1'],
          },
          (req, res) => {
            this.handleHttpRequest(req as any, res as any);
          },
        );

        await new Promise<void>((resolve, reject) => {
          this.tlsServer!.listen(tlsPort, this.config.host, (error?: Error) => {
            if (error) reject(error);
            else resolve();
          });
        });

        if (this.config.enableLogging) {
          const actualTlsPort = this.getActualTlsPort();
          console.log(`[BankingMCPServer] TLS+ALPN listener started on ${this.config.host}:${actualTlsPort} (h2)`);
        }
      }
```

`selfsignedGenerate` is already imported at the top of this file (used by the `MCP_MTLS_ENABLED` branch) — no new import needed for it.

- [ ] **Step 5: Add `getActualTlsPort()`**

Beside the existing `getActualPort()` (after line 497):

```typescript
  /**
   * Get the actual port the TLS+ALPN listener is bound to, or null if
   * MCP_TLS_ENABLED was not set (or the server isn't running).
   */
  getActualTlsPort(): number | null {
    if (!this.tlsServer || !this.isRunning) {
      return null;
    }

    const address = this.tlsServer.address();
    if (address && typeof address === 'object') {
      return address.port;
    }

    return null;
  }
```

- [ ] **Step 6: Close the TLS listener in `stopServer()` and `cleanup()`**

In `stopServer()`, after the existing "Close HTTP server" block (after line 244):

```typescript
      // Close TLS listener, if one was started
      if (this.tlsServer) {
        await new Promise<void>((resolve) => {
          this.tlsServer!.close(() => resolve());
        });
      }
```

In `cleanup()` (line 1095-1101), add the field reset:

```typescript
  private async cleanup(): Promise<void> {
    this.isRunning = false;
    this.connections.clear();
    this.server = null;
    this.httpServer = null;
    this.tlsServer = null;
    this.stats.activeConnections = 0;
  }
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cd demo_mcp_server && npx jest tests/server/BankingMCPServer.test.ts`
Expected: PASS, including the 4 new tests and all pre-existing ones (regression check — the plain listener's tests must still pass unchanged).

- [ ] **Step 8: Run the build gate**

Run: `cd demo_mcp_server && npm run build`
Expected: exit 0. This is the step that catches the `Http2SecureServer` vs `HttpServer` typing mismatch if Step 3's field declaration was skipped or wrong.

- [ ] **Step 9: Commit**

```bash
git add demo_mcp_server/src/server/BankingMCPServer.ts demo_mcp_server/tests/server/BankingMCPServer.test.ts
git commit -m "feat(mcp-server): opt-in TLS+ALPN listener for real HTTP/2"
```

---

## Task 2: Bridge trust for self-signed HTTPS

**Files:**
- Modify: `demo_api_server/services/http2McpBridge.js` (the `createHttp2Session` function, around line 55-65)
- Test: `demo_api_server/src/__tests__/http2McpBridge.test.js`

**Interfaces:**
- Consumes: nothing new — same `createHttp2Session(mcpServerUrl, bearerToken)` signature.
- Produces: nothing new — `http2.connect()` now receives `{ rejectUnauthorized: false }` for `https:` targets, in addition to the existing `{ allowHTTP1: true }` for `http:` targets. Task 3's manual verification depends on this to actually connect.

- [ ] **Step 1: Write the failing test**

Add to `demo_api_server/src/__tests__/http2McpBridge.test.js`, inside the existing `describe('createHttp2Session', ...)` block (after the "should create separate sessions for different URLs" test, around line 150):

```javascript
    it('should skip TLS verification for https:// targets (self-signed MCP server cert)', () => {
      const mockSession = createMockSession();
      mockSessions = [mockSession];

      createHttp2Session('https://mcp-server:8443', 'test-token-abc');

      expect(http2.connect).toHaveBeenCalledWith(
        'https://mcp-server:8443',
        expect.objectContaining({ rejectUnauthorized: false }),
      );
    });

    it('should NOT set rejectUnauthorized for http:// targets', () => {
      const mockSession = createMockSession();
      mockSessions = [mockSession];

      createHttp2Session('http://mcp-server:8080', 'test-token-abc');

      const [, options] = http2.connect.mock.calls[0];
      expect(options).not.toHaveProperty('rejectUnauthorized');
      expect(options.allowHTTP1).toBe(true);
    });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd demo_api_server && CI=true npx jest src/__tests__/http2McpBridge.test.js --forceExit`
Expected: FAIL — first new test's `toHaveBeenCalledWith` assertion fails because `options` is `{}` for `https:` today.

- [ ] **Step 3: Add the branch**

In `demo_api_server/services/http2McpBridge.js`, in `createHttp2Session` (around line 59-63):

```javascript
  const options = {};
  // For local development / self-signed certs: allow connecting over plain HTTP
  if (parsed.protocol === 'http:') {
    // Node http2 only speaks h2c (cleartext HTTP/2) via http2.connect with allowHTTP1
    options.allowHTTP1 = true;
  } else if (parsed.protocol === 'https:') {
    // Same-network internal hop to demo_mcp_server's self-signed TLS+ALPN
    // listener (MCP_TLS_ENABLED) — not a trust boundary. Matches PingGateway's
    // own local-dev requireHttps:false pattern.
    options.rejectUnauthorized = false;
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd demo_api_server && CI=true npx jest src/__tests__/http2McpBridge.test.js --forceExit`
Expected: PASS, all tests in the file (regression check on the pre-existing ones).

- [ ] **Step 5: Restore generated files, then commit**

```bash
git checkout -- demo_api_server/data 2>/dev/null || true
git add demo_api_server/services/http2McpBridge.js demo_api_server/src/__tests__/http2McpBridge.test.js
git commit -m "feat(mcp-server): trust the MCP server's self-signed TLS cert in the h2 bridge"
```

---

## Task 3: Compose wiring and live verification

**Files:**
- Modify: `docker-compose.yml` (the `mcp-server` service block, around line 291-330)

**Interfaces:**
- Consumes: Task 1's `MCP_TLS_ENABLED`/`MCP_TLS_PORT`, Task 2's bridge fix.
- Produces: nothing consumed downstream — this is the end-to-end proof.

- [ ] **Step 1: Add the new port and env vars**

In `docker-compose.yml`, in the `mcp-server` service's `ports:` block (around line 298-299):

```yaml
    ports:
      - "8080:8080"
      - "8443:8443"
```

In the same service's `environment:` block, near `MCP_SERVER_PORT` (around line 303):

```yaml
      # Opt-in TLS+ALPN listener for real HTTP/2 to the BFF's http2McpBridge.js.
      # Default off: when unset, no second port is bound, no cert is generated,
      # and the plain ws:// listener on MCP_SERVER_PORT is completely unaffected.
      MCP_TLS_ENABLED: "${MCP_TLS_ENABLED:-false}"
      MCP_TLS_PORT: "8443"
```

- [ ] **Step 2: Verify default-off behavior doesn't change on an isolated container**

```bash
cd /Users/cmuir/Development/AI-DEMO2
docker rm -f mcp-h2-verify 2>/dev/null
docker run -d --name mcp-h2-verify --network ai-demo_ai-demo \
  -p 18080:8080 \
  --env-file ./demo_mcp_server/.env \
  -e MCP_SERVER_HOST=0.0.0.0 -e MCP_SERVER_PORT=8080 \
  -e HTTP_MCP_TRANSPORT_ENABLED=true \
  $(docker build -q ./demo_mcp_server)
sleep 3
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:18080/health   # expect 200
docker logs mcp-h2-verify 2>&1 | grep -i "TLS+ALPN"                      # expect NOTHING
docker rm -f mcp-h2-verify
```

Expected: `200`, and no "TLS+ALPN listener started" log line — confirms the default path is untouched.

- [ ] **Step 3: Verify the TLS listener on an isolated container**

```bash
docker rm -f mcp-h2-verify 2>/dev/null
docker run -d --name mcp-h2-verify --network ai-demo_ai-demo \
  -p 18080:8080 -p 18443:8443 \
  --env-file ./demo_mcp_server/.env \
  -e MCP_SERVER_HOST=0.0.0.0 -e MCP_SERVER_PORT=8080 \
  -e HTTP_MCP_TRANSPORT_ENABLED=true \
  -e MCP_TLS_ENABLED=true -e MCP_TLS_PORT=8443 \
  $(docker build -q ./demo_mcp_server)
sleep 3
curl -s -o /dev/null -w "plain :8080 -> %{http_code}\n" http://localhost:18080/health
curl -sk -o /dev/null -w "tls   :8443 (h1 fallback) -> %{http_code}\n" https://localhost:18443/health
curl -sk --http2 -o /dev/null -w "tls   :8443 (h2) -> %{http_code} (%{http_version})\n" https://localhost:18443/health
docker rm -f mcp-h2-verify
```

Expected: `plain :8080 -> 200`; `tls :8443 (h1 fallback) -> 200`; `tls :8443 (h2) -> 200 (2)` — the `%{http_version}` of `2` is the proof this is negotiated ALPN h2, not a downgrade.

- [ ] **Step 4: End-to-end through the bridge**

Point a BFF instance's `MCP_SERVER_URL` at the isolated container's TLS port (`https://host.docker.internal:18443` or the equivalent compose-network address) and drive one real tool call through `mcpToolPipeline.js`, confirming `useHttp2` is true and `forwardToolCall` completes successfully. Use the same isolated-container discipline as Tasks above — do not repoint the running stack's `demo-api-server`.

- [ ] **Step 5: Commit**

```bash
git add docker-compose.yml
git commit -m "feat(mcp-server): wire MCP_TLS_ENABLED port in compose"
```

---

## Self-review

**Spec coverage.** Design doc sections map to tasks: "Separate port" architecture → Task 1 Steps 3-4; "Typing" note → Task 1 Step 3 (`tlsServer: Http2SecureServer`, not reusing `httpServer`'s type); "Cert generation NOT shared" → Task 1 Step 4 (independent `selfsignedGenerate` call); "Bridge trust" → Task 2; "Compose" → Task 3; "Two listeners, one process" risk → Task 1 Step 6 (`stopServer`/`cleanup` both updated). The design's "Health/readiness checks" risk is a documented non-action (no healthcheck added), not a task — correctly absent from the plan.

**Placeholders.** None — every step has real code, real file:line anchors taken from the actual files, not descriptions.

**Type consistency.** `getActualTlsPort()` name and `null`-when-not-running contract match `getActualPort()`'s existing shape exactly (Task 1 Steps 1 and 5). `MCP_TLS_ENABLED`/`MCP_TLS_PORT` names are identical across Task 1 (server reads them) and Task 3 (compose sets them) — no drift between the env var names the code checks and the ones compose declares.

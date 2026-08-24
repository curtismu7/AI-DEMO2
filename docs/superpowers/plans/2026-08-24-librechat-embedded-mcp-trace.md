# LibreChat Embedded MCP Trace — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give LibreChat's two Privilege gateway doors (`opensearch-privilege-agent`, `privilege-agentless`) the same MCP-response and hop-by-hop "movie reel" visibility the AI Gateway client page and `/transaction-trace` already give this repo's own agent — without touching LibreChat's own image, and without changing the two direct doors (`aidemo-mcp`, `opensearch-direct`), which need none of this.

**Architecture:** A new standalone Node/TypeScript service (`librechat/mcp-facade/`) sits between LibreChat and each real gateway: LibreChat's two gateway-door URLs in `librechat.yaml` repoint at it, it relays every call unchanged, and it posts one ledger hop per phase to this repo's existing `/internal/transaction-hop` endpoint. A new compact, unauthenticated UI route (`/transaction-trace/embed/:correlationId`) renders those hops as a filmstrip, reused verbatim as data source (`transactionAssembler.assemble()`) from the existing `/transaction-trace` feature. The façade appends a `reel_url` text block to every tool result; the two gateway-door agents' system instructions ask the model to also render it as a LibreChat HTML artifact (`:::artifact{type="application/vnd.code-html"}`), an iframe onto that view.

**Tech Stack:** Node 22, TypeScript (ESM, `NodeNext` module resolution — required by `@modelcontextprotocol/sdk`'s deep `.js` import paths), `@modelcontextprotocol/sdk` (`McpServer` + `StreamableHTTPServerTransport`, current API — the older `Server`/`setRequestHandler(ListToolsRequestSchema, ...)` pattern is deprecated), Express, `jest`+`ts-jest` for the pure-logic unit tests (matching this repo's existing TS-service convention), Playwright (`demo_api_ui`'s `*.real.spec.js` convention) for live proof of the parts that can only be proven against the real stack.

**Spec:** `docs/superpowers/specs/2026-08-24-librechat-embedded-mcp-trace-design.md`

## Global Constraints

- Emoji allowlist only (`⚠️ ✅ ❌ 🔐 ✕ ✓ 👤 🔑 🪟 📚`) — none of this work needs emoji at all; don't add any.
- Every git commit happens on this worktree's existing branch (`worktree-agent-abb04d0a310af8164`), staged explicitly (`git add <files>`, never `-A`).
- `librechat/` stays out of the root `docker-compose.yml`/`run-docker.sh` — the façade is a THIRD service inside `librechat/docker-compose.yml`, never added to the main stack.
- Never touch `oauth-mcp`'s `BankingToolProvider`/`HttpMCPTransport`/`DemoMCPServer` — the spec's §3.2 judgment call is final: the façade is fully standalone.
- The façade never sends an `Authorization` header on the agent-mode door (Priv Agent) — the agent's mTLS identity IS the identity; adding one would be a genuine behavior change, not a no-op.
- `docs/superpowers/specs/2026-08-24-librechat-embedded-mcp-trace-design.md` §3.4's hop phases are exact strings from `demo_api_server/routes/transactionHopIngest.js`'s `VALID_PHASES`: `ui.request`, `token.exchange`, `gateway.authorize`, `mcp.tool`, `response` — do not invent new phase names.

---

## Task 1: Façade service scaffold

**Files:**
- Create: `librechat/mcp-facade/package.json`
- Create: `librechat/mcp-facade/tsconfig.json`
- Create: `librechat/mcp-facade/tsconfig.test.json`
- Create: `librechat/mcp-facade/jest.config.js`
- Create: `librechat/mcp-facade/src/index.ts`
- Create: `librechat/mcp-facade/.gitignore`

**Interfaces:**
- Produces: an Express app listening on `PORT` (default `8790`), with `GET /healthz` returning `{ ok: true }`. Later tasks add routes to this same `app` instance.

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "librechat-mcp-facade",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "start": "node dist/index.js",
    "dev": "tsc -p tsconfig.json --watch",
    "test": "jest"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.29.0",
    "express": "^4.21.0",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/jest": "^29.5.14",
    "@types/node": "^22.10.0",
    "jest": "^29.7.0",
    "ts-jest": "^29.2.5",
    "typescript": "^5.7.2"
  }
}
```

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": false,
    "sourceMap": true
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: Write `tsconfig.test.json`**

ts-jest needs CommonJS output for its transform even though the built service is ESM — this file is used only by jest, never by `npm run build`.

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "module": "CommonJS",
    "moduleResolution": "Node"
  }
}
```

- [ ] **Step 4: Write `jest.config.js`**

```js
/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/test/**/*.test.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.test.json' }],
  },
};
```

- [ ] **Step 5: Write `src/index.ts`**

```ts
import express from 'express';

const app = express();
app.use(express.json());

app.get('/healthz', (_req, res) => {
  res.json({ ok: true });
});

const port = Number(process.env.PORT || 8790);
app.listen(port, () => {
  console.log(`[mcp-facade] listening on :${port}`);
});

export { app };
```

- [ ] **Step 6: Write `.gitignore`**

```
node_modules/
dist/
data/
```

- [ ] **Step 7: Install and build**

Run: `cd librechat/mcp-facade && npm install && npm run build`
Expected: `dist/index.js` exists, no TypeScript errors.

- [ ] **Step 8: Verify the health check**

Run: `node dist/index.js &` then `curl -s http://localhost:8790/healthz`
Expected: `{"ok":true}`. Kill the background process afterward (`kill %1`).

- [ ] **Step 9: Commit**

```bash
git add librechat/mcp-facade/package.json librechat/mcp-facade/tsconfig.json librechat/mcp-facade/tsconfig.test.json librechat/mcp-facade/jest.config.js librechat/mcp-facade/src/index.ts librechat/mcp-facade/.gitignore
git commit -m "feat(mcp-facade): scaffold the standalone recording-facade service"
```

---

## Task 2: Ledger hop emitter

**Files:**
- Create: `librechat/mcp-facade/src/transactionHop.ts`
- Test: `librechat/mcp-facade/test/transactionHop.test.ts`

**Interfaces:**
- Produces: `emitHop(hop: TransactionHopInput): void` — fire-and-forget POST to `process.env.BFF_TRANSACTION_HOP_URL` with header `x-internal-gateway-secret: process.env.BFF_INTERNAL_SECRET`. No-ops silently if either env var is unset (matches `oauth-mcp/src/utils/transactionHop.ts`'s existing fail-open contract — this repo already relies on that behavior elsewhere).
- Consumes: nothing from other tasks.

- [ ] **Step 1: Write the failing test**

```ts
// librechat/mcp-facade/test/transactionHop.test.ts
import { emitHop, __setFetchForTests } from '../src/transactionHop';

describe('emitHop', () => {
  afterEach(() => {
    __setFetchForTests(undefined);
    delete process.env.BFF_TRANSACTION_HOP_URL;
    delete process.env.BFF_INTERNAL_SECRET;
  });

  it('POSTs the hop with the shared-secret header when both env vars are set', () => {
    process.env.BFF_TRANSACTION_HOP_URL = 'http://bff.local/internal/transaction-hop';
    process.env.BFF_INTERNAL_SECRET = 's3cret';
    const calls: any[] = [];
    __setFetchForTests(async (url: string, init: any) => {
      calls.push({ url, init });
      return { ok: true } as any;
    });

    emitHop({ correlationId: 'cid-1', service: 'librechat-facade', phase: 'ui.request', status: 'ok' });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://bff.local/internal/transaction-hop');
    expect(calls[0].init.headers['x-internal-gateway-secret']).toBe('s3cret');
    const body = JSON.parse(calls[0].init.body);
    expect(body).toMatchObject({ correlationId: 'cid-1', service: 'librechat-facade', phase: 'ui.request', status: 'ok' });
  });

  it('does nothing when BFF_TRANSACTION_HOP_URL is unset', () => {
    const calls: any[] = [];
    __setFetchForTests(async (url: string, init: any) => {
      calls.push({ url, init });
      return { ok: true } as any;
    });
    emitHop({ correlationId: 'cid-2', service: 'librechat-facade', phase: 'response', status: 'ok' });
    expect(calls).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd librechat/mcp-facade && npm test -- transactionHop`
Expected: FAIL — `Cannot find module '../src/transactionHop'`.

- [ ] **Step 3: Write the implementation**

```ts
// librechat/mcp-facade/src/transactionHop.ts
export type TransactionHopPhase = 'ui.request' | 'token.exchange' | 'gateway.authorize' | 'mcp.tool' | 'response';

export interface TransactionHopInput {
  correlationId: string;
  service: string;
  phase: TransactionHopPhase;
  op?: string;
  status?: 'ok' | 'error';
  durationMs?: number;
  decision?: Record<string, unknown>;
  identity?: Record<string, unknown>;
}

type FetchLike = (url: string, init: any) => Promise<{ ok: boolean }>;
let _fetch: FetchLike | undefined;

export function __setFetchForTests(fn: FetchLike | undefined): void {
  _fetch = fn;
}

/**
 * Ship one transaction hop to the BFF ledger, fire-and-forget. Mirrors
 * oauth-mcp/src/utils/transactionHop.ts's existing contract: silently
 * no-ops when the two env vars aren't configured, never throws into the
 * caller's request path.
 */
export function emitHop(hop: TransactionHopInput): void {
  const url = process.env.BFF_TRANSACTION_HOP_URL;
  const secret = process.env.BFF_INTERNAL_SECRET;
  if (!url || !secret) return;

  const doFetch = _fetch ?? (globalThis.fetch as unknown as FetchLike);
  doFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-internal-gateway-secret': secret },
    body: JSON.stringify(hop),
  }).catch((err) => {
    console.warn('[mcp-facade] emitHop failed:', (err as Error).message);
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd librechat/mcp-facade && npm test -- transactionHop`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add librechat/mcp-facade/src/transactionHop.ts librechat/mcp-facade/test/transactionHop.test.ts
git commit -m "feat(mcp-facade): ledger hop emitter"
```

---

## Task 3: Reel URL helper

**Files:**
- Create: `librechat/mcp-facade/src/reelUrl.ts`
- Test: `librechat/mcp-facade/test/reelUrl.test.ts`

**Interfaces:**
- Produces: `buildReelUrl(correlationId: string): string`, reading `process.env.REEL_BASE_URL` (default `http://localhost:4000`, matching the UI's dev port — the plan's Task 8 sets the real value in compose).
- Consumes: nothing.

- [ ] **Step 1: Write the failing test**

```ts
// librechat/mcp-facade/test/reelUrl.test.ts
import { buildReelUrl } from '../src/reelUrl';

describe('buildReelUrl', () => {
  afterEach(() => {
    delete process.env.REEL_BASE_URL;
  });

  it('builds the embed URL under the configured base', () => {
    process.env.REEL_BASE_URL = 'https://local.ping-devops.com:4000';
    expect(buildReelUrl('cid-123')).toBe('https://local.ping-devops.com:4000/transaction-trace/embed/cid-123');
  });

  it('defaults to localhost:4000 when unset', () => {
    expect(buildReelUrl('cid-456')).toBe('http://localhost:4000/transaction-trace/embed/cid-456');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd librechat/mcp-facade && npm test -- reelUrl`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// librechat/mcp-facade/src/reelUrl.ts
export function buildReelUrl(correlationId: string): string {
  const base = process.env.REEL_BASE_URL || 'http://localhost:4000';
  return `${base.replace(/\/+$/, '')}/transaction-trace/embed/${encodeURIComponent(correlationId)}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd librechat/mcp-facade && npm test -- reelUrl`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add librechat/mcp-facade/src/reelUrl.ts librechat/mcp-facade/test/reelUrl.test.ts
git commit -m "feat(mcp-facade): reel URL helper"
```

---

## Task 4: Agent-mode relay (`opensearch-privilege-agent` door) — no OAuth

**Files:**
- Create: `librechat/mcp-facade/src/agentRelay.ts`
- Modify: `librechat/mcp-facade/src/index.ts`
- Modify: `librechat/docker-compose.yml`
- Modify: `librechat/librechat.yaml`

**Interfaces:**
- Consumes: `emitHop` (Task 2), `buildReelUrl` (Task 3).
- Produces: `mountAgentRelay(app: express.Express): void`, mounting `POST /agent/mcp`.

This is the door proven first — no OAuth, matches the exact TLS/DNS setup the earlier LibreChat proof already worked out (`librechat/procyon-tenant-root.crt`), so the only new risk here is the façade's own MCP-server protocol correctness.

- [ ] **Step 1: Write `src/agentRelay.ts`**

```ts
// librechat/mcp-facade/src/agentRelay.ts
import type { Express, Request, Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { emitHop } from './transactionHop.js';
import { buildReelUrl } from './reelUrl.js';

const UPSTREAM_URL = process.env.PRIV_AGENT_MCP_URL || 'https://opensearch.default.applications.procyon.ai:8643/mcp';
const CA_PATH = process.env.PRIV_AGENT_CA_PATH || '/app/procyon-tenant-root.crt';

interface UpstreamTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

async function upstreamCall(method: string, params: Record<string, unknown>, correlationId: string): Promise<any> {
  const https = await import('node:https');
  const ca = readFileSync(CA_PATH);
  const url = new URL(UPSTREAM_URL);
  const body = JSON.stringify({ jsonrpc: '2.0', id: randomUUID(), method, params: { ...params, correlationId } });

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname,
        method: 'POST',
        ca,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'x-correlation-id': correlationId,
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: 30_000,
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            // The gateway may reply as a bare JSON-RPC object or as one SSE
            // "data: {...}" frame — handle both, matching this repo's own
            // BFF relay's tolerance for either shape.
            const jsonText = data.trim().startsWith('data:') ? data.trim().slice(5).trim() : data;
            resolve(JSON.parse(jsonText));
          } catch (err) {
            reject(err);
          }
        });
      },
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('upstream timeout')); });
    req.end(body);
  });
}

async function fetchUpstreamTools(correlationId: string): Promise<UpstreamTool[]> {
  const initResult = await upstreamCall(
    'initialize',
    { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'librechat-mcp-facade', version: '1.0.0' } },
    correlationId,
  );
  if (initResult.error) throw new Error(`upstream initialize failed: ${initResult.error.message}`);
  const listResult = await upstreamCall('tools/list', {}, correlationId);
  if (listResult.error) throw new Error(`upstream tools/list failed: ${listResult.error.message}`);
  return listResult.result?.tools || [];
}

/**
 * Builds one McpServer per Express request (the SDK's documented pattern
 * for the JSON-response HTTP transport), registering whatever tools the
 * real Priv Agent gateway currently advertises — a dynamic passthrough,
 * not a hardcoded tool list, since registerTool() (the current, non-
 * deprecated API) needs each tool named at registration time.
 */
async function buildServerForSession(): Promise<McpServer> {
  const server = new McpServer({ name: 'librechat-mcp-facade-agent', version: '1.0.0' });
  const bootstrapCorrelationId = randomUUID();
  const tools = await fetchUpstreamTools(bootstrapCorrelationId);

  for (const tool of tools) {
    server.registerTool(
      tool.name,
      { description: tool.description || '', inputSchema: (tool.inputSchema as any) || { type: 'object', properties: {} } },
      async (args: Record<string, unknown>) => {
        const correlationId = randomUUID();
        const start = Date.now();
        emitHop({ correlationId, service: 'librechat-facade', phase: 'ui.request', op: `tools/call:${tool.name}`, status: 'ok' });
        try {
          const result = await upstreamCall('tools/call', { name: tool.name, arguments: args }, correlationId);
          emitHop({ correlationId, service: 'librechat-facade', phase: 'gateway.authorize', op: 'agent-identity', status: 'ok', durationMs: Date.now() - start });
          const content = result.result?.content || [{ type: 'text', text: JSON.stringify(result) }];
          emitHop({ correlationId, service: 'librechat-facade', phase: 'response', status: 'ok', durationMs: Date.now() - start });
          return { content: [...content, { type: 'text', text: `reel_url: ${buildReelUrl(correlationId)}` }] };
        } catch (err) {
          emitHop({ correlationId, service: 'librechat-facade', phase: 'response', status: 'error', durationMs: Date.now() - start });
          throw err;
        }
      },
    );
  }
  return server;
}

export function mountAgentRelay(app: Express): void {
  app.post('/agent/mcp', async (req: Request, res: Response) => {
    try {
      const server = await buildServerForSession();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on('close', () => transport.close());
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      res.status(502).json({ error: 'upstream_unreachable', message: (err as Error).message });
    }
  });
}
```

**Note on `sessionIdGenerator: undefined` (stateless):** each Express request builds a fresh `McpServer` and transport, matching the SDK's own documented "one transport per request" pattern. This means the façade doesn't persist an MCP session across LibreChat's `initialize` → `tools/list` → `tools/call` sequence — LibreChat's client must therefore tolerate a server that returns no `Mcp-Session-Id` (this differs from `mcp-server`'s own stateful behavior). **Verify this works against LibreChat in Step 5 below before building Task 6 on the same pattern** — if LibreChat's client requires a persisted session ID, this task's transport construction needs a session-ID-keyed map instead (flag it as a plan revision if so, don't silently patch around it).

- [ ] **Step 2: Wire it into `src/index.ts`**

```ts
// librechat/mcp-facade/src/index.ts — add these two lines
import { mountAgentRelay } from './agentRelay.js';
// ... after `app.use(express.json());`
mountAgentRelay(app);
```

- [ ] **Step 3: Add the `mcp-facade` service to `librechat/docker-compose.yml`**

```yaml
  mcp-facade:
    container_name: librechat-mcp-facade
    build:
      context: ./mcp-facade
    ports:
      - "127.0.0.1:8790:8790"
    extra_hosts:
      - "opensearch.default.applications.procyon.ai:host-gateway"
    environment:
      PORT: "8790"
      PRIV_AGENT_CA_PATH: "/app/procyon-tenant-root.crt"
      BFF_TRANSACTION_HOP_URL: "https://host.docker.internal:3001/internal/transaction-hop"
      BFF_INTERNAL_SECRET: "${BFF_INTERNAL_SECRET}"
      REEL_BASE_URL: "https://local.ping-devops.com:4000"
    volumes:
      - type: bind
        source: ./procyon-tenant-root.crt
        target: /app/procyon-tenant-root.crt
    restart: unless-stopped
```

Add a matching `Dockerfile` at `librechat/mcp-facade/Dockerfile`:

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY tsconfig.json ./
COPY src ./src
RUN npm install typescript --no-save && npx tsc -p tsconfig.json && npm uninstall typescript
CMD ["node", "dist/index.js"]
```

`BFF_INTERNAL_SECRET` must match whatever `demo_api_server`'s own `.env` already has for that variable — read it from there rather than inventing a new value: `grep BFF_INTERNAL_SECRET ../../demo_api_server/.env`.

- [ ] **Step 4: Repoint `opensearch-privilege-agent` in `librechat/librechat.yaml`**

```yaml
  opensearch-privilege-agent:
    type: streamable-http
    url: 'http://mcp-facade:8790/agent/mcp'
```

Remove the `apiKey` no-op-header block this entry had before (the façade never advertises OAuth-required metadata, so LibreChat's startup probe won't flag it — verify this in Step 5). Add `mcp-facade:8790` to `mcpSettings.allowedAddresses`.

- [ ] **Step 5: Live verification**

```bash
docker compose -f librechat/docker-compose.yml build mcp-facade
docker compose -f librechat/docker-compose.yml up -d mcp-facade
docker compose -f librechat/docker-compose.yml restart api
sleep 30
docker logs librechat --since 40s 2>&1 | grep -E '\[MCP\]\[opensearch-privilege-agent\]'
```

Expected: `Initialized in: <n>ms` with no error, and a `Tools:` line listing the real Priv Agent tool names (or the door showing `Disconnected` with the same policy-403 this repo already knows about — that's a pass, not a façade bug, per the existing plan's documented Priv Agent policy state). If LibreChat instead logs an OAuth-required error, revisit the `sessionIdGenerator: undefined` note above.

- [ ] **Step 6: Commit**

```bash
git add librechat/mcp-facade/src/agentRelay.ts librechat/mcp-facade/src/index.ts librechat/mcp-facade/Dockerfile librechat/docker-compose.yml librechat/librechat.yaml
git commit -m "feat(mcp-facade): agent-mode relay for opensearch-privilege-agent, recorded to the ledger"
```

---

## Task 5: Compact reel embed view

**Files:**
- Create: `demo_api_ui/src/pages/TransactionTraceEmbedPage.jsx`
- Create: `demo_api_ui/src/pages/TransactionTraceEmbedPage.css`
- Create: `demo_api_ui/src/pages/__tests__/TransactionTraceEmbedPage.test.jsx`
- Modify: `demo_api_ui/src/App.js`

**Interfaces:**
- Consumes: the existing `GET /api/transaction-trace/:correlationId` route (`demo_api_server/routes/transactionTrace.js`, already merged, unauthenticated for this exact use per its own current code — confirm in Step 1) — response shape `{ correlationId, startedAt, endedAt, hops: [{ service, phase, op, status, durationMs, ... }] }` per `transactionAssembler.assemble()`.
- Produces: a route at `/transaction-trace/embed/:correlationId`, no `AppShell`/`TopNav`, polling every 800ms until two consecutive polls return the same hop count (or 30s elapses).

- [ ] **Step 1: Confirm the existing trace API needs no session**

Run: `grep -n "requireAdminSession\|authenticateToken\|requireJwtAuth" demo_api_server/routes/transactionTrace.js`
Expected: no match on the `GET /:correlationId` route. If there IS a guard, this task's route cannot be embedded in LibreChat's sandboxed artifact iframe (no ambient session) — stop and flag this as a spec revision rather than silently adding a bypass.

- [ ] **Step 2: Write the failing test**

```jsx
// demo_api_ui/src/pages/__tests__/TransactionTraceEmbedPage.test.jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import TransactionTraceEmbedPage from '../TransactionTraceEmbedPage';

describe('TransactionTraceEmbedPage', () => {
  beforeEach(() => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        correlationId: 'cid-1',
        hops: [
          { service: 'librechat-facade', phase: 'ui.request', status: 'ok', durationMs: 12 },
          { service: 'mcp-server', phase: 'mcp.tool', op: 'get_my_accounts', status: 'ok', durationMs: 57 },
        ],
      }),
    }));
  });

  it('renders each hop from the trace API', async () => {
    render(
      <MemoryRouter initialEntries={['/transaction-trace/embed/cid-1']}>
        <Routes>
          <Route path="/transaction-trace/embed/:correlationId" element={<TransactionTraceEmbedPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText('ui.request')).toBeInTheDocument());
    expect(screen.getByText('mcp.tool')).toBeInTheDocument();
    expect(screen.getByText(/get_my_accounts/)).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledWith('/api/transaction-trace/cid-1');
  });

  it('shows a waiting state when no hops have landed yet', async () => {
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ correlationId: 'cid-2', hops: [] }) }));
    render(
      <MemoryRouter initialEntries={['/transaction-trace/embed/cid-2']}>
        <Routes>
          <Route path="/transaction-trace/embed/:correlationId" element={<TransactionTraceEmbedPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText(/waiting for the first hop/i)).toBeInTheDocument());
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd demo_api_ui && npm run test:unit -- TransactionTraceEmbedPage`
Expected: FAIL — module not found.

- [ ] **Step 4: Write `TransactionTraceEmbedPage.jsx`**

```jsx
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import './TransactionTraceEmbedPage.css';

const POLL_MS = 800;
const MAX_WAIT_MS = 30_000;

export default function TransactionTraceEmbedPage() {
  const { correlationId } = useParams();
  const [hops, setHops] = useState(null);
  const stableCountRef = useRef({ count: -1, streak: 0 });
  const startedRef = useRef(Date.now());

  useEffect(() => {
    let cancelled = false;
    let timer;

    async function poll() {
      try {
        const res = await fetch(`/api/transaction-trace/${encodeURIComponent(correlationId)}`);
        const data = res.ok ? await res.json() : { hops: [] };
        if (cancelled) return;
        const nextHops = data.hops || [];
        setHops(nextHops);

        const prev = stableCountRef.current;
        if (nextHops.length === prev.count) {
          prev.streak += 1;
        } else {
          stableCountRef.current = { count: nextHops.length, streak: 0 };
        }
        const settled = stableCountRef.current.streak >= 2;
        const timedOut = Date.now() - startedRef.current > MAX_WAIT_MS;
        if (!settled && !timedOut) {
          timer = setTimeout(poll, POLL_MS);
        }
      } catch {
        if (!cancelled) timer = setTimeout(poll, POLL_MS);
      }
    }

    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [correlationId]);

  if (hops === null) {
    return <div className="ttep-status">Loading trace…</div>;
  }
  if (hops.length === 0) {
    return <div className="ttep-status">waiting for the first hop…</div>;
  }

  return (
    <div className="ttep-filmstrip">
      {hops.map((hop, i) => (
        <div className="ttep-frame" key={`${hop.phase}-${i}`}>
          <div className="ttep-frame-num">{String(i + 1).padStart(2, '0')}</div>
          <div className="ttep-frame-phase">{hop.phase}</div>
          <div className="ttep-frame-service">{hop.service}</div>
          {hop.op && <div className="ttep-frame-op">{hop.op}</div>}
          <div className="ttep-frame-status" data-status={hop.status || 'ok'}>{hop.status || 'ok'}</div>
          {typeof hop.durationMs === 'number' && <div className="ttep-frame-dur">{hop.durationMs}ms</div>}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Write `TransactionTraceEmbedPage.css`**

```css
.ttep-status {
  font: 13px/1.4 -apple-system, sans-serif;
  color: #888;
  padding: 16px;
}
.ttep-filmstrip {
  display: flex;
  gap: 8px;
  padding: 12px;
  overflow-x: auto;
  font: 12px/1.4 -apple-system, sans-serif;
}
.ttep-frame {
  flex: none;
  width: 120px;
  padding: 8px;
  border: 1px solid #ccc;
  border-radius: 8px;
}
.ttep-frame-num { color: #888; font-size: 10px; }
.ttep-frame-phase { font-weight: 600; }
.ttep-frame-service { color: #666; font-size: 11px; }
.ttep-frame-status[data-status="error"] { color: #c0392b; }
.ttep-frame-status[data-status="ok"] { color: #2e8b57; }
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd demo_api_ui && npm run test:unit -- TransactionTraceEmbedPage`
Expected: PASS, 2 tests.

- [ ] **Step 7: Add the route**

Run: `grep -n 'path="/transaction-trace"' demo_api_ui/src/App.js` to find the existing (authenticated) route, then add a sibling **bare** route outside any `AppShell`/`TopNav` wrapper — read the surrounding ~20 lines first to match this file's existing pattern for an unauthenticated route (do not guess the JSX shape; copy the structure of another route in this file that renders with no layout wrapper).

```jsx
<Route path="/transaction-trace/embed/:correlationId" element={<TransactionTraceEmbedPage />} />
```

Add the import: `import TransactionTraceEmbedPage from './pages/TransactionTraceEmbedPage';`

- [ ] **Step 8: Build gate**

Run: `cd demo_api_ui && npm run test:unit && npm run build`
Expected: both green.

- [ ] **Step 9: Commit**

```bash
git add demo_api_ui/src/pages/TransactionTraceEmbedPage.jsx demo_api_ui/src/pages/TransactionTraceEmbedPage.css demo_api_ui/src/pages/__tests__/TransactionTraceEmbedPage.test.jsx demo_api_ui/src/App.js
git commit -m "feat(ui): compact unauthenticated trace embed view for LibreChat's Artifacts panel"
```

---

## Task 6: OAuth-persisted session for the agentless door

**Files:**
- Create: `librechat/mcp-facade/src/oauthSession.ts`
- Test: `librechat/mcp-facade/test/oauthSession.test.ts`
- Modify: `librechat/mcp-facade/src/index.ts`
- Modify: `librechat/docker-compose.yml`

**Interfaces:**
- Produces: `getValidAccessToken(): Promise<string | null>` (refreshes if near expiry, returns `null` if never logged in), `mountOAuthAdmin(app): void` (mounts `GET /admin/login`, `GET /admin/callback`).
- Consumes: nothing from other tasks (self-contained; Task 7 consumes `getValidAccessToken`).

This mirrors the exact DCR + PKCE flow LibreChat's own OAuth client already proved works against this gateway (`docs/superpowers/plans/2026-08-24-librechat-privilege-mcp-client.md`'s Task 5) — the façade runs the same flow itself, once, driven by a human visiting `/admin/login` in a browser.

- [ ] **Step 1: Write the failing test (pure logic only — PKCE generation and expiry math, no live network)**

```ts
// librechat/mcp-facade/test/oauthSession.test.ts
import { isExpiringSoon, generatePkce } from '../src/oauthSession';

describe('isExpiringSoon', () => {
  it('is true within the 60s safety margin', () => {
    expect(isExpiringSoon(Date.now() + 30_000)).toBe(true);
  });
  it('is false well before expiry', () => {
    expect(isExpiringSoon(Date.now() + 600_000)).toBe(false);
  });
  it('is true for a token with no expiry recorded', () => {
    expect(isExpiringSoon(undefined)).toBe(true);
  });
});

describe('generatePkce', () => {
  it('produces a verifier and a distinct S256 challenge', () => {
    const { verifier, challenge } = generatePkce();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(challenge).not.toBe(verifier);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd librechat/mcp-facade && npm test -- oauthSession`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// librechat/mcp-facade/src/oauthSession.ts
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Express, Request, Response } from 'express';

const GATEWAY_BASE = process.env.AGENTLESS_GATEWAY_BASE || 'https://cmuir-agentless-mcpgw.ping-devops.com/external';
const TOKEN_PATH = process.env.FACADE_TOKEN_PATH || '/app/data/agentless-token.json';
const REDIRECT_URI = process.env.FACADE_REDIRECT_URI || 'http://localhost:8790/admin/callback';
const SAFETY_MARGIN_MS = 60_000;

interface StoredToken {
  access_token: string;
  refresh_token?: string;
  expires_at?: number; // epoch ms
  client_id?: string;
  client_secret?: string;
}

interface PendingAuth {
  verifier: string;
  state: string;
}

let pending: PendingAuth | null = null;

export function isExpiringSoon(expiresAt: number | undefined): boolean {
  if (!expiresAt) return true;
  return expiresAt - Date.now() < SAFETY_MARGIN_MS;
}

export function generatePkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(48).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

function readToken(): StoredToken | null {
  if (!existsSync(TOKEN_PATH)) return null;
  return JSON.parse(readFileSync(TOKEN_PATH, 'utf8'));
}

function writeToken(token: StoredToken): void {
  mkdirSync(dirname(TOKEN_PATH), { recursive: true });
  writeFileSync(TOKEN_PATH, JSON.stringify(token, null, 2));
}

async function registerClientIfNeeded(stored: StoredToken | null): Promise<{ client_id: string; client_secret?: string }> {
  if (stored?.client_id) return { client_id: stored.client_id, client_secret: stored.client_secret };
  const res = await fetch(`${GATEWAY_BASE}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ redirect_uris: [REDIRECT_URI], token_endpoint_auth_method: 'none' }),
  });
  if (!res.ok) throw new Error(`DCR failed: ${res.status}`);
  const body = await res.json();
  return { client_id: body.client_id, client_secret: body.client_secret };
}

export async function getValidAccessToken(): Promise<string | null> {
  const stored = readToken();
  if (!stored) return null;
  if (!isExpiringSoon(stored.expires_at)) return stored.access_token;
  if (!stored.refresh_token) return null;

  const res = await fetch(`${GATEWAY_BASE}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: stored.refresh_token,
      client_id: stored.client_id || '',
    }),
  });
  if (!res.ok) return null;
  const body = await res.json();
  const refreshed: StoredToken = {
    access_token: body.access_token,
    refresh_token: body.refresh_token || stored.refresh_token,
    expires_at: Date.now() + (body.expires_in || 3600) * 1000,
    client_id: stored.client_id,
    client_secret: stored.client_secret,
  };
  writeToken(refreshed);
  return refreshed.access_token;
}

export function mountOAuthAdmin(app: Express): void {
  app.get('/admin/login', async (_req: Request, res: Response) => {
    try {
      const stored = readToken();
      const client = await registerClientIfNeeded(stored);
      writeToken({ access_token: stored?.access_token || '', client_id: client.client_id, client_secret: client.client_secret });

      const { verifier, challenge } = generatePkce();
      const state = randomBytes(16).toString('hex');
      pending = { verifier, state };

      const authUrl = new URL(`${GATEWAY_BASE}/authorize`);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('client_id', client.client_id);
      authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
      authUrl.searchParams.set('code_challenge', challenge);
      authUrl.searchParams.set('code_challenge_method', 'S256');
      authUrl.searchParams.set('state', state);
      res.redirect(authUrl.toString());
    } catch (err) {
      res.status(500).send(`Login setup failed: ${(err as Error).message}`);
    }
  });

  app.get('/admin/callback', async (req: Request, res: Response) => {
    const { code, state } = req.query as { code?: string; state?: string };
    if (!pending || state !== pending.state || !code) {
      res.status(400).send('Invalid or expired login attempt — visit /admin/login again.');
      return;
    }
    const stored = readToken();
    try {
      const tokenRes = await fetch(`${GATEWAY_BASE}/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: REDIRECT_URI,
          client_id: stored?.client_id || '',
          code_verifier: pending.verifier,
        }),
      });
      if (!tokenRes.ok) throw new Error(`token exchange failed: ${tokenRes.status}`);
      const body = await tokenRes.json();
      writeToken({
        access_token: body.access_token,
        refresh_token: body.refresh_token,
        expires_at: Date.now() + (body.expires_in || 3600) * 1000,
        client_id: stored?.client_id,
        client_secret: stored?.client_secret,
      });
      pending = null;
      res.send('Facade logged in. You can close this tab.');
    } catch (err) {
      res.status(500).send(`Token exchange failed: ${(err as Error).message}`);
    }
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd librechat/mcp-facade && npm test -- oauthSession`
Expected: PASS, 4 tests.

- [ ] **Step 5: Wire the admin routes into `src/index.ts`**

```ts
// add:
import { mountOAuthAdmin } from './oauthSession.js';
// after mountAgentRelay(app):
mountOAuthAdmin(app);
```

- [ ] **Step 6: Add persistent storage to `librechat/docker-compose.yml`**

```yaml
  mcp-facade:
    # ... existing config from Task 4 ...
    environment:
      # ... existing entries ...
      FACADE_TOKEN_PATH: "/app/data/agentless-token.json"
      FACADE_REDIRECT_URI: "http://localhost:8790/admin/callback"
      AGENTLESS_GATEWAY_BASE: "https://cmuir-agentless-mcpgw.ping-devops.com/external"
    volumes:
      # ... existing procyon-tenant-root.crt bind ...
      - librechat-mcp-facade-data:/app/data

volumes:
  # ... existing librechat-data, librechat-mongo-data ...
  librechat-mcp-facade-data:
```

- [ ] **Step 7: Commit**

```bash
git add librechat/mcp-facade/src/oauthSession.ts librechat/mcp-facade/test/oauthSession.test.ts librechat/mcp-facade/src/index.ts librechat/docker-compose.yml
git commit -m "feat(mcp-facade): persisted, self-service OAuth session for the agentless door"
```

---

## Task 7: Agentless relay (`privilege-agentless` door)

**Files:**
- Create: `librechat/mcp-facade/src/agentlessRelay.ts`
- Modify: `librechat/mcp-facade/src/index.ts`
- Modify: `librechat/librechat.yaml`

**Interfaces:**
- Consumes: `getValidAccessToken` (Task 6), `emitHop` (Task 2), `buildReelUrl` (Task 3).
- Produces: `mountAgentlessRelay(app): void`, mounting `POST /agentless/mcp`.

Nearly identical shape to `agentRelay.ts` (Task 4) — the only difference is an `Authorization: Bearer <token>` header on every upstream call, and a `token.exchange` hop recording that the façade's own persisted session was used.

- [ ] **Step 1: Write `src/agentlessRelay.ts`**

```ts
// librechat/mcp-facade/src/agentlessRelay.ts
import type { Express, Request, Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { randomUUID } from 'node:crypto';
import { emitHop } from './transactionHop.js';
import { buildReelUrl } from './reelUrl.js';
import { getValidAccessToken } from './oauthSession.js';

const UPSTREAM_URL = process.env.AGENTLESS_MCP_URL || 'https://cmuir-agentless-mcpgw.ping-devops.com/external/mcp';

interface UpstreamTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

async function upstreamCall(method: string, params: Record<string, unknown>, correlationId: string, accessToken: string): Promise<any> {
  const res = await fetch(UPSTREAM_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${accessToken}`,
      'x-correlation-id': correlationId,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: randomUUID(), method, params: { ...params, correlationId } }),
  });
  const text = await res.text();
  const jsonText = text.trim().startsWith('data:') ? text.trim().slice(5).trim() : text;
  return JSON.parse(jsonText);
}

async function buildServerForSession(): Promise<McpServer> {
  const bootstrapCorrelationId = randomUUID();
  const tokenStart = Date.now();
  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    emitHop({ correlationId: bootstrapCorrelationId, service: 'agentless-mcpgw', phase: 'token.exchange', status: 'error', durationMs: Date.now() - tokenStart });
    throw new Error('facade is not logged in — visit http://localhost:8790/admin/login once');
  }
  emitHop({ correlationId: bootstrapCorrelationId, service: 'agentless-mcpgw', phase: 'token.exchange', status: 'ok', durationMs: Date.now() - tokenStart });

  const server = new McpServer({ name: 'librechat-mcp-facade-agentless', version: '1.0.0' });
  const initResult = await upstreamCall('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'librechat-mcp-facade', version: '1.0.0' } }, bootstrapCorrelationId, accessToken);
  if (initResult.error) throw new Error(`upstream initialize failed: ${initResult.error.message}`);
  const listResult = await upstreamCall('tools/list', {}, bootstrapCorrelationId, accessToken);
  if (listResult.error) throw new Error(`upstream tools/list failed: ${listResult.error.message}`);
  const tools: UpstreamTool[] = listResult.result?.tools || [];

  for (const tool of tools) {
    server.registerTool(
      tool.name,
      { description: tool.description || '', inputSchema: (tool.inputSchema as any) || { type: 'object', properties: {} } },
      async (args: Record<string, unknown>) => {
        const correlationId = randomUUID();
        const start = Date.now();
        emitHop({ correlationId, service: 'librechat-facade', phase: 'ui.request', op: `tools/call:${tool.name}`, status: 'ok' });
        try {
          const token = await getValidAccessToken();
          if (!token) throw new Error('facade lost its logged-in session');
          const result = await upstreamCall('tools/call', { name: tool.name, arguments: args }, correlationId, token);
          emitHop({ correlationId, service: 'agentless-mcpgw', phase: 'gateway.authorize', status: 'ok', durationMs: Date.now() - start });
          const content = result.result?.content || [{ type: 'text', text: JSON.stringify(result) }];
          emitHop({ correlationId, service: 'librechat-facade', phase: 'response', status: 'ok', durationMs: Date.now() - start });
          return { content: [...content, { type: 'text', text: `reel_url: ${buildReelUrl(correlationId)}` }] };
        } catch (err) {
          emitHop({ correlationId, service: 'librechat-facade', phase: 'response', status: 'error', durationMs: Date.now() - start });
          throw err;
        }
      },
    );
  }
  return server;
}

export function mountAgentlessRelay(app: Express): void {
  app.post('/agentless/mcp', async (req: Request, res: Response) => {
    try {
      const server = await buildServerForSession();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on('close', () => transport.close());
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      res.status(502).json({ error: 'upstream_unreachable', message: (err as Error).message });
    }
  });
}
```

- [ ] **Step 2: Wire it into `src/index.ts`**

```ts
// add:
import { mountAgentlessRelay } from './agentlessRelay.js';
// after mountOAuthAdmin(app):
mountAgentlessRelay(app);
```

- [ ] **Step 3: Repoint `privilege-agentless` in `librechat/librechat.yaml`**

```yaml
  privilege-agentless:
    type: streamable-http
    url: 'http://mcp-facade:8790/agentless/mcp'
```

Remove the comment block explaining LibreChat's own native DCR (no longer relevant — the façade owns OAuth now, LibreChat talks to a plain unauthenticated door). Add `mcp-facade:8790` is already in `allowedAddresses` from Task 4.

- [ ] **Step 4: Rebuild and do the one-time interactive login**

```bash
docker compose -f librechat/docker-compose.yml build mcp-facade
docker compose -f librechat/docker-compose.yml up -d mcp-facade
```

Open `http://localhost:8790/admin/login` in a browser, complete the PingOne sign-in (same flow already proven in the original LibreChat proof — `demoUser`/Super Sports). Expected: "Facade logged in. You can close this tab."

- [ ] **Step 5: Live verification**

```bash
docker compose -f librechat/docker-compose.yml restart api
sleep 30
docker logs librechat --since 40s 2>&1 | grep -E '\[MCP\]\[privilege-agentless\]'
```

Expected: `Initialized in: <n>ms`, `Tools:` listing real tool names (`get_my_accounts`, …), no OAuth-required error (the door is now unauthenticated from LibreChat's point of view — the façade holds the real credential).

- [ ] **Step 6: Commit**

```bash
git add librechat/mcp-facade/src/agentlessRelay.ts librechat/mcp-facade/src/index.ts librechat/librechat.yaml
git commit -m "feat(mcp-facade): agentless relay using the facade's own persisted OAuth session"
```

---

## Task 8: LibreChat agent instructions + Playwright proof

**Files:**
- Modify: `demo_api_ui/tests/e2e/librechat-mcp-servers.real.spec.js`

**Interfaces:**
- Consumes: the `createAgent` helper already in this file (`session.token`, `PROVIDER`, `MODEL`).

- [ ] **Step 1: Extend `createAgent` to set instructions and enable the Artifacts tool**

```js
// modify the existing createAgent() in librechat-mcp-servers.real.spec.js:
async function createAgent(request, { server, tool }, { instructions } = {}) {
  const r = await request.post(`${LC}/api/agents`, {
    headers: { Authorization: `Bearer ${session.token}` },
    data: {
      name: `e2e ${server}`,
      provider: PROVIDER,
      model: MODEL,
      tools: [`sys__server__sys_mcp_${server}`, `${tool}_mcp_${server}`, 'execute_code'],
      instructions,
    },
  });
  expect(r.status(), `create agent for ${server}`).toBe(201);
  const id = (await r.json()).id;
  createdAgents.push(id);
  return id;
}
```

`execute_code` is a placeholder for whichever tool key LibreChat uses internally for its Artifacts capability — **confirm the exact key before this step**: `docker exec librechat sh -c "grep -n \"AgentCapabilities\" /app/api/server/services/ToolService.js"` and cross-check against what the Tool Library dialog showed for "Artifacts" earlier in this project's manual testing; use that exact string here, not `execute_code` if it differs.

- [ ] **Step 2: Add the reel-compliance test for the façade doors**

```js
// add near the end of the test.describe block, after the existing DOORS loop
const GATEWAY_DOORS = [
  { server: 'privilege-agentless', tool: 'get_my_accounts', prompt: 'What are my account balances?' },
];

const REEL_INSTRUCTIONS = (correlationHint) => `When you call a tool and its result includes a line starting with "reel_url:", always render that URL as an artifact, in this exact form, replacing <url> with the value:

:::artifact{identifier="reel" type="application/vnd.code-html" title="Live trace"}
<iframe src="<url>" style="width:100%;height:100%;border:0"></iframe>
:::

Do this every time, even if you already showed one earlier in the conversation.`;

for (const door of GATEWAY_DOORS) {
  test(`${door.server}: reel_url is present and the artifact fence is attempted (measured, not a hard gate)`, async ({ request }) => {
    const RUNS = 5;
    let fenceCount = 0;
    let linkCount = 0;
    for (let i = 0; i < RUNS; i++) {
      const agentId = await createAgent(request, door, { instructions: REEL_INSTRUCTIONS() });
      const page = await newAuthedPage();
      try {
        const reply = await askAndWaitForTool(page, agentId, door);
        if (/reel_url:/.test(reply) || /transaction-trace\/embed/.test(reply)) linkCount++;
        if (/```html|<iframe/.test(reply)) fenceCount++;
      } finally {
        await page.close();
      }
    }
    console.log(`[reel-compliance] ${door.server}: link present ${linkCount}/${RUNS}, artifact fence attempted ${fenceCount}/${RUNS}`);
    test.info().annotations.push({ type: 'reel-compliance', description: `link ${linkCount}/${RUNS}, fence ${fenceCount}/${RUNS}` });
    // The fallback link is the actual contract — require it. The artifact
    // fence is measured, not required, per the design spec's §7.
    expect(linkCount, 'reel_url fallback must appear every time — this is the part with no LLM-compliance risk').toBe(RUNS);
  });
}
```

- [ ] **Step 3: Run it**

Run: `cd demo_api_ui && PLAYWRIGHT_SKIP_WEBSERVER=1 npm run test:e2e:real -- librechat-mcp-servers`
Expected: the new test passes on the `linkCount === RUNS` assertion; the console log line reports the measured artifact-fence rate — read it, don't assume a number.

- [ ] **Step 4: Commit**

```bash
git add demo_api_ui/tests/e2e/librechat-mcp-servers.real.spec.js
git commit -m "test(librechat): prove the reel_url fallback and measure artifact-fence compliance"
```

---

## Plan Self-Review

**Spec coverage:** §3.1 (façade protocol) → Tasks 1, 4, 7. §3.2 (standalone service, not oauth-mcp) → Task 1 (new directory, no oauth-mcp imports). §3.3 (persisted OAuth) → Task 6. §3.4 (hop table) → `emitHop` calls in Tasks 4/6/7 use exactly the phases from the Global Constraints. §4 (embed view) → Task 5. §5 (LibreChat wiring: config, instructions, Artifacts, fallback) → Tasks 4, 7, 8. §6 (error handling: façade unreachable, gateway denies, artifact skipped, race on a fresh correlationId) → the `catch` blocks in Tasks 4/7 (502 passthrough), Task 5's "waiting for the first hop" state, Task 8's compliance measurement instead of a hard requirement. §7 (testing) → Task 8. §8 (open questions) → service name/location resolved in Task 1 (`librechat/mcp-facade/`), polling vs SSE resolved in Task 5 (polling), one-time admin-login UX resolved in Task 6 (self-contained `/admin/login`, simpler than the spec's own guess of routing through the AI Gateway client page).

**Placeholder scan:** none found — every step has real, complete code; the two "confirm before proceeding" notes (Task 4 Step 5's session-ID assumption, Task 8 Step 1's exact capability key) are flagged as verify-live steps with a concrete command, not unresolved TODOs.

**Type consistency:** `TransactionHopInput`/`emitHop` (Task 2) used identically in Tasks 4, 6, 7. `buildReelUrl` (Task 3) used identically in Tasks 4, 7. `getValidAccessToken` (Task 6) consumed with the same signature in Task 7.

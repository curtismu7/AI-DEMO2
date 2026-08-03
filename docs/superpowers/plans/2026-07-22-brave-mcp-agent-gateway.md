# Brave Search MCP via Agent Gateway Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `brave_news_search` MCP tool backed by a new standalone Node service that calls Brave's real News Search API, front it with `ping-gateway` exactly like the existing Weather MCP precedent, gate it with a query-content blocklist and a live feature flag in one Groovy filter (a scope-membership check was attempted twice and proven unworkable in this PingOne environment, then removed — see the Task 2 design note below for the full history), and make it callable/visible from `AgentGatewayTester.jsx`.

**Architecture:** `demo_mcp_brave/server.js` (new, hand-written MCP-over-HTTP server, no child-process bridge) → `ping-gateway` route `/mcp/brave` (new: audit → strip-prefix → the existing global `rsFilter` → MCP validation → new `tx-brave-scope.groovy` doing a query-content blocklist check → reverse-proxy) → real outbound call to `https://api.search.brave.com/res/v1/news/search`. `AgentGatewayTester.jsx` gets the tool added via a code change in `mcpGatewayClient.js` (tool-name → sub-path routing is a hardcoded `Set` lookup there, same pattern already used for weather).

**Tech Stack:** Node 22 (`demo_mcp_brave`, no new npm dependency — built-in `fetch`), ping-gateway (PingGateway/IG config JSON + Groovy `ScriptableFilter`), Docker Compose, React (`demo_api_ui`).

## Global Constraints

- **Remote-only.** Every call to `demo_mcp_brave` makes a real, live outbound HTTPS request to Brave's API. No mock/local mode.
- **No new PingOne provisioning.** No new PingOne resource, scope, or Authorize policy is created. Gating at the gateway is a query-content blocklist plus a live feature flag only — no scope or client-identity check of any kind ships (see the Task 2 design note below for the full history of why).
- **No child-process bridge.** Unlike `demo_mcp_weather` (which wraps a stdio-only third-party npm package), `demo_mcp_brave` is hand-written and speaks HTTP/MCP directly — there is no third-party Brave MCP package to wrap.
- **Secret handling.** `BRAVE_SEARCH_API_KEY` lives only in `demo_mcp_brave/.env` (gitignored via the repo's blanket `.env` rule). Never in a committed file, never in `docker-compose.yml`'s `environment:` block, never logged.
- **Existing files touched, not rewritten.** `demo_api_server/routes/featureFlags.js`, `demo_api_server/server.js`, `demo_api_server/services/mcpGatewayClient.js`, `demo_api_ui/src/components/AgentGatewayTester.jsx`, and `docker-compose.yml` all get small, additive edits (new lines/blocks) — no existing line is rewritten or removed except where explicitly shown.
- **Mechanism revised during implementation, not the design doc's original guess.** The approved design doc suggested a Groovy-only scope check. Research first confirmed a real, working scope accessor (`contexts['oauth2'].accessToken.getInfo()['scope']`, per `p1az-decision.groovy`), but live testing against real PingOne then proved no per-caller identity check — scope-based or client-id-based — is reachable by any real caller in this environment, so that check was removed entirely. The route still reuses the same global `"rsFilter"` (`OAuth2ResourceServerFilter`) weather already uses (no new IG heap/resolver/introspection-provider block is needed); the shipped gating is a content blocklist plus a live feature flag only. See Task 2's design note below for the full history.

---

### Task 1: `demo_mcp_brave` standalone service

**Files:**
- Create: `demo_mcp_brave/server.js`
- Create: `demo_mcp_brave/package.json`
- Create: `demo_mcp_brave/Dockerfile`
- Create: `demo_mcp_brave/.env` (gitignored — not committed; created locally during this task)

**Interfaces:**
- Produces: an MCP Streamable HTTP server on `POST /mcp` (JSON-RPC 2.0: `initialize`, `notifications/initialized`, `tools/list`, `tools/call`) and `GET /health`, listening on port `8897`.
- Produces: one tool, `brave_news_search` — `inputSchema: {query: string (required), count?: number}`.
- Consumes: `BRAVE_SEARCH_API_KEY` from `process.env` (loaded from `demo_mcp_brave/.env` when run via `npm start`, or from the container's `env_file` in Task 2).

- [ ] **Step 1: Write `demo_mcp_brave/package.json`**

```json
{
  "name": "demo-mcp-brave",
  "version": "1.0.0",
  "description": "MCP-over-HTTP server for Brave News Search — Agent Gateway (IG) remote-third-party-MCP showcase",
  "main": "server.js",
  "scripts": {
    "start": "node server.js"
  },
  "engines": {
    "node": ">=22"
  }
}
```

- [ ] **Step 2: Write `demo_mcp_brave/server.js`**

```js
/**
 * demo_mcp_brave — hand-written MCP-over-HTTP server fronting Brave's real
 * News Search API. No child-process bridge (unlike demo_mcp_weather, which
 * wraps a stdio-only third-party npm package) — this server calls Brave's
 * HTTPS API directly inside its own tools/call handler.
 */
'use strict';

const http = require('node:http');
const https = require('node:https');
const zlib = require('node:zlib');

const PORT = parseInt(process.env.PORT || '8897', 10);
const BRAVE_API_KEY = process.env.BRAVE_SEARCH_API_KEY || '';

const TOOLS = [
  {
    name: 'brave_news_search',
    description: 'Search recent news via the Brave Search API.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        count: { type: 'number', description: 'Number of results (default 10, max 50)' },
      },
      required: ['query'],
    },
  },
];

function send(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', (c) => { data += c; });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch (e) { reject(Object.assign(e, { status: 400 })); }
    });
    req.on('error', reject);
  });
}

/** Real outbound call to Brave's News Search API. Returns the parsed JSON body. */
function braveNewsSearch(query, count) {
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams({ q: query });
    if (count) params.set('count', String(count));
    const options = {
      hostname: 'api.search.brave.com',
      path: `/res/v1/news/search?${params.toString()}`,
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': BRAVE_API_KEY,
      },
      timeout: 10000,
    };
    const req = https.request(options, (res) => {
      if (res.statusCode !== 200) {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          reject(new Error(`Brave API responded ${res.statusCode}: ${data.slice(0, 300)}`));
        });
        return;
      }
      let stream = res;
      if (res.headers['content-encoding'] === 'gzip') {
        stream = res.pipe(zlib.createGunzip());
      }
      let data = '';
      stream.on('data', (c) => { data += c; });
      stream.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`Brave API returned invalid JSON: ${e.message}`)); }
      });
      stream.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('Brave API request timed out')));
    req.on('error', reject);
    req.end();
  });
}

async function handleToolsCall(rpc) {
  const { name, arguments: args } = rpc.params || {};
  if (name !== 'brave_news_search') {
    return { jsonrpc: '2.0', id: rpc.id, error: { code: -32601, message: `Unknown tool: ${name}` } };
  }
  const query = args && args.query;
  if (!query || typeof query !== 'string') {
    return { jsonrpc: '2.0', id: rpc.id, error: { code: -32602, message: 'query (string) is required' } };
  }
  try {
    const result = await braveNewsSearch(query, args.count);
    return {
      jsonrpc: '2.0',
      id: rpc.id,
      result: { content: [{ type: 'text', text: JSON.stringify(result) }] },
    };
  } catch (e) {
    return { jsonrpc: '2.0', id: rpc.id, error: { code: -32000, message: e.message } };
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    return send(res, 200, { ok: true, hasApiKey: !!BRAVE_API_KEY });
  }

  if (req.method === 'POST' && req.url === '/mcp') {
    let rpc;
    try {
      rpc = await readBody(req);
    } catch (e) {
      return send(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    }

    if (rpc.method === 'initialize') {
      return send(res, 200, {
        jsonrpc: '2.0',
        id: rpc.id,
        result: {
          protocolVersion: (rpc.params && rpc.params.protocolVersion) || '2025-03-26',
          capabilities: { tools: {} },
          serverInfo: { name: 'demo-mcp-brave', version: '1.0.0' },
        },
      });
    }
    if (rpc.method === 'notifications/initialized') {
      res.writeHead(202);
      return res.end();
    }
    if (rpc.method === 'tools/list') {
      return send(res, 200, { jsonrpc: '2.0', id: rpc.id, result: { tools: TOOLS } });
    }
    if (rpc.method === 'tools/call') {
      const result = await handleToolsCall(rpc);
      return send(res, 200, result);
    }

    return send(res, 200, { jsonrpc: '2.0', id: rpc.id, error: { code: -32601, message: `Unknown method: ${rpc.method}` } });
  }

  send(res, 404, { error: 'Not found' });
});

server.listen(PORT, () => {
  console.log(`[mcp-brave] listening on :${PORT} (hasApiKey=${!!BRAVE_API_KEY})`);
});
```

- [ ] **Step 3: Write `demo_mcp_brave/Dockerfile`**

```dockerfile
ARG GIT_SHA=unknown
FROM node:22-alpine
ENV GIT_SHA=$GIT_SHA

WORKDIR /app

COPY package.json ./
COPY server.js ./

EXPOSE 8897

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8897/health || exit 1

CMD ["node", "server.js"]
```

(No `npm ci` needed — this service has zero dependencies, unlike `demo_mcp_weather`.)

- [ ] **Step 4: Create the local secret file (not committed)**

Create `demo_mcp_brave/.env`:
```
BRAVE_SEARCH_API_KEY=<your real Brave Search API key>
```

Confirm it's gitignored: `cd demo_mcp_brave && git check-ignore -v .env` — expected output shows it matched by the repo's blanket `.env` ignore rule. If this prints nothing (not ignored), STOP and add an explicit `.gitignore` entry before proceeding — do not continue until this is confirmed.

- [ ] **Step 5: Run the server directly and test it, bypassing the gateway entirely**

```bash
cd demo_mcp_brave
set -a && . .env && set +a
node server.js &
sleep 1
curl -s http://localhost:8897/health
```
Expected: `{"ok":true,"hasApiKey":true}`

```bash
curl -s -X POST http://localhost:8897/mcp -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```
Expected: `{"jsonrpc":"2.0","id":1,"result":{"tools":[{"name":"brave_news_search",...}]}}`

```bash
curl -s -X POST http://localhost:8897/mcp -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"brave_news_search","arguments":{"query":"machine learning","count":3}}}'
```
Expected: `{"jsonrpc":"2.0","id":2,"result":{"content":[{"type":"text","text":"{...real Brave JSON with a \"results\" array...}"}]}}`. Confirm the `text` field, when parsed, contains real Brave News Search results (title/url/description fields per Brave's documented response shape), not an error.

Stop the background server: `kill %1`

- [ ] **Step 6: Commit**

```bash
git add demo_mcp_brave/server.js demo_mcp_brave/package.json demo_mcp_brave/Dockerfile
git commit -m "feat(brave-mcp): add standalone MCP-over-HTTP server for Brave News Search"
```
(`.env` is gitignored and intentionally not added.)

---

### Task 2: `ping-gateway` route — scope + content gating

**Files:**
- Create: `ping-gateway/config/routes/00-mcp-brave.json`
- Create: `ping-gateway/scripts/groovy/tx-brave-scope.groovy`
- Modify: `docker-compose.yml` (new `mcp-brave` service block + `ping-gateway` env vars + `depends_on` entry)

**Interfaces:**
- Consumes: `demo_mcp_brave`'s `POST /mcp` from Task 1 (as `ReverseProxyHandler`'s upstream).
- Consumes (existing, unmodified): the global `"rsFilter"` (`OAuth2ResourceServerFilter`, `ping-gateway/config/config.json:35-45`) for the coarse gateway-scope admission check (same `PG_INBOUND_SCOPE`/`gateway:mcp:invoke` every other `/mcp/*` route already requires) — reused by bare-string reference exactly like `00-mcp-weather.json` does, no new IG heap/resolver needed.
- Produces: route `^/mcp/brave`, reachable at `https://<ping-gateway-host>/mcp/brave` once `docker compose up` includes the new `mcp-brave` service.

**Design note (revised three times — this is the final, shipped mechanism, read before implementing):** research first proved `contexts['oauth2'].accessToken.getInfo()['scope']` is a real, working accessor (confirmed in `p1az-decision.groovy`), and a first attempt gated on `invest:read` scope membership. Live testing against real PingOne found no `client_credentials`-obtainable token in this environment can carry BOTH the gateway's entry scope (`gateway:mcp:invoke`, aliased to `mcp:invoke` per `scope-topology.json:17`) and `invest:read` on the same token (confirmed structurally: only apps using `token_exchange` grant type ever carry `mcp:invoke` — `scope-topology.json:78-81,154-158,160-163`). A second attempt switched to gating on `client_id` (the "Investment Advisor Agent" app) instead of scope. Task 4's static trace of `demo_api_server/services/mcpGatewayClient.js`'s `callToolViaGateway` → `agentMcpTokenService.js`'s two-exchange delegation then found this is ALSO unworkable, for a deeper, structural reason than either prior attempt hit: **every realistic path that produces an `rsFilter`-passing token in this environment mints it via the two-exchange chain, whose final token's top-level `client_id` is ALWAYS the MCP Token Exchanger app** (`f4dd707d-f78d-4417-ba56-dc8707d10a1f`), regardless of which user is logged in or which specialist agent is notionally "acting" — that per-specialist identity lives in a nested `act.sub` claim (per the P1AZ policy snapshot `snapshots/AI_Demo_Transaction_Authorization_P1AZ.snapshot.json`'s `HasValidActorChain` documentation: "Normal MCP path: act.sub = MCP Exchanger. A2A path: act.sub = one of 5 specialist agents"), and only varies via the A2A chat delegation path — explicitly out of scope for this plan (no chat/agent wiring). Combined with the earlier finding that no `client_credentials` token can reach `rsFilter` at all, there is no live path in this environment, ever, that presents a caller identity other than the fixed Token Exchanger — making any per-caller identity check's DENY branch permanently unreachable by any real caller, not just hard to script.

**Final mechanism: drop the identity check entirely, keep only the content blocklist + live flag check.** Both are fully demonstrable through `AgentGatewayTester.jsx` with real allow/deny contrast (a clean query permits, a blocklisted term denies; the flag on permits, off denies) — no PingOne provisioning, no unreachable code paths. A per-caller identity check is left for a future plan that's allowed to drive the real A2A delegation path.

- [ ] **Step 1: Write `ping-gateway/scripts/groovy/tx-brave-scope.groovy`**

```groovy
// ping-gateway/scripts/groovy/tx-brave-scope.groovy
//
// Agent Gateway (IG) demo policy for /mcp/brave: the tools/call query
// argument must not contain a blocked term (bank policy demo: no
// crypto-related searches via the agent gateway) before reaching the real
// Brave Search API.
//
// NOTE ON SCOPE: an earlier revision of this filter also checked the
// caller's token client_id (either scope-membership, then client-identity)
// as a second, per-caller allow/deny signal. Both were removed after live
// testing on the real PingOne environment proved neither is demonstrable
// here: no client_credentials-obtainable token can pass the gateway's base
// rsFilter admission gate at all (confirmed for every app in
// scope-topology.json — only the two-exchange delegation chain ever mints
// an rsFilter-passing token), and that chain's token always carries the
// SAME top-level client_id (the MCP Token Exchanger) regardless of which
// user or specialist agent is acting — the per-specialist identity lives in
// a nested act.sub claim that only varies via the A2A chat delegation path,
// out of scope for this plan (see the implementation plan's Task 2/Task 4
// design notes for the full live-tested proof). A per-caller identity check
// is left for a future plan that's allowed to drive that path.
//
// Also checks a live feature flag (ff_brave_mcp_showcase) the same way
// tx-weather-scope.groovy checks ff_weather_mcp_showcase.

import groovy.json.JsonSlurper
import groovy.json.JsonOutput
import org.forgerock.http.protocol.Response
import org.forgerock.http.protocol.Status
import org.forgerock.util.promise.Promises

def internalSecret = System.getenv('BFF_INTERNAL_SECRET') ?: ''
def flagUrl         = System.getenv('BFF_BRAVE_FLAG_URL') ?: ''

def BLOCKED_TERMS = ['bitcoin', 'cryptocurrency', 'crypto'] as Set

// Live flag check against the BFF: ff_brave_mcp_showcase (on/off). Fails OPEN
// (a demo toggle, not a security control) — same posture as tx-weather-scope's
// weatherFlags() closure. The content check below remains fail-closed
// regardless of this call's outcome.
def braveFlags = {
    def result = [enabled: true]
    if (!flagUrl) return result
    try {
        def conn = new URL(flagUrl).openConnection() as java.net.HttpURLConnection
        conn.requestMethod = 'GET'
        conn.connectTimeout = 2000
        conn.readTimeout = 3000
        if (internalSecret) conn.setRequestProperty('x-internal-gateway-secret', internalSecret)
        def code = conn.responseCode
        if (code != 200) {
            logger.warn('[TxBraveScope] flag check HTTP ' + code + ' — failing open (enabled)')
            return result
        }
        def respBody = conn.inputStream?.text ?: '{}'
        def parsed = new JsonSlurper().parseText(respBody)
        result.enabled = parsed.enabled != false
        return result
    } catch (Exception e) {
        logger.warn('[TxBraveScope] flag check failed: ' + e.message + ' — failing open (enabled)')
        return result
    }
}

def denied = { Object id, String message ->
    def resp = new Response(Status.FORBIDDEN)
    resp.headers.put('Content-Type', 'application/json')
    resp.entity.setString(JsonOutput.toJson([
        jsonrpc: '2.0',
        id: id,
        error: [code: -32000, message: message],
    ]))
    return Promises.newResultPromise(resp)
}

def body
try {
    body = new JsonSlurper().parseText(request.entity.string ?: '')
} catch (Exception e) {
    body = null
}

def id = (body instanceof Map && body.containsKey('id')) ? body.id : null

def flags = braveFlags()
if (!flags.enabled) {
    return denied(id, 'Agent Gateway: Brave search capability disabled (ff_brave_mcp_showcase is off)')
}

if (!(body instanceof Map) || body.method != 'tools/call') {
    return next.handle(context, request)
}

// ── Content blocklist ─────────────────────────────────────────────────────
def params = body.params
def args = (params instanceof Map) ? params.arguments : null
def query = (args instanceof Map) ? args.query : null
if (query instanceof String) {
    def normalized = query.toLowerCase()
    def hit = BLOCKED_TERMS.find { normalized.contains(it) }
    if (hit) {
        return denied(id, "Agent Gateway: Brave search query contains a blocked term ('${hit}') — demo bank policy")
    }
}

return next.handle(context, request)
```

- [ ] **Step 2: Write `ping-gateway/config/routes/00-mcp-brave.json`**

```json
{
  "name": "mcp-brave-primary",
  "condition": "${find(request.uri.path, '^/mcp/brave')}",
  "handler": {
    "type": "Chain",
    "config": {
      "filters": [
        {
          "name": "McpAudit",
          "type": "McpAuditFilter",
          "config": { "auditService": "AuditService" }
        },
        {
          "name": "StripBravePrefix",
          "type": "UriPathRewriteFilter",
          "config": {
            "mappings": { "/mcp/brave": "/mcp" }
          }
        },
        "rsFilter",
        {
          "name": "McpProtocol",
          "type": "McpValidationFilter",
          "config": { "acceptedOrigins": ".*", "metricsEnabled": true }
        },
        {
          "name": "TxBraveScope",
          "type": "ScriptableFilter",
          "config": { "type": "application/x-groovy", "file": "tx-brave-scope.groovy" }
        }
      ],
      "handler": {
        "type": "ReverseProxyHandler",
        "baseURI": "${env['PG_BRAVE_BACKEND_URL']}",
        "config": {}
      }
    }
  }
}
```

- [ ] **Step 3: Add the `mcp-brave` service to `docker-compose.yml`**

Add this new service block immediately after the existing `mcp-weather:` service block (the one ending around `docker-compose.yml:597`):

```yaml
  # ── MCP Brave (remote third-party API, real outbound calls) ─────────────
  # Agent Gateway (IG) showcase: fronts a hand-written MCP server that calls
  # the real Brave Search News API, scoped at the edge by
  # ping-gateway/scripts/groovy/tx-brave-scope.groovy (crypto-term content
  # blocklist + a live feature-flag check).
  mcp-brave:
    build:
      context: ./demo_mcp_brave
      dockerfile: Dockerfile
      args:
        GIT_SHA: ${GIT_SHA:-unknown}
    container_name: ai-demo-mcp-brave
    ports:
      - "8897:8897"
    env_file:
      - path: ./demo_mcp_brave/.env
        required: false
    environment:
      PORT: "8897"
    networks:
      - ai-demo
    restart: unless-stopped
```

Add these two lines to the `ping-gateway` service's `environment:` block, immediately after the existing `PG_WEATHER_BACKEND_URL` line (around `docker-compose.yml:896`):
```yaml
      PG_BRAVE_BACKEND_URL: "http://mcp-brave:8897"
```

And immediately after the existing `BFF_WEATHER_FLAG_URL` line (around `docker-compose.yml:905`):
```yaml
      BFF_BRAVE_FLAG_URL: "https://api.ping.demo:3001/internal/feature-flags/brave-mcp-showcase"
```

Add a `depends_on` entry for `mcp-brave` on the `ping-gateway` service, immediately after the existing `mcp-weather:` entry (around `docker-compose.yml:948`):
```yaml
      mcp-brave:
        condition: service_started
```

- [ ] **Step 4: Bring the stack up and run the tests a curl-only environment can actually prove**

Full PERMIT / content-DENY / flag-disabled-DENY proof needs a real interactive login (RFC 8693 token exchange) — no `client_credentials`-obtainable token in this PingOne environment can pass the pre-existing `rsFilter` gate at all (see the Design note above). That full proof is Task 4's job, which drives a real logged-in browser session. This step proves what's actually script-testable: the route deploys correctly and rejects unauthenticated/malformed requests exactly like every other `/mcp/*` route already does.

**Worktree note:** if the live stack is already running from the main checkout (a known pattern in this repo — check `docker inspect ai-demo-ping-gateway --format '{{json .Mounts}}'`), `docker compose up` from this worktree's directory will fail on unrelated missing `.env` files elsewhere in the monolithic compose file (Compose validates the whole file even with a service filter). Build and run `mcp-brave` directly from this worktree (`docker build`/`docker run`, joined to the existing `ai-demo_ai-demo` network), and point `ping-gateway`'s config/groovy bind mounts at this worktree's paths by capturing the running container's env/mounts (`docker inspect`) and recreating it — do not edit files in the main checkout to make this work.

```bash
docker compose logs mcp-brave --tail 20   # or `docker logs <container>` if run directly
```
Expected: `[mcp-brave] listening on :8897 (hasApiKey=true)`.

```bash
docker compose logs ping-gateway --tail 30   # or `docker logs <container>`
```
Expected: a route-load line naming `mcp-brave-primary` (matching the format `00-mcp-weather`'s load already logs), no new error lines beyond any pre-existing, unrelated ones (e.g. a `mcp-delegation` route load error that predates this task — confirm it was present identically before your change too, don't treat it as caused by you).

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:<ping-gateway-port>/mcp/brave \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"brave_news_search","arguments":{"query":"machine learning"}}}'
```
Expected: `401` (no `Authorization` header — `rsFilter` correctly rejects, proving the route and filter chain are wired and reachable even though this plan can't script a passing token).

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:<ping-gateway-port>/mcp/weather \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_weather","arguments":{}}}'
```
Expected: `401` (regression check — confirms adding the new route didn't disturb the existing weather route).

If the live stack was originally running from the main checkout, revert it back to that state (remove the worktree-pointed `mcp-brave`/`ping-gateway` containers you created, restore the original ones) before finishing, so the shared demo stack isn't left dependent on this worktree.

- [ ] **Step 5: Commit**

```bash
git add ping-gateway/config/routes/00-mcp-brave.json ping-gateway/scripts/groovy/tx-brave-scope.groovy docker-compose.yml
git commit -m "feat(brave-mcp): wire /mcp/brave through ping-gateway with scope + content gating"
```

---

### Task 3: Live feature flag

**Files:**
- Create: `demo_api_server/routes/braveMcpFlag.js`
- Modify: `demo_api_server/routes/featureFlags.js` (add one flag definition object to the existing flags array)
- Modify: `demo_api_server/server.js` (add one `app.use()` line)

**Interfaces:**
- Consumes (existing, unmodified): `configStore.getEffective(key)` from `../services/configStore`.
- Produces: `GET /internal/feature-flags/brave-mcp-showcase` → `{enabled: boolean}`, gated by the same `x-internal-gateway-secret` header check `weatherMcpFlag.js` uses. Consumed by Task 2's `tx-brave-scope.groovy` via `BFF_BRAVE_FLAG_URL`.

- [ ] **Step 1: Write `demo_api_server/routes/braveMcpFlag.js`**

```js
'use strict';
/**
 * /internal/feature-flags/brave-mcp-showcase — gateway-only endpoint
 *
 * Lets ping-gateway's tx-brave-scope.groovy check the live value of
 * ff_brave_mcp_showcase on every /mcp/brave request, so a Quick Flags UI
 * toggle takes effect immediately with no gateway restart. Same
 * x-internal-gateway-secret gate as this directory's other /internal/* routes
 * (see weatherMcpFlag.js).
 *
 * Status codes:
 *   200  { enabled: true|false }  — success
 *   403  forbidden                — missing or wrong x-internal-gateway-secret
 */
const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const configStore = require('../services/configStore');

const DEFAULT_INTERNAL_SECRET = 'dev-shared-secret-change-me';
const INTERNAL_SECRET = process.env.BFF_INTERNAL_SECRET || DEFAULT_INTERNAL_SECRET;
const INTERNAL_SECRET_BUF = Buffer.from(INTERNAL_SECRET);

router.get('/feature-flags/brave-mcp-showcase', (req, res) => {
  const presented = req.headers['x-internal-gateway-secret'];
  const presentedBuf = typeof presented === 'string' ? Buffer.from(presented) : null;
  if (
    !presentedBuf ||
    presentedBuf.length !== INTERNAL_SECRET_BUF.length ||
    !crypto.timingSafeEqual(presentedBuf, INTERNAL_SECRET_BUF)
  ) {
    return res.status(403).json({ error: 'forbidden' });
  }

  const raw = configStore.getEffective('ff_brave_mcp_showcase');
  const isUnset = raw === null || raw === undefined || raw === '';
  const enabled = isUnset ? true : (raw === true || raw === 'true');

  return res.json({ enabled });
});

module.exports = router;
```

- [ ] **Step 2: Register the flag in `demo_api_server/routes/featureFlags.js`**

Add this object to the existing flags array, immediately after the `ff_weather_mcp_allowed_state` entry:

```js
  {
    id:           'ff_brave_mcp_showcase',
    name:         'Brave Search MCP Showcase (Agent Gateway)',
    category:     'MCP / Agent',
    description:
      'Controls whether the Agent Gateway (PingGateway/IG) Brave Search MCP showcase route ' +
      '(`/mcp/brave`) is enabled. A standalone gateway capability demo — a remote third-party ' +
      'API (Brave News Search) fronted by the gateway, gated by a crypto-term content ' +
      'blocklist. `tx-brave-scope.groovy` calls this flag live on every `/mcp/brave` request ' +
      'via `GET /internal/feature-flags/brave-mcp-showcase`, so toggling it here takes effect ' +
      'immediately, with no gateway restart.',
    impact:
      'ON (default) = /mcp/brave is reachable (subject to the content blocklist policy). ' +
      'OFF = every /mcp/brave request is denied with HTTP 403.',
    type:         'boolean',
    defaultValue: true,
  },
```

- [ ] **Step 3: Mount the router in `demo_api_server/server.js`**

Add this line immediately after the existing `app.use('/internal', require('./routes/weatherMcpFlag'));` line:
```js
app.use('/internal', require('./routes/braveMcpFlag'));
```

- [ ] **Step 4: Test the flag endpoint directly**

**Port 3001 is almost certainly already bound** by the live `ai-demo-api-server` container (check first: `lsof -i :3001`) — this repo's shared demo stack runs continuously and, like `ping-gateway`, mounts from the main checkout, not any worktree, so your new route in this worktree isn't live on it. Do not try to start `server.js` (the full app, with all its other service dependencies) on the same port — it will fail with `EADDRINUSE`, and even on a free port `server.js` pulls in far more than this one route.

Instead, test the new router in isolation, in its own tiny Express app, on a free port:

```bash
cd demo_api_server
node -e "
const express = require('express');
const app = express();
app.use('/internal', require('./routes/braveMcpFlag'));
app.listen(3098, () => console.log('test server on :3098'));
" &
sleep 1
curl -s http://localhost:3098/internal/feature-flags/brave-mcp-showcase
```
Expected: `{"error":"forbidden"}` (no secret header sent)

```bash
curl -s http://localhost:3098/internal/feature-flags/brave-mcp-showcase -H "x-internal-gateway-secret: $BFF_INTERNAL_SECRET"
```
Expected: `{"enabled":true}` (uses the default `dev-shared-secret-change-me` unless `BFF_INTERNAL_SECRET` is set in your shell — check `demo_api_server/.env`'s real value and export it first if you want to test against the real secret rather than the default)

Stop the background test server: `kill %1`

This isolated test proves the route handler and `configStore.getEffective('ff_brave_mcp_showcase')` read work correctly — it does not prove `demo_api_server/server.js`'s new `app.use('/internal', ...)` mount line is wired correctly in the full app, since the full app isn't running from this worktree. That integration is implicitly proven in Task 4, when the full live stack (including this file, once deployed) serves a real UI-driven request that reaches `tx-brave-scope.groovy`'s flag check.

- [ ] **Step 5: Confirm the OFF-state logic directly**

`configStore` has no public write method exposed to a standalone script — flag writes normally happen through the live stack's admin API (`PATCH /api/admin/feature-flags`), which would write to the MAIN checkout's LMDB file, not this worktree's own `data/persistent/lmdb` — an isolated test script here can't observe a toggle made that way (same worktree-vs-live-stack data split as everywhere else in this plan). Instead, prove the OFF-state branch of `braveMcpFlag.js`'s logic directly, by temporarily editing the route handler's read to a hardcoded value rather than going through `configStore`:

Temporarily change `const raw = configStore.getEffective('ff_brave_mcp_showcase');` to `const raw = 'false';` in `demo_api_server/routes/braveMcpFlag.js`, re-run Step 4's isolated-server curl (with the correct secret header) — expect `{"enabled":false}`. Revert the change, re-run, confirm `{"enabled":true}` again (the default/unset path, already proven in Step 4).

(Full end-to-end proof — a live-toggled flag actually making `tx-brave-scope.groovy` deny a real `/mcp/brave` call — requires both a real bearer token past `rsFilter` AND the live stack's actual data directory. Both are deferred to Task 4, same as the client-identity and content-blocklist proof, per Task 2's design note.)

- [ ] **Step 6: Commit**

```bash
git add demo_api_server/routes/braveMcpFlag.js demo_api_server/routes/featureFlags.js demo_api_server/server.js
git commit -m "feat(brave-mcp): add live ff_brave_mcp_showcase feature flag"
```

---

### Task 4: `AgentGatewayTester.jsx` wiring

**Files:**
- Modify: `demo_api_server/services/mcpGatewayClient.js` (add a `BRAVE_TOOLS` Set + one ternary branch)
- Modify: `demo_api_ui/src/components/AgentGatewayTester.jsx` (add one `FALLBACK_TOOLS` entry, one optional `TOOL_GROUPS` entry)

**Interfaces:**
- Consumes (existing, unmodified): `callToolViaGateway`, `getMcpGatewayHttpUrl` from the same file; `POST /api/mcp-gateway/test` (`demo_api_server/routes/mcpGatewayConfig.js`, unmodified — already tool-name/args-agnostic).
- Design note: `AgentGatewayTester.jsx` routes tool calls to gateway sub-paths via a hardcoded tool-name `Set` lookup in `mcpGatewayClient.js` (confirmed: `WEATHER_TOOLS` at that file's existing `get_weather` entry) — NOT a configurable path parameter. This task extends that same lookup with a new `BRAVE_TOOLS` Set, mirroring the exact pattern already used for weather.

- [ ] **Step 1: Add `BRAVE_TOOLS` and the routing branch in `demo_api_server/services/mcpGatewayClient.js`**

Find the existing `WEATHER_TOOLS` declaration (a `Set` containing `'get_weather'`) and add immediately after it:

```js
// brave-mcp showcase: PingGateway (IG) only — 00-mcp-brave.json fronts a
// hand-written MCP server that calls the real Brave Search News API, gated
// by tx-brave-scope.groovy (crypto-term content blocklist). No
// Node mcp-gateway equivalent exists. Only applied when the gateway base IS
// PingGateway (base === pgUrl below) — same conditional weather uses.
const BRAVE_TOOLS = new Set([
    'brave_news_search',
]);
```

Find the existing ternary that resolves `url` (the one containing `isIgBase && WEATHER_TOOLS.has(tool) ? \`${base}/mcp/weather\``) and add a new branch immediately before the final fallback:

```js
const url  = isIgBase && APIKEY_TOOLS.has(tool) ? `${base}/mcp/apikey`
           : isIgBase && WEATHER_TOOLS.has(tool) ? `${base}/mcp/weather`
           : isIgBase && BRAVE_TOOLS.has(tool) ? `${base}/mcp/brave`
           : `${base}/mcp`;
```

- [ ] **Step 2: Add the tool to `AgentGatewayTester.jsx`**

Add this entry to the existing `FALLBACK_TOOLS` array, after the last entry (`create_transfer`):

```jsx
  {
    name: 'brave_news_search',
    description: 'Search recent news via the Brave Search API (Agent Gateway remote MCP showcase).',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        count: { type: 'number', description: 'Number of results (default 10, max 50)' },
      },
      required: ['query'],
    },
  },
```

Optionally add a new group to `TOOL_GROUPS` (purely cosmetic — anything not listed falls into "Other" automatically, per the existing `groupKey` fallback):

```jsx
  Search: ['brave_news_search'],
```

- [ ] **Step 3: Test from the UI — full live proof (content + flag only)**

This step owns the full live PERMIT / content-DENY / flag-disabled-DENY proof that Task 2 couldn't complete (no `client_credentials` token can pass `rsFilter`; a real logged-in browser session is the only way to reach `/mcp/brave` with a token that does). There is no client-identity dimension to test — a prior attempt at this exact step traced `mcpGatewayClient.js`'s `callToolViaGateway` → `agentMcpTokenService.js`'s two-exchange delegation and found, decisively, that every token this UI ever presents to the gateway carries the SAME top-level `client_id` (the MCP Token Exchanger app) no matter who's logged in — so `tx-brave-scope.groovy`'s identity check was removed entirely (see Task 2's Step 1 design note). Only the content blocklist and the live flag remain as gated checks.

1. Deploy the live stack with Tasks 1–3's changes. Reuse Task 2's worktree-pointed `docker build`/`docker run` recipe (its report has the full, working steps) for `mcp-brave` and `ping-gateway`. You also need `demo_api_server`'s worktree code live (Task 3's flag route, this task's `mcpGatewayClient.js` change, and `AgentGatewayTester.jsx`) — apply the same pattern: capture the running `ai-demo-api-server` container's env/mounts via `docker inspect`, recreate it pointed at this worktree's `demo_api_server` and `demo_api_ui` paths instead. Revert all three afterward, same as Task 2 did.
2. Sign in as a real demo user (standard login flow), navigate to `/pinggateway-inspector?subtab=tester`, select `brave_news_search` (renders under the "Search" tool group), fill `{"query": "machine learning", "count": 3}`, execute.
   **PERMIT case**: response tab shows real Brave results, auth-decision tab shows PERMIT, audit-trail tab shows the call.
3. Repeat with a query containing `bitcoin`.
   **Content DENY case**: response/auth-decision tabs show the DENY with the blocked-term message.
4. Toggle `ff_brave_mcp_showcase` OFF (same admin mechanism as `ff_weather_mcp_showcase`), repeat the PERMIT case's clean query.
   **Flag-disabled DENY case**: response/auth-decision tabs show the DENY with the "capability disabled" message. Toggle back ON, confirm PERMIT passes again.
5. **Prove the content check is independently live**: temporarily remove `'bitcoin'` from `BLOCKED_TERMS` in `tx-brave-scope.groovy`, restart `ping-gateway`, re-run the content DENY case — expect it to now pass through (200, real results). Revert, restart, re-confirm content DENY denies again.

- [ ] **Step 4: Commit**

```bash
git add demo_api_server/services/mcpGatewayClient.js demo_api_ui/src/components/AgentGatewayTester.jsx
git commit -m "feat(brave-mcp): wire brave_news_search into AgentGatewayTester"
```

---

## After this plan

Weather's chat-integration precedent (`AIAgent.js`'s `action === "weather"` branch + a capability-ledger entry) has no analog in this plan by design — the approved design's non-goals explicitly exclude chat/agent wiring for Brave. If that's wanted later, it's a separate, follow-on plan mirroring `demo_api_ui/src/config/capabilityLedgers/agentGatewayCapabilities.js`'s weather entry and `AIAgent.js`'s weather branch — not part of this scope.

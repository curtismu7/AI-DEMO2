# Weather MCP Agent Gateway (IG) — Texas-Only Showcase Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Front the third-party `weather-mcp` server through Agent Gateway (`ping-gateway`,
IG), scoped to Texas-only requests, as a standalone gateway capability showcase — no banking
chat/agent wiring.

**Architecture:** A new `demo_mcp_weather/` sidecar spawns `weather-mcp` (stdio-only) as a
child process and exposes it over MCP Streamable HTTP (`POST /mcp`), matching the wire
contract `demo_mcp_server`'s `HttpMCPTransport.ts` already implements. A new `ping-gateway`
route (`00-mcp-weather.json`) reuses the gateway's existing inbound introspection/scope, then
runs a new Groovy filter (`tx-weather-scope.groovy`) that denies any `tools/call` whose
location argument isn't Texas, before reverse-proxying to the sidecar.

**Tech Stack:** Node 20 (plain `http` + `child_process`, no framework, matching
`demo_mcp_proxy`'s zero-dependency style plus one pinned npm dependency), PingGateway
Groovy `ScriptableFilter` (`org.forgerock.http.protocol.*`), Docker Compose.

## Global Constraints

- Full spec: `docs/superpowers/specs/2026-07-21-weather-mcp-agent-gateway-design.md`. Read it
  before starting — it has the non-goals list (no chat/agent wiring, no PingOne resource/
  scope/policy, no JWKS-variant route, no rate-limit filter, default-6 tools only).
- **No PingOne console provisioning required.** This route reuses the gateway's existing
  `rsFilter` (shared inbound introspection/scope) and does its own RFC 8693 token exchange
  nowhere — the backend call is unauthenticated (the weather-mcp child is not an OAuth
  resource server). If any task starts requiring a new PingOne resource/scope/policy, stop —
  that means the design has drifted from the approved spec.
- **Testing convention for this class of file:** this repo has no jest coverage for Groovy
  filters (IG/Java runs them, not Node) or for the existing `demo_mcp_proxy` sidecar (zero
  tests, zero dependencies). Verification here is `ping-gateway/scripts/validate-config.sh`
  (JSON syntax) + manual `curl` with exact expected output + an extension of
  `ping-gateway/scripts/e2e-pinggateway.sh`. Do not add a jest suite for
  `demo_mcp_weather/` or the Groovy filter — it would be new, unestablished convention for
  this file class.
- Emoji allowlist (REGRESSION_PLAN.md §0), applies to the capability-ledger `oneLiner` string
  in Task 7: `⚠️ ✅ ❌ 🔐 ✕ ✓ 👤 🔑 🪟 📚` only — plain text otherwise.
- Work happens in this worktree only (branch `worktree-weather-mcp-agent-gateway`). Stage
  files explicitly (`git add <files>`, never `-A`). Verify `git branch --show-current` before
  each commit.
- Every new file's content is fully specified in this plan — no placeholders, no "add
  appropriate error handling."

---

### Task 1: Scaffold `demo_mcp_weather/`

**Files:**
- Create: `demo_mcp_weather/package.json`
- Create: `demo_mcp_weather/Dockerfile`
- Create: `demo_mcp_weather/.gitignore`

**Interfaces:**
- Produces: an npm project with `@dangahagan/weather-mcp` (pinned `1.13.0`) as its one
  dependency, buildable into a Docker image that listens on `:8896`. Task 2 writes
  `server.js` into this scaffold; Task 3 builds this directory as a Compose service.

- [ ] **Step 1: Create the directory and `package.json`**

```json
{
  "name": "demo-mcp-weather",
  "version": "1.0.0",
  "description": "HTTP bridge for weather-mcp (stdio-only third-party MCP server) — Agent Gateway (IG) Texas-only showcase",
  "main": "server.js",
  "scripts": {
    "start": "node server.js"
  },
  "dependencies": {
    "@dangahagan/weather-mcp": "1.13.0"
  },
  "engines": {
    "node": ">=18"
  }
}
```

- [ ] **Step 2: Create `.gitignore`**

```
node_modules/
```

- [ ] **Step 3: Create `Dockerfile`**

```dockerfile
ARG GIT_SHA=unknown
FROM node:20-alpine
ENV GIT_SHA=$GIT_SHA

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY server.js ./

EXPOSE 8896

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8896/health || exit 1

CMD ["node", "server.js"]
```

- [ ] **Step 4: Install locally to generate the lockfile**

Run: `cd demo_mcp_weather && npm install && cd ..`
Expected: `demo_mcp_weather/package-lock.json` created, `demo_mcp_weather/node_modules/@dangahagan/weather-mcp/dist/index.js` exists.

Verify the entry point resolved:
Run: `test -f demo_mcp_weather/node_modules/@dangahagan/weather-mcp/dist/index.js && echo FOUND`
Expected: `FOUND`

- [ ] **Step 5: Commit**

```bash
git add demo_mcp_weather/package.json demo_mcp_weather/package-lock.json demo_mcp_weather/Dockerfile demo_mcp_weather/.gitignore
git commit -m "feat(mcp-weather): scaffold demo_mcp_weather bridge project"
```

---

### Task 2: Implement the stdio↔HTTP bridge (`server.js`)

**Files:**
- Create: `demo_mcp_weather/server.js`

**Interfaces:**
- Consumes: `demo_mcp_weather/node_modules/@dangahagan/weather-mcp/dist/index.js` (Task 1).
- Produces: `POST /mcp` (JSON-RPC 2.0 passthrough) and `GET /health` on port `process.env.PORT
  || 8896`. Task 3's Compose service and Task 4's gateway route both depend on this HTTP
  contract; Task 6's e2e script depends on it responding through the gateway.

- [ ] **Step 1: Write `server.js`**

```javascript
/**
 * demo_mcp_weather — HTTP-to-stdio bridge for the third-party weather-mcp server.
 * weather-mcp ships stdio-only; Agent Gateway (ping-gateway)'s ReverseProxyHandler
 * needs an HTTP backend. This bridge spawns weather-mcp as a long-lived stdio
 * child and exposes it over MCP Streamable HTTP (POST /mcp, JSON-RPC 2.0).
 */
'use strict';

const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');

const PORT = parseInt(process.env.PORT || '8896', 10);
const CHILD_ENTRY = path.join(__dirname, 'node_modules', '@dangahagan', 'weather-mcp', 'dist', 'index.js');
const INIT_ID = '__bridge_init__';

let child = null;
let stdoutBuffer = '';
const pending = new Map(); // JSON-RPC id -> { resolve, reject, timer }

function sendRaw(message) {
  child.stdin.write(JSON.stringify(message) + '\n');
}

function startChild() {
  child = spawn(process.execPath, [CHILD_ENTRY], { stdio: ['pipe', 'pipe', 'inherit'] });
  stdoutBuffer = '';

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdoutBuffer += chunk;
    let idx;
    while ((idx = stdoutBuffer.indexOf('\n')) !== -1) {
      const line = stdoutBuffer.slice(0, idx);
      stdoutBuffer = stdoutBuffer.slice(idx + 1);
      if (line.trim()) handleChildLine(line);
    }
  });

  child.on('exit', (code) => {
    console.error(`[mcp-weather] child exited (code=${code}) — will respawn on next request`);
    for (const { reject, timer } of pending.values()) {
      clearTimeout(timer);
      reject(new Error('weather-mcp child exited'));
    }
    pending.clear();
    child = null;
  });

  child.on('error', (err) => {
    console.error(`[mcp-weather] child spawn error: ${err.message}`);
    child = null;
  });

  // One-time MCP handshake so the child is always ready for tools/list and
  // tools/call regardless of whether the HTTP caller sends its own initialize.
  sendRaw({
    jsonrpc: '2.0',
    id: INIT_ID,
    method: 'initialize',
    params: {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'demo-mcp-weather-bridge', version: '1.0.0' },
    },
  });
}

function handleChildLine(line) {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch (e) {
    console.error(`[mcp-weather] unparseable child line: ${line.slice(0, 200)}`);
    return;
  }
  if (msg.id === INIT_ID) {
    sendRaw({ jsonrpc: '2.0', method: 'notifications/initialized' });
    return;
  }
  const waiter = pending.get(msg.id);
  if (!waiter) return; // stray notification or no in-flight HTTP request waiting on this id
  clearTimeout(waiter.timer);
  pending.delete(msg.id);
  waiter.resolve(msg);
}

function callChild(message, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    if (!child) startChild();
    const timer = setTimeout(() => {
      pending.delete(message.id);
      reject(new Error('weather-mcp child timeout'));
    }, timeoutMs);
    pending.set(message.id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify(message) + '\n');
  });
}

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

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    return send(res, 200, { ok: true, childAlive: !!child });
  }

  if (req.method === 'POST' && req.url === '/mcp') {
    let rpc;
    try {
      rpc = await readBody(req);
    } catch (e) {
      return send(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    }

    // The bridge is always initialized against the child at startup — answer
    // any caller-side initialize locally instead of forwarding a second one.
    if (rpc.method === 'initialize') {
      return send(res, 200, {
        jsonrpc: '2.0',
        id: rpc.id,
        result: {
          protocolVersion: (rpc.params && rpc.params.protocolVersion) || '2025-03-26',
          capabilities: { tools: {} },
          serverInfo: { name: 'demo-mcp-weather-bridge', version: '1.0.0' },
        },
      });
    }
    if (rpc.method === 'notifications/initialized') {
      res.writeHead(202);
      return res.end();
    }

    try {
      const result = await callChild(rpc);
      return send(res, 200, result);
    } catch (e) {
      return send(res, 502, { jsonrpc: '2.0', id: rpc.id != null ? rpc.id : null, error: { code: -32000, message: e.message } });
    }
  }

  send(res, 404, { error: 'Not found' });
});

startChild();
server.listen(PORT, () => {
  console.log(`[mcp-weather] listening on :${PORT}`);
});
```

- [ ] **Step 2: Run it standalone and verify `/health`**

Run:
```bash
cd demo_mcp_weather && PORT=8896 node server.js &
sleep 1
curl -s http://127.0.0.1:8896/health
```
Expected: `{"ok":true,"childAlive":true}`

- [ ] **Step 3: Verify `tools/list` returns the default-6 preset**

Run:
```bash
curl -s http://127.0.0.1:8896/mcp -X POST -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":"1","method":"tools/list"}'
```
Expected: JSON with `result.tools` containing exactly 6 entries whose `name` fields are
`get_weather_summary`, `get_forecast`, `get_current_conditions`, `get_alerts`,
`search_location`, `check_service_status` (order may vary).

- [ ] **Step 4: Verify a real tool call for a Texas city**

Run:
```bash
curl -s http://127.0.0.1:8896/mcp -X POST -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":"2","method":"tools/call","params":{"name":"get_current_conditions","arguments":{"city_name":"Austin, TX"}}}'
```
Expected: HTTP 200, JSON-RPC `result` present (not `error`), content mentions Austin/Texas
temperature data.

- [ ] **Step 5: Stop the standalone server**

Run: `kill %1` (or `pkill -f "node server.js"`)

- [ ] **Step 6: Commit**

```bash
git add demo_mcp_weather/server.js
git commit -m "feat(mcp-weather): implement stdio-to-HTTP bridge for weather-mcp"
```

---

### Task 3: Wire `demo_mcp_weather` into Docker Compose

**Files:**
- Modify: `docker-compose.yml` (add `mcp-weather` service; add `PG_WEATHER_BACKEND_URL` +
  `mcp-weather` dependency to the existing `ping-gateway` service block)

**Interfaces:**
- Consumes: `demo_mcp_weather/Dockerfile` (Task 1), `POST /mcp` / `GET /health` (Task 2).
- Produces: service `mcp-weather` reachable at `http://mcp-weather:8896` on the `ai-demo`
  Compose network. Task 4's route file reads `PG_WEATHER_BACKEND_URL` to reach it.

- [ ] **Step 1: Add the `mcp-weather` service**

Insert after the existing `mcp-invest` service block (the one ending `restart:
unless-stopped` right before the `# ── MCP JWT Verifier` comment):

```yaml
  # ── MCP Weather (third-party weather-mcp, stdio bridged to HTTP) ────────────
  # Agent Gateway (IG) showcase: fronts github.com/weather-mcp/weather-mcp,
  # scoped to Texas-only by ping-gateway/scripts/groovy/tx-weather-scope.groovy.
  # Not wired into the banking AI agent — gateway-level capability only.
  mcp-weather:
    build:
      context: ./demo_mcp_weather
      dockerfile: Dockerfile
      args:
        GIT_SHA: ${GIT_SHA:-unknown}
    container_name: ai-demo-mcp-weather
    ports:
      - "8896:8896"
    environment:
      PORT: "8896"
    networks:
      - ai-demo
    restart: unless-stopped
```

- [ ] **Step 2: Add `PG_WEATHER_BACKEND_URL` to the `ping-gateway` service's `environment:`**

In the `ping-gateway` service block, next to the existing `PG_INVEST_BACKEND_URL` line:

```yaml
      PG_INVEST_BACKEND_URL: "http://mcp-invest:8081"
      PG_WEATHER_BACKEND_URL: "http://mcp-weather:8896"
```

- [ ] **Step 3: Add `mcp-weather` to the `ping-gateway` service's `depends_on:`**

Next to the existing `mcp-invest: condition: service_started` entry:

```yaml
    depends_on:
      mcp-server:
        condition: service_started
      mcp-invest:
        condition: service_started
      mcp-weather:
        condition: service_started
      mortgage-service:
        condition: service_started
```

- [ ] **Step 4: Validate the compose file parses**

Run: `COMPOSE_PROJECT_NAME=ai-demo docker compose config --quiet`
Expected: no output, exit code 0 (a YAML/schema error would print and exit non-zero).

- [ ] **Step 5: Build and start the new service**

Run: `COMPOSE_PROJECT_NAME=ai-demo docker compose up -d --build mcp-weather`
Expected: image builds, container `ai-demo-mcp-weather` starts and reports healthy
(`docker compose ps mcp-weather` shows `healthy` after ~30s).

- [ ] **Step 6: Verify it's reachable from the host**

Run: `curl -s http://localhost:8896/health`
Expected: `{"ok":true,"childAlive":true}`

- [ ] **Step 7: Recreate `ping-gateway` so it picks up the new env vars**

Run: `COMPOSE_PROJECT_NAME=ai-demo docker compose up -d ping-gateway`
Expected: `ai-demo-ping-gateway` recreated, still healthy.

- [ ] **Step 8: Commit**

```bash
git add docker-compose.yml
git commit -m "feat(mcp-weather): add compose service + wire ping-gateway backend URL"
```

---

### Task 4: Add the `ping-gateway` route (plain passthrough, no TX scoping yet)

**Files:**
- Create: `ping-gateway/config/routes/00-mcp-weather.json`
- Modify: `ping-gateway/.env.example`
- Modify: `ping-gateway/config/routes/01-mcp-olb.json` (protected file — one-token regex
  exclusion only, see Step 4a; regression-guard invariant stated there)
- Modify: `REGRESSION_PLAN.md` (append a `§4` bug-fix-log entry for the Step 4a fix)

**Interfaces:**
- Consumes: `PG_WEATHER_BACKEND_URL` (Task 3), the gateway's existing `rsFilter` heap object
  (defined in `ping-gateway/config/config.json`, unchanged).
- Produces: `/mcp/weather` reachable through `ping-gateway` (port `3036`), still with no
  Texas scoping — Task 5 adds that filter into this same route file.

**Regression-guard invariant (state before Step 4a):** PingGateway selects among matching
routes by the route's `"name"` field, sorted alphabetically — NOT by filename (confirmed via
an in-repo comment in `00-mcp-apikey-jwks.json`: "IG selects by name, not filename"). Without
Step 4a, `01-mcp-olb.json`'s catch-all condition (`^/mcp(?!/invest)`, name `mcp-olb-primary`)
alphabetically outranks `mcp-weather-primary` and silently swallows all `/mcp/weather`
traffic — proxying it to the OLB/banking backend instead of the weather backend. Step 4a's
fix — adding `|/weather` to that regex, mirroring the existing `|/invest` exclusion — will NOT
change OLB's behavior for `/mcp`, `/mcp/olb`, or any existing banking/OLB traffic; it only
removes one path OLB was never meant to own from its match set.

- [ ] **Step 1: Create the route file**

```json
{
  "name": "mcp-weather-primary",
  "condition": "${find(request.uri.path, '^/mcp/weather')}",
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
          "name": "StripWeatherPrefix",
          "type": "UriPathRewriteFilter",
          "config": {
            "mappings": { "^/mcp/weather(.*)$": "/mcp$1" }
          }
        },
        "rsFilter",
        {
          "name": "McpProtocol",
          "type": "McpValidationFilter",
          "config": { "acceptedOrigins": ".*", "metricsEnabled": true }
        }
      ],
      "handler": {
        "type": "ReverseProxyHandler",
        "config": { "baseURI": "${env['PG_WEATHER_BACKEND_URL']}" }
      }
    }
  }
}
```

- [ ] **Step 2: Add the `.env.example` entry**

In `ping-gateway/.env.example`, in the `# --- Backend URLs ---` section, next to the existing
`PG_INVEST_BACKEND_URL` line:

```
PG_OLB_BACKEND_URL=http://host.docker.internal:8080
PG_INVEST_BACKEND_URL=http://host.docker.internal:8081
# demo_mcp_weather bridge (Agent Gateway showcase — third-party weather-mcp, Texas-only).
# In the main compose stack this is overridden to http://mcp-weather:8896 (service DNS).
PG_WEATHER_BACKEND_URL=http://host.docker.internal:8896
```

- [ ] **Step 3: Validate the new route's JSON**

Run: `bash ping-gateway/scripts/validate-config.sh`
Expected: script reports success (exit 0), no error mentioning `00-mcp-weather.json`.

- [ ] **Step 4: Recreate `ping-gateway` and verify the route loads**

Run: `COMPOSE_PROJECT_NAME=ai-demo docker compose up -d ping-gateway`

Then verify unauthenticated access is rejected (proves the route is live and `rsFilter` is
enforcing — same behavior as the existing OLB/invest routes):

Run:
```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3036/mcp/weather -X POST \
  -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":"1","method":"tools/list"}'
```
Expected: `401`

**This 401 alone does NOT prove the route is reachable** — `01-mcp-olb.json`'s catch-all
condition also 401s on an unauthenticated request, so an identical response code can come
from the wrong route. Step 5 below adds the fix and Step 6 re-verifies with a header
comparison that distinguishes the two.

- [ ] **Step 5: Fix the route-shadowing bug — exclude `/weather` in `01-mcp-olb.json`**

Read `ping-gateway/config/routes/01-mcp-olb.json` first. Find its `"condition"` line:

```json
  "condition": "${find(request.uri.path, '^/mcp(?!/invest)')}",
```

Change ONLY the regex, adding a `/weather` exclusion alongside the existing `/invest` one —
do not touch anything else in this file:

```json
  "condition": "${find(request.uri.path, '^/mcp(?!/invest|/weather)')}",
```

Validate and recreate:
```bash
bash ping-gateway/scripts/validate-config.sh
COMPOSE_PROJECT_NAME=ai-demo docker compose up -d ping-gateway
```
Expected: validate-config.sh passes; container recreated and healthy.

Verify OLB's own existing behavior is unchanged (the regression-guard proof this edit didn't
break banking/OLB traffic) — run the existing e2e script's OLB legs:
```bash
bash ping-gateway/scripts/e2e-pinggateway.sh
```
Expected: Leg A/B behave exactly as they did before this change (same PASS/LIVE_E2E_BLOCKED
outcomes) — this script predates this task and its OLB-path assertions must still hold.

Now re-verify `/mcp/weather` is reaching the RIGHT route, not just returning the same status
code as before. Compare the `WWW-Authenticate` response header between `/mcp` (OLB) and
`/mcp/weather` (should now differ — OLB's uses `McpProtectionFilter`/`resource_metadata`; the
weather route's bare `rsFilter` does not):
```bash
curl -sI http://localhost:3036/mcp -X POST -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":"1","method":"tools/list"}' | grep -i 'www-authenticate'
curl -sI http://localhost:3036/mcp/weather -X POST -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":"1","method":"tools/list"}' | grep -i 'www-authenticate'
```
Expected: the two `WWW-Authenticate` header VALUES differ. If they are identical, the
shadowing is NOT fixed — stop and re-check the regex edit before proceeding.

Log this fix in `REGRESSION_PLAN.md`'s `§4 — Bug Fix Log` (reverse-chronological — insert as
the newest entry, directly after the "Reverse-chronological, newest first." line):

```markdown
### 2026-07-21 — /mcp/weather route silently shadowed by 01-mcp-olb.json's catch-all

**Files changed:**
- `ping-gateway/config/routes/01-mcp-olb.json` — condition regex now excludes `/weather`
  alongside the existing `/invest` exclusion (`^/mcp(?!/invest|/weather)`).

**What was broken:** PingGateway selects among matching routes by the route's `"name"`
field, sorted alphabetically — not by filename. `00-mcp-weather.json` (name
`mcp-weather-primary`) was added expecting its `00-` filename prefix to win priority over
`01-mcp-olb.json` (name `mcp-olb-primary`), matching how `00-mcp-apikey.json` (name
`mcp-apikey-primary`) already escapes the same catch-all. That precedent is coincidental —
`"apikey"` alphabetically precedes `"olb"`, `"weather"` does not — so `01-mcp-olb.json`'s
catch-all silently swallowed all `/mcp/weather` traffic, proxying it to the OLB/banking
backend instead of the weather backend. A 401 on an unauthenticated request looked identical
either way, masking the bug until response headers were compared directly.

**What was fixed:** added `|/weather` to `01-mcp-olb.json`'s condition regex, mirroring the
existing `|/invest` exclusion — the same structurally-guaranteed mechanism (not
alphabetical-name luck) that already protects the invest route.

**Do not break:** `01-mcp-olb.json`'s condition must keep matching `/mcp` and any other
`/mcp/*` path that isn't `/invest` or `/weather` — do not narrow it further without checking
what else relies on the OLB catch-all.

**Verify:** `bash ping-gateway/scripts/validate-config.sh` (PASS); `bash
ping-gateway/scripts/e2e-pinggateway.sh` (OLB legs unchanged); `WWW-Authenticate` header on
`/mcp/weather` no longer matches `/mcp`'s.
```

- [ ] **Step 6: Commit**

```bash
git add ping-gateway/config/routes/00-mcp-weather.json ping-gateway/.env.example ping-gateway/config/routes/01-mcp-olb.json REGRESSION_PLAN.md
git commit -m "feat(mcp-weather): add ping-gateway route + fix OLB catch-all shadowing /mcp/weather"
```

---

### Task 5: Implement the Texas-scope Groovy filter

**Files:**
- Create: `ping-gateway/scripts/groovy/tx-weather-scope.groovy`
- Modify: `ping-gateway/config/routes/00-mcp-weather.json` (insert the filter)

**Interfaces:**
- Consumes: the buffered request body `McpValidationFilter` (already in the chain) produces.
- Produces: a `TxWeatherScope` filter step that denies out-of-Texas `tools/call` requests
  with HTTP 403 before they reach `ReverseProxyHandler`. Task 6's e2e legs assert on this
  behavior. Task 8 (added later in this plan) edits this SAME file to prepend a live
  feature-flag check ahead of the Texas-scope logic below — this task's job is the Texas
  scoping only, with no flag awareness.

- [ ] **Step 1: Create the Groovy filter**

```groovy
// ping-gateway/scripts/groovy/tx-weather-scope.groovy
//
// Agent Gateway (IG) demo policy: the weather-mcp passthrough is scoped to
// Texas only. Runs after McpValidationFilter has buffered the body. A
// tools/call whose location argument cannot be verified as Texas is denied
// here, not by the upstream weather-mcp server.

import groovy.json.JsonSlurper
import groovy.json.JsonOutput
import org.forgerock.http.protocol.Response
import org.forgerock.http.protocol.Status
import org.forgerock.util.promise.Promises

// Texas bounding box (approximate, generous — covers the whole state).
def TX_LAT_MIN = 25.8
def TX_LAT_MAX = 36.5
def TX_LON_MIN = -106.6
def TX_LON_MAX = -93.5

// 20 largest Texas cities by population — matched as a case-insensitive
// substring of city_name (so "Austin, TX" and "austin" both match).
def TX_CITIES = [
    'houston', 'san antonio', 'dallas', 'austin', 'fort worth', 'el paso',
    'arlington', 'corpus christi', 'plano', 'laredo', 'lubbock', 'irving',
    'garland', 'frisco', 'mckinney', 'amarillo', 'grand prairie',
    'brownsville', 'killeen', 'mcallen',
] as Set

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

if (!(body instanceof Map) || body.method != 'tools/call') {
    return next.handle(context, request)
}

def id = body.containsKey('id') ? body.id : null
def params = body.params
def args = (params instanceof Map) ? params.arguments : null
if (!(args instanceof Map)) {
    return next.handle(context, request)
}

def lat = args.latitude
def lon = args.longitude
if (lat instanceof Number && lon instanceof Number) {
    double latVal = lat.doubleValue()
    double lonVal = lon.doubleValue()
    if (latVal < TX_LAT_MIN || latVal > TX_LAT_MAX || lonVal < TX_LON_MIN || lonVal > TX_LON_MAX) {
        return denied(id, 'Agent Gateway: weather scope restricted to Texas (demo policy) — coordinates outside Texas')
    }
    return next.handle(context, request)
}

def city = args.city_name
if (city instanceof String) {
    def normalized = city.toLowerCase()
    def isTx = normalized.endsWith(', tx') || normalized.endsWith(', texas') ||
        TX_CITIES.any { normalized.contains(it) }
    if (!isTx) {
        return denied(id, 'Agent Gateway: weather scope restricted to Texas (demo policy) — city not recognized as Texas')
    }
    return next.handle(context, request)
}

if (args.location_name instanceof String) {
    return denied(id, 'Agent Gateway: weather scope restricted to Texas (demo policy) — saved locations cannot be verified')
}

// No location argument at all (e.g. check_service_status) — nothing to scope.
return next.handle(context, request)
```

- [ ] **Step 2: Insert the filter into the route, after `McpProtocol` and before the handler**

In `ping-gateway/config/routes/00-mcp-weather.json`, the `filters` array becomes:

```json
      "filters": [
        {
          "name": "McpAudit",
          "type": "McpAuditFilter",
          "config": { "auditService": "AuditService" }
        },
        {
          "name": "StripWeatherPrefix",
          "type": "UriPathRewriteFilter",
          "config": {
            "mappings": { "^/mcp/weather(.*)$": "/mcp$1" }
          }
        },
        "rsFilter",
        {
          "name": "McpProtocol",
          "type": "McpValidationFilter",
          "config": { "acceptedOrigins": ".*", "metricsEnabled": true }
        },
        {
          "name": "TxWeatherScope",
          "type": "ScriptableFilter",
          "config": { "type": "application/x-groovy", "file": "tx-weather-scope.groovy" }
        }
      ],
```

- [ ] **Step 3: Validate config + recreate `ping-gateway`**

Run:
```bash
bash ping-gateway/scripts/validate-config.sh
COMPOSE_PROJECT_NAME=ai-demo docker compose up -d ping-gateway
```
Expected: validate-config.sh passes; container recreated and healthy.

- [ ] **Step 4: Manually verify the unauthenticated leg still 401s (filter didn't break the chain)**

Run:
```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3036/mcp/weather -X POST \
  -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":"1","method":"tools/list"}'
```
Expected: `401`

- [ ] **Step 5: If a valid inbound token is available, manually verify TX-allow and non-TX-deny**

This leg needs a bearer token the gateway's `rsFilter` accepts (scope `gateway:mcp:invoke`,
per `PG_INBOUND_SCOPE`). Task 6 automates this behind the same `BANKING_TEST_TOKEN`-gated
pattern `ping-gateway/scripts/e2e-pinggateway.sh` already uses for its Leg C. If you have such
a token now:

```bash
TOKEN="<paste a token with gateway:mcp:invoke scope>"

# Texas — expect 200
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3036/mcp/weather -X POST \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -H 'MCP-Protocol-Version: 2025-11-25' \
  -d '{"jsonrpc":"2.0","id":"1","method":"tools/call","params":{"name":"get_current_conditions","arguments":{"city_name":"Austin, TX"}}}'

# New York — expect 403
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3036/mcp/weather -X POST \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -H 'MCP-Protocol-Version: 2025-11-25' \
  -d '{"jsonrpc":"2.0","id":"2","method":"tools/call","params":{"name":"get_current_conditions","arguments":{"city_name":"New York, NY"}}}'
```
Expected: `200` then `403`. If no token is available, skip — Task 6's e2e script documents
the `LIVE_E2E_BLOCKED` fallback recipe for this exact check.

- [ ] **Step 6: Commit**

```bash
git add ping-gateway/scripts/groovy/tx-weather-scope.groovy ping-gateway/config/routes/00-mcp-weather.json
git commit -m "feat(mcp-weather): add Texas-only geographic scope Groovy filter"
```

---

### Task 6: Extend `e2e-pinggateway.sh` with weather legs

**Files:**
- Modify: `ping-gateway/scripts/e2e-pinggateway.sh`

**Interfaces:**
- Consumes: `PG_URL` (existing script var), `BANKING_TEST_TOKEN` (existing script var, reused
  — the weather route's `rsFilter` checks the same `PG_INBOUND_SCOPE` as OLB/invest, so no
  new token variable is needed).
- Produces: two new legs (`D`, `E`) in the script's PASS/FAIL/LIVE_E2E_BLOCKED summary.

- [ ] **Step 1: Add Leg D (unauthenticated 401) after the existing Leg C block**

Insert before the `echo "== Summary:` line at the end of the script:

```bash
# ── Leg D: PingGateway weather route inbound protection (no token -> 401) ────
D_CODE="$(probe "$PG_URL/mcp/weather" -X POST -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":"1","method":"tools/list"}')"
if [ -z "$D_CODE" ] || [ "$D_CODE" = "000" ]; then
  echo "LIVE_E2E_BLOCKED: PingGateway not reachable at $PG_URL for the weather route."
else
  ran=$((ran+1))
  if [ "$D_CODE" = "401" ]; then
    echo "PASS  Leg D: unauthenticated POST /mcp/weather -> 401 (rsFilter enforcing)"
  else
    echo "FAIL  Leg D: unauthenticated POST /mcp/weather -> $D_CODE (expected 401)"
    fail=1
  fi
fi
echo ""

# ── Leg E: Texas-scope Groovy filter (allow TX, deny non-TX) ──────────────────
if [ -n "${BANKING_TEST_TOKEN:-}" ]; then
  ran=$((ran+1))
  TX_CODE="$(probe "$PG_URL/mcp/weather" -X POST \
    -H "Authorization: Bearer $BANKING_TEST_TOKEN" \
    -H 'Content-Type: application/json' -H 'MCP-Protocol-Version: 2025-11-25' \
    -d '{"jsonrpc":"2.0","id":"1","method":"tools/call","params":{"name":"get_current_conditions","arguments":{"city_name":"Austin, TX"}}}')"
  if [ "$TX_CODE" = "200" ]; then
    echo "PASS  Leg E1: Texas tools/call through PingGateway -> 200"
  else
    echo "FAIL  Leg E1: Texas tools/call -> $TX_CODE (expected 200)"
    fail=1
  fi

  NONTX_CODE="$(probe "$PG_URL/mcp/weather" -X POST \
    -H "Authorization: Bearer $BANKING_TEST_TOKEN" \
    -H 'Content-Type: application/json' -H 'MCP-Protocol-Version: 2025-11-25' \
    -d '{"jsonrpc":"2.0","id":"2","method":"tools/call","params":{"name":"get_current_conditions","arguments":{"city_name":"New York, NY"}}}')"
  if [ "$NONTX_CODE" = "403" ]; then
    echo "PASS  Leg E2: non-Texas tools/call through PingGateway -> 403 (tx-weather-scope.groovy denying)"
  else
    echo "FAIL  Leg E2: non-Texas tools/call -> $NONTX_CODE (expected 403)"
    fail=1
  fi
else
  echo "LIVE_E2E_BLOCKED: no BANKING_TEST_TOKEN — the token-bearing weather-scope legs need"
  echo "  a real bearer token with gateway:mcp:invoke scope (same token Leg C uses)."
  echo "  Manual:  curl -i $PG_URL/mcp/weather -X POST -H 'Authorization: Bearer <tok>' \\"
  echo "             -H 'Content-Type: application/json' -H 'MCP-Protocol-Version: 2025-11-25' \\"
  echo "             -d '{\"jsonrpc\":\"2.0\",\"id\":\"1\",\"method\":\"tools/call\",\"params\":{\"name\":\"get_current_conditions\",\"arguments\":{\"city_name\":\"Austin, TX\"}}}'  (expect 200)"
fi
echo ""
```

- [ ] **Step 2: Run the script**

Run: `bash ping-gateway/scripts/e2e-pinggateway.sh`
Expected: Leg A/B pass as before; Leg D passes (`PASS  Leg D: ...`); Leg E either passes both
sub-legs (if `BANKING_TEST_TOKEN` is set) or prints `LIVE_E2E_BLOCKED` for Leg E (not a
failure). Overall `RESULT: PASS` (script exits 0) as long as nothing prints `FAIL`.

- [ ] **Step 3: Commit**

```bash
git add ping-gateway/scripts/e2e-pinggateway.sh
git commit -m "test(mcp-weather): add e2e legs for /mcp/weather auth + TX-scope"
```

---

### Task 7: BFF-side feature flag + internal endpoint for the weather showcase

**Files:**
- Modify: `demo_api_server/routes/featureFlags.js` (new `FLAG_REGISTRY` entry)
- Create: `demo_api_server/routes/weatherMcpFlag.js`
- Modify: `demo_api_server/server.js` (register the new route)

**Interfaces:**
- Consumes: `configStore.getEffective('ff_weather_mcp_showcase')` — the same singleton and
  method `featureFlags.js`'s own `resolveFlag()` already uses; `BFF_INTERNAL_SECRET` (already
  read elsewhere in this file's sibling `/internal/*` routes).
- Produces: `GET /internal/feature-flags/weather-mcp-showcase` → `{ enabled: true|false }`,
  gated by the `x-internal-gateway-secret` header matching `BFF_INTERNAL_SECRET` (constant-time
  comparison, matching `agentIdToken.js`'s pattern). Task 8 (gateway-side) calls this endpoint
  per-request so a Quick Flags UI toggle takes effect live, with no `ping-gateway` recreate.

This is a real, live-toggleable flag — unlike `PG_OLB_BACKEND_URL`-style static env vars, a
change here is visible on the very next `/mcp/weather` request. Default is enabled (`true`),
matching "starts by default, flag turns it off."

- [ ] **Step 1: Add the `FLAG_REGISTRY` entry**

In `demo_api_server/routes/featureFlags.js`, add a new object to the `FLAG_REGISTRY` array
immediately after the existing `ff_mcp_gateway_pinggateway` entry (same `'MCP / Agent'`
category):

```javascript
  {
    id:           'ff_weather_mcp_showcase',
    name:         'Weather MCP Showcase (Agent Gateway)',
    category:     'MCP / Agent',
    description:
      'Controls whether the Agent Gateway (PingGateway/IG) weather-mcp showcase route ' +
      '(`/mcp/weather`) is enabled. This is a standalone gateway capability demo — a ' +
      'third-party MCP server fronted and scoped to Texas-only by the gateway — with no ' +
      'banking chat/agent wiring. `tx-weather-scope.groovy` calls this flag live on every ' +
      '`/mcp/weather` request via `GET /internal/feature-flags/weather-mcp-showcase`, so ' +
      'toggling it here takes effect immediately, with no gateway restart.',
    impact:
      'ON (default) = /mcp/weather is reachable (subject to the Texas-only scope policy). ' +
      'OFF = every /mcp/weather request is denied with HTTP 403, regardless of location.',
    type:         'boolean',
    defaultValue: true,
  },
```

- [ ] **Step 2: Create the internal endpoint**

```javascript
'use strict';
/**
 * /internal/feature-flags/weather-mcp-showcase — gateway-only endpoint
 *
 * Lets ping-gateway's tx-weather-scope.groovy check the live value of
 * ff_weather_mcp_showcase on every /mcp/weather request, so a Quick Flags UI
 * toggle takes effect immediately with no gateway restart. Same
 * x-internal-gateway-secret gate as this directory's other /internal/* routes.
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

router.get('/feature-flags/weather-mcp-showcase', (req, res) => {
  const presented = req.headers['x-internal-gateway-secret'];
  const presentedBuf = typeof presented === 'string' ? Buffer.from(presented) : null;
  if (
    !presentedBuf ||
    presentedBuf.length !== INTERNAL_SECRET_BUF.length ||
    !crypto.timingSafeEqual(presentedBuf, INTERNAL_SECRET_BUF)
  ) {
    return res.status(403).json({ error: 'forbidden' });
  }

  const raw = configStore.getEffective('ff_weather_mcp_showcase');
  const enabled = (raw === null || raw === undefined) ? true : (raw === true || raw === 'true');
  return res.json({ enabled });
});

module.exports = router;
```

- [ ] **Step 3: Register the route**

In `demo_api_server/server.js`, add one line immediately after the existing
`app.use('/internal', require('./routes/vaultServiceKey'));`:

```javascript
app.use('/internal', require('./routes/weatherMcpFlag'));
```

- [ ] **Step 4: Verify locally**

Start (or use the already-running) `demo_api_server`, then:

```bash
# Wrong/missing secret — expect 403
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3001/internal/feature-flags/weather-mcp-showcase

# Correct secret (read it from demo_api_server/.env — BFF_INTERNAL_SECRET=...) — expect 200 + {"enabled":true}
SECRET=$(grep '^BFF_INTERNAL_SECRET=' demo_api_server/.env | cut -d= -f2-)
curl -s -H "x-internal-gateway-secret: $SECRET" http://localhost:3001/internal/feature-flags/weather-mcp-showcase
```
Expected: first call `403`; second call `200` with body `{"enabled":true}` (the registry
default, since no one has toggled it yet).

Also confirm the flag is visible where the UI reads flags from:
```bash
curl -s http://localhost:3001/api/admin/feature-flags | grep -o '"id":"ff_weather_mcp_showcase"[^}]*}'
```
Expected: an entry with `"defaultValue":true` and `"value":true`.

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/routes/featureFlags.js demo_api_server/routes/weatherMcpFlag.js demo_api_server/server.js
git commit -m "feat(mcp-weather): add ff_weather_mcp_showcase flag + internal endpoint"
```

---

### Task 8: Gateway-side live flag check

**Files:**
- Modify: `ping-gateway/scripts/groovy/tx-weather-scope.groovy` (prepend the live check)
- Modify: `docker-compose.yml` (add `BFF_WEATHER_FLAG_URL` to `ping-gateway`'s `environment:`)

**Interfaces:**
- Consumes: `GET /internal/feature-flags/weather-mcp-showcase` (Task 7), the existing
  `BFF_INTERNAL_SECRET` env var (already present in the `ping-gateway` container via
  `env_file`, written by `refresh-service-envs.js` — no change needed to make it available),
  and the new `BFF_WEATHER_FLAG_URL` env var.
- Produces: every `/mcp/weather` request now pays one blocking HTTP round-trip to the BFF
  before the Texas-scope logic runs. Fails OPEN (treats the capability as enabled) if the
  call errors, times out, or `BFF_WEATHER_FLAG_URL` is unset — this is a demo-showcase
  on/off toggle, not a security control (the actually security-relevant Texas-scope check
  stays fail-closed, unchanged by this task).

- [ ] **Step 1: Add `BFF_WEATHER_FLAG_URL` to `docker-compose.yml`**

In the `ping-gateway` service's `environment:` block, next to the existing
`BFF_VAULT_KEY_URL` line, in the same literal-URL style:

```yaml
      BFF_VAULT_KEY_URL: "https://api.ping.demo:3001/internal/vault/service-key"
      BFF_WEATHER_FLAG_URL: "https://api.ping.demo:3001/internal/feature-flags/weather-mcp-showcase"
```

- [ ] **Step 2: Edit `tx-weather-scope.groovy` — prepend the live flag check**

Read the current file first. Add the imports/closures below immediately after the existing
`import` lines (before the `TX_LAT_MIN` constant), and replace the existing `def id = ...`
line (currently found just after the `tools/call`-only gate) — this hoists id-extraction
earlier so the flag-check has an `id` to echo on denial, matching every other `denied(id, ...)`
call in this file:

```groovy
def internalSecret = System.getenv('BFF_INTERNAL_SECRET') ?: ''
def flagUrl         = System.getenv('BFF_WEATHER_FLAG_URL') ?: ''

// Live on/off check against the BFF's ff_weather_mcp_showcase flag. Fails OPEN
// (enabled) on any error — this is a demo toggle, not a security control; the
// Texas-scope check below remains fail-closed regardless of this result.
def weatherShowcaseEnabled = {
    if (!flagUrl) return true
    try {
        def conn = new URL(flagUrl).openConnection() as java.net.HttpURLConnection
        conn.requestMethod = 'GET'
        conn.connectTimeout = 2000
        conn.readTimeout = 3000
        if (internalSecret) conn.setRequestProperty('x-internal-gateway-secret', internalSecret)
        def code = conn.responseCode
        if (code != 200) {
            logger.warn('[TxWeatherScope] flag check HTTP ' + code + ' — failing open (enabled)')
            return true
        }
        def respBody = conn.inputStream?.text ?: '{}'
        def parsed = new JsonSlurper().parseText(respBody)
        return parsed.enabled != false
    } catch (Exception e) {
        logger.warn('[TxWeatherScope] flag check failed: ' + e.message + ' — failing open (enabled)')
        return true
    }
}
```

Then change the body-parsing section from:

```groovy
if (!(body instanceof Map) || body.method != 'tools/call') {
    return next.handle(context, request)
}

def id = body.containsKey('id') ? body.id : null
def params = body.params
```

to:

```groovy
def id = (body instanceof Map && body.containsKey('id')) ? body.id : null

if (!weatherShowcaseEnabled()) {
    return denied(id, 'Agent Gateway: weather capability disabled (ff_weather_mcp_showcase is off)')
}

if (!(body instanceof Map) || body.method != 'tools/call') {
    return next.handle(context, request)
}

def params = body.params
```

Leave everything else in the file (the Texas bounding-box/city logic, the `denied` closure)
unchanged.

- [ ] **Step 3: Validate, recreate, and verify**

```bash
bash ping-gateway/scripts/validate-config.sh
COMPOSE_PROJECT_NAME=ai-demo docker compose up -d ping-gateway
```
Expected: passes; container healthy.

Confirm unauthenticated access still 401s first (the flag check runs after `rsFilter`, so
auth is checked before the flag ever matters):
```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3036/mcp/weather -X POST \
  -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":"1","method":"tools/list"}'
```
Expected: `401`.

If `BANKING_TEST_TOKEN` is available, prove the LIVE toggle end-to-end (no gateway recreate
between these two calls):
```bash
TOKEN="<paste a token with gateway:mcp:invoke scope>"
SECRET=$(grep '^BFF_INTERNAL_SECRET=' demo_api_server/.env | cut -d= -f2-)

# Flip the flag off
curl -s -X PATCH http://localhost:3001/api/admin/feature-flags \
  -H 'Content-Type: application/json' -d '{"ff_weather_mcp_showcase": false}'

# Expect 403 now, with no ping-gateway recreate in between
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3036/mcp/weather -X POST \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -H 'MCP-Protocol-Version: 2025-11-25' \
  -d '{"jsonrpc":"2.0","id":"1","method":"tools/call","params":{"name":"get_current_conditions","arguments":{"city_name":"Austin, TX"}}}'

# Flip it back on
curl -s -X PATCH http://localhost:3001/api/admin/feature-flags \
  -H 'Content-Type: application/json' -d '{"ff_weather_mcp_showcase": true}'

# Expect 200 again, immediately, no recreate
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3036/mcp/weather -X POST \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -H 'MCP-Protocol-Version: 2025-11-25' \
  -d '{"jsonrpc":"2.0","id":"2","method":"tools/call","params":{"name":"get_current_conditions","arguments":{"city_name":"Austin, TX"}}}'
```
Expected: `403`, then `200` — proving the toggle is genuinely live. If no token is available,
skip this block (same `LIVE_E2E_BLOCKED`-style limitation as Task 5/6) but still confirm the
401 check above.

- [ ] **Step 4: Commit**

```bash
git add ping-gateway/scripts/groovy/tx-weather-scope.groovy docker-compose.yml
git commit -m "feat(mcp-weather): wire live ff_weather_mcp_showcase check into gateway route"
```

---

### Task 9: Add the Agent Gateway capability-ledger entry

**Files:**
- Modify: `demo_api_ui/src/config/capabilityLedgers/agentGatewayCapabilities.js`

**Interfaces:**
- Consumes: nothing from earlier tasks at runtime — this is a static UI data entry. It cites
  file:line evidence from the Groovy file, which Task 8 also edits — do this task last (after
  Task 8, not before) so the line-count evidence matches the final committed file.

- [ ] **Step 1: Get the exact line count of the Groovy filter (for the evidence string)**

Run: `wc -l ping-gateway/scripts/groovy/tx-weather-scope.groovy`
Note the number `N` printed — use `1-N` as the line range in the evidence string below. Do
not guess or reuse a number from this plan; the file has been edited by both Task 5 and Task
8, so this must be the actual current count.

- [ ] **Step 2: Add the new capability entry**

In `demo_api_ui/src/config/capabilityLedgers/agentGatewayCapabilities.js`, add a new object to
the `AGENT_GATEWAY_CAPABILITIES` array, after the `mcp-validation` entry (same
`validate-audit` group), substituting `N` from Step 1:

```javascript
  {
    id: 'weather-tx-scope',
    group: 'validate-audit',
    title: 'Scope a third-party MCP server',
    oneLiner: 'Fronts a third-party weather MCP server and denies any tool call outside Texas, entirely at the gateway — the demo policy the backend never sees. Live-toggleable via ff_weather_mcp_showcase.',
    evidence: { code: 'PingGateway only — no Node mcp-gateway equivalent: ping-gateway/scripts/groovy/tx-weather-scope.groovy:1-N · ping-gateway/config/routes/00-mcp-weather.json · demo_api_server/routes/weatherMcpFlag.js' },
    relatedUCIds: [],
  },
```

- [ ] **Step 3: Confirm the UI still builds**

Run: `cd demo_api_ui && npm run build && cd ..`
Expected: build succeeds (no syntax error in the ledger file).

- [ ] **Step 4: Commit**

```bash
git add demo_api_ui/src/config/capabilityLedgers/agentGatewayCapabilities.js
git commit -m "feat(mcp-weather): add Agent Gateway capability-ledger entry"
```

---

### Task 10: Full-stack verification pass

**Files:** none (verification only)

**Interfaces:** none — this task confirms Tasks 1–9 work together.

- [ ] **Step 1: Bring up the full affected slice**

Run: `COMPOSE_PROJECT_NAME=ai-demo docker compose up -d --build mcp-weather ping-gateway demo-api-server`
Expected: all three containers healthy (`demo-api-server` — the BFF — is included this time
because Task 7/8 added a live gateway→BFF dependency that wasn't there before).

- [ ] **Step 2: Re-run config validation and the e2e script**

Run:
```bash
bash ping-gateway/scripts/validate-config.sh
bash ping-gateway/scripts/e2e-pinggateway.sh
```
Expected: `validate-config.sh` passes; `e2e-pinggateway.sh` exits 0 with no `FAIL` lines
(Leg E may report `LIVE_E2E_BLOCKED` if no token is available — that's an expected,
documented outcome, not a failure).

- [ ] **Step 3: If `BANKING_TEST_TOKEN` is available, run the full token-bearing check**

Run: `BANKING_TEST_TOKEN=<tok> bash ping-gateway/scripts/e2e-pinggateway.sh`
Expected: `RESULT: PASS`, Legs A/B/C/D/E all `PASS` (Leg C is the pre-existing banking leg;
confirm this change didn't regress it).

- [ ] **Step 4: Re-verify the live flag toggle end-to-end**

If `BANKING_TEST_TOKEN` is available, repeat Task 8 Step 3's PATCH-then-curl sequence once
more here as a final cross-task check (flip `ff_weather_mcp_showcase` off, confirm `403` on
`/mcp/weather`, flip it back on, confirm `200` again) — this is the one behavior that spans
Tasks 7, 8, AND the full running stack together, so it's worth re-proving after everything is
up rather than trusting Task 8's isolated result alone.

- [ ] **Step 5: Confirm success criteria from the spec**

Check off each, from `docs/superpowers/specs/2026-07-21-weather-mcp-agent-gateway-design.md`:
- [ ] `/mcp/weather` route live and reachable through `ping-gateway` (and NOT shadowed by
  `01-mcp-olb.json` — confirm via the `WWW-Authenticate` header check from Task 4 Step 5)
- [ ] A Texas-scoped request returns real weather data (200)
- [ ] A non-Texas request is denied by the Groovy filter (403), not by upstream weather-mcp
- [ ] `ff_weather_mcp_showcase` toggled off denies all `/mcp/weather` traffic live, with no
  gateway recreate; toggled back on, it resumes immediately
- [ ] `validate-config.sh` passes clean
- [ ] Both new `e2e-pinggateway.sh` legs pass (or are honestly `LIVE_E2E_BLOCKED`, not silently skipped)
- [ ] Capability card renders (verify by loading the Agent Gateway tour page in a browser)

- [ ] **Step 6: No commit for this task** — it's verification only. If any check fails, return
  to the relevant task, fix, and re-run this task's checks before considering the plan done.

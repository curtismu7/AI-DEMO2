# Startup Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the startup process across all 8 services and `run.sh` so every failure surfaces immediately with actionable output, services start in dependency order, and each service validates its config before binding.

**Architecture:** `run.sh` gains `wait_for_health` (port + HTTP 200 check with log-tail on timeout), a pre-launch env pass, and a tiered startup sequence. The three weakest services (HITL, mortgage, agent service) gain graceful shutdown drains; HITL, mortgage, and MCP Invest gain env validation startup warnings; HITL and agent service health endpoints gain `uptime`/`checks`; MCP Invest health endpoint gains `uptime`. The MCP server already has `/health` (returns HTTP 200) — no change needed there.

**Tech Stack:** bash (run.sh), Node.js CommonJS (hitl, mortgage), TypeScript (mcp_invest, agent_service)

---

## File Map

| File | Change |
|------|--------|
| `run.sh` | Add `wait_for_health` + `_health_timeout_report`; pre-launch env pass; tiered launch sequence; updated `print_status_table` with health column; updated `service_status_line` |
| `demo_hitl_service/src/index.js` | Env startup warn, graceful shutdown drain, richer `/health` (uptime + checks.env), structured ready log |
| `demo_mortgage_service/server.js` | Env startup warn (default API key), graceful shutdown, structured ready log |
| `demo_mcp_invest/src/index.ts` | Env startup warn (`RESOURCE_URI`), add `uptime` to `/health` |
| `demo_agent_service/src/index.ts` | Replace `process.exit(0)` handlers with `server.close()` + 5s drain; add `uptime`/`checks` to `/health` |

**Not changed:** `demo_mcp_server` (already has `/health` at HTTP 200), `demo_mcp_gateway` (already compliant), `demo_api_server` (already compliant), `langchain_agent` (already compliant).

---

## Task 1: demo_hitl_service — env validation + graceful shutdown + health + ready log

**Files:**
- Modify: `demo_hitl_service/src/index.js`

- [ ] **Step 1: Read and understand the current file**

  Open `demo_hitl_service/src/index.js`. Note:
  - Line 30: `PORT` parsed from env with default `3009`
  - Line 38-41: `ALLOWED_ORIGINS` split from `HITL_ALLOWED_ORIGINS` with no warning if empty
  - Line 55-57: `/health` returns `{ status, service, ts }` — needs `uptime` + `checks`
  - Line 71-77: `app.listen(...)` logs via `teachLog.info` — needs structured ready log
  - Lines 79-80: `process.on('SIGINT'/'SIGTERM', () => process.exit(0))` — no drain

- [ ] **Step 2: Replace the file with the hardened version**

  Replace `demo_hitl_service/src/index.js` entirely with:

  ```javascript
  'use strict';
  
  /**
   * banking-hitl-service — entry point
   *
   * Standalone REST service for Human-in-the-Loop approval flows.
   * Extracted from banking_api_server (transactionConsentChallenge.js + cibaService.js).
   *
   * REST API:
   *   POST   /challenges               — MCP Gateway creates a HITL challenge
   *   GET    /challenges/:id           — MCP Gateway polls for decision
   *   POST   /challenges/:id/respond   — Human approves or denies via dashboard/webhook
   *   GET    /challenges               — Dashboard lists pending challenges
   *   GET    /health                   — liveness probe
   *
   * Token flow:
   *   MCP Gateway → POST /challenges (internal service call, no user token required)
   *   Dashboard   → POST /challenges/:id/respond (user token from OLB App session)
   *
   * Start: node src/index.js
   */
  
  require('dotenv').config();
  
  const express = require('express');
  const challengeRoutes = require('./routes/challenges');
  const { teachLog } = require('./teachLogger');
  const { correlationMiddleware } = require('./correlationMiddleware');
  
  const PORT = parseInt(process.env.PORT || '3009', 10);
  const HOST = process.env.HOST || '0.0.0.0';
  
  const app = express();
  app.use(express.json());
  app.use(correlationMiddleware);
  
  // CORS — allow OLB dashboard and MCP Gateway
  const ALLOWED_ORIGINS = (process.env.HITL_ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  
  // Startup env validation — warn loudly so run.sh log tail shows the issue
  if (!ALLOWED_ORIGINS.length) {
    console.warn(
      '[demo-hitl-service] WARNING: HITL_ALLOWED_ORIGINS is not set. ' +
      'CORS will allow all origins — set this to a comma-separated list of ' +
      'allowed origins (e.g. https://api.ping.demo:4000,https://api.ping.demo:3005) ' +
      'in demo_api_server/.env'
    );
  }
  
  const _envOk = ALLOWED_ORIGINS.length > 0;
  
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (!ALLOWED_ORIGINS.length || (origin && ALLOWED_ORIGINS.includes(origin))) {
      res.setHeader('Access-Control-Allow-Origin', origin || '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    }
    if (req.method === 'OPTIONS') { res.sendStatus(204); return; }
    next();
  });
  
  // Health — includes uptime and env check result
  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'banking-hitl-service',
      uptime: process.uptime(),
      checks: {
        env: _envOk ? 'ok' : 'warn',
      },
    });
  });
  
  // Challenge routes
  app.use('/challenges', challengeRoutes);
  
  // 404
  app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
  
  // Error handler
  app.use((err, _req, res, _next) => {
    teachLog.error('unhandled error', err, { message: err.message });
    res.status(500).json({ error: 'Internal server error' });
  });
  
  const server = app.listen(PORT, HOST, () => {
    teachLog.info('hitl service listening', {
      host: HOST,
      port: PORT,
      notifyMode: process.env.HITL_NOTIFY_MODE || 'log',
      dashboardUrl: process.env.HITL_DASHBOARD_URL || 'http://localhost:3000/dashboard/approve',
    });
    console.log(`[demo-hitl-service] Ready on :${PORT}`);
  });
  
  // Graceful shutdown — drain in-flight requests before exit
  const shutdown = (signal) => {
    console.log(`[demo-hitl-service] ${signal} received — shutting down`);
    server.close(() => {
      console.log('[demo-hitl-service] HTTP server closed');
      process.exit(0);
    });
    setTimeout(() => {
      console.error('[demo-hitl-service] Drain timeout — forcing exit');
      process.exit(1);
    }, 5000);
  };
  process.on('SIGINT',  () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  ```

- [ ] **Step 3: Verify the service starts cleanly**

  ```bash
  cd /path/to/repo/demo_hitl_service
  node src/index.js
  ```
  Expected output includes:
  ```
  [demo-hitl-service] WARNING: HITL_ALLOWED_ORIGINS is not set...
  [demo-hitl-service] Ready on :3009
  ```
  Then:
  ```bash
  curl -s http://localhost:3009/health | python3 -m json.tool
  ```
  Expected:
  ```json
  {
    "status": "ok",
    "service": "banking-hitl-service",
    "uptime": <number>,
    "checks": { "env": "warn" }
  }
  ```
  Kill with Ctrl+C — should see `SIGINT received — shutting down` then `HTTP server closed`.

- [ ] **Step 4: Commit**

  ```bash
  git add demo_hitl_service/src/index.js
  git commit -m "feat(hitl): env validation, graceful shutdown drain, richer /health"
  ```

---

## Task 2: demo_mortgage_service — env validation + graceful shutdown + ready log

**Files:**
- Modify: `demo_mortgage_service/server.js`

- [ ] **Step 1: Read and understand the current file**

  Open `demo_mortgage_service/server.js`. Note:
  - Line 23: `API_KEY` defaults to `'demo-mortgage-key-0000'` with no warning
  - Lines 166-171: `app.listen(...)` with bare `console.log` — needs structured ready log
  - No shutdown handlers anywhere

- [ ] **Step 2: Add env validation, graceful shutdown, and ready log**

  Make these three targeted edits to `demo_mortgage_service/server.js`:

  **Edit 1** — Add API key warning after the `API_KEY` declaration (after line 23, before `const app`):

  ```javascript
  // Startup env validation
  const DEFAULT_MORTGAGE_KEY = 'demo-mortgage-key-0000';
  if (API_KEY === DEFAULT_MORTGAGE_KEY) {
    console.warn(
      '[demo-mortgage-service] WARNING: MORTGAGE_SERVICE_API_KEY is not set — ' +
      'using the insecure default key. Set MORTGAGE_SERVICE_API_KEY in ' +
      'demo_api_server/.env for a real deployment.'
    );
  }
  ```

  **Edit 2** — Replace the `app.listen` block (lines 166-171) with:

  ```javascript
  if (require.main === module) {
    const server = app.listen(PORT, HOST, () => {
      console.log(`[demo-mortgage-service] Ready on :${PORT}`);
      console.log(`[demo-mortgage-service] API key (last 4): ...${API_KEY.length >= 4 ? API_KEY.slice(-4) : 'XXXX'}`);
    });

    // Graceful shutdown — drain in-flight requests before exit
    const shutdown = (signal) => {
      console.log(`[demo-mortgage-service] ${signal} received — shutting down`);
      server.close(() => {
        console.log('[demo-mortgage-service] HTTP server closed');
        process.exit(0);
      });
      setTimeout(() => {
        console.error('[demo-mortgage-service] Drain timeout — forcing exit');
        process.exit(1);
      }, 5000);
    };
    process.on('SIGINT',  () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  }
  ```

- [ ] **Step 3: Verify the service starts cleanly**

  ```bash
  cd /path/to/repo/demo_mortgage_service
  node server.js
  ```
  Expected:
  ```
  [demo-mortgage-service] WARNING: MORTGAGE_SERVICE_API_KEY is not set...
  [demo-mortgage-service] Ready on :8082
  [demo-mortgage-service] API key (last 4): ...0000
  ```
  Then:
  ```bash
  curl -s http://localhost:8082/health | python3 -m json.tool
  ```
  Expected:
  ```json
  { "status": "ok", "service": "banking_mortgage_service", "port": 8082, "apiKeyLast4": "0000" }
  ```
  Kill with Ctrl+C — should see `SIGINT received — shutting down` then `HTTP server closed`.

- [ ] **Step 4: Commit**

  ```bash
  git add demo_mortgage_service/server.js
  git commit -m "feat(mortgage): env validation warn, graceful shutdown drain, structured ready log"
  ```

---

## Task 3: demo_mcp_invest — env validation + uptime in /health

**Files:**
- Modify: `demo_mcp_invest/src/index.ts`

- [ ] **Step 1: Read and understand the current file**

  Open `demo_mcp_invest/src/index.ts`. Note:
  - Line 28: `RESOURCE_URI` defaults silently to `'https://mcp-invest.ping.demo'` — needs warn
  - Lines 60-64: `/health` returns `{ status, service, resourceUri }` — needs `uptime`
  - This is a TypeScript file compiled to `dist/` — changes require `npm run build`

- [ ] **Step 2: Add env warning after RESOURCE_URI declaration**

  After line 28 (the `RESOURCE_URI` const), add:

  ```typescript
  // Startup env validation
  if (!process.env.MCP_SERVER_RESOURCE_URI) {
    console.warn(
      '[demo-mcp-invest] WARNING: MCP_SERVER_RESOURCE_URI is not set — ' +
      `using default '${RESOURCE_URI}'. Token audience validation may fail. ` +
      'Set MCP_SERVER_RESOURCE_URI in demo_api_server/.env'
    );
  }
  ```

- [ ] **Step 3: Add uptime to the /health response**

  Find the health handler (lines 60-64):
  ```typescript
  if (url === '/health' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'banking-mcp-invest', resourceUri: RESOURCE_URI }));
    return;
  }
  ```

  Replace with:
  ```typescript
  if (url === '/health' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      service: 'banking-mcp-invest',
      uptime: process.uptime(),
      resourceUri: RESOURCE_URI,
    }));
    return;
  }
  ```

- [ ] **Step 4: Build and verify**

  ```bash
  cd /path/to/repo/demo_mcp_invest
  npm run build
  ```
  Expected: exit 0, `dist/index.js` updated.

  ```bash
  node dist/index.js
  ```
  Expected:
  ```
  [demo-mcp-invest] WARNING: MCP_SERVER_RESOURCE_URI is not set...
  ```
  (or no warning if `MCP_SERVER_RESOURCE_URI` is set in your `.env`)

  ```bash
  curl -s http://localhost:8081/health | python3 -m json.tool
  ```
  Expected:
  ```json
  { "status": "ok", "service": "banking-mcp-invest", "uptime": <number>, "resourceUri": "https://mcp-invest.ping.demo" }
  ```

- [ ] **Step 5: Commit**

  ```bash
  git add demo_mcp_invest/src/index.ts demo_mcp_invest/dist/index.js
  git commit -m "feat(mcp-invest): env validation warn, add uptime to /health"
  ```

---

## Task 4: demo_agent_service — graceful shutdown drain + richer /health

**Files:**
- Modify: `demo_agent_service/src/index.ts`

- [ ] **Step 1: Read and understand the current file**

  Open `demo_agent_service/src/index.ts`. Note:
  - Lines 99-100: `process.on('SIGINT'/'SIGTERM', () => process.exit(0))` — no drain
  - Line 86: `const server = app.listen(...)` — wait, `app.listen` is called but the return value is NOT stored. We need to store it.
  - Line 78-80: `/health` returns `{ status, service, ts }` — needs `uptime` + `checks`
  - The whole body is inside an async IIFE starting at line 30 — edits must stay inside it

- [ ] **Step 2: Store the server reference from app.listen**

  Find the current `app.listen` call (line 86):
  ```typescript
  app.listen(config.port, config.host, () => {
    console.log(`[Agent] banking-agent-service running on ${config!.host}:${config!.port}`);
    ...
  });
  ```

  Replace with (store the return value):
  ```typescript
  const server = app.listen(config.port, config.host, () => {
    console.log(`[Agent] banking-agent-service running on ${config!.host}:${config!.port}`);
    if (config!.host === '0.0.0.0') {
      console.warn(
        `[Agent] ⚠️  Bound to ALL interfaces (0.0.0.0). :3006 is loopback-only per ` +
          `REGRESSION_PLAN §3 — set HOST=127.0.0.1 unless this deploy is firewalled.`,
      );
    }
    console.log(`[Agent] LLM provider: ${config!.llmProvider} / model: ${config!.llmModel}`);
    console.log(`[Agent] Mode: reasoning-only (BFF holds token custody)`);
    console.log(`[Agent] PKI creds: ${config!.usePkiCreds ? 'enabled' : 'disabled (client_secret)'}`);
    console.log(`[demo-agent-service] Ready on :${config!.port}`);
  });
  ```

- [ ] **Step 3: Replace the SIGINT/SIGTERM handlers with drain-aware shutdown**

  Find lines 99-100:
  ```typescript
  process.on('SIGINT', () => process.exit(0));
  process.on('SIGTERM', () => process.exit(0));
  ```

  Replace with:
  ```typescript
  const shutdown = (signal: string): void => {
    console.log(`[demo-agent-service] ${signal} received — shutting down`);
    server.close(() => {
      console.log('[demo-agent-service] HTTP server closed');
      process.exit(0);
    });
    setTimeout(() => {
      console.error('[demo-agent-service] Drain timeout — forcing exit');
      process.exit(1);
    }, 5000);
  };
  process.on('SIGINT',  () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  ```

- [ ] **Step 4: Enrich the /health endpoint**

  Find the current health handler (line 78-80):
  ```typescript
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'banking-agent-service', ts: new Date().toISOString() });
  });
  ```

  Replace with:
  ```typescript
  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'banking-agent-service',
      uptime: process.uptime(),
      checks: {
        env: 'ok',
      },
    });
  });
  ```

- [ ] **Step 5: Build and verify**

  ```bash
  cd /path/to/repo/demo_agent_service
  npm run build
  ```
  Expected: exit 0.

  ```bash
  PORT=3006 node dist/index.js
  ```
  Expected (last line of startup):
  ```
  [demo-agent-service] Ready on :3006
  ```

  ```bash
  curl -s http://localhost:3006/health | python3 -m json.tool
  ```
  Expected:
  ```json
  { "status": "ok", "service": "banking-agent-service", "uptime": <number>, "checks": { "env": "ok" } }
  ```
  Kill with Ctrl+C — should see `SIGINT received — shutting down` then `HTTP server closed`.

- [ ] **Step 6: Commit**

  ```bash
  git add demo_agent_service/src/index.ts demo_agent_service/dist/index.js
  git commit -m "feat(agent-service): graceful shutdown drain, structured ready log, richer /health"
  ```

---

## Task 5: run.sh — add wait_for_health and _health_timeout_report

**Files:**
- Modify: `run.sh`

- [ ] **Step 1: Add the two new helper functions after `wait_for_port`**

  Find the existing `wait_for_port` function in `run.sh` (around line 347). After its closing `}`, add these two new functions:

  ```bash
  # Verify a service is truly healthy: first wait for TCP port, then poll HTTP /health
  # until HTTP 200. On timeout, prints the last 20 lines of the service log.
  # Args: port path timeout label log_file
  # Returns "up" or "timeout" on stdout (same contract as wait_for_port).
  wait_for_health() {
    local port="$1" path="$2" timeout="${3:-25}" label="${4:-:$1}" log_file="${5:-}"
    local interactive=0
    [[ -t 2 ]] && interactive=1

    # Phase 1: wait for TCP port (half the timeout budget)
    local port_timeout=$(( timeout / 2 ))
    if [[ "$(wait_for_port "$port" "$port_timeout" "$label")" == "timeout" ]]; then
      _health_timeout_report "$label" "$log_file"
      echo "timeout"; return 1
    fi

    # Phase 2: poll /health until HTTP 200
    local i=0 remaining=$(( timeout - port_timeout ))
    [[ $interactive -eq 1 ]] && printf "    polling health for %s" "$label" >&2
    while [[ $i -lt $remaining ]]; do
      local http_code
      http_code=$(curl -s -o /dev/null -w "%{http_code}" \
        --max-time 2 --insecure "http://localhost:${port}${path}" 2>/dev/null || echo "000")
      if [[ "$http_code" == "200" ]]; then
        [[ $interactive -eq 1 ]] && printf " — healthy after %ds\n" "$i" >&2
        echo "up"; return 0
      fi
      [[ $interactive -eq 1 ]] && printf "." >&2
      sleep 1; (( i++ )) || true
    done
    [[ $interactive -eq 1 ]] && printf " — TIMEOUT after %ds\n" "$timeout" >&2

    _health_timeout_report "$label" "$log_file"
    echo "timeout"; return 1
  }

  # Print last 20 lines of a service log when health check times out.
  _health_timeout_report() {
    local label="$1" log_file="$2"
    echo "" >&2
    err "$label did not become healthy"
    if [[ -n "$log_file" && -f "$log_file" ]]; then
      echo -e "  ${DIM}Last 20 lines of ${log_file}:${RESET}"
      echo -e "  ${DIM}$(printf '─%.0s' {1..60})${RESET}"
      tail -20 "$log_file" | sed 's/^/    /'
      echo -e "  ${DIM}$(printf '─%.0s' {1..60})${RESET}"
    fi
    echo ""
    warn "Run ./run.sh status to see current service state."
  }
  ```

- [ ] **Step 2: Verify the functions are syntactically valid**

  ```bash
  bash -n run.sh
  ```
  Expected: no output (clean parse).

- [ ] **Step 3: Commit**

  ```bash
  git add run.sh
  git commit -m "feat(run.sh): add wait_for_health + _health_timeout_report helpers"
  ```

---

## Task 6: run.sh — pre-launch env pass + tiered startup sequence

**Files:**
- Modify: `run.sh`

- [ ] **Step 1: Move ensure_service_env calls to a pre-launch block**

  Find the section in `run.sh` that starts `# ── Demo MCP Server on :8080` (around line 731). Before the first service launch block (`# ── Demo API Server`) but after the vault preflight and `NODE_EXTRA_CA_CERTS` export, insert a pre-launch env pass:

  ```bash
  # ── Pre-launch: symlink all service .envs before any process starts ──────────
  # Done as a single pass here so no service can start before its .env is in place.
  # (Previously each ensure_service_env was called inline just before that service's
  # launch block, creating a race on the first service.)
  for _svc in demo_mcp_server demo_mcp_gateway demo_hitl_service \
              demo_agent_service demo_mcp_invest; do
    [[ -d "$BASEDIR/$_svc" ]] && ensure_service_env "$_svc"
  done
  unset _svc
  ```

  Then **remove** the inline `ensure_service_env <svc>` calls from each individual service launch block (they will now be redundant). There is one before each of:
  - `demo_mcp_server` launch
  - `demo_mcp_gateway` launch
  - `demo_hitl_service` launch
  - `demo_agent_service` launch
  - `demo_mcp_invest` launch

- [ ] **Step 2: Replace the flat health-check block with the tiered sequence**

  Find the current flat wait block (around line 858-866):
  ```bash
  wait_for_port "${API_PORT}" 25 "Demo API Server"    >/dev/null
  wait_for_port 8080         25 "Demo MCP Server"    >/dev/null
  wait_for_port 3005         15 "MCP Gateway"        >/dev/null
  wait_for_port 3009         15 "HITL Service"       >/dev/null
  wait_for_port 3006         15 "Agent Service"      >/dev/null
  wait_for_port 8081         15 "MCP Invest Server"  >/dev/null
  wait_for_port 8082         10 "Demo Mortgage"      >/dev/null
  wait_for_port "${UI_PORT}" 60 "Demo UI"            >/dev/null
  sleep 1   # give LangChain agent a moment too
  ```

  And the launch blocks for the services. The new structure reorganises both the launch blocks AND the waits. Replace the entire "START SERVICES" section (from after `preflight_checks` to before the banner) with:

  ```bash
  # ══════════════════════════════════════════════════════════════════
  # TIER 1 — Foundation: API Server
  # ══════════════════════════════════════════════════════════════════
  echo "[LAUNCH] Starting Demo API Server on ${API_HOST}:${API_PORT}..."
  (
    cd "$BASEDIR/demo_api_server"
    PORT=${API_PORT} \
    NODE_EXTRA_CA_CERTS="${NODE_EXTRA_CA_CERTS:-}" \
    REACT_APP_CLIENT_URL=${CLIENT_URL} \
    FRONTEND_ADMIN_URL=${CLIENT_URL}/admin \
    FRONTEND_DASHBOARD_URL=${CLIENT_URL}/dashboard \
    MCP_GATEWAY_HTTP_URL="${MCP_GATEWAY_HTTP_URL:-https://api.ping.demo:3005}" \
    VAULT_PASSWORD="${VAULT_PASSWORD:-}" \
    VAULT_PATH="${VAULT_PATH:-}" \
    npm start > /tmp/demo-api.log 2>&1
  ) &
  echo $! > "$PID_API"

  # Gate: Tier 2 blocked until API server is healthy
  wait_for_health "${API_PORT}" "/api/healthz" 30 "Demo API Server" "${LOG_API}" >/dev/null

  # ══════════════════════════════════════════════════════════════════
  # TIER 2 — Core backend (depends on API server)
  # ══════════════════════════════════════════════════════════════════
  if [[ -d "$BASEDIR/demo_mcp_server" ]]; then
    echo "[BOT] Starting Demo MCP Server on :8080..."
    (
      cd "$BASEDIR/demo_mcp_server"
      npm start > /tmp/demo-mcp.log 2>&1
    ) &
    echo $! > "$PID_MCP"
  fi

  if [[ -d "$BASEDIR/demo_mcp_gateway" ]]; then
    echo "[SHIELD]  Starting MCP Gateway on :3005..."
    (
      cd "$BASEDIR/demo_mcp_gateway"
      VAULT_PASSWORD="${VAULT_PASSWORD:-}" \
      VAULT_PATH="${VAULT_PATH:-}" \
      npm start > "${LOG_GW}" 2>&1
    ) &
    echo $! > "$PID_GW"
  fi

  if [[ -d "$BASEDIR/demo_hitl_service" ]]; then
    echo "[ALERT] Starting HITL Service on :3009..."
    (
      cd "$BASEDIR/demo_hitl_service"
      PORT=3009 npm start > "${LOG_HITL}" 2>&1
    ) &
    echo $! > "$PID_HITL"
  fi

  # Wait for Tier 2 services; gate Tier 3 on gateway health
  wait_for_health 8080 "/health" 25 "Demo MCP Server"  "${LOG_MCP}"  >/dev/null
  wait_for_health 3005 "/health" 15 "MCP Gateway"      "${LOG_GW}"   >/dev/null
  wait_for_health 3009 "/health" 15 "HITL Service"     "${LOG_HITL}" >/dev/null

  # ══════════════════════════════════════════════════════════════════
  # TIER 3 — Dependent services + UI (UI launched now so CRA compile
  #           runs in parallel while Tier 3 services start)
  # ══════════════════════════════════════════════════════════════════
  if [[ -d "$BASEDIR/demo_agent_service" ]]; then
    echo "[CONNECT] Starting Agent Service on :3006..."
    (
      cd "$BASEDIR/demo_agent_service"
      PORT=3006 \
      VAULT_PASSWORD="${VAULT_PASSWORD:-}" \
      VAULT_PATH="${VAULT_PATH:-}" \
      npm start > "${LOG_AGENT_SVC}" 2>&1
    ) &
    echo $! > "$PID_AGENT_SVC"
  fi

  if [[ -d "$BASEDIR/demo_mcp_invest" ]]; then
    echo "[INVEST] Starting MCP Invest Server on :8081..."
    (
      cd "$BASEDIR/demo_mcp_invest"
      PORT=8081 npm start > "${LOG_INVEST}" 2>&1
    ) &
    echo $! > "$PID_INVEST"
  fi

  if [[ -d "$BASEDIR/demo_mortgage_service" ]]; then
    echo "[MORTGAGE] Starting Mortgage Service on :8082..."
    (
      cd "$BASEDIR/demo_mortgage_service"
      MORTGAGE_SERVICE_PORT=8082 npm start > "${LOG_MORTGAGE}" 2>&1
    ) &
    echo $! > "$PID_MORTGAGE"
  fi

  # UI launched now so CRA's slow compile runs in parallel with Tier 3 waits
  echo "[WEB] Starting Demo UI on ${CLIENT_URL}..."
  (
    cd "$BASEDIR/demo_api_ui"
    HOST=0.0.0.0 \
    PORT=${UI_PORT} \
    HTTPS=true \
    SSL_CRT_FILE=${CERT_FILE} \
    SSL_KEY_FILE=${KEY_FILE} \
    REACT_APP_API_URL=${API_URL} \
    REACT_APP_API_PORT=${API_PORT} \
    REACT_APP_API_HTTPS=true \
    REACT_APP_CLIENT_URL=${CLIENT_URL} \
    DANGEROUSLY_DISABLE_HOST_CHECK=true \
    WDS_SOCKET_PORT=0 \
    npm start > /tmp/demo-ui.log 2>&1
  ) &
  echo $! > "$PID_UI"

  # Optional: LangChain agent (fire-and-forget, not a gate)
  if [[ -f "$BASEDIR/langchain_agent/src/main.py" ]]; then
    echo "[CHAIN] Starting LangChain Agent (chat WS :8889, health :8890)..."
    (
      cd "$BASEDIR/langchain_agent"
      if [[ -x ".venv/bin/python" ]]; then
        PY=".venv/bin/python"
      elif [[ -x "venv/bin/python" ]]; then
        PY="venv/bin/python"
      else
        PY="python3"
      fi
      "$PY" -m src.main > /tmp/demo-langchain.log 2>&1
    ) &
    echo $! > "$PID_AGENT"
  fi

  # Wait for Tier 3 services
  wait_for_health 3006 "/health" 15 "Agent Service"     "${LOG_AGENT_SVC}" >/dev/null
  wait_for_health 8081 "/health" 15 "MCP Invest Server" "${LOG_INVEST}"    >/dev/null
  wait_for_health 8082 "/health" 10 "Demo Mortgage"     "${LOG_MORTGAGE}"  >/dev/null
  # UI: port-only (CRA has no /health endpoint)
  wait_for_port "${UI_PORT}" 90 "Demo UI" >/dev/null
  # LangChain: warn-only, not a gate
  wait_for_health 8890 "/health" 20 "LangChain Agent" "${LOG_AGENT}" >/dev/null || true
  ```

- [ ] **Step 3: Verify bash syntax**

  ```bash
  bash -n run.sh
  ```
  Expected: no output (clean parse).

- [ ] **Step 4: Commit**

  ```bash
  git add run.sh
  git commit -m "feat(run.sh): tiered startup sequence + pre-launch env pass"
  ```

---

## Task 7: run.sh — upgrade print_status_table with health column

**Files:**
- Modify: `run.sh`

- [ ] **Step 1: Replace service_status_line with a health-aware version**

  Find the current `service_status_line` function (around line 370):
  ```bash
  service_status_line() {
    local label="$1" port="$2" url="${3:-}"
    if port_listening "$port"; then
      printf "  ${GREEN}${BOLD}  [OK]  %-24s${RESET}  ${MAGENTA}:%-6s${RESET}  ${YELLOW}%s${RESET}\n" "$label" "$port" "$url"
    else
      printf "  ${RED}${BOLD}  [ERROR]  %-24s${RESET}  ${MAGENTA}:%-6s${RESET}  ${DIM}not yet ready${RESET}\n" "$label" "$port"
    fi
  }
  ```

  Replace with a health-column version:
  ```bash
  # Print a single-line status row for a service.
  # Args: label port health_path url
  # health_path — the HTTP path to check (e.g. /health). Pass "" to skip health check.
  service_status_line() {
    local label="$1" port="$2" health_path="${3:-}" url="${4:-}"
    if port_listening "$port"; then
      local health_status="port-up"
      local health_color="${YELLOW}"
      if [[ -n "$health_path" ]]; then
        local hcode
        hcode=$(curl -s -o /dev/null -w "%{http_code}" \
          --max-time 2 --insecure "http://localhost:${port}${health_path}" 2>/dev/null || echo "000")
        if [[ "$hcode" == "200" ]]; then
          health_status="healthy"
          health_color="${GREEN}"
        fi
      fi
      printf "  ${GREEN}${BOLD}  [OK]  %-24s${RESET}  ${MAGENTA}:%-6s${RESET}  ${health_color}%-10s${RESET}  ${YELLOW}%s${RESET}\n" \
        "$label" "$port" "$health_status" "$url"
    else
      printf "  ${RED}${BOLD}  [DOWN]  %-24s${RESET}  ${MAGENTA}:%-6s${RESET}  ${DIM}%-10s${RESET}\n" \
        "$label" "$port" "offline"
    fi
  }
  ```

- [ ] **Step 2: Update all print_status_table calls to pass health_path**

  Find the `print_status_table` function (around line 380) and update each `service_status_line` call to pass the health endpoint path as the third argument:

  ```bash
  print_status_table() {
    echo -e "${WHITE}${BOLD}  SERVICES${RESET}"
    service_status_line "Demo API Server"      ${API_PORT}  "/api/healthz"  "${API_URL}"
    service_status_line "Demo MCP Server"      8080         "/health"        "ws://localhost:8080 (internal)"
    service_status_line "MCP Gateway"          3005         "/health"        "http://localhost:3005 (internal)"
    service_status_line "MCP Invest Server"    8081         "/health"        "ws://localhost:8081 (internal)"
    service_status_line "Mortgage Service"     8082         "/health"        "http://localhost:8082 (internal)"
    service_status_line "Agent Service"        3006         "/health"        "http://localhost:3006 (internal)"
    service_status_line "HITL Service"         3009         "/health"        "http://localhost:3009 (internal)"
    service_status_line "LangChain Agent"      8890         "/health"        "ws://localhost:8889 (chat WS)"
    if port_listening ${UI_PORT}; then
      printf "  ${GREEN}${BOLD}  [OK]  %-24s${RESET}  ${MAGENTA}:%-6s${RESET}  ${GREEN}%-10s${RESET}  ${YELLOW}%s${RESET}\n" \
        "Demo UI (React)" "${UI_PORT}" "port-up" "${CLIENT_URL}"
    else
      printf "  ${YELLOW}  [WAIT]  %-24s${RESET}  ${MAGENTA}:%-6s${RESET}  ${DIM}%-10s${RESET}  %s${RESET}\n" \
        "Demo UI (React)" "${UI_PORT}" "compiling…" "${CLIENT_URL}"
    fi
  }
  ```

- [ ] **Step 3: Verify bash syntax**

  ```bash
  bash -n run.sh
  ```
  Expected: no output.

- [ ] **Step 4: Commit**

  ```bash
  git add run.sh
  git commit -m "feat(run.sh): health column in status table, health-aware service_status_line"
  ```

---

## Task 8: End-to-end verification

- [ ] **Step 1: Full start**

  ```bash
  cd /path/to/repo
  ./run.sh
  ```
  Expected: all services start in tier order; status table shows `healthy` in the health column for each service with a `/health` endpoint.

- [ ] **Step 2: Status command**

  ```bash
  ./run.sh status
  ```
  Expected: same health column visible; each service shows `healthy` or `port-up` or `offline`.

- [ ] **Step 3: Clean stop and restart**

  ```bash
  ./run.sh stop
  ./run.sh start
  ```
  Expected: no port conflicts; clean restart with full tier sequence and health checks.

- [ ] **Step 4: Simulate missing HITL_ALLOWED_ORIGINS warning**

  After startup, tail the HITL log:
  ```bash
  ./run.sh tail 7
  ```
  If `HITL_ALLOWED_ORIGINS` is not set in `.env`, look for:
  ```
  [demo-hitl-service] WARNING: HITL_ALLOWED_ORIGINS is not set.
  ```

- [ ] **Step 5: Add REGRESSION_PLAN.md §4 entry**

  Open `REGRESSION_PLAN.md` and add to §4 (Bug Fix Log):

  ```markdown
  | 2026-05-24 | Startup hardening | run.sh: port-only health checks; flat launch order; ensure_service_env race; HITL/mortgage/invest had no env validation or graceful shutdown | Added wait_for_health + tiered startup (run.sh); env warn + graceful shutdown drain + richer /health in hitl, mortgage, agent_service, mcp_invest | run.sh, demo_hitl_service/src/index.js, demo_mortgage_service/server.js, demo_mcp_invest/src/index.ts, demo_agent_service/src/index.ts |
  ```

- [ ] **Step 6: Final commit**

  ```bash
  git add REGRESSION_PLAN.md
  git commit -m "docs(regression): log startup hardening changes in §4"
  ```

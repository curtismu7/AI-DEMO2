# Startup Hardening Design
**Date:** 2026-05-24  
**Status:** Approved  
**Scope:** All 8 Node/Python services + `run.sh` orchestration

---

## Problem Statement

The current startup process has several failure modes that make demos unreliable:

1. **Port-only health checks** — `wait_for_port` returns "up" the moment a port opens, before the service has loaded its vault, validated config, or registered routes. A service can be "up" but completely broken.
2. **Silent failures** — When a service times out, there's no log snippet shown. The user must manually find and tail the right log file.
3. **Flat launch order** — All 8 services launch as a pile. Services that depend on the API server or gateway start before those dependencies are healthy.
4. **`ensure_service_env` race** — Env symlinks are created just before each service launches, meaning a service can attempt to start before its `.env` is in place.
5. **Inconsistent service hardening** — HITL, mortgage, and MCP Invest services have no env validation, weak/no graceful shutdown, and minimal health endpoint detail.

---

## Goals

- Every service fails fast and loudly on bad config — no silent degraded starts
- `run.sh` verifies actual health (HTTP 200 from `/health`) not just TCP port open
- Startup ordering respects dependencies via explicit tiers
- On any failure, the relevant log tail is shown automatically
- All 8 services share a consistent startup standard: env guard + health endpoint + graceful shutdown + ready log line

---

## Non-Goals

- No external process manager (PM2, systemd) — `run.sh` remains the orchestrator
- No retry logic inside services — fail-fast remains the pattern
- No changes to OAuth, session, token, or BFF logic
- No changes to the UI/React code
- No marketing page changes

---

## Architecture

### Startup Sequence (Tiered)

```
Pre-launch pass
  ├── preflight_checks()          (Node, npm, .env warning, ports, Ollama)
  ├── vault preflight             (exit 1 if vault present + VAULT_PASSWORD unset)
  ├── ensure_service_env (ALL)    (symlink all .envs before first launch)
  └── mkcert CA export            (NODE_EXTRA_CA_CERTS)

TIER 1 — Foundation
  └── demo_api_server :3001
      wait_for_health :3001 /api/healthz  timeout=30s
      ← GATE: Tier 2 blocked until healthy

TIER 2 — Core backend
  ├── demo_mcp_server   :8080
  ├── demo_mcp_gateway  :3005
  └── demo_hitl_service :3009
      wait_for_health :8080 /health  timeout=25s
      wait_for_health :3005 /health  timeout=15s
      wait_for_health :3009 /health  timeout=15s
      ← GATE: Tier 3 + UI blocked until gateway healthy

TIER 3 — Dependent services (+ UI launched in parallel)
  ├── demo_agent_service    :3006
  ├── demo_mcp_invest       :8081
  ├── demo_mortgage_service :8082
  └── demo_api_ui           :4000  (launched at Tier 2 gate; CRA is slow)
      wait_for_health :3006 /health  timeout=15s
      wait_for_health :8081 /health  timeout=15s
      wait_for_health :8082 /health  timeout=10s
      wait_for_port   :4000          timeout=90s  (CRA has no /health)

TIER 5 — Optional (fire-and-forget)
  └── langchain_agent  :8890
      wait_for_health :8890 /health  timeout=20s  (warn-only, not a gate)
```

---

## Component Designs

### run.sh: `wait_for_health`

Replaces `wait_for_port` for all Node services. Keeps `wait_for_port` for CRA UI (no `/health` endpoint).

```bash
wait_for_health() {
  local port="$1" path="$2" timeout="${3:-25}" label="${4:-:$1}" log_file="${5:-}"

  # Phase 1: wait for TCP port (half the timeout budget)
  local port_timeout=$(( timeout / 2 ))
  if [[ "$(wait_for_port "$port" "$port_timeout" "$label")" == "timeout" ]]; then
    _health_timeout_report "$label" "$log_file"
    echo "timeout"; return 1
  fi

  # Phase 2: poll /health until HTTP 200
  local i=0 remaining=$(( timeout - port_timeout ))
  while [[ $i -lt $remaining ]]; do
    local http_code
    http_code=$(curl -s -o /dev/null -w "%{http_code}" \
      --max-time 2 --insecure "http://localhost:${port}${path}" 2>/dev/null || echo "000")
    if [[ "$http_code" == "200" ]]; then
      echo "up"; return 0
    fi
    sleep 1; (( i++ )) || true
  done

  _health_timeout_report "$label" "$log_file"
  echo "timeout"; return 1
}

_health_timeout_report() {
  local label="$1" log_file="$2"
  echo ""
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

### run.sh: `print_status_table` upgrade

Add a health column that distinguishes port-up-but-unhealthy from truly healthy:

```
  [OK]   Demo API Server     :3001  healthy   https://api.ping.demo:3001
  [WARN] Agent Service       :3006  port-up   (health check failed — see log)
  [DOWN] Demo MCP Server     :8080  offline
```

Implementation: after `port_listening`, also `curl -s ... /health` and compare HTTP code.

### run.sh: Pre-launch env setup

Move all `ensure_service_env` calls into a single pass after the dependency/build loop and before any service launches:

```bash
# Pre-launch: ensure all service .envs are in place before any process starts
for svc in demo_mcp_server demo_mcp_gateway demo_hitl_service \
           demo_agent_service demo_mcp_invest; do
  [[ -d "$BASEDIR/$svc" ]] && ensure_service_env "$svc"
done
```

---

## Service Hardening: The Four Standards

Every service must implement all four. Current gaps and required changes:

### Standard 1: Env Validation (fail-fast on missing required config)

| Service | Gap | Fix |
|---------|-----|-----|
| `demo_hitl_service` | No validation; CORS wildcard if `HITL_ALLOWED_ORIGINS` empty | Add startup check: warn if origins empty, validate PORT is numeric |
| `demo_mcp_invest` | No validation; silently uses defaults for `RESOURCE_URI` | Add check: warn if `PINGONE_RESOURCE_MCP_SERVER_URI` unset |
| `demo_mortgage_service` | Uses `demo-mortgage-key-0000` hardcoded default | Add warn if `MORTGAGE_SERVICE_API_KEY` equals the default |

Services already compliant: `demo_api_server`, `demo_mcp_server`, `demo_mcp_gateway`, `demo_agent_service`, `langchain_agent`.

### Standard 2: Graceful Shutdown (drain before exit)

Pattern for plain JS services:

```javascript
const shutdown = (signal) => {
  console.log(`[service-name] ${signal} received — shutting down`);
  server.close(() => {
    console.log('[service-name] HTTP server closed');
    process.exit(0);
  });
  // Force exit if drain takes too long
  setTimeout(() => {
    console.error('[service-name] Drain timeout — forcing exit');
    process.exit(1);
  }, 5000);
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
```

| Service | Gap | Fix |
|---------|-----|-----|
| `demo_agent_service` | `process.exit(0)` — no drain | Add `server.close()` + 5s timeout drain |
| `demo_hitl_service` | `process.exit(0)` — no drain | Add `server.close()` + 5s timeout drain |
| `demo_mortgage_service` | No shutdown handler at all | Add SIGTERM/SIGINT + `server.close()` + 5s drain |

Services already compliant: `demo_api_server`, `demo_mcp_server`, `demo_mcp_gateway`, `demo_mcp_invest`, `langchain_agent`.

### Standard 3: Health Endpoint Quality

Standard response shape:
```json
{
  "status": "ok",
  "service": "demo-hitl-service",
  "uptime": 42.3,
  "checks": {
    "env": "ok"
  }
}
```

| Service | Gap | Fix |
|---------|-----|-----|
| `demo_mcp_server` | No `/health` HTTP endpoint | Add `GET /health` on HTTP server |
| `demo_hitl_service` | Returns `{status:'ok'}` only | Add `uptime`, `checks.env` |
| `demo_agent_service` | Returns `{status:'ok'}` only | Add `uptime`, `checks.env` |
| `demo_mcp_invest` | Returns `{status:'ok', resourceUri}` | Add `uptime` |

Services already sufficient: `demo_api_server`, `demo_mcp_gateway`, `demo_mortgage_service`, `langchain_agent`.

### Standard 4: Startup-Ready Log Signal

Each service emits a single clear line after full initialization (after port bind AND after vault/config/session load):

```
[demo-hitl-service] Ready on :3009
[demo-mortgage-service] Ready on :8082
```

| Service | Gap | Fix |
|---------|-----|-----|
| `demo_hitl_service` | Node default `Listening` only | Replace with structured ready log |
| `demo_mortgage_service` | Node default `Listening` only | Replace with structured ready log |

---

## Error Handling

- `wait_for_health` timeout: show log tail, print status reminder, continue (not abort)
- Service startup exits 1 (vault/env error): `run.sh` does not crash — the PID file is written before launch; `print_status_table` shows the service as offline at the end
- Tier gate failure: if a Tier 1 health check times out, print the log tail and continue anyway (don't block the demo for an optional Tier 3 service because Tier 1 degraded). Gates are advisory, not hard-abort.
- `ensure_service_env` when `demo_api_server/.env` missing: already warns in `preflight_checks`; symlink silently skips if source doesn't exist (existing behavior preserved)

---

## Testing / Verification

After implementation, verify by:

1. `./run.sh` — all services start, status table shows all healthy
2. Kill `demo_api_server` mid-startup (SIGKILL after port opens, before `/api/healthz` 200) — should see log tail printed, Tier 2 still attempts startup
3. Start with `HITL_ALLOWED_ORIGINS` unset — should see startup warning in HITL log, not a silent CORS wildcard
4. Start with `MORTGAGE_SERVICE_API_KEY` unset — should see warning about default key
5. `./run.sh stop` then `./run.sh start` — no PID or port conflicts, clean restart
6. `./run.sh status` — health column shows correct state for each service

---

## Files to Change

| File | Change |
|------|--------|
| `run.sh` | Add `wait_for_health`, `_health_timeout_report`; tiered launch sequence; pre-launch env pass; updated `print_status_table` with health column |
| `demo_hitl_service/src/index.js` | Env validation, graceful shutdown drain, richer `/health`, structured ready log |
| `demo_mortgage_service/server.js` | Env validation (API key default warn), graceful shutdown, structured ready log |
| `demo_mcp_invest/src/index.ts` | Env validation (`RESOURCE_URI` warn), add `uptime` to `/health` |
| `demo_agent_service/src/index.ts` | Graceful shutdown drain (server.close + 5s), add `uptime`/`checks` to `/health` |
| `demo_mcp_server/src/index.ts` | Add HTTP `/health` endpoint alongside WebSocket server |

---

## Regression Considerations

- `run.sh` changes: `wait_for_port` is preserved and still used for CRA UI. All existing subcommands (`stop`, `status`, `tail`, `test`) are unchanged.
- Service changes: only startup/shutdown paths and `/health` endpoints are touched. No route logic, auth, token, or session code is modified.
- `REGRESSION_PLAN.md` §1 files: none of the 6 files above are listed as critical regression-guard files. Add a §4 entry per the template after implementation.

# Servers inventory: stop false "down" in K8s deployments

**Date:** 2026-07-11
**Branch:** `fix/servers-inventory-k8s-topology`
**Status:** approved (lightweight flow)

## Problem

`https://ai-demo.ping-devops.com/servers` and `/check` report ~12 of 22 services
"down" even though the deployment is fully operational. Verified against the live
K8s namespace `ping-devops-cmuir`: all 14 pods `Running`/Ready, and every service
responds when probed directly from inside the cluster.

Root cause: `GET /api/health/inventory` reads `demo_api_server/data/serverInventory.js`,
whose probe `candidates[]` are hardcoded to the **docker-compose** topology. In K8s
this is wrong two ways:

1. **False negatives on running services** — the probe config doesn't match K8s:
   - **UI** probes only `https://frontend:4000`; K8s serves it over **HTTP** → TLS
     failure → false down. (Direct `http://frontend:4000/` = 200.)
   - **LangChain Agent** probes port **8890**; in K8s it answers on **8888** and
     returns 401 (auth-gated). Wrong port + no `acceptAnyStatus` → false down.
2. **Compose-only services with no K8s pods** — `mcp-proxy`, `authz-server`,
   `openai/mastra/pydantic-agent`, `weaviate`, `embeddings`, `mcp-code-search`,
   host `llama-tier-1/6` — never deployed in this environment, so they always show
   red even though they were never meant to run here.

## Fix (three parts + manifest)

### 1. Correct the probe config — `data/serverInventory.js`
- `ui`: append `http://frontend:4000` after the existing `https://` candidates
  (compose keeps hitting HTTPS first; K8s falls through to HTTP).
- `langchain-agent`: add `http://langchain-agent:8888` / `http://localhost:8888`
  candidates and set `acceptAnyStatus: true` (a reachable 401 = up).

Additive and order-preserving → compose and native runs behave exactly as today.

### 2. Deployment-awareness — `routes/health.js` `GET /inventory`
- New env var **`INVENTORY_DEPLOYED_KEYS`** (comma-separated service keys).
- When set: any entry whose `key` is not listed is returned as
  `{ up: null, deployed: false }` with **no probe** (grey), instead of red.
- When unset (compose/native default): unchanged — everything is probed, and
  entries carry `deployed: true`.
- Operator-controlled per environment: it must list the services actually applied
  in that deployment. It is not auto-derived from applied manifests.

### 3. UI grey state — `pages/ServersPage.jsx` + `ServersPage.css`
- `StatusCell`: render `deployed === false` as a grey "not in this deployment"
  badge — distinct from the existing "on-demand" badge (`up === null` with
  `deployed !== false`).
- The existing `up !== null` filter already excludes these from the "X/Y up" count
  and the red `row-down` styling, so the header flips from "9/22 up" to "11/11 up".

### 4. K8s manifest — `k8s/20-api-server-deployment.yaml`
Add `INVENTORY_DEPLOYED_KEYS` to the api-server inline `env:` listing the services
applied in the lean SE deployment:
`api-server,ui,mortgage-service,mcp-server,mcp-invest,mcp-gateway,ping-gateway,agent-service,langchain-agent,hitl-service,llm-proxy,ungoverned-agent`
(`ungoverned-agent` included to preserve its on-demand badge.)

## Success criteria
- Unit tests pass for both probe-config fixes and the env-filter behavior.
- Local: with `INVENTORY_DEPLOYED_KEYS` unset, `/inventory` is byte-for-byte
  unchanged (all 22 probed).
- Live: after redeploy, `GET /api/health/inventory` shows every deployed service
  `up: true`, compose-only services `deployed: false` (grey), zero red rows; the
  `/servers` page header reads "11/11 up".

## Out of scope
- Adding K8s-only services (`jaeger`, `tier-manager`, `llama-tier5`) to the inventory.
- Any change to auth/token/session code (not touched).

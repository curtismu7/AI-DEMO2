# Servers Page — Size Columns Addendum

Date: 2026-07-04
Status: approved (extends 2026-07-04-servers-page-design.md)

## Purpose

Add three size dimensions to the `/servers` page: Docker image size, live
container memory usage, and codebase size on disk. All three were requested
explicitly; the base page ships without them.

## Data sources (all already available — no compose changes, no new deps)

- **Image size + memory:** the BFF container already mounts
  `/var/run/docker.sock` (used by the admin gateway-restart button,
  `services/agentGatewayConfig/dockerRestart.js`). Reuse that exact pattern:
  raw `http.request` with `socketPath`, no docker CLI, no dockerode.
  - Image sizes: one `GET /images/json` call; map each inventory entry's
    running container (`GET /containers/json?all=true` gives container→image)
    to its image `Size`.
  - Memory: `GET /containers/{name}/stats?stream=false&one-shot=true` per
    probeable container, in parallel, 5s timeout each. Report
    `memory_stats.usage` (minus `inactive_file` cache when present, matching
    `docker stats` semantics).
- **Codebase size:** the repo root is already bind-mounted at `/repo`. Walk
  each entry's `sourceDir` summing file sizes, skipping
  `node_modules`, `.venv`, `venv`, `dist`, `build`, `.git`, `coverage`,
  `__pycache__`, `logs`. Native (`./run.sh`) resolves the repo root from the
  module path instead of `/repo`.

## Components

### 1. `serverInventory.js` — add `sourceDir` per entry

New optional field, from the compose build contexts: `demo_api_server`,
`demo_api_ui`, `demo_mcp_server`, `langchain_agent`, `demo_mcp_gateway`,
`demo_agent_service`, `demo_hitl_service`, `demo_mcp_invest`,
`demo_mortgage_service`, `demo_authz_server`, `mastra_agent`, `openai_agent`,
`pydantic_agent`, `demo_mcp_proxy`, `ping-gateway` (config/scripts — image is
vendor), `demo_mcp_code_search`, `demo_llm_proxy`, `demo_ungoverned_agent`.
`null` for vendor images with no repo dir (weaviate, embeddings) and the host
llama tiers. No other inventory changes.

### 2. `demo_api_server/services/serverSizes.js` (new)

Exports `getServerSizes()` returning
`{ sizes: { [key]: { imageBytes, memBytes, memLimitBytes, codeBytes } }, timestamp }`.

- Every field nullable; a missing socket, a stopped container, or a null
  `sourceDir` yields `null` for that field — never a throw, never a 5xx.
- Codebase walk cached in-module for 10 minutes (disk-heavy, changes slowly).
  Docker image list cached for the same 10 minutes; memory stats are always
  live.
- Host llama tiers and `ungoverned-agent` (when not running): image/memory
  `null`.

### 3. `GET /health/inventory/sizes` (append to `routes/health.js`)

Thin wrapper over `getServerSizes()`. Always HTTP 200, unauthenticated like
its `/health/*` peers. Deliberately separate from `GET /health/inventory` so
the 15s status poll never pays for docker-stats or directory walks.
`/demo-status` and `/services` (footer chips) stay untouched.

## UI — three columns on the existing table

- `ServersPage.jsx` fetches `/api/health/inventory/sizes` on mount and every
  60s (status polling stays at 15s, unchanged). Results merge into rows by
  `key`.
- New columns: **Image**, **Memory**, **Code** — human-formatted (`1.2 GB`,
  `348 MB`); `null` renders as `—` (an em dash, not an emoji).
- Fetch failure: existing error-banner pattern; size cells just stay `—`.

## Security note

The docker socket grants host container control. This feature only performs
read-only GETs (`/images/json`, `/containers/json`, `/containers/*/stats`);
no restart/exec paths are added, and the endpoint returns only size numbers.

## Testing / done criteria

- Jest unit tests for `serverSizes.js` (mocked socket + temp dirs): image
  mapping, memory parse, cache behavior, missing-socket and null-`sourceDir`
  fallbacks.
- Route test for `/health/inventory/sizes` response shape.
- `npm run test:api-server` passes; UI production build passes
  (regression-guard gate).
- Against the running Docker stack, `/servers` shows live status plus all
  three size columns with real values for compose services and `—` for host
  tiers.

## Out of scope

- No start/stop controls, no per-process CPU, no historical charts.
- No changes to `/health/inventory`, `/demo-status`, `/services`.

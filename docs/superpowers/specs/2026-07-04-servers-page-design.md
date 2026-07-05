# Servers Page — Design

Date: 2026-07-04
Status: approved (inventory + live health; side-nav link, any signed-in user; build end-to-end)

## Purpose

A live UI page at `/servers` showing every server in the demo — the 20 compose
services plus the 4 host `llama-server` tiers — with the descriptive detail from
`docs/server-inventory-sot.md` and a live up/down status per service.

## Why the BFF probes, not the browser

Several services are unreachable from the browser (weaviate has no host port;
everything else is CORS-restricted). The BFF sits on the `ai-demo` compose
network and already probes services for the footer chips
(`GET /health/services` in `demo_api_server/routes/health.js`), so the new
endpoint reuses that pattern.

## Components

### 1. `demo_api_server/data/serverInventory.js`

Static module exporting the 24 inventory entries. Per entry:

- `key`, `name`, `container`, `hostPort`, `internalPort`
- `lang`, `purpose` (prose mirrored from `docs/server-inventory-sot.md`)
- `category`: `core` | `mcp` | `agents` | `ai-infra` | `authz` | `demo-prop`
- `healthUrl`: derived from the same env vars the BFF already uses
  (e.g. `MCP_GATEWAY_HTTP_URL`), falling back to compose hostnames; host llama
  tiers use `host.docker.internal:8091-8094` (env-overridable base)
- `healthPath`: `/health` default; weaviate `/v1/meta`
- `probe`: `false` for `ungoverned-agent` (on-demand demo prop, no port)

Header comment cross-references the doc; the doc gains a one-line pointer back.
Ports/URLs come from env (service-topology-derived), so drift risk vs the doc is
limited to prose.

### 2. `GET /health/inventory` (append to `routes/health.js`)

- Probes all `probe: true` entries in parallel with the existing pattern:
  2.5s timeout, dev https-fallback agent, never throws.
- Always HTTP 200: `{ services: [ ...entry, up, latencyMs?, error? ], timestamp }`.
- Unauthenticated, like the other `/health/*` routes.
- Does NOT touch `/demo-status` or `/services` (footer chips contract).

### 3. UI — `demo_api_ui/src/pages/ServersPage.jsx` + `.css`

- Route `/servers` in `App.js`, signed-in users (same guard as peer demo pages).
- Side-nav link in `AdminSideNav.jsx` next to Code Search / AI Control Plane.
- Table grouped by category: CSS status dot (no emoji), name, host→internal
  port, latency, language, purpose. Header: up-count, Refresh button.
- Auto-refresh every 15s while the tab is visible (pause on `hidden`).
- `probe: false` rows show a neutral "on-demand" badge instead of a dot.

## Error handling

- Endpoint never 5xxs for a down service — down is data (`up: false, error`).
- UI fetch failure shows an inline error banner with retry; stale data stays
  visible with a "last updated" timestamp.

## Testing / done criteria

- Jest unit test for `/health/inventory` (mocked axios): up, down, and
  not-probed cases; response shape.
- `npm run test:api-server` passes; UI production build passes
  (regression-guard gate).
- Signed-in user opens `/servers` and sees all 24 rows; probeable services show
  live dots.

## Out of scope

- No start/stop controls, no log viewing, no Docker API integration.
- No changes to existing health endpoints or footer chips.

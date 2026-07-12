# PingOne Admin Vertical — Live Hosted MCP Execution

**Date:** 2026-07-11
**Branch:** `feat/pingone-admin-live-mcp`
**Status:** Approved (design review with Curtis, 2026-07-11)

## Problem

The `pingone-admin` vertical ("AI-Driven API Discovery Demo") answers every
question with canned data. `call_pingone_operation` resolves the operation from
the bundled OAS fragment (`demo_api_server/config/oas/pingone-fragment.json`)
and then returns `getMockResponse()` output — three fake users, three fake
apps, a fake environment. Asking "show me user info for demouser" returns
alice.demo. The vertical demonstrates the OAS/x-permission governance story
but produces no real answers from PingOne.

The repo already has a proven live path: the hosted PingOne MCP server
(`api.pingone.{region}/v1/environments/{envId}/mcp`) via
`demo_api_server/services/mcpPingOneHttpAdapter.js` (worker
`client_credentials` auth, `listTools()`/`callTool()`, process-lifetime tool
cache, pre-warmed at server start). It powers the banking dashboard's
"PingOne Admin [MCP]" chips and the `/api/admin-agent` service today.

## Decisions (made in design review)

1. **Discovery: hybrid.** Default `discover_oas_operations` keeps the curated
   5-operation OAS fragment (preserves the x-permission/scope teaching layer).
   A new live view lists the hosted server's actual `tools/list`.
2. **Writes: real.** `createUser` performs a real write against the demo
   environment through the hosted MCP server.
3. **Failure: labeled mock fallback.** If the hosted MCP is unreachable
   (missing worker creds, HTTP/RPC error, timeout), fall back to the existing
   mock responses, clearly labeled as mock with the failure reason. Never
   silently serve mock data as real.
4. **Approach: swap the vertical executor (Approach A).** All changes live in
   `demo_api_server/config/verticals/pingone-admin/`. No changes to the
   chip→routing→MCP pipeline (REGRESSION_PLAN skip-proof contract), no
   changes to `mcpPingOneHttpAdapter.js`, mocks in `oasDiscovery.js` are kept
   as the fallback source.

## Design

### call_pingone_operation — live execution

Validation is unchanged: unknown `operationId` returns the same error steering
the caller to `discover_oas_operations`. For a known operation:

1. Call `mcpPingOneHttpAdapter.callTool(op.operationId, args)`. The hosted
   server's camelCase tool names match the fragment's operationIds
   (`listUsers`, `getUser`, `createUser`, `listApplications`,
   `getEnvironment`).
2. Parse the MCP envelope: `result.content[0].text` → `JSON.parse`, tolerating
   plain-object results and non-JSON text (kept as a string).
3. Return the existing result fields (`operationId`, `oasPath`, `permission`,
   `scopeRequired`, `responseSummary`) plus a new field:
   **`source: "live — hosted PingOne MCP"`**.
4. `summaryForResponse` is hardened for real PingOne shapes: it uses the
   existing per-operation summaries when the shape matches
   (`_embedded.users`, `_embedded.applications`, `name`/`type`/`region`,
   `username`/`id`) and falls back to a truncated JSON preview when it does
   not. A schema drift must never crash the chip.

### createUser — real write defaults

- If the caller supplies no `username`/`email`, generate
  `demo.user.<suffix>@example.com`-style defaults (suffix from timestamp) so
  repeated demos do not collide.
- If the live tool's inputSchema requires a `populationId`, resolve the
  environment's default population once via the adapter (`listPopulations`)
  and cache it for the process lifetime.
- A PingOne validation error from the MCP call is rendered as the response
  (the real API contract on display), not treated as a crash and not
  mock-fallback material — only transport/auth failures trigger the fallback.

### discover_oas_operations — hybrid discovery

- Default (no new input): unchanged — curated fragment table with Method /
  Path / Summary / x-permission / Required Scope columns.
- New optional boolean input `live`. When true, return the hosted server's
  `tools/list` mapped to `{ name, description }` rows, rendered by a new
  manifest render entry **`discover_live_tools`** (columns: Tool,
  Description). On adapter failure, same labeled-mock rule: return the
  fragment table with a `source` note explaining live discovery was
  unavailable.
- One new heuristic in `index.js` (phrases like "live tools", "hosted tools",
  "real tools" → `discover_oas_operations` with `defaultParams: { live: true }`).
- One new manifest chip `pa6` "List Live Tools" (chips + chips10). Existing
  chip ids, labels, and messages are untouched.

### Labeled mock fallback

Any adapter transport/auth failure (thrown by `callTool`/`listTools`):

- Log a warning (`console.warn`) with the operation and reason.
- Return the existing `getMockResponse()` result with
  **`source: "mock — PingOne MCP unavailable: <reason>"`** and the normal
  mock summary.
- The manifest's `call_pingone_operation` fieldList render gains a
  **Source** row (path `source`) so live-vs-mock is always visible in the UI.

### Files touched

| File | Change |
|---|---|
| `demo_api_server/config/verticals/pingone-admin/tools.js` | Live execution, envelope parsing, createUser defaults, labeled fallback, live discovery branch |
| `demo_api_server/config/verticals/pingone-admin/index.js` | New live-tools heuristic |
| `demo_api_server/config/verticals/pingone-admin/manifest.json` | `pa6` chip, `discover_live_tools` render entry, Source row on `call_pingone_operation` render |
| `demo_api_server/tests/oas/pingone-admin.test.js` | New unit coverage (adapter mocked) |

Nothing else changes. `oasDiscovery.js`, `mcpPingOneHttpAdapter.js`, chips
pipeline, and all other verticals stay byte-identical.

## Error handling summary

| Failure | Behavior |
|---|---|
| Unknown operationId | Existing error result (unchanged) |
| Adapter throws (creds/HTTP/RPC/timeout) | Labeled mock fallback with reason |
| MCP returns PingOne validation error payload | Rendered as the real response |
| Unparseable MCP content | Raw text kept as response summary (truncated) |
| Live discovery fails | Fragment table + source note |

## Testing / success criteria

Unit (CI, adapter jest-mocked in `tests/oas/pingone-admin.test.js`):

1. Live success: envelope parsed, summary from real-shaped payload,
   `source` = live.
2. Adapter failure: mock payload returned, `source` labels mock + reason.
3. `createUser` with no params: defaults generated; `populationId` resolved
   when required by schema.
4. `discover_oas_operations { live: true }`: tools/list mapped,
   `discover_live_tools` render key; failure → fragment + note.
5. Existing tests (default discovery, unknown operationId) still pass.

Manual (demo env, worker creds configured):

- Each of the 5 chips returns real environment data with Source: live.
- "List Live Tools" chip shows the hosted tool list (~67 tools healthy).
- With worker creds removed, chips still answer with clearly-labeled mock
  data (no dead ends, no unlabeled fake data).

Done = unit suite green + the manual pass above.

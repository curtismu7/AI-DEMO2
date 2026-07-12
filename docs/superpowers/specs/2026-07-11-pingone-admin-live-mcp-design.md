# PingOne Admin Vertical — Live Hosted MCP Execution (no OAS)

**Date:** 2026-07-11
**Branch:** `feat/pingone-admin-live-mcp`
**Status:** Approved v2 (design review with Curtis, 2026-07-11 — OAS layer dropped)

## Problem

The `pingone-admin` vertical answers every question with canned data.
`call_pingone_operation` resolves an operation from a bundled OAS fragment and
returns `getMockResponse()` output — three fake users, three fake apps, a fake
environment. It produces no real answers about the PingOne environment.

The original OAS/x-permission framing was decorative: the fragment is
hand-written and nothing enforces its annotations. Decision: drop it. The
vertical's story becomes the true one — **the agent discovers its capabilities
from the hosted PingOne MCP server's live tool list, and the worker app's
admin roles in PingOne gate which tools the agent even sees.**

The repo already has a proven live path: the hosted PingOne MCP server
(`api.pingone.{region}/v1/environments/{envId}/mcp`) via
`demo_api_server/services/mcpPingOneHttpAdapter.js` (worker
`client_credentials` auth, `listTools()`/`callTool()`, process-lifetime tool
cache, pre-warmed at server start). It powers the banking dashboard's
"PingOne Admin [MCP]" chips and `/api/admin-agent` today.

## Decisions (design review)

1. **No OAS layer.** Discovery = live `tools/list`. The bundled fragment and
   x-permission/scope narration are removed from this vertical's story.
2. **Writes: real.** `createUser` performs a real write against the demo
   environment through the hosted MCP server.
3. **Failure: labeled mock fallback.** If the hosted MCP is unreachable
   (missing worker creds, HTTP/RPC error, timeout), fall back to mock
   responses clearly labeled as mock with the failure reason. Never silently
   serve mock data as real.
4. **Approach: swap the vertical executor.** Changes live in
   `demo_api_server/config/verticals/pingone-admin/` plus the mechanical
   ripple of the tool renames (generated catalog, heuristics extraction,
   tests, one launch-link message). No changes to the chip→routing→MCP
   pipeline logic (REGRESSION_PLAN skip-proof contract) or to
   `mcpPingOneHttpAdapter.js`.

## Design

### Tools (renamed — no spec indirection)

| Old | New | Behavior |
| --- | --- | --- |
| `discover_oas_operations` | `list_pingone_tools` | Return the hosted server's live `tools/list` as `{ name, description }` rows. Optional `filter` string matches name/description. |
| `call_pingone_operation` | `call_pingone_tool` | Input `{ name, arguments }` → `mcpPingOneHttpAdapter.callTool(name, arguments)`. |

The dummy `api_key_demo` / `dual_token_demo` entries keep their current
not-available behavior.

Chip heuristics keep the deterministic mapping, now to real hosted tool names
(which equal the old operationIds): `listUsers`, `createUser`,
`listApplications`, `getEnvironment`. The discovery heuristic maps
"tools/APIs/what can you do" phrasing to `list_pingone_tools`.

### call_pingone_tool — execution

1. `callTool(name, arguments)` via the adapter.
2. Parse the MCP envelope: `result.content[0].text` → `JSON.parse`, tolerating
   plain-object results and non-JSON text (kept as a truncated string).
3. Result fields: `tool` (name), `responseSummary`, and
   **`source: "live — hosted PingOne MCP"`**.
4. Summary builder handles known PingOne shapes (`_embedded.users`,
   `_embedded.applications`, `name`/`type`/`region`, `username`/`id`) with a
   truncated JSON preview fallback. Schema drift must never crash the chip.
5. A PingOne validation-error payload from the MCP call is rendered as the
   response (real API contract on display) — only transport/auth failures
   trigger the mock fallback.

### createUser — real write defaults

- No `username`/`email` supplied → generate
  `demo.user.<suffix>@example.com`-style defaults (timestamp suffix) so
  repeated demos do not collide.
- If the live tool's inputSchema requires `populationId`, resolve the
  environment's default population once via the adapter (`listPopulations`)
  and cache it for the process lifetime.

### list_pingone_tools — live discovery

- `adapter.listTools()` (process-lifetime cache, pre-warmed at boot) mapped to
  `{ name, description }`, optional filter, rendered by manifest render entry
  **`list_pingone_tools`** (columns: Tool, Description).
- Adapter failure → labeled fallback: a static list of the five core tool
  names with `source: "mock — PingOne MCP unavailable: <reason>"`.

### Labeled mock fallback

Any adapter transport/auth failure:

- `console.warn` with tool name and reason.
- For the five known tools, return the existing mock payloads (kept either via
  `oasDiscovery.getMockResponse` or inlined into the vertical — implementer
  picks the smaller diff) with
  **`source: "mock — PingOne MCP unavailable: <reason>"`**.
- For any other tool name, return a labeled unavailable message (no fake data
  exists for it).
- The `call_pingone_tool` fieldList render includes a **Source** row so
  live-vs-mock is always visible in the UI.

### Manifest / story changes

- Greeting + `systemPromptFlavor` + `index.js` system prompt rewritten: agent
  discovers capabilities from the live hosted MCP server; which tools appear
  is governed by the worker app's admin roles in PingOne (~67 healthy; a
  reduced list means reduced roles — itself a demo beat).
- Tagline updated (no "API Discovery via OAS" framing); identity/theme
  otherwise unchanged.
- Chips: same five; pa1 relabeled "Discover APIs" → "List Tools" with message
  "Show me the tools available from the PingOne MCP server". Other chips keep
  their intent; messages updated only where they mention the OpenAPI spec.
- Render entries: `list_pingone_tools` table (Tool, Description);
  `call_pingone_tool` fieldList (Tool, Response, Source). x-permission/scope
  rows removed.
- Terminology keys referencing API quota/operations may be tidied only if
  rendered UI shows them; otherwise left alone (minimal diff).

### Rename ripple (mechanical, must not be hand-skipped)

| Surface | Change |
| --- | --- |
| `demo_mcp_server/src/tools/handlers/verticalTools.generated.ts` | Regenerate via its generation script (never hand-edit) so the MCP catalog carries the new tool names for vertical `pingone-admin` |
| `nlIntentParser` pingone-admin heuristics extraction | Follows from `index.js` heuristics; verify extraction picks up new names |
| `tests/oas/pingone-admin.test.js`, `tests/oas/verticalDispatch.oas.test.js` | Update to new tool names/behavior (adapter mocked) |
| `demo_api_ui/src/components/OASDemoPage.jsx` launch link | Update the `?vertical=pingone-admin&msg=...` message to the new discovery phrasing |

`config/oas/pingone-fragment.json` and `services/oasDiscovery.js` are left in
place (other consumers/tests may reference them); this vertical simply stops
importing the spec-lookup functions it no longer needs.

## Error handling summary

| Failure | Behavior |
| --- | --- |
| Unknown/missing tool name | Error result steering to `list_pingone_tools` |
| Adapter throws (creds/HTTP/RPC/timeout) | Labeled mock fallback (five known tools) or labeled unavailable message |
| MCP returns PingOne validation error payload | Rendered as the real response |
| Unparseable MCP content | Raw text kept as response summary (truncated) |
| Live discovery fails | Static five-tool list + mock source label |

## Testing / success criteria

Unit (CI, adapter jest-mocked):

1. `call_pingone_tool` live success: envelope parsed, summary from
   real-shaped payload, `source` = live.
2. Adapter failure: known tool → labeled mock payload with reason; unknown
   tool → labeled unavailable.
3. `createUser` with no params: defaults generated; `populationId` resolved
   when the schema requires it.
4. `list_pingone_tools`: live list mapped + filter works; failure → labeled
   static list.
5. Vertical dispatch/regenerated catalog tests pass with new tool names.

Manual (demo env, worker creds configured):

- All five chips return real environment data with Source: live.
- "List Tools" shows the live hosted tool list (~67 healthy).
- With worker creds removed, chips answer with clearly-labeled mock data (no
  dead ends, no unlabeled fake data).

Done = unit suite green + the manual pass above.

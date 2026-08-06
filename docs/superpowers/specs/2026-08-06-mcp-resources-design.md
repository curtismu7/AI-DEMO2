# MCP Resources + All-Vertical Tools — demo_mcp_resource_server

**Date:** 2026-08-06

## Goal

Add MCP `resources/*` support and expand tool coverage to all 9 demo verticals in `demo_mcp_resource_server`. Currently only `investment` and `airlines` have tools. After this work every vertical has tools and resources, all auth-gated by scope.

## Verticals in scope

| Vertical | Scope | Mock-data entities |
|---|---|---|
| banking | `banking:read` | accounts, transactions |
| healthcare | `healthcare:read` | patientRecords, billingHistory |
| government | `government:read` | permits, filings |
| manufacturing | `manufacturing:read` | work orders, inventory |
| retail | `retail:read` | orders, products, lineItems |
| sporting-goods | `sporting-goods:read` | gear, rentals |
| university | `university:read` | courses, enrollmentHistory |
| workforce | `workforce:read` | benefits, expenses |
| abercrombie-fitch | `abercrombie-fitch:read` | orders, products |

Pre-existing verticals (unchanged): `investment` (`invest:read`), `airlines` (`airlines:read`)

## New files (18 total)

```
src/tools/bankingTools.ts
src/tools/bankingToolHandler.ts
src/tools/healthcareTools.ts
src/tools/healthcareToolHandler.ts
src/tools/governmentTools.ts
src/tools/governmentToolHandler.ts
src/tools/manufacturingTools.ts
src/tools/manufacturingToolHandler.ts
src/tools/retailTools.ts
src/tools/retailToolHandler.ts
src/tools/sportingGoodsTools.ts
src/tools/sportingGoodsToolHandler.ts
src/tools/universityTools.ts
src/tools/universityToolHandler.ts
src/tools/workforceTools.ts
src/tools/workforceToolHandler.ts
src/tools/anfTools.ts
src/tools/anfToolHandler.ts
```

## Modified files (3)

- `src/tools/registry.ts` — import + spread all 9 new tool arrays into `ALL_TOOLS`
- `src/index.ts` — add `resources/list`, `resources/read`, `resources/templates/list` handlers; add `resources` to `capabilities`
- `src/shared/mockData.ts` (new shared helper) — loads `demo_api_server/config/verticals/{vertical}/mock-data.json` at startup

## Tool pattern (per vertical)

Each `{vertical}Tools.ts` exports a `McpToolDef[]` with 2 tools:
- `list_{entities}` — returns the list from mock-data (requires `{vertical}:read`)
- `get_{entity}` — returns one item by id (requires `{vertical}:read`)

Each `{vertical}ToolHandler.ts` exports `dispatch(name, args)` reading from `mockData`.

## Resources

Two resources per vertical — list and detail URI:

| Vertical | List URI | Detail URI |
|---|---|---|
| banking | `banking://accounts` | `banking://accounts/{accountId}` |
| healthcare | `healthcare://records` | `healthcare://records/{patientId}` |
| government | `government://permits` | `government://permits/{permitId}` |
| manufacturing | `manufacturing://work-orders` | `manufacturing://work-orders/{orderId}` |
| retail | `retail://orders` | `retail://orders/{orderId}` |
| sporting-goods | `sporting-goods://gear` | `sporting-goods://gear/{itemId}` |
| university | `university://courses` | `university://courses/{courseId}` |
| workforce | `workforce://expenses` | `workforce://expenses/{expenseId}` |
| abercrombie-fitch | `anf://orders` | `anf://orders/{orderId}` |
| investment | `banking://investment-accounts` | `banking://investment-accounts/{accountId}` |
| airlines | `airlines://bookings` | `airlines://bookings/{bookingId}` |

## New MCP methods in `handleMessage`

- **`resources/list`** — validate token → extract scopes → return resources whose required scope is present
- **`resources/templates/list`** — same scope filter, return URI templates for `{id}` variants
- **`resources/read`** — validate token → match URI to resource → check scope → call `dispatch()` → return `{ contents: [{ uri, mimeType: "application/json", text: JSON.stringify(data) }] }`

## Auth

Identical to tools: `decodeAndValidate` → `extractScopes` → per-resource scope check.
- Missing/invalid token → JSON-RPC `-32001`
- Insufficient scope → JSON-RPC `-32005`

## `initialize` capabilities

```json
{
  "tools": {},
  "resources": { "subscribe": false, "listChanged": false }
}
```

## Data source

All new verticals read from `demo_api_server/config/verticals/{vertical}/mock-data.json` via a shared loader. Path resolved relative to repo root via env var `BANKING_API_DATA_DIR` parent or `__dirname` walk-up. Airlines keeps its SQLite source unchanged.

## Success criteria

- `resources/list` returns correct subset filtered by token scopes
- `resources/read` returns JSON content for each vertical with correct scope token
- `resources/read` returns `-32005` with wrong scope
- `resources/read` returns `-32001` with no token
- `tools/list` returns new vertical tools filtered by scope (existing behavior preserved)
- `npx tsc --noEmit` passes
- Existing jest tests still pass (`npm test`)

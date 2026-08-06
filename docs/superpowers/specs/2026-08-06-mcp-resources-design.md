# MCP Resources — demo_mcp_resource_server

**Date:** 2026-08-06

## Goal

Add MCP `resources/*` support to `demo_mcp_resource_server` so MCP clients can discover and read banking data via the standard resource protocol, not only via tools.

## Resources

| URI | Name | Required scope | Backing data |
|---|---|---|---|
| `banking://accounts` | Investment Accounts | `invest:read` | `get_investment_accounts` dispatch |
| `banking://accounts/{accountId}` | Account Holdings | `invest:read` | `get_investment_balance` dispatch |
| `banking://bookings` | Airline Bookings | `airlines:read` | `get_airline_bookings` dispatch |
| `banking://bookings/{bookingId}` | Booking Detail | `airlines:read` | `get_airline_bookings` + filter |

## New MCP Methods

- **`resources/list`** — return resources the token's scopes permit (filtered same as `tools/list`)
- **`resources/templates/list`** — return URI templates for `{accountId}` and `{bookingId}` variants
- **`resources/read`** — validate token, check scope for the requested URI, dispatch to existing handlers, return `contents` array with `mimeType: "application/json"`

## Auth

Identical to tools: `decodeAndValidate` → `extractScopes` → per-resource scope check. Missing scope → `-32005` error. Missing/invalid token → `-32001`.

## Capabilities

`initialize` response gains:
```json
{ "resources": { "subscribe": false, "listChanged": false } }
```

## Architecture

One file change: `index.ts`. New branches in `handleMessage` for the three methods. No changes to registry, tool handlers, or transport layer.

Resource dispatch reuses `dispatch()` from `registry.ts`. No new data-fetching logic.

## Success criteria

- `resources/list` returns correct subset based on token scopes
- `resources/read` with valid `invest:read` token returns account data as JSON content
- `resources/read` with valid `airlines:read` token returns booking data as JSON content
- `resources/read` with wrong scope returns `-32005`
- `resources/read` with no token returns `-32001`
- `npx tsc --noEmit` passes
- Existing `tools/*` tests still pass

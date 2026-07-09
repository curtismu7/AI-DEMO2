---
name: pingone-mcp
description: Use when reading or updating PingOne resources during development — apps, populations, users, DaVinci flows, env config. Encodes the MCP-first rule for the hosted PingOne MCP server, when to fall back to the direct Management API, and how each consumer (Claude Code, BFF) authenticates.
---

# PingOne MCP — hosted admin-plane server

The HOSTED PingOne MCP server is the preferred way to read/update PingOne
state during development. It is PingOne's own admin-plane endpoint:

    https://api.pingone.{region}/v1/environments/{envId}/mcp

`envId`/`region` come from `demo_api_server/.env` (`PINGONE_ENVIRONMENT_ID`,
`PINGONE_REGION`). Do NOT confuse it with this repo's data-plane MCP servers
(`demo_mcp_server`, `demo_mcp_gateway`, `demo_mcp_invest`) — those serve
banking tools to end users, not PingOne administration.

## MCP-first rule

Prefer the hosted MCP tools for: application/population/user READS, user
management, DaVinci flow reads, and environment config updates.

Stay on the direct Management API (worker token + REST) for:
- `createEnvironment` (not exposed via MCP)
- resource servers and scopes CRUD (`/resources`, `/resources/{id}/scopes`)
- application grants (`/applications/{id}/grants` — PUT full-replace, not PATCH)

On any MCP failure (5xx, missing tool, auth), fall back to the direct
Management API rather than retrying MCP in a loop.

## Tool conventions

- Tool names and parameters are camelCase (`listApplications`,
  `getUser`, `environmentId`) — a snake_case parameter is silently wrong.
- The visible tool set is gated by the WORKER APP's admin roles in the target
  env. Healthy baseline is ~67 tools; a much smaller list means the worker
  lost roles (check `pingOneWorkerPreflight` verdicts in BFF startup logs).
- `tools/call` params shape: `{ "name": "<toolName>", "arguments": { ... } }`.
- Responses may arrive as plain JSON or as a single SSE frame
  (`event: message` / `data: {...}`) — parse both (see the smoke script).

## How each consumer authenticates

| Consumer | Config | Auth |
|---|---|---|
| Claude Code session | `.air/mcp.json` (per-machine, gitignored; template `.air/mcp.json.example`) | Interactive OAuth — run `/mcp` in an interactive session to authorize; per-user, not shareable |
| Cursor (project) | `.cursor/mcp.json` (per-machine, gitignored; template `.cursor/mcp.json.example`) | Static OAuth `auth.CLIENT_ID` from bootstrap; Customize → MCP → pingone → Connect (browser OAuth) |
| BFF (runtime) | `demo_api_server/services/mcpPingOneHttpAdapter.js` | Worker `client_credentials` Bearer token; stateless JSON-RPC (no initialize handshake, no session id); `tools/list` cached for process lifetime |
| Scripts / smoke | `scripts/smoke-pingone-mcp.js` | Same worker Bearer pattern as the BFF |

There is no Basic auth on the MCP endpoint itself — Basic is only the token
endpoint auth method used to MINT the worker token.

## Health check

    npm run smoke:pingone-mcp

Mints a worker token and calls `tools/list` (needs `demo_api_server/.env`
credentials; deliberately not in CI). Success prints the live tool count.

## Known stale docs — do not follow

`docs/pingone-mcp-server-report.md` and
`docs/superpowers/plans/2026-05-27-pingone-mcp-server-integration.md` are
marked SUPERSEDED and describe a retired local stdio binary (`pingone-admin`,
PKCE port 7464, Homebrew install). Any doc or skill describing a
`pingone-admin` server in a root `.mcp.json` is describing that dead setup.
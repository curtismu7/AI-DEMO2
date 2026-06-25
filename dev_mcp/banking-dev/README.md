# banking-dev-mcp

Dev-only MCP server for the Super Banking demo. **Not shipped, not deployed,
not consumed by `langchain_agent` or `banking_agent_service`.** It exists to
make iterating on this repo faster by exposing four tool namespaces over stdio:

| Namespace      | What it inspects                                              |
|----------------|---------------------------------------------------------------|
| `logs_*`       | The 13 `/tmp/bank-*.log` files with X-Request-ID correlation  |
| `state_*`      | `banking_api_server/data/sessions.db`, `runtimeData.json`, etc. |
| `tokenchain_*` | JWT decode, diff, introspect, demo-rule verdict               |
| `pingone_*`    | PingOne Management API (read-only by default)                 |

## Hard rules

- **Read-only by default.** Write tools register only when their gate env var is set.
- **All token values are redacted in returned data** (length + last 4 chars only).
- **Worker token never leaves the server process** — taken from `.env` PINGONE_WORKER_CLIENT_ID/SECRET.
- **No `.env` writes, no log truncation, no PingOne writes unless gated.**

## Gate env vars

| Var                          | Effect                                           |
|------------------------------|--------------------------------------------------|
| `DEV_MCP_PINGONE_WRITE=1`    | Registers `pingone_update_user_attribute`        |
| `DEV_MCP_INTROSPECT=1`       | Registers `tokenchain_introspect` (burns PingOne quota) |

## Build + run

```bash
cd dev_mcp/banking-dev
npm install
npm run build
```

It's wired into the repo's `.mcp.json` as `banking-dev`. Restart Claude Code /
Cursor to pick it up.

## What it deliberately does NOT do

See [`.planning/DEV_MCP_SERVERS_PLAN.md`](../../.planning/DEV_MCP_SERVERS_PLAN.md)
for the design rationale and explicit non-goals.

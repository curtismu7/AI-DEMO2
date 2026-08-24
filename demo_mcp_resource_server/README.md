# banking-mcp-resource-server — standalone deployment

An MCP server exposing read-mostly tools across ten mock verticals (banking,
healthcare, government, manufacturing, retail, sporting-goods, university,
workforce, Abercrombie & Fitch, airlines) plus a set of investment tools.
Every vertical reads its own bundled SQLite database — no other service is
required to run it. Investment tools can optionally proxy to a banking API
you supply instead (see below).

## Prerequisites

- Docker + Docker Compose
- A PingOne environment to mint and verify bearer tokens (or any OAuth AS
  that can issue a JWT with the right `aud`/`scope` claims and publish a JWKS
  endpoint — this server only relies on standard OIDC discovery, not
  anything PingOne-specific)

## Quick start

```bash
cp .env.standalone.example .env
```

Edit `.env`: set `MCP_RESOURCE_SERVER_RESOURCE_URI`, `PINGONE_ENVIRONMENT_ID`
and `PINGONE_REGION` for your own PingOne environment. Leave `PINGONE_ISSUER`
commented out until you have real tokens (see "Auth modes").

```bash
docker compose -f docker-compose.standalone.yml up --build
```

The server listens on `http://localhost:8081`. SQLite databases persist in
`./data` (seeded on first use from `seed/`; a restart never re-seeds a
non-empty database).

## Verify it's running

```bash
curl http://localhost:8081/health
curl http://localhost:8081/.well-known/oauth-protected-resource
```

The second call returns the resource's advertised scopes and, if
`PINGONE_ENVIRONMENT_ID`/`PINGONE_REGION` are set, its authorization server —
this is the RFC 9728 metadata an MCP client uses for OAuth discovery.

## Connecting an MCP client

The server speaks MCP over both WebSocket and HTTP (streamable, `POST /mcp`)
on the same port. Point your client at `http://localhost:8081/mcp` (or
`ws://localhost:8081`) with a bearer token whose `aud` matches
`MCP_RESOURCE_SERVER_RESOURCE_URI` and whose `scope` claim covers whatever
tools you want to call. Call `tools/list` after connecting for the
authoritative, current tool catalog and required scopes — it's generated
from this server's own registry, so it never drifts from what's actually
callable.

## Auth modes

Whether a token's signature is verified is decided by whether a JWKS source
is configured — not by `STRICT_AUTH`:

- **JWKS source set** (`PINGONE_ISSUER`, `PINGONE_JWKS_URI`, or
  `PINGONE_BASE_URL`) — every token is verified against your PingOne
  environment's keys and rejected on failure. `STRICT_AUTH` has no effect.
  Run this way once real tokens are flowing.
- **No JWKS source** — `STRICT_AUTH=false` (the shipped default) accepts a
  well-formed token with a console warning, so you can exercise every tool
  with a hand-made token before PingOne is wired up; `STRICT_AUTH=true`
  rejects every token instead. Do not leave the default reachable by more
  than you.

`.env.standalone.example` ships with all three JWKS variables commented out
for that reason — uncomment one when you have real tokens.

## Investment tools

`get_investment_accounts`, `get_investment_balance`, `get_portfolio_summary`,
and `get_investment_transactions` work out of the box from a bundled SQLite
database (`data/invest.db`, seeded from `seed/invest.seed.json` on first
use), exactly like every other vertical.

Set `BANKING_API_BASE_URL` only if you run a banking API of your own and want
these four tools to forward the caller's bearer token to it and return
whatever it returns. With it set, the bundled invest database is not used.

## Adding a tool

Tools are code, not config. The catalog (`tools/list`), the per-tool scope
gate, and the `scopes_supported` advertised in
`/.well-known/oauth-protected-resource` are all derived from `ALL_TOOLS` in
`src/tools/registry.ts`, so a tool you add to a vertical's list is live
everywhere once you rebuild the image (the `--build` command in Quick start).

### 1. Add a tool to an existing vertical

Two edits, no registry change:

1. Append a tool definition to that vertical's `src/tools/<vertical>Tools.ts`
   array, e.g. in `sportingGoodsTools.ts`:

   ```ts
   {
     name: 'gear_return_status',
     description: 'Show the status of a sporting-goods return.',
     inputSchema: {
       type: 'object',
       properties: { orderId: { type: 'string', description: 'Order ID' } },
       required: ['orderId'],
     },
     requiredScopes: ['read'],   // the bearer token must carry every scope listed
     readOnly: true,
     intentHints: ['check my gear return'],   // required — tests/registry.test.ts asserts it
   },
   ```

2. Add a matching `case 'gear_return_status':` to the `switch` in
   `src/tools/<vertical>ToolHandler.ts`. The handler just returns JSON —
   read from that vertical's `src/db/<vertical>Db.ts`, or anything else.

### 2. Add a new vertical

Same two files as above (`src/tools/<vertical>Tools.ts` exporting a
`<VERTICAL>_TOOLS: McpToolDef[]`, and `src/tools/<vertical>ToolHandler.ts`
exporting `dispatch<Vertical>Tool`), plus:

- **Data** (optional): `src/db/<vertical>Db.ts` + `seed/<vertical>.seed.json`.
  Copy `sportingGoodsDb.ts` — it opens `data/<vertical>.db`, creates the
  schema, and applies the seed only when the tables are empty. `Dockerfile`
  already copies `seed/`, and the compose file already mounts `data/`.
- **Register** in `src/tools/registry.ts`: import the two exports, spread
  `<VERTICAL>_TOOLS` into `ALL_TOOLS`, add a
  `const <VERTICAL>_TOOL_NAMES = new Set(<VERTICAL>_TOOLS.map((t) => t.name))`,
  and one line in `dispatch()`:
  `if (<VERTICAL>_TOOL_NAMES.has(toolName)) return dispatch<Vertical>Tool(toolName, args, subject);`
  (`subject` is the token's `sub` — accept it in your handler when reads
  must be scoped to the caller, as banking and airlines do.)
- **Resources** (optional): `tools/list` is automatic, but MCP *resources*
  (`resources/list`, `resources/read`) come from the hand-maintained
  `RESOURCE_CATALOG` in `src/index.ts` — add an entry there if the vertical
  should also expose its list tool as a resource.

### Things that bite

- `requiredScopes` must be scopes your PingOne resource actually grants.
  A token missing any of them gets 403 on `tools/call`, and `tools/list`
  hides the tool from that token entirely.
- Tool names are global. `dispatch()` routes by the first name set that
  matches, so a name reused across two verticals silently goes to whichever
  is checked first.
- Use a data-backed vertical (e.g. sporting-goods) as the template, not
  invest — invest is the `dispatch()` fallthrough and carries a
  proxy-vs-SQLite switch you don't need.

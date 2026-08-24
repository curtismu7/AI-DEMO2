# banking-mcp-resource-server — standalone deployment

An MCP server exposing read-mostly tools across ten mock verticals (banking,
healthcare, government, manufacturing, retail, sporting-goods, university,
workforce, Abercrombie & Fitch, airlines) plus a set of investment tools.
Every vertical except investment reads its own bundled SQLite database — no
other service is required to run it. Investment tools proxy to a banking API
you supply (optional — see below).

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

Edit `.env`: set `MCP_RESOURCE_SERVER_RESOURCE_URI`, `PINGONE_ENVIRONMENT_ID`,
`PINGONE_REGION`, and `PINGONE_ISSUER` for your own PingOne environment.

```bash
docker compose -f docker-compose.standalone.yml up --build
```

The server listens on `http://localhost:8081`. SQLite databases persist in
`./data` (seeded on first boot from `seed/`; a restart never re-seeds a
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

- **Production (`STRICT_AUTH=true`)** — tokens are rejected unless their
  signature verifies against your PingOne environment's JWKS
  (`PINGONE_ISSUER`, `PINGONE_JWKS_URI`, or `PINGONE_BASE_URL` — set one).
- **Wiring things up (`STRICT_AUTH` unset)** — a token that can't be
  signature-checked is accepted with a console warning instead of rejected.
  Useful while you're still setting up your PingOne environment; don't run
  this way past that.

## Investment tools (optional)

`get_investment_accounts`, `get_investment_balance`, `get_portfolio_summary`,
and `get_investment_transactions` forward the caller's bearer token to
`BANKING_API_BASE_URL` and return whatever that API returns. Every other
tool works with no such backend. Leave `BANKING_API_BASE_URL` unset to skip
investment tools entirely — calls to them will fail with a connection error,
everything else is unaffected.

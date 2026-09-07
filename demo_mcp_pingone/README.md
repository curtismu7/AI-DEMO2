# demo_mcp_pingone — PingOne's own MCP server, behind Privilege

Runs [`pingidentity/pingone-mcp-server`](https://github.com/pingidentity/pingone-mcp-server)
as a sidecar in the PingOne Privilege AI Gateway pod, so Privilege applies
per-tool policy to **PingOne administrative actions**.

The demo it enables: *"this agent may inventory your PingOne applications, but
may not create or modify one."*

## Why a bridge is needed at all

`pingone-mcp-server` speaks **stdio only** — `run` has no `--port`/`--http`/`--sse`
flag, and upstream's Docker guidance is a one-shot `docker run -i --rm`. The AI
Gateway discovers a backend by issuing a bare `GET` and waiting for an SSE
`endpoint` event, so it can never reach a stdio process.

`server.js` owns one long-lived stdio child and exposes it over both transports
the estate uses. It is a composition of two patterns already in this repo, not a
new invention:

| From | What it contributes |
|---|---|
| `demo_mcp_weather/server.js` | long-lived stdio child, respawn, JSON-RPC id remapping |
| `demo_mcp_brave/server.js` | the SSE `endpoint` handshake the gateway requires |

## The auth trap (this is the important part)

Upstream documents two grants — `authorization_code` and `device_code` — and
**both are unusable behind a gateway**. Their authorization URL is emitted to
**stderr as a log line**, not as an MCP `elicitation/create` request:

```
STDERR msg="Device authorization required" verification_uri=https://auth.pingone.com/<env>/device user_code=NNKD-FJFH
STDERR msg="Waiting for authorization..."
```

stderr does not traverse a bridge, and certainly not the gateway. A client
connecting through Privilege would hang on "Waiting for authorization…" showing
nothing. Verified 2026-09-07 with a client that explicitly advertised
`elicitation` capability — no elicitation was ever sent.

**Use `PINGONE_AUTH_GRANT_TYPE=client_credentials`.** It is undocumented in the
upstream README but fully supported by the binary, needs no human, and self-renews.

**Consequence worth saying on stage:** the upstream then acts as a **service**
identity, so PingOne's own role filtering is static and *every* per-user access
decision comes from Privilege policy. That is the point of this demo, but it is
a real change from the hosted server's "roles ride on the signed-in user" model.

## Tool surface

Curated deliberately. Upstream ships 15 tools across four collections and is
**read-only by default**; this sidecar runs
`--disable-read-only --include-tool-collections applications,populations`,
giving 8 tools and a clean policy contrast:

| Reads — permit | Writes — deny or require approval |
|---|---|
| `list_applications`, `get_application` | `create_oidc_application`, `update_oidc_application` |
| `list_populations`, `get_population` | `create_population`, `update_population` |

Override with `PINGONE_MCP_ARGS` rather than editing the source.

Writes only work against a **SANDBOX** environment — the binary enables an
"environment validation middleware" that blocks writes to PRODUCTION. The demo
tenant `AI-Demo` (`01d89b06`) is SANDBOX, so this is fine, but a PRODUCTION
tenant would refuse the write *at the server*, which looks like a Privilege
denial and is not one.

## HTTP surface

| Route | Purpose |
|---|---|
| `GET /health` | readiness probe |
| `GET /sse` | SSE handshake — emits `event: endpoint` |
| `GET /mcp` | same handshake, for catalog-added apps whose backend is pinned to `/mcp` and cannot be edited |
| `POST /messages?sessionId=…` | JSON-RPC in; reply rides the SSE stream, POST returns `202` |
| `POST /mcp` | Streamable HTTP — JSON-RPC in, response out |

## Configuration

| Env | Default | Notes |
|---|---|---|
| `PORT` | `8083` | 8080–8082 are the other gateway sidecars |
| `PINGONE_MCP_BIN` | `/usr/local/bin/pingone-mcp-server` | |
| `PINGONE_MCP_ARGS` | `run --disable-read-only --include-tool-collections applications,populations` | |
| `PINGONE_MCP_TIMEOUT_MS` | `30000` | PingOne management calls are not fast |
| `PINGONE_MCP_ENVIRONMENT_ID` | — | required |
| `PINGONE_AUTH_GRANT_TYPE` | — | set to `client_credentials` |
| `PINGONE_CLIENT_CREDENTIALS_CLIENT_ID` / `_SECRET` | — | worker app |
| `PINGONE_CLIENT_CREDENTIALS_SCOPES` | — | `p1:read:env` |
| `PINGONE_ROOT_DOMAIN` | — | `pingone.com` |

## Deploy

The sidecar is declared in
[`../pingone-privgateway-helm-main/agentless/sidecars.values.yaml`](../pingone-privgateway-helm-main/agentless/sidecars.values.yaml),
which restates **every** sidecar — `extraContainers` is a list and Helm replaces
lists wholesale, so a partial upgrade silently deletes the ones it omits.

```bash
kubectl -n ping-devops-curtismuir create secret generic pingone-mcp-secrets \
  --from-literal=PINGONE_MCP_ENVIRONMENT_ID=... \
  --from-literal=PINGONE_CLIENT_CREDENTIALS_CLIENT_ID=... \
  --from-literal=PINGONE_CLIENT_CREDENTIALS_CLIENT_SECRET=...

helm upgrade agentless-mcpgw \
  pingone-privgateway-helm-main/agentless/agentless-mcpgw/ \
  -n ping-devops-curtismuir --reuse-values \
  -f pingone-privgateway-helm-main/agentless/sidecars.values.yaml
```

Then register it in the Privilege console as its own Agentic App:

```
Application Name  pingone-admin
MCP Server URL    http://localhost:8083/sse      <- /sse, NOT /mcp
Mesh Cluster      ai-demo-cmuir
Auth Mode         None
```

`/sse` is not optional — registering a backend as `/mcp` makes gateway discovery
fail with `Gateway Unreachable … calling "initialize": Unauthorized`, which reads
like an auth fault and is not one.

## Test

```bash
node --test test/*.test.js
```

Covers the SSE `endpoint` handshake and JSON-RPC id remapping — the two things
that fail silently and look like a broken upstream. The fake child answers
**slowly and out of order** on purpose: an instant reply lets each call finish
before the next begins, so no two are ever in flight and the cross-talk test
passes even with remapping removed.

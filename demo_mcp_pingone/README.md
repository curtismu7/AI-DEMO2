# demo_mcp_pingone — PingOne's own MCP server, behind Privilege

Runs [`pingidentity/pingone-mcp-server`](https://github.com/pingidentity/pingone-mcp-server)
as a sidecar in the PingOne Privilege AI Gateway pod, so Privilege applies
per-tool policy to **PingOne administrative actions**.

**Gateway/policy behaviors that aren't specific to this server** — policy
union across multiple policies, entry-path pinning, DCR statelessness, the
hosted-vs-self-hosted auth split — live in
[`privilege/LESSONS-LEARNED.md`](../privilege/LESSONS-LEARNED.md), not here.
This file stays scoped to what's specific to this bridge.

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

**Use a worker `client_credentials` token.** But note the platform split found
on 2026-09-07, on v0.0.2:

| Build (same commit `68064d2`) | `PINGONE_AUTH_GRANT_TYPE=client_credentials` |
|---|---|
| `darwin_arm64` | honoured — proven by a wrong secret returning `invalid_client` |
| `linux_arm64` | **ignored** — never attempts the flow, fails every tool call |

`--grant-type client_credentials` is rejected as a *flag* on both
("unable to parse grant type"), so the env var is the only route — and it does
not work on Linux, which is what we deploy.

**So the bridge mints the token itself** and writes the session file the binary
reads. That depends on the file's UNDOCUMENTED shape:

```json
{ "accessToken": "...", "refreshToken": "", "expiry": "<RFC3339>", "sessionId": "..." }
```

`test/sessionShape.test.js` pins that shape against a real captured sample, so an
upstream change surfaces as a red test rather than a demo that silently stops
authenticating. There is no refresh token (client_credentials never issues one),
so expiry is handled by re-minting ahead of a 5-minute skew, plus a retry-once
path when the child reports an auth failure — that self-heals even if the child
cached a token in memory.

`--store-type file` is also mandatory in a container: the default `keychain`
means the DBus Secret Service on Linux, and without it the process exits 1 on
every start with `keychain is not accessible: exec: "dbus-launch": executable
file not found`. Invisible on macOS, which has a keychain.

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
| `PINGONE_MCP_ARGS` | `run --store-type file --disable-read-only --include-tool-collections applications,populations` | `--store-type file` is mandatory in a container |
| `PINGONE_MCP_TIMEOUT_MS` | `30000` | PingOne management calls are not fast |
| `PINGONE_MCP_ENVIRONMENT_ID` | — | required |
| `PINGONE_AUTH_GRANT_TYPE` | — | set to `client_credentials` (ignored by the Linux build; the bridge mints instead) |
| `PINGONE_MCP_SESSION_FILE` | `$HOME/.pingone_mcp_session.json` | where the minted session is written |
| `PINGONE_CLIENT_CREDENTIALS_CLIENT_ID` / `_SECRET` | — | worker app |
| `PINGONE_CLIENT_CREDENTIALS_SCOPES` | — | `p1:read:env` |
| `PINGONE_ROOT_DOMAIN` | — | `pingone.com` |

The demo client's **door URL** is configured separately, in
`demo_api_server/routes/privilegeMcpClient.js`:

| Env | Default | Notes |
|---|---|---|
| `PRIVILEGE_APP_PINGONE_ADMIN` | `pingone-admin-local` | the Agentic App name |
| `PRIVILEGE_APP_PINGONE_ADMIN_PATH` | `mcp` | must match the gateway's current entry path — see below |
| `PRIVILEGE_MCPGW_PINGONE_ADMIN_URL` | — | whole URL, overrides both |

## Entry path: whichever the app is registered with

The AI Gateway pins an Agentic App to ONE path, derived from how its backend was
registered, and this applies to the CLIENT-facing URL too — not just the
backend. An app whose backend is registered as `/sse` is reachable by clients
only at `/<app>/sse`; `/<app>/mcp` returns a bare `404`.

The only place that says so is the gateway log:

```
[mcpgw] resolved host for app <name>: <name>.default.applications.procyon.ai:8643
[mcpgw] rejecting /mcp on app <name>: outside entry path "/sse"
```

Two traps follow from this:

- **The 404 arrives AFTER authentication.** With no bearer you get a normal 401
  challenge, so a door can look healthy and still 404 every real call. Auth is
  not the problem when this happens.
- **Console discovery reports the app's URL with `/mcp`**, which is only correct
  while the app is registered that way. That is why `privilegeMcpClient.js`
  lists this door explicitly rather than relying on discovery.

**Either path works as a BACKEND for this server**, because the bridge answers
the SSE handshake on `/sse` and `/mcp` alike. That is unusual — a plain
streamable-HTTP server answers a bare `GET /mcp` without the `endpoint` event and
fails discovery entirely (`Gateway Unreachable … calling "initialize":
Unauthorized`, no tools, no policy). So for THIS server the Backend Name is a
free choice, and whichever you pick becomes the client path.

`/mcp` is the better choice: it is what the console's own MCP Config block hands
out and what console door discovery reports, so picking it makes both usable
rather than traps.

**It changes under you.** Editing Backend Name in the console flips the client
path for every caller, and only after the gateway restarts and re-runs
discovery — it flipped from `/sse` to `/mcp` on 2026-09-08 mid-session. That is
why `privilegeMcpClient.js` exposes `PRIVILEGE_APP_PINGONE_ADMIN_PATH`:
realigning the demo's door should be an env change and a restart, not a PR.

**Known live example:** the `opensearch22` door 404s on `/mcp` for exactly this
reason. It is excluded from `scripts/lmstudio-mcp-sync.js` and flagged in
`demo_api_server/services/mcpProfileStore.js` on those grounds. Do NOT assume the
free choice above transfers to it — its backend is the OpenSearch MCP server,
not this bridge, and it may genuinely only answer the handshake on `/sse`.

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

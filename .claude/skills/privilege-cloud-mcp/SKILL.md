# Privilege Cloud MCP — Gateway Integration

Use when troubleshooting, configuring, or extending the PingOne Privilege Cloud
MCP integration: the Privilege Gateway, the BFF MCP client relay, the
Privilege MCP Client UI page, or the K8s deployment.

## Architecture

```
Browser → BFF (privilegeMcpClient.js) → Privilege Gateway (MCP server)
                                              ↓
                                     Our backend MCP server
```

**Our app is the MCP client. Privilege Gateway is the MCP server.**
The gateway handles communication with our backend MCP server — our app only
knows about the gateway endpoint. The gateway validates the user's PingOne token,
applies tool-level access policies, then proxies allowed calls to the backend.

The BFF authenticates the user via a **separate OAuth flow** using the Privilege
SSO client — the main banking app token has the wrong audience for Privilege Cloud.

### Two deployment paths

| Path | Endpoint | Status |
|------|----------|--------|
| **Gateway frontend** (use this) | `https://local.ping-devops.com:8623/mcp` — SE cluster: `https://ai-demo.ping-devops.com/mcpgw` | The only path that can work. Requires an MCP Server application in the console (see below) |
| **Cloud API** | `https://privilege.pingone.com/api/mcp` | DEAD END — 401s every request including its own `.well-known/oauth-protected-resource`, sends no `WWW-Authenticate` |

**Do not repoint `PRIVILEGE_MCPGW_URL` at the Cloud API.** That was tried and
reverted; `docs/PRIVILEGE-MCP.md` §"4. The client pointed at the Privilege cloud
API, not a gateway — RESOLVED 2026-08-02" is the record. No token from PingOne
env `01d89b06` satisfies `privilege.pingone.com` — not the `6586d3de` app, not the
dedicated `873cc9e4` "Privilege Cloud MCP Gateway" app (which mints
`aud: mcpserver.ping.demo`, the demo's own audience). The 401 arrives before any
policy runs, so it looks like an authorization problem and is not one.

**Port `8623`, not `8680`.** `-listen :8680` opened no reachable MCP listener:
inside the container only `127.0.0.1:8090` was bound, so `:8680` accepted the host
port-forward's TCP connection and immediately closed it (`UND_ERR_SOCKET` at the
BFF). #1219 moved the listener to `:8623`, the product's MCP traffic port, which
is also what the k8s ingress maps 443 to. `PRIVILEGE_MCPGW_URL` and the service's
`-listen` flag must always name the same port.

### Current state (verified 2026-08-02)

The proxy runs and is healthy; the demo is blocked entirely on console-side setup.

- Container `ai-demo-ping-mcpgw` up, node `e40f4540-…` `Active`, control-plane link
  established, `ProxyURL local.ping-devops.com:8623`.
- **No MCP frontend exists.** The log creates only the vendor defaults
  (`console.tun.procyon.ai`, `login.procyon.ai`, `agent.procyon.ai`,
  `local.procyon.ai:8643`, `*.privilege.pingone.com`) and inside the container only
  `127.0.0.1:8090` is bound. Nothing serves 8623, so `tools/list` cannot work no
  matter what the BFF sends. Fixed only by creating the MCP Server application in
  the console (checklist step 5).
- **Duplicate node registration.** `has same NodeURL - this happens because of
  misconfigured Node`: a stale row claims the same `NodeURL local.ping-devops.com:8690`
  as the live node. Delete the stale one in the console.
- `Error sending update to mesh controller: … not found` is the same symptom, not a
  separate fault.

### Headers (Cloud API path only — kept for reference, that path is dead)

| Header | When | Value |
|--------|------|-------|
| `Authorization` | Always | `Bearer <user's PingOne SSO token>` |
| `x-procyon-session-id` | Always | Unique session UUID (generated per-session in BFF) |
| `mcp-protocol-version` | Non-initialize requests | `2024-11-05` |
| `Content-Type` | Always | `application/json` |

### How the pieces relate (Privilege console)

| Console section | Purpose |
|-----------------|---------|
| **Gateways** | Manage proxy infrastructure (clusters, nodes, enrollment tokens) |
| **Agentic Apps → MCP Servers** | Register which MCP server the gateway protects; set upstream auth mode |
| **Policies / Configure MCP Access** | Grant users access to specific tools (requires discovery first) |

These are **separate entities** linked via the "Mesh Cluster" dropdown on the MCP App.

### Upstream auth modes (MCP Application → Auth Mode)

| Mode | When to use |
|------|-------------|
| **Static Token** | MCP server expects a fixed Bearer token (or no auth) |
| **OAuth (Pre-Register)** | MCP server protected by an IdP; you provide client_id/secret/endpoints |
| **OAuth (DCR)** | Privilege registers itself as an OAuth client at runtime (RFC 7591) |

Our MCP server uses mTLS for gateway auth (not OAuth bearer). Set mTLS to false
when Privilege is the gateway — Privilege IS the security boundary. Use **Static
Token** with no token value, or OAuth if the MCP server validates bearers.

### Tool discovery prerequisite

Before policies can be created, Privilege must discover the MCP server's tools.
This requires the proxy to successfully call `POST /mcp` on the upstream server
and get an `initialize` + `tools/list` response. If mTLS blocks the connection,
discovery fails with "No Tools, Prompts, or Resources Discovered."

## Key identifiers

| What | Value |
|------|-------|
| PingOne Env | `01d89b06-66d5-430e-9f28-65636843788b` |
| OIDC Client (MCP Gateway) | `6586d3de-b916-454c-84e5-6d21b572a534` |
| Privilege Tenant | `8d4d7a4c-de40-4f71-9b98-0c3507cd4d1b` |
| Proxy Image | `public.ecr.aws/s7q1z8z4/privilege-proxy` |
| Proxy Binary | `/procyon/bin/cyonproxy` |
| Cluster ID | `ai-demo-se` |
| Cluster Name | `cmuir-mcpgw` |
| MCP endpoint (gateway frontend) | `https://local.ping-devops.com:8623/mcp` — what `PRIVILEGE_MCPGW_URL` must be |
| MCP endpoint (Cloud API) | `https://privilege.pingone.com/api/mcp` — DEAD END, do not use |
| Node ID (current) | `e40f4540-ac21-47f4-bfc0-47a41adb8022`, `ProxyURL local.ping-devops.com:8623` |
| gRPC controller | `grpc.privilege.pingone.com:443` |
| End user | `cmuir+ssoEndUser@pingone.com` / `Demo1234!` |
| Token file | `ping-mcpgw/config/proxy-token` (gitignored) |
| Gateway OIDC config | `ping-mcpgw/config/pingone.env` (gitignored; `.example` is committed) |

### Current token status

The enrollment token in `ping-mcpgw/config/proxy-token` (and `PRIVILEGE_PROXY_TOKEN`
in the root `.env`) **expired 2026-08-02T12:22:37Z**. That does **not** stop the
proxy: verified 2026-08-02, the container starts, enrolls, and holds an active
control-plane link with the expired wizard JWT still in place, because cyonproxy
already swapped it for a long-lived token inside the `mcpgw-ssl` volume. An expired
token only matters on **first** boot or after that volume is deleted — do not
diagnose "expired token" from the file's `exp` alone; check whether the container
is running and linked first.

See **[ping-mcpgw/RENEW-TOKEN.md](../../ping-mcpgw/RENEW-TOKEN.md)** for the
full step-by-step renewal procedure.

### MCP server requirements for Privilege gateway

The backend MCP server must be configured to accept connections from the Privilege
gateway. Key settings in `docker-compose.yml`:

| Setting | Value | Why |
|---------|-------|-----|
| `MCP_MTLS_ENABLED` | `"false"` | Privilege connects via plain HTTP; mTLS blocks it |
| `NODE_ENV` | `development` | Needed for SKIP_TOKEN_SIGNATURE_VALIDATION |
| `SKIP_TOKEN_SIGNATURE_VALIDATION` | `true` | Gateway may send its own tokens |
| `ALLOW_JWKS_FAILOPEN` | `true` | Graceful degradation if JWKS unreachable |
| `tmpfs: /app/dev-data` | (volume config) | Dev mode needs writable session dir; container runs as uid 1001 |

The `PRIVILEGE_MCPGW_URL` env var on the BFF (`demo-api-server`) points to the
gateway frontend: `https://local.ping-devops.com:8623/mcp`

## Proxy enrollment

The proxy needs a one-time enrollment token on first boot. After that it persists
state in `/procyon/ssl/` (mainly `proxy-config.data`).

### Get a token
1. Privilege Cloud console → Gateways → your gateway → "Add Node"
2. Copy the JWT — it expires in ~24h

### Provide to Docker

**Option A — env var (preferred for first boot):**
```bash
export PRIVILEGE_PROXY_TOKEN="eyJ..."
./run-docker.sh optional start mcpgw
```
docker-compose.yml passes it via `ENV_PROXY_TOKEN: "${PRIVILEGE_PROXY_TOKEN:-}"`.

**Option B — token file:**
```bash
printf '%s' 'eyJ...' > ping-mcpgw/config/proxy-token
export PRIVILEGE_PROXY_TOKEN="$(cat ping-mcpgw/config/proxy-token)"
./run-docker.sh optional start mcpgw
```
The file is **not** bind-mounted — it is a place to keep the JWT, and the value
still reaches the container through `ENV_PROXY_TOKEN`. Do not add a single-file
bind of it: cyonproxy rewrites `/procyon/ssl/proxy-token.data` at startup (it swaps
the short-lived wizard JWT for a long-lived one), so a `:ro` bind makes the
container exit 1 with *"ProxyToken write to /procyon/ssl/proxy-token.data failed …
read-only file system"*, and a `:rw` single-file bind breaks as soon as the proxy
replaces rather than truncates the file.

### After enrollment
The proxy writes `proxy-config.data` into the `mcpgw-ssl` Docker volume.
Subsequent boots use this persisted config — no token needed. If the volume is
lost (Docker crash, prune), re-enroll with a fresh token.

### Re-enrollment (Docker crash recovery)
```bash
# 1. Get new token from console
# 2. Save it:
echo "eyJ..." > ping-mcpgw/config/proxy-token
# 3. Clear stale volume state:
docker volume rm ai-demo_mcpgw-ssl 2>/dev/null || true
# 4. Start fresh:
export PRIVILEGE_PROXY_TOKEN="eyJ..."
./run-docker.sh optional start mcpgw
# 5. Verify enrollment:
docker logs ai-demo-ping-mcpgw 2>&1 | grep -i "enrolled\|connected\|ready"
```

## Proxy ports

| Port | Purpose |
|------|---------|
| 8623 | MCP traffic — the frontend the BFF calls, and what k8s maps 443 to |
| 8620 | Agentless API |
| 8690 | Medusa gRPC tunnel (also the node's `NodeURL`) |

The container publishes 8623 whether or not anything serves it. A successful TCP
connect to 8623 proves the port-forward, not the gateway — `curl` the `/mcp` path
and check for a listener inside the container (`docker exec … cat /proc/net/tcp`)
before concluding the gateway is up.

## BFF MCP client (privilegeMcpClient.js)

Route prefix: `/api/privilege-mcp/`

The BFF requires a **Privilege-specific OAuth token** — the main banking app's
SSO token will NOT work (wrong audience). The user must authenticate via the
Privilege SSO client (`6586d3de-b916-454c-84e5-6d21b572a534`) through the
"Sign In with Privilege" button.

### Auth flow

PingOne token exchange (RFC 8693) does NOT work for OIDC app audiences — it only
issues tokens for custom resources. The ONLY working path is authorization_code.

1. User clicks "Sign In with Privilege" → `POST /auth/start`
2. BFF discovers authorization/token URIs from PingOne OIDC metadata
3. Builds authorize URL with `client_id`, PKCE S256, `login_hint` (`PRIVILEGE_LOGIN_HINT` env var)
4. User authenticates in new tab → PingOne redirects to `/auth/callback`
5. BFF exchanges code for token (client_secret_post + PKCE verifier)
6. Token stored in privilege-specific session (NOT the main app session)
7. Subsequent `tools/list` and `tools/call` use this token

### Routes

1. `GET /state` — returns session state (token presence, tools, config)
2. `POST /auth/start` — begins OAuth PKCE flow, returns `authUrl`
3. `GET /auth/callback` — exchanges code for Privilege-specific token
4. `POST /tools/list` — initializes MCP session + discovers tools from Privilege Gateway
5. `POST /tools/call` — invokes a tool via the gateway
6. `POST /rpc` — raw JSON-RPC passthrough

### Required env vars (BFF / docker-compose.yml)

| Var | Purpose |
|-----|---------|
| `PRIVILEGE_MCPGW_URL` | Gateway frontend: `https://local.ping-devops.com:8623/mcp` — must match the `ping-mcpgw` service's `-listen` port |
| `PRIVILEGE_SSO_CLIENT_ID` | PingOne OIDC client for Privilege auth |
| `PRIVILEGE_SSO_CLIENT_SECRET` | Client secret (client_secret_post for code exchange) |
| `PRIVILEGE_SSO_ENV_ID` | PingOne env ID (for OIDC discovery fallback) |
| `PRIVILEGE_LOGIN_HINT` | Email pre-filled in PingOne login (`cmuir+ssoEndUser@pingone.com`) |

### PingOne OIDC app config (Privilege SSO client)

| Setting | Value |
|---------|-------|
| App ID | `6586d3de-b916-454c-84e5-6d21b572a534` |
| Name | Demo AI App - MCP Gateway |
| Type | WEB_APP |
| Grant Types | AUTHORIZATION_CODE, CLIENT_CREDENTIALS |
| PKCE | S256_REQUIRED |
| Token Endpoint Auth | CLIENT_SECRET_POST |
| Redirect URI | `https://local.ping-devops.com:4000/api/privilege-mcp/auth/callback` |

## UI — PrivilegeMcpClientPage

- Route: `/privilege-mcp-client`
- Shows "Access Denied" modal when refreshTools gets a 401 "not authorized"
  (means Privilege policy not yet assigned to the user)
- Fix: assign the user a policy in the Privilege Cloud console

## K8s deployment

Manifest: `k8s/75-ping-mcpgw-deployment.yaml`
- Reads `ENV_PROXY_TOKEN` from K8s secret `ping-mcpgw-secrets`
- Hostname: `ai-demo.ping-devops.com`
- Persists SSL state via `ssl-certs` volume

## Docker startup

```bash
# Local dev (compose optional group):
./run-docker.sh optional start mcpgw

# Standalone (host network, proven approach):
docker run -d --name ai-demo-ping-mcpgw \
  --net=host \
  -e ENV_PROXY_TOKEN="$(cat ping-mcpgw/config/proxy-token)" \
  public.ecr.aws/s7q1z8z4/privilege-proxy \
  /procyon/bin/cyonproxy -hostname local.ping-devops.com -listen :8623
```

Never drive `docker compose up` directly — a hook blocks it. Parallel sessions
converging the same project produce `container name /ai-demo-... is already in use`
conflicts. Use `./run-docker.sh`, which pins the project name/directory.

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Proxy exits immediately, no logs | Missing/invalid `proxy-config.data` and no `ENV_PROXY_TOKEN` | Provide enrollment token |
| "not found" on enrollment (500) | Token's `nodeId` was deleted from the gateway in the Privilege console | Go to console → Gateways → Add Node to generate a token for a *new* node; if the gateway itself is gone, recreate it |
| Proxy starts then drops with `token expired` or silent reconnect loop | `ENV_PROXY_TOKEN` JWT `exp` claim is in the past | Get a fresh token from the console (see below) |
| "No Tools, Prompts, or Resources Discovered" in console | Proxy can't reach MCP server (mTLS blocks, wrong URL, wrong port) | Set `MCP_MTLS_ENABLED=false` on MCP server; ensure URL is `https://host.docker.internal:8080/mcp` |
| 401 "User is not authorized" from MCP | User has no Privilege policy for the MCP app | Assign policy in Privilege console (requires discovery first) |
| 401 "Unsupported authentication method" on token exchange | Missing `client_secret` in POST body | Ensure `PINGONE_MCP_GATEWAY_CLIENT_SECRET` is set |
| redirect_uri mismatch | BFF detects wrong host (Docker internal hostname) | Set `PRIVILEGE_MCP_CALLBACK_HOST` or ensure `x-forwarded-host` passes through |
| Session not persisting between requests | Session cookie not sent / saveUninitialized | Use browser (cookies auto-sent), or pass `Cookie` header in curl |
| curl to MCP server gets "Empty reply" | mTLS enabled — server drops non-cert connections | Disable mTLS or provide gateway client cert |
| gRPC `UNAVAILABLE` / proxy silent hang | Firewall blocking outbound to `grpc.privilege.pingone.com:443` | Allow outbound 443; no inbound holes needed |
| `IssuerPublicKey:[]` in proxy logs | Controller never pushes JWKS keys to the local proxy | Known gap. The Cloud API is **not** the workaround — it 401s everything (see "Two deployment paths") |
| Container up, 8623 accepts TCP, but `curl https://…:8623/mcp` fails to connect | No MCP frontend exists — the proxy binds only `127.0.0.1:8090`. The log shows the vendor default frontends (`console.tun.procyon.ai`, `login.procyon.ai`, `agent.procyon.ai`, `*.privilege.pingone.com`) and none for our MCP server | Create the MCP Server application in the console against cluster `ai-demo-se` (checklist step 5). No code change will open that port |
| `has same NodeURL - this happens because of misconfigured Node` | Two node registrations claim the same `NodeURL local.ping-devops.com:8690` — the live node is linking to a stale twin of itself | Console → Gateways → delete the stale node row, keep the one whose ID matches the running container's log |
| BFF gets `UND_ERR_SOCKET` / connection refused to the gateway | `PRIVILEGE_MCPGW_URL` port does not match the service's `-listen` port | Both must be `8623` (see "Port 8623, not 8680") |
| Server crash: `EACCES: permission denied, mkdir './dev-data'` | Dev mode needs writable dir but container runs as non-root (uid 1001) | Add `tmpfs: /app/dev-data:uid=1001,gid=1001` to docker-compose.yml |
| Server crash: `Configuration validation failed` | `SKIP_TOKEN_SIGNATURE_VALIDATION=true` forbidden outside development | Set `NODE_ENV: development` in docker-compose.yml for the mcp-server service |
| Cloud API 400: "mcp-protocol-version header is required" | Non-initialize requests need protocol version header | BFF's fetchMcp adds `mcp-protocol-version: 2024-11-05` for non-initialize requests |
| Discovery succeeds but tool calls return empty | MCP server behind PingGateway, not directly reachable | MCP App config → set MCP Server URL to the **internal** URL (`http://mcp-server:8080/mcp`), not the gateway URL |
| 401 despite policy being set | Using main app's SSO token (wrong `aud` claim) | User must click "Sign In with Privilege" to get a token from the Privilege SSO client |

## Token expiration and renewal

The enrollment token (`ENV_PROXY_TOKEN`) is a JWT issued by the Privilege console
wizard. It typically expires **~24h after creation** (first enrollment) or **~1 year**
for long-lived node tokens.

### Check expiration
```bash
cat ping-mcpgw/config/proxy-token | cut -d. -f2 | base64 -d 2>/dev/null | python3 -c "
import sys, json, datetime
d = json.loads(sys.stdin.read())
exp = datetime.datetime.fromtimestamp(d['exp'], tz=datetime.timezone.utc)
now = datetime.datetime.now(tz=datetime.timezone.utc)
status = 'EXPIRED' if now > exp else 'valid'
print(f'{status} — expires {exp.isoformat()} ({"%.1f" % ((exp-now).total_seconds()/3600)}h from now)')
"
```

### Renew an expired token
1. PingOne Privilege console → **Cloud > Gateways** → select your gateway
2. Click **Add Node** (or the refresh icon on an existing node row)
3. Copy the new `ENV_PROXY_TOKEN=eyJ...` JWT
4. Save locally:
   ```bash
   printf '%s' 'eyJ...<full JWT>' > ping-mcpgw/config/proxy-token
   ```
5. Clear stale enrollment state and restart:
   ```bash
   docker volume rm ai-demo_mcpgw-ssl 2>/dev/null || true
   export PRIVILEGE_PROXY_TOKEN="$(cat ping-mcpgw/config/proxy-token)"
   ./run-docker.sh optional start mcpgw
   ```
6. Verify:
   ```bash
   docker logs ai-demo-ping-mcpgw 2>&1 | grep -iE "enrolled|connected|ready|error"
   ```

### After successful enrollment
Once enrolled, the proxy persists its identity in the `mcpgw-ssl` Docker volume
(`/procyon/ssl/proxy-config.data`). Subsequent container restarts do NOT need the
token — the volume state is sufficient. Only clear the volume if re-enrolling.

## Quick install checklist (fresh machine)

1. **Get the enrollment token** from Privilege console (Gateway wizard → Add Node)
2. **Save it**: `printf '%s' 'eyJ...' > ping-mcpgw/config/proxy-token`
3. **Start**: `./run-docker.sh optional start mcpgw`
4. **Verify enrollment**: the container writes to a volume, not stdout —
   `docker exec ai-demo-ping-mcpgw tail -50 /var/log/procyon/cyonproxy.log`
   (`docker logs` is empty). Look for `established command stream` / `Created
   frontend node`.
5. **Register MCP App** in console: AI Security → Agentic Apps → Add Application → MCP Server
   - Frontend URL: `https://local.ping-devops.com:8623`
   - MCP Server URL: `http://mcp-server:8080/mcp` (compose-internal DNS — the
     gateway resolves it inside the network; it is not browser-reachable)
   - Mesh Cluster: `ai-demo-se`
6. **Discover tools**: wait ~30s after MCP app creation, check console for discovered tools
7. **Create policy**: assign user `cmuir+ssoEndUser@pingone.com` a policy granting tool access
8. **Test from UI**: navigate to `/privilege-mcp-client`, sign in, call a tool

## mTLS and Privilege proxy coexistence

The demo MCP server has `MCP_MTLS_ENABLED` which enforces gateway client certs on
the HTTP transport (`POST /mcp`). When Privilege proxy is the gateway, disable
mTLS on the MCP server — Privilege enforces policy at its layer instead:

```bash
# docker-compose.yml or docker exec:
MCP_MTLS_ENABLED=false
```

The existing `demo_mcp_gateway` (PingGateway) uses mTLS with its own cert at
`/certs/gw-mtls/gw-client.crt`. These are independent paths — both can coexist
if mTLS is left enabled and you add the Privilege proxy's cert to the trust store,
but for simplicity the demo disables mTLS when using Privilege.

## Docker volume gotchas

The compose service uses three named volumes:
- `mcpgw-ssl` — persists enrollment state (`proxy-config.data`). **If this volume
  contains stale state from a previous enrollment, re-enrollment with a new token
  will silently fail.** Always `docker volume rm ai-demo_mcpgw-ssl` before
  re-enrolling.
- `mcpgw-logs` — proxy diagnostic logs
- `mcpgw-recordings` — session recordings (if enabled in console)

- `mcpgw-logs` also holds `cyonproxy.log` — the only place the proxy writes. `docker
  logs ai-demo-ping-mcpgw` is empty, so read
  `docker exec ai-demo-ping-mcpgw tail -50 /var/log/procyon/cyonproxy.log` instead.

If the volume's `proxy-config.data` exists, the proxy uses it and ignores
`ENV_PROXY_TOKEN` entirely — by design, the token is only consumed on first boot.

## pingone.env reference

`ping-mcpgw/config/pingone.env` (gitignored; `pingone.env.example` is the committed
template) holds the OIDC config the gateway uses to authenticate MCP clients. The
whole `ping-mcpgw/config` **directory** is mounted at `/var/lib/procyon/config` —
a single-file bind goes stale when the host file is replaced. The BFF writes this
file via `PUT /api/privilege-mcp/env`.

There is no `guest-agent.env` — earlier revisions of this skill described one.

| Field | Purpose |
|-------|---------|
| `SERVER_URL` | Public URL of this MCPGW; `https://local.ping-devops.com:8623` locally, `https://ai-demo.ping-devops.com/mcpgw` on the SE cluster. The PingOne redirect URI must be `${SERVER_URL}/callback` |
| `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` | The MCPGW application in PingOne (AI Security → Agentic Apps) |
| PingOne AS endpoints | Authorize / token / userinfo for the environment |

A missing `SERVER_URL` is a documented cause of "gateway does not behave as
expected" — which looks exactly like a proxy that enrolls fine and then serves
nothing.

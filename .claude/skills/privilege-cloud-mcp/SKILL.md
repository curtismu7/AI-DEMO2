# Privilege Cloud MCP — Proxy & OIDC Integration

Use when troubleshooting, configuring, or extending the PingOne Privilege Cloud
MCP integration: the privilege proxy container, the BFF OIDC relay, the
Privilege MCP Client UI page, or the K8s deployment.

## Architecture

```
Browser → BFF (privilegeMcpClient.js) → https://host.docker.internal:8080/mcp
                                         (local MCP server, self-signed TLS)

Future (when Privilege OIDC JWKS is fixed):
Browser → BFF → privilege.pingone.com/api/mcp
                      ↕ gRPC tunnel
  Privilege Proxy (:8680) → MCP Server (:8080/mcp)
                      ↕ outbound gRPC
             grpc.privilege.pingone.com:443
```

PingOne Privilege acts as a **proxy gateway** between AI clients and the internal
MCP server. It manages access tokens from the IdP at runtime so the AI client is
never affected. The proxy connects **outbound** to the Privilege Cloud controller
— no inbound connectivity needed.

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
| MCP endpoint (current) | `https://host.docker.internal:8080/mcp` (local MCP server) |
| MCP endpoint (Privilege proxy) | `https://privilege.pingone.com/api/mcp` (disabled — IssuerPublicKey empty) |
| gRPC controller | `grpc.privilege.pingone.com:443` |
| End user | `cmuir+ssoEndUser@pingone.com` |
| Token file | `ping-mcpgw/config/proxy-token` (gitignored) |
| Guest agent env | `ping-mcpgw/config/guest-agent.env` (committed — non-secret config) |

### Current token status

The enrollment token in `ping-mcpgw/config/proxy-token` **expired 2026-07-31**.
A fresh token was obtained 2026-08-01 but enrollment returned **500 "not found"**
— the node (`affdbc0f-8f89-4e48-95b4-63e81359e0fc`) was deleted on the Privilege
side. Must create a new node in the console before the proxy will enroll.

See **[ping-mcpgw/RENEW-TOKEN.md](../../ping-mcpgw/RENEW-TOKEN.md)** for the
full step-by-step renewal procedure, including the "not found" and "Unauthorized"
discovery errors and their fixes.

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
echo "eyJ..." > ping-mcpgw/config/proxy-token
./run-docker.sh optional start mcpgw
```
The compose service bind-mounts this file read-only into `/procyon/ssl/proxy-token.data`.

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
docker volume rm ai-demo2_mcpgw-ssl 2>/dev/null || true
# 4. Start fresh:
export PRIVILEGE_PROXY_TOKEN="eyJ..."
./run-docker.sh optional start mcpgw
# 5. Verify enrollment:
docker logs ai-demo-ping-mcpgw 2>&1 | grep -i "enrolled\|connected\|ready"
```

## Proxy ports

| Port | Purpose |
|------|---------|
| 8680 | mTLS listener (MCP relay / RDP/SSH sessions) |
| 8620 | Agentless API |
| 8690 | Medusa gRPC tunnel |

## BFF OIDC flow (privilegeMcpClient.js)

Route prefix: `/api/privilege-mcp/`

1. `GET /auth/discover` — fetches PingOne OIDC well-known, adds `x-procyon-session-id`
2. `GET /auth/start` — generates PKCE, redirects to PingOne `/authorize`
3. `GET /auth/callback` — exchanges code for tokens (CLIENT_SECRET_POST + PKCE)
4. `POST /mcp/message` — relays JSON-RPC to `PRIVILEGE_MCPGW_URL` with Bearer token + `x-procyon-session-id`

### Required env vars (BFF / docker-compose.yml)

| Var | Purpose |
|-----|---------|
| `PRIVILEGE_MCPGW_URL` | MCP endpoint — currently `https://host.docker.internal:8080/mcp` (local); when Privilege JWKS works: `https://privilege.pingone.com/api/mcp` |
| `PINGONE_MCP_GATEWAY_CLIENT_ID` | OIDC client for auth_code flow |
| `PINGONE_MCP_GATEWAY_CLIENT_SECRET` | Client secret (CLIENT_SECRET_POST) |
| `PINGONE_ENVIRONMENT_ID` | PingOne env for well-known discovery fallback |
| `PRIVILEGE_MCP_CALLBACK_HOST` | Optional — override callback hostname |

### Required OIDC client config (PingOne)

- Grant types: AUTHORIZATION_CODE, TOKEN_EXCHANGE, CLIENT_CREDENTIALS
- PKCE: S256_REQUIRED
- Token auth method: CLIENT_SECRET_POST
- Redirect URI: `https://local.ping-devops.com:4000/api/privilege-mcp/auth/callback`

### Required headers for Privilege MCP

When the target host is `privilege.pingone.com`, the BFF adds:
- `Authorization: Bearer <access_token>`
- `x-procyon-session-id: <uuid>` (per-session, stored on req.session)

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
  /procyon/bin/cyonproxy -hostname local.ping-devops.com -listen :8680
```

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
| Discovery succeeds but tool calls return empty | MCP server behind PingGateway, not directly reachable | MCP App config → set MCP Server URL to the **internal** URL (`http://mcp-server:8080/mcp`), not the gateway URL |

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
   docker volume rm ai-demo2_mcpgw-ssl 2>/dev/null || true
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
4. **Verify enrollment**: `docker logs ai-demo-ping-mcpgw 2>&1 | tail -10`
5. **Register MCP App** in console: AI Security → Agentic Apps → Add Application → MCP Server
   - Frontend URL: `https://local.ping-devops.com:8680`
   - MCP Server URL: `https://host.docker.internal:8080/mcp`
   - Mesh Cluster: select your gateway
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
  will silently fail.** Always `docker volume rm ai-demo2_mcpgw-ssl` before
  re-enrolling.
- `mcpgw-logs` — proxy diagnostic logs
- `mcpgw-recordings` — session recordings (if enabled in console)

The `proxy-token` file is bind-mounted read-only at `/procyon/ssl/proxy-token.data`.
If both the bind-mount file AND the volume's `proxy-config.data` exist, the proxy
prefers the persisted config (ignores the token file). This is by design — the
token is only consumed on first boot.

## guest-agent.env reference

`ping-mcpgw/config/guest-agent.env` is the committed (non-secret) config used by
the proxy's guest-agent mode. Key fields:

| Field | Purpose |
|-------|---------|
| `Tenant` | Privilege tenant ID |
| `APIKey` / `APISecret` | Guest agent API credentials (non-OIDC path) |
| `CNTRLUrl` | Privilege control plane URL |
| `ClusterName` | Must match the gateway name registered in console |
| `HostIP` | FQDN the proxy advertises |
| `NodeType` | `MCPGw` for MCP gateway mode |
| `MCPGwServer` | Public URL of this proxy (`https://local.ping-devops.com:8680`) |
| `MCPGwCertPath` | Path to TLS certs inside the container |
| `OidcClientID/Secret` | PingOne OIDC app for user auth |
| `OidcAuthURL/TokenURL/UserURL` | PingOne AS endpoints |
| `OidcUserIDClaim` | Claim used to identify the user (`sub`) |

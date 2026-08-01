# Privilege Cloud MCP — Proxy & OIDC Integration

Use when troubleshooting, configuring, or extending the PingOne Privilege Cloud
MCP integration: the privilege proxy container, the BFF OIDC relay, the
Privilege MCP Client UI page, or the K8s deployment.

## Architecture

```
Browser → BFF (privilegeMcpClient.js) → privilege.pingone.com/api/mcp
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
| MCP endpoint | `https://privilege.pingone.com/api/mcp` |
| gRPC controller | `grpc.privilege.pingone.com:443` |
| End user | `cmuir+ssoEndUser@pingone.com` |

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
| `PRIVILEGE_MCPGW_URL` | Proxy MCP endpoint, e.g. `https://privilege.pingone.com/api/mcp` |
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
| "not found" on enrollment (500) | Token references a deleted/different node | Get fresh token from Gateways → Add Node |
| "No Tools, Prompts, or Resources Discovered" in console | Proxy can't reach MCP server (mTLS blocks, wrong URL, wrong port) | Set `MCP_MTLS_ENABLED=false` on MCP server; ensure URL is `http://localhost:8080/mcp` |
| 401 "User is not authorized" from MCP | User has no Privilege policy for the MCP app | Assign policy in Privilege console (requires discovery first) |
| 401 "Unsupported authentication method" on token exchange | Missing `client_secret` in POST body | Ensure `PINGONE_MCP_GATEWAY_CLIENT_SECRET` is set |
| redirect_uri mismatch | BFF detects wrong host (Docker internal hostname) | Set `PRIVILEGE_MCP_CALLBACK_HOST` or ensure `x-forwarded-host` passes through |
| Session not persisting between requests | Session cookie not sent / saveUninitialized | Use browser (cookies auto-sent), or pass `Cookie` header in curl |
| curl to MCP server gets "Empty reply" | mTLS enabled — server drops non-cert connections | Disable mTLS or provide gateway client cert |

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

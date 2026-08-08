# Privilege Cloud MCP — Gateway Integration

Use when troubleshooting, configuring, or extending the PingOne Privilege Cloud
MCP integration: the Privilege Gateway, the BFF MCP client relay, the
Privilege MCP Client UI page, or the K8s deployment.

## Read this first — the five things that cost weeks

Every one of these was learned the expensive way. Check them before theorising.

1. **The MCP frontend is port `8620`, not `8623`.** `8623` is the mesh port; it
   speaks mTLS and answers everything else with `tlsv13 alert certificate required`,
   which nginx reports as a bare `502`. Probe: `POST http://localhost:8620/mcp` must
   return `401 Bearer Token not found.`
2. **`IssuerPublicKey:[]` is the blocker, and agentless mode does NOT avoid it.**
   Tested 2026-08-08 with a real PingOne token through nginx to the agentless port:
   `401 Authorization header JWT parsing failed JWT signature validation failed` —
   byte-identical to mesh mode. The gateway validates inbound JWTs on 8620 too.
   Even a token from Privilege's own tenant (`8d4d7a4c`) is rejected, so this is not
   about picking the right environment. Nothing in this repo populates that key.
3. **Use env `8d4d7a4c`**, not `01d89b06`. Not a preference — it is the only tenant
   with Privilege console access, and every required setting lives in that console.
4. **An expired enrollment token is almost never the problem.** cyonproxy swaps the
   wizard JWT for a long-lived one in the `mcpgw-ssl` volume on first boot. A token
   that expired days ago still starts the container fine. Only a deleted volume, a
   new cluster, or a new host needs a fresh one.
5. **`pingone.env` is never read.** Zero log hits for its keys, on two tenants, in
   both modes. Keep it correct; never debug through it.

### Fast path for a fresh setup

```bash
# 1. Certs + stack (ensure-mcpgw-certs.sh runs automatically for this profile)
./run-docker.sh optional start mcpgw

# 2. Hosts entries — one line per frontend host, no wildcards in /etc/hosts
sudo sh -c 'printf "127.0.0.1\tmcpgw.local.ping-devops.com\n127.0.0.1\taidemo.mcpgw.local.ping-devops.com\n" >> /etc/hosts'

# 3. Prove the gateway answers BEFORE touching the console
curl -i -X POST http://localhost:8620/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
# expect: 401 "Bearer Token not found."

# 4. Prove the full chain (nginx -> gateway)
curl -i -X POST https://aidemo.mcpgw.local.ping-devops.com/mcp -d '...'
# expect: the same 401. A 502 here means nginx, not Privilege.
```

Then do the console steps, then re-run step 4 and check for a `WWW-Authenticate`
header. That header is the pass/fail signal for the whole integration.

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

### Three deployment paths — pick agentless

| Path | Endpoint | Status |
|------|----------|--------|
| **Agentless / self-hosted frontend** (use this) | `https://aidemo.mcpgw.local.ping-devops.com/mcp` → nginx :443 → proxy :8620 | Reaches the gateway directly, bypassing Ping's cloud. Everything below the auth layer works: routing, backend, discovery |
| **Mesh / cloud frontend** | `https://<app>-app-default.applications.privilege.pingone.com:8643/mcp` | Ping-assigned FQDN, routed through Ping's cloud and back over the mesh |
| **Cloud API** | `https://privilege.pingone.com/api/mcp` | DEAD END — 401s every request including its own `.well-known/oauth-protected-resource`, sends no `WWW-Authenticate` |

**Both of the first two hit the same auth wall.** A hypothesis held through most of
2026-08-08 — that agentless mode escapes the JWT-signature failure because the
gateway would run OIDC itself — was **disproven by direct test**: a real PingOne
token sent through nginx to 8620 returns the identical
`JWT signature validation failed`. Prefer agentless anyway (fewer moving parts, no
dependency on Ping's cloud routing, and it is what the SE material documents), but
do not expect it to solve authentication.

The console field that selects mesh vs agentless is the MCP Server application's
Frontend Name — and in the current console build it is **read-only**, assigned on
create as `<app>-app-default.applications.privilege.pingone.com:8643`.

### The nginx front door (agentless only)

Agentless mode needs customer-owned DNS + TLS in front of the proxy:

| Piece | Where |
|---|---|
| nginx service | `demo_mcpgw_nginx/nginx.conf`, compose service `mcpgw-nginx`, host `443` |
| Wildcard cert | `scripts/ensure-mcpgw-certs.sh` → `certs/mcpgw-wildcard{,-key}.pem`, SAN `*.mcpgw.local.ping-devops.com` |
| k8s equivalent | `k8s/aws/mcpgw-agentless-ingress.yaml` (ingress-nginx **is** the engine there) |
| `/etc/hosts` | one `127.0.0.1` line **per frontend host** — a wildcard cert works, `/etc/hosts` has no wildcards |

nginx must forward the original `Host` header (`proxy_set_header Host $host`) — the
gateway routes on the frontend hostname. Use a **variable** upstream plus
`resolver 127.0.0.11`, or nginx refuses to start with `host not found in upstream`
whenever the proxy is down.

**Do not repoint `PRIVILEGE_MCPGW_URL` at the Cloud API.** That was tried and
reverted; `docs/PRIVILEGE-MCP.md` §"4. The client pointed at the Privilege cloud
API, not a gateway — RESOLVED 2026-08-02" is the record. No token from PingOne
env `01d89b06` satisfies `privilege.pingone.com` — not the `6586d3de` app, not the
dedicated `873cc9e4` "Privilege Cloud MCP Gateway" app (which mints
`aud: mcpserver.ping.demo`, the demo's own audience). The 401 arrives before any
policy runs, so it looks like an authorization problem and is not one.

**Port: `8620`.** Earlier revisions of this skill said `8680`, then `8623`. Both
were wrong — see "Proxy ports" below for the probe that settles it. `8680` and
`8623` accept a TCP connection without serving MCP, which is why each looked
plausible for a while.

### Current state (verified 2026-08-08)

Infrastructure is done and proven. Remaining work is console-side only.

- Container `ai-demo-ping-mcpgw` up, node `1cf90baf-2a83-45db-830f-581ea98110d1`
  `Active` in cluster **`ai-demo-fresh`**, command streams established,
  `ProxyURL local.ping-devops.com:8623`.
- **The gateway answers.** `POST http://localhost:8620/mcp` → `401 Bearer Token not
  found.` End to end through nginx also reaches it:
  `POST https://aidemo.mcpgw.local.ping-devops.com/mcp` → `HTTP/2 401` same body.
- Backend reachable from inside the compose network:
  `POST http://mcp-server:8080/mcp` → `200`.
- **The 401 carries no `WWW-Authenticate` header**, so a browser never learns where
  to authenticate. Control-plane driven — see below.
- **A real bearer token fails signature validation.** Tested through nginx to 8620:

  ```
  no token      -> 401 Bearer Token not found.
  PingOne token -> 401 Authorization header JWT parsing failed
                       JWT signature validation failed
  ```

  Same error as mesh mode, and the token was minted in Privilege's own tenant
  `8d4d7a4c`. `AuthzMiddleware` for the app carries `AuthzServer:<app-name>` and
  `IssuerPublicKey:[]`. The control plane also advertises a tenant-level
  `AuthzServer:<envid>.oauth.privilege.pingone.com`, but the app is not bound to it.
  **Everything converges here: populate `IssuerPublicKey` and the demo unblocks.**
- **Duplicate node registration.** `has same NodeURL - this happens because of
  misconfigured Node`: a stale row claims the same `NodeURL local.ping-devops.com:8690`.
  Cosmetic — confirmed the command stream stays up and discovery still dispatches.
  Console offers no way to delete the stale row.
- `Error sending update to mesh controller: … not found` is the same symptom, not a
  separate fault.

### `pingone.env` is never read — do not debug it

Grepping the proxy log after a clean restart, with `pingone.env` correctly mounted
at `/var/lib/procyon/config/pingone.env` and populated, returns **zero** hits for
`SERVER_URL`, `authorize`, `oidc`, or `pingone.env`. Verified twice, on two
different tenants, in both mesh and agentless mode.

Whatever drives the OIDC challenge is control-plane state, not this file. Keep it
correct anyway (the console wizard asks for the same values), but never conclude
"the gateway is misconfigured" from its contents, and never spend time editing it
to make a challenge appear.

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

### Console forms, field by field

**Setup Gateways** (Cloud → Gateways → Add via Docker). Only needed for a *new*
node — see rule 4 above before opening it.

| Field | Value |
|---|---|
| Mode | Private Proxy |
| Cluster ID | `ai-demo-fresh` |
| Host IP | `local.ping-devops.com` |

Then *Get Docker Command* and copy the `ENV_PROXY_TOKEN` JWT. Decode it before
using it — the `clusterID` claim must match the cluster your MCP application is
bound to, or the frontend will have no node behind it. Enrolling a second node on
the same Host IP produces the permanent `has same NodeURL` error.

**Add MCP Application** (Agentic Apps → Add Application).

| Field | Value | Note |
|---|---|---|
| Application Name | `MCP-aidemo` | free text |
| **MCP Server URL** | `http://mcp-server:8080/mcp` | the **backend**. Compose DNS — the proxy shares that network. Never `localhost:8080` |
| Auth Mode | Static Token | this is **upstream** auth (gateway → backend), not how clients are challenged |
| Auth Token | *empty* | `mcp-server` runs `MCP_AUTH_DISABLED=true`; Privilege is the boundary |
| Headers | none | |
| Mesh Cluster | `ai-demo-fresh` | must match the enrolled node's cluster |

There is **no Frontend field in this modal.** The console assigns a cloud FQDN on
create — which is mesh mode. Immediately open the app and change **Frontend Name**
to `aidemo.mcpgw.local.ping-devops.com`. That single edit is what selects agentless
mode, and skipping it puts you back on the unfixable JWT-signature wall.

Verify the backend is reachable from inside the network first, or discovery fails:

```bash
docker run --rm --network ai-demo_ai-demo curlimages/curl -s -o /dev/null -w '%{http_code}\n' \
  -X POST http://mcp-server:8080/mcp -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}'
# expect 200
```

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
| PingOne Env | `8d4d7a4c-de40-4f71-9b98-0c3507cd4d1b` — **the only tenant we hold Privilege console access in**, which is what decides it |
| OIDC Client (gateway) | `deff60f5-5a67-4a6e-b283-47252856c89c` (in `8d4d7a4c`) |
| Proxy Image | `public.ecr.aws/s7q1z8z4/privilege-proxy` |
| Proxy Binary | `/procyon/bin/cyonproxy` |
| Cluster ID | `ai-demo-fresh` |
| Node ID (current) | `1cf90baf-2a83-45db-830f-581ea98110d1`, `ProxyURL local.ping-devops.com:8623` |
| MCP Server app | `mcp-pingone-admin` / `MCP-aidemo`, backend `http://mcp-server:8080/mcp` |
| Frontend host (local) | `aidemo.mcpgw.local.ping-devops.com` |
| Frontend host (SE) | `aidemo.mcpgw.ai-demo.ping-devops.com` |
| Gateway base / `SERVER_URL` | `https://mcpgw.local.ping-devops.com` — the **nginx** URL, never the proxy port |
| MCP endpoint (Cloud API) | `https://privilege.pingone.com/api/mcp` — DEAD END, do not use |
| gRPC controller | `grpc.privilege.pingone.com:443` |
| End user | `cmuir+ssoEndUser@pingone.com` |
| Admin user | `cmuir+ssoAdmin@pingone.com` |
| Token file | `ping-mcpgw/config/proxy-token` (gitignored) |
| Gateway OIDC config | `ping-mcpgw/config/pingone.env` (gitignored; `.example` is committed) |
| Console | `https://console.pingone.com/?env=8d4d7a4c-de40-4f71-9b98-0c3507cd4d1b` then launch Privilege |

**Environment `01d89b06` (AI-Demo) is where the banking users live, and it is NOT
usable here** — no Privilege console access, so the gateway cannot be configured
at all. The gateway signs users in against `8d4d7a4c`, so `cmuir+sso*` are the
identities that reach the MCP tools. Note this split is **not** what causes the
signature failure — a token minted in `8d4d7a4c` itself is rejected the same way.

Verify a credential belongs to the right environment before trusting a doc:

```bash
curl -s -X POST "https://auth.pingone.com/$ENVID/as/token" \
  -d grant_type=client_credentials -d "client_id=$CID" -d "client_secret=$CS"
# decode the JWT payload and check the `env` claim
```

### Current token status — expired, and that is fine

The enrollment token in `ping-mcpgw/config/proxy-token` (and `PRIVILEGE_PROXY_TOKEN`
in the root `.env`) expired **2026-08-04**. The proxy does not care: verified again
on 2026-08-08 across two container recreates, it starts, links to the control plane,
and re-exchanges `proxy-token.data` — because cyonproxy already swapped the wizard
JWT for a long-lived one inside the `mcpgw-ssl` volume.

Never diagnose "expired token" from a file's `exp`. Check whether the container is
running and linked first.

**When a new token IS required:**

| Situation | New token? |
|---|---|
| Container recreate / restart / compose change | No |
| `mcpgw-ssl` volume deleted | Yes |
| Enrolling into a different cluster | Yes |
| First proxy on a new host (e.g. pingaws) | Yes — separate node |

The expiry clock only runs between clicking *Get Docker Command* and the
container's first successful start (~2h in practice). After `proxy-token.data`
exists, let it expire.

**The one unrecoverable move:** deleting `ai-demo_mcpgw-ssl` without a fresh token
already in hand. That discards the only enrollment identity and needs console
access to redo.

Decode a token before using it — `clusterID` and `tenantName` must match what you
expect:

```bash
python3 -c "
import base64,json,sys,datetime
p=sys.argv[1].split('.')[1]; p+='='*(-len(p)%4)
c=json.loads(base64.urlsafe_b64decode(p))
print({k:c.get(k) for k in ('clusterID','nodeId','tenantName')})
print('exp', datetime.datetime.fromtimestamp(c['exp'],datetime.timezone.utc))" "eyJ..."
```

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
frontend host through nginx: `https://aidemo.mcpgw.local.ping-devops.com/mcp`

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

## Proxy ports — 8620 is the MCP frontend, NOT 8623

| Port | Flag | Purpose |
|------|------|---------|
| **8620** | `-alp-port` | **The MCP frontend. Plain HTTP.** Point nginx / the BFF / k8s Service here |
| 8623 | `-listen` | Mesh. Speaks **mTLS** and rejects everything else |
| 8690 | `-medusa` | gRPC tunnel (also the node's `NodeURL`) |
| 8090 | `-debug-port` | Debug API, loopback only |

Settle it by probing, never by reading vendor material:

```bash
curl -i -X POST http://localhost:8620/mcp -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
# HTTP/1.1 401 Unauthorized
# Bearer Token not found.          <- the gateway. This is the frontend.

curl -ik -X POST https://localhost:8623/mcp -d '...'
# TLS: tlsv13 alert certificate required   <- the mesh port demanding a client cert
```

`Bearer Token not found.` is the gateway's tokenless response and is the positive
signal you are on the right port.

**This table was wrong until 2026-08-08 and cost hours twice.** Two traps:

- Ping's SE deck says *"proxy forwards to MCPGW runtime, often 8623 in field
  examples."* Not true here.
- Pointing nginx at 8623 yields a bare **502** with the real cause only in the nginx
  error log (`SSL_read() failed … tlsv13 alert certificate required`). The response
  body says nothing.

Do **not** try to fix the 8623 alert by giving it a server certificate. That was
tried (PR #1465, reverted by #1466): `/procyon/ssl/mcpgw-cert.pem` + `mcpgw-key.pem`
were mounted, the container recreated, and 8623 returned the identical alert. It
requires mTLS because it is the mesh port, full stop.

Listing what actually binds (busybox has no `ss`/`netstat`, and `awk` here lacks
`strtonum`, so parse the hex on the host):

```bash
docker exec ai-demo-ping-mcpgw cat /proc/net/tcp /proc/net/tcp6 > /tmp/t.txt
python3 -c "
print(sorted({int(f[1].rsplit(':',1)[1],16) for f in
  (l.split() for l in open('/tmp/t.txt')) if len(f)>3 and f[3]=='0A'}))"
# [8090, 8620, 8623, 8690]
```

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
| `PRIVILEGE_MCPGW_URL` | Frontend host through nginx: `https://aidemo.mcpgw.local.ping-devops.com/mcp`. nginx forwards to the proxy on **8620** |
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
| `curl https://…:8623/mcp` fails to connect | Wrong port — 8623 is the mesh port and speaks mTLS only | Use `http://…:8620` (see "Proxy ports") |
| `has same NodeURL - this happens because of misconfigured Node` | Two node registrations claim the same `NodeURL local.ping-devops.com:8690` — the live node is linking to a stale twin of itself | **Cosmetic — ignore.** Command streams stay up and discovery still dispatches. The console offers no way to delete the stale row. Avoid making it worse: do not enroll a second node on the same Host IP |
| BFF gets `UND_ERR_SOCKET` / connection refused to the gateway | Pointing at a port that accepts TCP but serves no MCP | Use `8620` (see "Proxy ports") |
| nginx returns a bare `502`, body says nothing | Upstream is `8623` (mesh, mTLS). Check the nginx error log for `tlsv13 alert certificate required` | Point the upstream at `http://…:8620` |
| `401 Bearer Token not found.` | Normal — the gateway with no token. This is the **success** signal for "am I on the right port" | Nothing to fix |
| `401` with no `WWW-Authenticate` header | Console-side: Frontend Name / auth mode not set on the MCP Server application | Set Frontend Name to our domain (see checklist) |
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
   - MCP Server URL: `http://mcp-server:8080/mcp` (compose-internal DNS — the
     gateway resolves it inside the network; it is not browser-reachable)
   - Auth Mode: Static Token, token empty
   - Mesh Cluster: `ai-demo-fresh` — must match the enrolled node
   - See "Console forms, field by field" above for the full modal
6. **Set Frontend Name** on the app you just created:
   `aidemo.mcpgw.local.ping-devops.com`. **Do not skip this.** On create the console
   assigns a `*.applications.privilege.pingone.com` FQDN, which is mesh mode and
   hits the unfixable JWT-signature wall
7. **Discover tools**: wait ~30s after MCP app creation, check console for discovered
   tools. Discovery has fired hours late before — a delay is not a failure
8. **Create policy**: assign user `cmuir+ssoEndUser@pingone.com` a policy granting
   tool access. Time-bound policies expire; re-author before each test session
9. **Verify the challenge**: `curl -i -X POST https://aidemo.mcpgw.local.ping-devops.com/mcp -d '…'`
   and look for `WWW-Authenticate: Bearer authorization_uri="…"`. A bare 401 means
   steps 6–8 did not take effect
10. **Test from UI**: navigate to `/privilege-mcp-client`, sign in, call a tool

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
| `SERVER_URL` | The **nginx front door**, browser-reachable — `https://mcpgw.local.ping-devops.com` locally, `https://mcpgw.ai-demo.ping-devops.com` on the SE cluster. Never a proxy port: this is the URL the 401 challenge hands the browser. PingOne redirect URI must be `${SERVER_URL}/callback` |
| `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` | The MCPGW application in PingOne (AI Security → Agentic Apps) |
| PingOne AS endpoints | Authorize / token / userinfo for the environment |

A missing `SERVER_URL` is a documented cause of "gateway does not behave as
expected" — which looks exactly like a proxy that enrolls fine and then serves
nothing.

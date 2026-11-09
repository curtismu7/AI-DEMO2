# Privilege Cloud MCP — Gateway Integration

Use when troubleshooting, configuring, or extending the PingOne Privilege Cloud
MCP integration: the Privilege Gateway, the BFF MCP client relay, the
Privilege MCP Client UI page, or the K8s deployment.

## Current live source of truth (2026-08-20)

Before using the historical investigation below, read
`privilege/AGENTLESS-CONFIGURATION.md` for Agentless or
`privilege/AGENT-CONFIGURATION.md` for Agent. The live cmuir Agentless deployment is proven
on `privilege-mcpgw`: `/cmuir/mcp` returns the MCP OAuth challenge and the demo BFF
uses that endpoint. The separate Agent endpoint is
`https://opensearch.default.applications.procyon.ai:8643/mcp` and relies on the
installed Agent for authentication. Any later section saying `mcpgw` is untested,
that Agentless uses Host rewriting, or that the cmuir Agentless backend is OpenSearch
is historical and must not override this section.

## Read this first — the things that cost weeks

Every one of these was learned the expensive way. Check them before theorising.

0. **We run `privilege-mcpgw` (binary `mcpgw`) as of 2026-08-12, not
   `privilege-proxy` (binary `cyonproxy`).** Everything below that names a port,
   an image, or a command reflects the CURRENT binary unless a note says
   otherwise. The two binaries have overlapping-but-different port models — do
   not assume a fact from one carries to the other. Reason for the swap:
   `cyonproxy`'s binary contains zero of the OAuth-challenge strings
   (`authorization_uri`, `MCP OAuth Server`, `oauth-protected-resource`);
   `mcpgw`'s binary contains all of them, and a live probe of this exact image
   (by digest) running in another engineer's cluster confirmed it emits the
   challenge for real: a tokenless request returned
   `401` with `www-authenticate: Bearer realm="MCP OAuth Server",
   authorization_uri="..."`. `ValidateInfraJwt` (item 3 below) is present in
   `mcpgw` too, so **this is not confirmed to unblock PingOne-issued client
   tokens** — only the discovery/challenge layer is proven. See "The PingOne
   token wall" below.
   ⚠️ **Corrected 2026-08-18 (user report).** The Privilege gateway — now named
   **AI Gateway** — is run with OAuth in the field, on the agent-based and
   agentless SE deployments alike. So do **not** repeat this doc's older
   conclusion that OAuth against the gateway is unavailable or that a challenge
   cannot be obtained. That conclusion was drawn from string-searching
   `cyonproxy` plus probes of our own local enrollment; it never described the
   SE/vendor deployments, and it is not a statement about what the product
   supports. Settle any specific claim by probing the deployment in front of
   you.
1. **The MCP+OAuth frontend is port `8623` (`-mcpgw` on this binary), not
   `8620`.** This is the **opposite** of the pre-2026-08-12 fact for `cyonproxy`,
   where 8620 was correct and 8623 was the mTLS mesh port. On `mcpgw`, `-listen`
   (mesh) defaults to `:8680` instead, and `-alp-port` (8620) is **untested** on
   this binary — do not assume it still behaves like the old frontend. Probe,
   don't assume: `POST http://localhost:8623/mcp` should return `401` with a
   `www-authenticate` header present.
2. **The console-token chain (initialize → `tools/list` → `tools/call`,
   per-app policy enforced) was proven end to end 2026-08-10 — on `cyonproxy`
   build `v1.260726`.** That proof has **not** been re-run against `mcpgw`.
   Treat it as unverified on the current binary until `scripts/privilege-smoke.sh`
   is re-run post-swap. Do not cite this as current-state evidence without
   re-running it.
3. **The rejection is `ValidateInfraJwt`, and it reproduces on Ping's own cloud.**
   The gateway compares the token's `kid` against `infra-root-jwt`
   (`graph.go:282`, via `AgentlessRestAPIService.forwardReq`, `agentless_api.go:98`).
   No PingOne token can match, whatever the env/audience/scope; nor can one
   self-signed with `mcpgw-key.pem`. The response says "JWT signature validation
   failed" but **no signature was checked** — only a key id compared. Do not chase
   signature/JWKS problems from that string.
   `infra-root-jwt` is the `kid` of a key the proxy **fetches at runtime from
   Privilege's internal Notary PKI** (`/rpc.NotaryService/GetInfraRoot` sits beside
   the `doesn't match InfraKid` error in the binary) — corrected 2026-08-11 from an
   earlier claim that it was enrollment state. There is no file to swap, no
   per-tenant knob, and re-enrolling the node was never going to help.
   The Ping-hosted frontend returns byte-identical errors without forwarding to our
   proxy at all, so **no local change can fix this**. See `privilege/PRIVILEGE-MCP.md`
   §2026-08-09 and §2026-08-11.
4. **Corrected 2026-08-12: `01d89b06` now ALSO has Privilege console access** —
   confirmed by a new OIDC client there, `PingOne Privilege`
   (`a6219652-47af-4ed2-8dea-20e9940b3377`), console-verified with Resources and
   Policies tabs populated like `deff60f5` in `8d4d7a4c`. Our BFF's
   `PRIVILEGE_SSO_*` config was switched to this client (Docker `.env` and the
   K8s `ai-demo-secrets` secret, both live-patched and restarted) since it's our
   main demo tenant — one fewer cross-tenant hop. `8d4d7a4c`/`deff60f5` are not
   decommissioned, just no longer the active client; the rest of this doc's
   examples and findings (client-config table, redirect URIs, PKCE requirement,
   etc.) were captured against `deff60f5` and are still accurate as history, but
   verify against `a6219652` before treating a `deff60f5`-specific detail as
   still current for the live client.
5. **An expired enrollment token is almost never the problem — for a host that has
   already enrolled.** A token that expired days ago still starts the container
   fine, because the durable credential is the **mTLS cert pair** in
   `/procyon/ssl` (`proxy-crt.pem`, `proxy-key.pem`, `proxy-ca.pem`) — not a
   token. Only a deleted volume, a new cluster, or a new host needs a fresh one.
   Verified on `cyonproxy`; not independently re-verified on `mcpgw`, though the
   mechanism (mTLS cert pair, not the token) is a proxy-family behavior rather
   than something specific to one binary.
6. **Never debug through `pingone.env`.** On `cyonproxy` it was loaded as env vars
   but the binary never read the file itself. **On `mcpgw` this is different** —
   the binary requires `-mcpconfpath` pointing at this exact file and reads it
   directly; a missing or invalid file is now a **fatal, crash-looping** error,
   not a soft degradation. See "`pingone.env` — loaded as env vars" below.
7. **No PingOne token of any kind passed on `cyonproxy`.** Worker, user
   (`authorization_code` with `sub` + MFA), `id_token`, and a self-signed JWT all
   failed identically on `kid` vs `infra-root-jwt`. The token class was not the
   variable — the missing issuer config was. Not yet re-tested against `mcpgw`.

### Fast path for a fresh setup

```bash
# 1. Certs + stack (ensure-mcpgw-certs.sh runs automatically for this profile)
./run-docker.sh optional start mcpgw

# 2. Hosts entries — one line per frontend host, no wildcards in /etc/hosts
sudo sh -c 'printf "127.0.0.1\tmcpgw.local.ping-devops.com\n127.0.0.1\taidemo.mcpgw.local.ping-devops.com\n" >> /etc/hosts'

# 3. Prove the gateway answers BEFORE touching the console
curl -i -X POST http://localhost:8623/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
# expect: 401, with a www-authenticate header present

# 4. Prove the full chain (nginx -> gateway)
curl -i -X POST https://aidemo.mcpgw.local.ping-devops.com/mcp -d '...'
# expect: the same 401. A 502 here means nginx, not Privilege.
```

Then do the console steps and prove the working chain with a console token:

```bash
bash scripts/privilege-smoke.sh '<console-auth_token>' mcp-pingone-admin
# five assertions: front-door 401 -> initialize -> session -> tools/list -> tools/call
```

A front-door PASS followed by an authenticated `403` means the console policy lapsed
(they are time-boxed), not that the gateway broke.

`WWW-Authenticate` on a **tokenless** 401 is a separate gate — the one that would
unblock PingOne-issued client tokens. `mcpgw` does emit it (confirmed live), and
the AI Gateway is run with OAuth in the field; an older revision of this doc
claimed no published build emitted it, which was a statement about `cyonproxy`
string contents, not about the product. If your deployment does not return the
header, probe it as a real problem rather than assuming it is expected.

## Referenced files

- `references/architecture-and-history.md` — architecture diagram, three deployment paths, nginx front door (Host rewrite), cyonproxy standing state, the PingOne token wall (ruled-out paths), pingone.env history
- `references/console-setup.md` — console sections, field-by-field forms (Gateways / Add MCP Application), upstream auth modes, tool-discovery prerequisite, Cloud-API headers (dead path)
- `references/enrollment-and-docker.md` — enrollment token flow, docker run/compose startup, re-enrollment, token expiration check and renewal
- `references/ports-and-diagrams.md` — port tables for `mcpgw` (8623 = MCP+OAuth frontend) and `cyonproxy` (historical), plus the three divergences from Ping's SE networking diagram
- `references/ui-k8s.md` — PrivilegeMcpClientPage behavior and the K8s deployment manifest notes

## Architecture

**The architecture diagram, the three deployment paths table, the nginx front-door setup (Host rewrite, Frontend Name read-only), the cyonproxy historical record, the PingOne token wall, and the pingone.env history all moved to [`references/architecture-and-history.md`](references/architecture-and-history.md).** Load it when: wiring or debugging routing (nginx map lines, `/etc/hosts`, `upstream-vhost`), proposing any fix for PingOne tokens against the gateway (read the ruled-out table FIRST — re-running dead paths costs days), or checking what was proven on which binary.

## Console setup

**Console forms (Gateways wizard, Add MCP Application), upstream auth modes, tool discovery, and the Cloud-API header table moved to [`references/console-setup.md`](references/console-setup.md).** Load it when registering an app or enrolling a gateway in the Privilege console.

## Proxy ports and SE diagrams

**Both port tables (current `mcpgw` and historical `cyonproxy`) and the Ping SE-diagram divergences moved to [`references/ports-and-diagrams.md`](references/ports-and-diagrams.md).** Load it when a connection fails and you suspect the wrong port, or when comparing our topology against Ping's reference diagram. Rule stands: settle ports by probing, never by reading vendor material.

## Enrollment, Docker, token renewal

**Enrollment token flow, Docker startup commands, re-enrollment recovery, and token expiration/renewal moved to [`references/enrollment-and-docker.md`](references/enrollment-and-docker.md).** Load it when: enrolling a new node, recovering from a Docker/volume loss, or checking whether an enrollment token's expiry matters (it almost never does — see "Read this first" item 5).

## UI and K8s

**PrivilegeMcpClientPage (`/privilege-mcp-client`) and the K8s deployment section moved to [`references/ui-k8s.md`](references/ui-k8s.md).** Load it for UI error handling on that page or the SE-cluster manifest/deploy history.


## Key identifiers

| What | Value |
|------|-------|
| PingOne Env | `8d4d7a4c-de40-4f71-9b98-0c3507cd4d1b` — **the only tenant we hold Privilege console access in**, which is what decides it |
| OIDC Client (gateway) | `deff60f5-5a67-4a6e-b283-47252856c89c` (in `8d4d7a4c`) |
| Proxy Image (current, since 2026-11-09) | `public.ecr.aws/s7q1z8z4/privilege-aigw:v1.261106`, pinned by digest `sha256:de145f71fa6d6323963076671c252c37cb5a1fbdcfe10cff3b969975e57496ce` (multi-arch manifest list; same `/procyon/bin/mcpgw` binary, the line the hosted gateways run). Public tag listing works anonymously via the ECR token endpoint: use the newest dated `v1.YYMMDD` tag. From 2026-08-12 to 2026-11-09 the image was `privilege-mcpgw@sha256:0faad5903a5bd72539b1df525e3c7bc5d458a5bd324aac9755b8af99dfa6647d` (build 2026-07-30); roll back by restoring that digest. Bump by updating the digest in `docker-compose.yml` via a PR |
| Proxy Binary (current) | `/procyon/bin/mcpgw` |
| Previous image/binary | `public.ecr.aws/s7q1z8z4/privilege-proxy` → `/procyon/bin/cyonproxy`. **Registry `latest` points at `v1.260726` (July)** — `v1.260806` exists only under its version tag, so "always pull latest" quietly pins you to the older build; irrelevant now unless reverting to this binary |
| Manual smoke test | `scripts/privilege-smoke.sh '<console-auth_token>' [app]` — five assertions, needs a live console token **and** a live policy. Last proven against `cyonproxy`; not yet re-run against `mcpgw` |
| Cluster ID | `ai-demo-fresh` |
| Node ID (current) | `1cf90baf-2a83-45db-830f-581ea98110d1`, `ProxyURL local.ping-devops.com:8623` as registered under `cyonproxy`. The node identity (mTLS cert pair) survives the binary swap, but the advertised `ProxyURL` may change after `mcpgw` reconnects on its own `-listen` default (`:8680`) — unconfirmed, re-check after enrollment |
| MCP Server app | `mcp-pingone-admin` / `MCP-aidemo`, backend `http://mcp-server:8080/mcp`. A third, `mcp-aidemo`, is a harmless leftover from the 2026-08-10 create-instead-of-update test — fully OAuth-configured, ready if a capable build arrives |
| Frontend host (local) | `aidemo.mcpgw.local.ping-devops.com` |
| Frontend host (SE) | `aidemo.mcpgw.ai-demo.ping-devops.com` |
| Gateway base / `SERVER_URL` | `https://mcpgw.local.ping-devops.com` — the **nginx** URL, never the proxy port |
| MCP endpoint (Cloud API) | `https://privilege.pingone.com/api/mcp` — DEAD END, do not use |
| gRPC controller | `grpc.privilege.pingone.com:443` |
| End user | `cmuir+ssoEndUser@pingone.com` |
| Admin user | `cmuir+ssoAdmin@pingone.com` |
| Token file | `ping-mcpgw/procyon/config/proxy-token.env` (gitignored) — an **env file** holding `ENV_PROXY_TOKEN=eyJ...`, not a bare JWT |
| Gateway OIDC config | `ping-mcpgw/procyon/config/pingone.env` (gitignored; `.example` is committed) |
| Console | `https://console.pingone.com/?env=8d4d7a4c-de40-4f71-9b98-0c3507cd4d1b` then launch Privilege |

**Corrected 2026-08-12 — `01d89b06` (AI-Demo, where the banking users live) now
has Privilege console access too**, via OIDC client `a6219652-47af-4ed2-8dea-20e9940b3377`
("PingOne Privilege"), which is what the BFF's `PRIVILEGE_SSO_*` config points
at as of this date (Docker `.env` + K8s `ai-demo-secrets`, both live). The
gateway's own enrollment/cluster/node identity (`Cluster ID`, `Node ID`, `gRPC
controller` rows above) has not been confirmed to have moved off `8d4d7a4c` —
only the BFF's user-facing SSO client did. Do not assume `cmuir+sso*` are still
the only identities that can reach the MCP tools without re-verifying against
the current client. This split was never what caused the `ValidateInfraJwt`
signature failure either way — a token minted directly in `8d4d7a4c` is
rejected the same way, and nothing here is expected to change that.

Verify a credential belongs to the right environment before trusting a doc:

```bash
curl -s -X POST "https://auth.pingone.com/$ENVID/as/token" \
  -d grant_type=client_credentials -d "client_id=$CID" -d "client_secret=$CS"
# decode the JWT payload and check the `env` claim
```

### Current token status — expired, and that is fine

The enrollment token in `ping-mcpgw/procyon/config/proxy-token.env` (and `PRIVILEGE_PROXY_TOKEN`
in the root `.env`) expired **2026-08-04**. The proxy does not care: verified again
on 2026-08-08 across two container recreates, it starts and links to the control plane.

**Why it still works, corrected 2026-08-10.** Not because the token was swapped for a
long-lived one — decoding `/procyon/ssl/proxy-token.data` shows the *same* enrollment
JWT, still carrying `exp: 2026-08-04T18:44:28Z`, rewritten unchanged. The durable
credential is the **mTLS cert pair** issued at enrollment: `proxy-crt.pem`,
`proxy-key.pem`, `proxy-ca.pem`, which refresh on restart while `proxy-token.data`
stays frozen. The proxy authenticates to the control plane with a client certificate,
not a bearer.

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

See **[privilege/runbooks/renew-token.md](../../../privilege/runbooks/renew-token.md)** for the
full step-by-step renewal procedure.

### MCP server requirements for Privilege gateway

The backend MCP server must be configured to accept connections from the Privilege
gateway. Key settings in `docker-compose.yml`:

| Setting | Value | Why |
|---------|-------|-----|
| `MCP_MTLS_ENABLED` | `"false"` | Privilege connects via plain HTTP; mTLS blocks it. **Do not edit this line in compose** — it is derived, `MCP_MTLS_ENABLED: "${MCP_MTLS_ON:+true}"`. The single switch is `MCP_MTLS_ON` in the root `.env`; leave it unset/empty for plaintext, `=1` for mTLS. It drives every side of the hop (scheme, client cert, gateway, ping-gateway) |
| `NODE_ENV` | `development` | Needed for SKIP_TOKEN_SIGNATURE_VALIDATION |
| `SKIP_TOKEN_SIGNATURE_VALIDATION` | `true` | Gateway may send its own tokens |
| `ALLOW_JWKS_FAILOPEN` | `true` | Graceful degradation if JWKS unreachable |
| `tmpfs: /app/dev-data` | (volume config) | Dev mode needs writable session dir; container runs as uid 1001 |

The `PRIVILEGE_MCPGW_URL` env var on the BFF (`demo-api-server`) points to the
frontend host through nginx: `https://aidemo.mcpgw.local.ping-devops.com/mcp`

## BFF MCP client (privilegeMcpClient.js)

Route prefix: `/api/privilege-mcp/`

The BFF requires a **Privilege-specific OAuth token** — the main banking app's
SSO token will NOT work (wrong audience). The user must authenticate via the
Privilege OIDC client (`deff60f5-5a67-4a6e-b283-47252856c89c`, console name
`MCPGW-CMUIR`) through the "Sign In with Privilege" button.

⚠️ **Corrected 2026-08-12.** Earlier revisions of this skill named a *separate*
"Privilege SSO client", `6586d3de-b916-454c-84e5-6d21b572a534`. That app is real
but has nothing to do with Privilege — per `docs/PINGONE_APP_REVIEW.md` it is
`PINGONE_MCP_GATEWAY_CLIENT_ID`, this demo's own internal MCP-gateway
token-exchange identity (RFC 8693, the Two-Exchange flow). The name "Demo AI
App - MCP Gateway" invited the confusion. There has only ever been one
Privilege-related OIDC client: `deff60f5`, which is also what `pingone.env`
already correctly uses for the gateway's own agentless OIDC dance. Confirmed
directly against the console — `deff60f5`'s registered Redirect URIs include
both `https://local.ping-devops.com:4000/api/privilege-mcp/auth/callback` and
`https://ai-demo.ping-devops.com/api/privilege-mcp/auth/callback`.

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
| `PRIVILEGE_MCPGW_URL` | Frontend host through nginx: `https://aidemo.mcpgw.local.ping-devops.com/mcp`. nginx forwards to the proxy on **8623** (was 8620 before the 2026-08-12 binary swap) |
| `PRIVILEGE_SSO_CLIENT_ID` | PingOne OIDC client for Privilege auth |
| `PRIVILEGE_SSO_CLIENT_SECRET` | Client secret (client_secret_post for code exchange) |
| `PRIVILEGE_SSO_ENV_ID` | PingOne env ID (for OIDC discovery fallback) |
| `PRIVILEGE_LOGIN_HINT` | Email pre-filled in PingOne login (`cmuir+ssoEndUser@pingone.com`) |

### PingOne OIDC app config (Privilege client)

| Setting | Value |
|---------|-------|
| App ID | `deff60f5-5a67-4a6e-b283-47252856c89c` |
| Name | `MCPGW-CMUIR` |
| Type | OIDC application |
| Redirect URIs (confirmed live, `Allow Redirect URI Patterns: False` — exact match only) | `https://local.ping-devops.com:4000/api/privilege-mcp/auth/callback`, `https://ai-demo.ping-devops.com/api/privilege-mcp/auth/callback`, plus five others for the gateway's own agentless callback and Postman testing |
| Grant Types / PKCE / Token Endpoint Auth | Not re-confirmed against this app specifically since the 2026-08-12 correction — verify in console before trusting the values an earlier revision of this skill listed here (they were recorded against the wrong app) |

## Troubleshooting

**The full symptom → cause → fix table moved to [`references/troubleshooting.md`](references/troubleshooting.md).** Load it for any gateway/BFF/console/enrollment failure — it covers every symptom observed since 2026-08, including the traps that look like auth problems but aren't (`IssuerPublicKey:[]` = stop, not fixable; `Domain not found` with an empty `200` = Host rewrite missing; `403 doesn't have access` = progress, not regression; `401 Bearer Token not found.` = the success signal for port checks).

## Quick install checklist (fresh machine)

1. **Get the enrollment token** from Privilege console (Gateway wizard → Add Node)
2. **Save it** (env-file format): `printf 'ENV_PROXY_TOKEN=%s\n' 'eyJ...' > ping-mcpgw/procyon/config/proxy-token.env`
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
6. **Read the registered Frontend Name from the console API** (never from the UI —
   the UI shows `…applications.privilege.pingone.com`, the object holds
   `…applications.procyon.ai`), then wire the `Host` rewrite: one `map` line in
   `demo_mcpgw_nginx/nginx.conf` and one `/etc/hosts` line. **Do not skip this** —
   without it every request gets `Domain not found` and an empty `200`. The Frontend
   Name field itself is read-only; there is nothing to set in the console
7. **Discover tools**: wait ~30s after MCP app creation, check console for discovered
   tools. Discovery has fired hours late before — a delay is not a failure
8. **Create policy**: assign user `cmuir+ssoEndUser@pingone.com` a policy granting
   tool access. Time-bound policies expire; re-author before each test session
9. **Prove the chain**: `bash scripts/privilege-smoke.sh '<console-auth_token>' <app>`
   — five assertions through to `tools/call`. An authenticated `403` after a
   front-door PASS means the policy lapsed, not that the gateway broke
10. **Test from UI**: navigate to `/privilege-mcp-client`, sign in, call a tool. This
    path uses a **PingOne** token and is still blocked by the `kid` wall — see "The
    PingOne token wall"

## mTLS and Privilege proxy coexistence

The demo MCP server has `MCP_MTLS_ENABLED` which enforces gateway client certs on
the HTTP transport (`POST /mcp`). When Privilege proxy is the gateway, turn mTLS off
— Privilege enforces policy at its layer instead. Do it with the **one switch**, not
by editing compose:

```bash
# root .env — unset/empty = plaintext, =1 = mTLS. Compose derives
# MCP_MTLS_ENABLED: "${MCP_MTLS_ON:+true}" on every service in the hop.
MCP_MTLS_ON=
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

`ping-mcpgw/procyon/config/pingone.env` (gitignored; `pingone.env.example` is the committed
template) holds the OIDC config the gateway uses to authenticate MCP clients. The
whole `./ping-mcpgw/procyon` **directory** is mounted at `/var/lib/procyon`, which
puts this file at `/var/lib/procyon/config/pingone.env` — a single-file bind goes
stale when the host file is replaced. Compose previously bound only the `config`
subdirectory; the paths moved, so anything still saying `ping-mcpgw/config/…` is
pre-move and wrong. The BFF writes this file via `PUT /api/privilege-mcp/env`.

**There is a `procyon-guest-agent.env`, and it is not the same thing.** Earlier
revisions of this skill flatly denied a "guest-agent.env" existed. That literal
filename does not, but `ping-mcpgw/procyon/procyon-guest-agent.env` does — and
`./ping-mcpgw/procyon` is bind-mounted at `/var/lib/procyon`, so it is present
inside the container. It is **not** an `env_file` entry: compose only loads
`config/pingone.env` and `config/proxy-token.env`, so nothing injects its keys as
environment variables. It carries `Tenant`, `APIKey`, `APISecret`, `CNTRLUrl`,
`ProxyMode`, `ClusterName`, `HostIP`, `NodeType`, `MCPGwServer`, `MCPGwCertPath`
and a full `Oidc*` set pointing at env `8d4d7a4c`. Treat it as an on-disk artifact
of the guest-agent install path, not as live gateway config — but do not tell
yourself it is absent.

| Field | Purpose |
|-------|---------|
| `SERVER_URL` | The **nginx front door**, browser-reachable — `https://mcpgw.local.ping-devops.com` locally, `https://mcpgw.ai-demo.ping-devops.com` on the SE cluster. Never a proxy port: this is the URL the 401 challenge hands the browser. PingOne redirect URI must be `${SERVER_URL}/callback` |
| `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` | The MCPGW application in PingOne (AI Security → Agentic Apps) |
| PingOne AS endpoints | Authorize / token / userinfo for the environment |

A missing `SERVER_URL` is a documented cause of "gateway does not behave as
expected" — which looks exactly like a proxy that enrolls fine and then serves
nothing.

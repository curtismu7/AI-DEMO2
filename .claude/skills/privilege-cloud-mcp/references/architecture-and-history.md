# Architecture, deployment paths, and historical findings

Referenced from SKILL.md. Includes: the architecture diagram, three deployment
paths and their routing, the nginx front door (agentless Host rewrite), the
cyonproxy standing state (historical), the PingOne token wall (ruled-out paths
and the untested `cyctl object idprovider create` lever), and the pingone.env
history. Much of this describes `cyonproxy` — check the "Read this first" items
in SKILL.md for what has been superseded by `mcpgw`.

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

### Three deployment paths — current routing

| Path | Endpoint | Status |
|------|----------|--------|
| **Agentless / self-hosted frontend** | `https://cmuir-agentless-mcpgw.ping-devops.com/cmuir/mcp` → ingress → gateway :8623 | Current cmuir deployment; OAuth challenge verified live on `mcpgw` |
| **Agent / cloud frontend** | `https://opensearch.default.applications.procyon.ai:8643/mcp` | Current Agent deployment; the installed Agent supplies authentication |
| **Cloud API** | `https://privilege.pingone.com/api/mcp` | DEAD END — 401s every request including its own `.well-known/oauth-protected-resource`, sends no `WWW-Authenticate` |

**Both of the first two hit the same auth wall.** A hypothesis held through most of
2026-08-08 — that agentless mode escapes the JWT-signature failure because the
gateway would run OIDC itself — was **disproven by direct test**: a real PingOne
token sent through nginx to 8620 returns the identical
`JWT signature validation failed`. Prefer agentless anyway (fewer moving parts, no
dependency on Ping's cloud routing, and it is what the SE material documents), but
do not expect it to solve authentication.

The MCP Server application's Frontend Name is **read-only** in the current console
build, assigned on create as
`<app>-app-default.applications.privilege.pingone.com:8643`. You do not edit it, and
you do not need to: agentless is selected by putting your own nginx in front and
**rewriting `Host` to the registered name** (below). Earlier revisions of this skill
told you to change Frontend Name to `aidemo.mcpgw.local.ping-devops.com` — that field
cannot be changed, and doing so was never what made agentless work.

### The nginx front door (agentless only)

Agentless mode needs customer-owned DNS + TLS in front of the proxy:

| Piece | Where |
|---|---|
| nginx service | `demo_mcpgw_nginx/nginx.conf`, compose service `mcpgw-nginx`, host `443` |
| Wildcard cert | `scripts/ensure-mcpgw-certs.sh` → `certs/mcpgw-wildcard{,-key}.pem`, SAN `*.mcpgw.local.ping-devops.com` |
| k8s equivalent | `k8s/aws/mcpgw-agentless-ingress.yaml` (ingress-nginx **is** the engine there) |
| `/etc/hosts` | one `127.0.0.1` line **per frontend host**, named after the app — a wildcard cert works, `/etc/hosts` has no wildcards: `127.0.0.1 MCP-aidemo.mcpgw.local.ping-devops.com` and `127.0.0.1 mcp-pingone-admin.mcpgw.local.ping-devops.com` |

**The gateway matches `Host` against the full registered Frontend Name**
(`<app-name>.default.applications.procyon.ai:8643`) — nothing else. Proven end to end
2026-08-10 on build `v1.260726` (`cyonproxy`, the previous binary): with that Host,
initialize → tools/list (238 tools) → tools/call all completed. Anything else gets
`Domain not found` in the proxy log and an empty `200` — which reads like a broken
backend. (Ping's SE deck describes a label-strip "EvaluateHost"; that was tested and
does NOT hold on `cyonproxy`.)

⚠️ **Unverified on `mcpgw` (current binary).** The one live routing evidence we have
for `mcpgw` is a *different* shape entirely: another engineer's cluster registers
per-app MCP servers as **path prefixes on a single base host**
(`cj-agentless-mcpgw.ping-devops.com/opensearch-mcp-server`,
`.../pingone-mcp-server-2`) rather than as separate Host-rewritten FQDNs, and their
per-app **subdomains** (`opensearch-mcp-server.cj-agentless-mcpgw...`) all returned
a plain `404`. Do not assume the Host-rewrite trick documented above still applies to
`mcpgw` — settle this by probing our own deployment once it is enrolled, not by
carrying this section's cyonproxy-era facts forward.

`demo_mcpgw_nginx/nginx.conf` therefore carries **one map line per application**,
client host → registered name; the k8s ingress does it with
`nginx.ingress.kubernetes.io/upstream-vhost` (one value per Ingress object, so one
Ingress per app there). `X-Forwarded-Host` always keeps the original. Adding an app =
one map line + one `/etc/hosts` line.

The registered value is **not** what the console displays — the console shows a
`…applications.privilege.pingone.com` name while the object holds a
`…applications.procyon.ai` one. Read it from the API:

```bash
curl -s "https://console.privilege.pingone.com/api/$TENANT/v1/applications?ObjectMeta.Namespace=default" \
  -b "auth_token=$TOK" -H "x-procyon-session-id: $SID" -H 'accept: application/json' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['Applications'][0]['Spec']['McpAppConfig']['FrontEndName'])"
```

`McpAppConfig`, not `MCPAppConfig` — the wrong casing reads as `undefined` instead of
failing. `TOK` and `SID` come from devtools and last ~60 minutes; full recipe and the
other collections (`/v1/pacpolicys` for access policies) in `privilege/PRIVILEGE-MCP.md`
§"the console API reads the real config".

Use a **variable** upstream plus `resolver 127.0.0.11`, or nginx refuses to start with
`host not found in upstream` whenever the proxy is down.

**Do not repoint `PRIVILEGE_MCPGW_URL` at the Cloud API.** That was tried and
reverted; `privilege/PRIVILEGE-MCP.md` §"4. The client pointed at the Privilege cloud
API, not a gateway — RESOLVED 2026-08-02" is the record. No token from PingOne
env `01d89b06` satisfies `privilege.pingone.com` — not the `6586d3de` app, not the
dedicated `873cc9e4` "Privilege Cloud MCP Gateway" app (which mints
`aud: mcpserver.ping.demo`, the demo's own audience). The 401 arrives before any
policy runs, so it looks like an authorization problem and is not one.

**Port on `cyonproxy`: `8620`.** Earlier revisions of this skill said `8680`, then
`8623`. Both were wrong for that binary — see "Proxy ports" below for the probe that
settles it. On `mcpgw` (current binary) the correct port is `8623` instead — see
item 1 in "Read this first". Do not let this historical correction confuse you into
using 8620 on the current binary.

### Standing state on `cyonproxy` (2026-08-10 end-to-end success, 2026-08-11
corrections) — historical, not the current binary

⚠️ Everything in this subsection describes `cyonproxy`, replaced 2026-08-12 by
`mcpgw`. Kept as a historical record of what was proven, and as the bar the current
binary still needs to clear (nothing below has been re-verified against `mcpgw`).

**Working and demonstrable on `cyonproxy`:** the console-token chain, end to end,
through nginx — auth, `Host` routing, per-application policy, backend proxy, session
recording. The entire Privilege value proposition minus PingOne-issued client tokens.

**Blocked on the vendor, on `cyonproxy`:** a tokenless 401 challenge, and inbound
trust for a PingOne issuer. Nothing in this repo, the console, the console API, or
`cyonproxy` changed `IssuerPublicKey:[]`. **Partially superseded** — `mcpgw` does emit
the tokenless `WWW-Authenticate` challenge (see item 0 above and "The PingOne token
wall" below), though inbound PingOne-issuer trust (`IssuerPublicKey:[]`) is still
unconfirmed either way on the new binary.

Supporting detail for `cyonproxy`, kept for history:

- Container `ai-demo-ping-mcpgw` up, node `1cf90baf-2a83-45db-830f-581ea98110d1`
  `Active` in cluster **`ai-demo-fresh`**, command streams established,
  `ProxyURL local.ping-devops.com:8623`.
- **The gateway answers.** `POST http://localhost:8620/mcp` → `401 Bearer Token not
  found.` End to end through nginx also reaches it:
  `POST https://aidemo.mcpgw.local.ping-devops.com/mcp` → `HTTP/2 401` same body.
- Backend reachable from inside the compose network:
  `POST http://mcp-server:8080/mcp` → `200`.
- **The 401 carried no `WWW-Authenticate` header** on this local `cyonproxy`
  enrollment, so a browser never learned where to authenticate. Read as a fact
  about that container on that date, not about the product: OAuth against the
  AI Gateway is in field use (see item 0).
- **A PingOne bearer token fails `kid` comparison.** Tested through nginx to 8620:

  ```
  no token      -> 401 Bearer Token not found.
  PingOne token -> 401 Authorization header JWT parsing failed
                       JWT signature validation failed
  ```

  Same error as mesh mode, and the token was minted in Privilege's own tenant
  `8d4d7a4c`. `AuthzMiddleware` for the app carries `AuthzServer:<app-name>` and
  `IssuerPublicKey:[]`. The control plane also advertises a tenant-level
  `AuthzServer:<envid>.oauth.privilege.pingone.com`, but the app is not bound to it.
- **The gateway has no unauthenticated surface at all.** Every path answers
  `401 Bearer Token not found.` — including `/authorize`, `/callback`, and both
  `.well-known` documents, which must be publicly readable for OAuth discovery:

  ```
  /mcp  /authorize  /callback
  /.well-known/oauth-authorization-server
  /.well-known/oauth-protected-resource     -> all 401, identical body
  ```

  You need a token to reach the endpoint that issues tokens. (`GET /` is the sole
  exception — a 3-byte `OK` liveness probe.)
- **Diagnose from the gateway's log delta, not the HTTP response.** Capture
  `wc -c < /var/log/procyon/cyonproxy.log` before and after a request and tail the
  difference. That is the only way `ValidateInfraJwt` / `InfraKid` becomes visible;
  the 401 body actively misdirects. **This filename transfers to `mcpgw`** —
  confirmed independently twice: another engineer's live `agentless-mcpgw` pod
  runs a log-tailer sidecar waiting on this exact path, and our own scratch
  container (same image, no `/var/log/procyon` mounted) logged
  `error opening file: open /var/log/procyon/cyonproxy.log: no such file or
  directory` on startup. Apparently a shared internal name across both binaries —
  do not go looking for an `mcpgw.log` that doesn't exist.
- **Duplicate node registration.** `has same NodeURL - this happens because of
  misconfigured Node`: a stale row claims the same `NodeURL local.ping-devops.com:8690`.
  Cosmetic — confirmed the command stream stays up and discovery still dispatches.
  Console offers no way to delete the stale row.
- `Error sending update to mesh controller: … not found` is the same symptom, not a
  separate fault.

### The PingOne token wall — ruled-out paths, and the one lever left

Read this before proposing any fix for "make PingOne tokens work against the
gateway." Every row below was tried or structurally disproven; re-running them
costs days and changes nothing.

| Path | Why it is dead |
|---|---|
| `cyctl object application update` | Rejects the console cookie JWT: `unexpected signing method: RS256`. It wants HS256, and console dashboard XHRs send `Authorization: Bearer undefined` — there is no HS256 bearer to lift |
| Console REST `PUT`/`PATCH` on `/v1/applications/<name>` | `401 User is not authorized`, route-level. **Not a header-shape problem** — a `PUT /v1/userpreferences/...` succeeds with the identical session because that object lists the user under `WrOwners.ObjectRef`. Application objects do not. Copying the working PUT's headers is the trap |
| `POST /v1/applications` (create instead of update) | Works — created `mcp-aidemo` with `ResourceOAuth` fully populated, pushed to the runtime in under a second — **and changed nothing.** `ResourceOAuth` is the *outbound/backend-facing* OAuth + DCR config. No inbound-issuer field exists on the Application object |
| `scripts/set-privilege-frontend-oauth.sh` | Structurally incapable, on three counts: `IssuerPublicKey` belongs to `OidcServer` (`cyctl` gives `get`/`list` only, no create/update); `authzmiddleware` is not a `cyctl` object type at all; `ResourceOAuth` is the outbound challenge + DCR config, not inbound trust. **Kept in the repo as the record of a ruled-out path — do not re-run it** |
| Newer `cyonproxy` build `v1.260806` | Same bare `401 Bearer Token not found.` on every path and host, including `/aidemo/authorize` and both `.well-known` documents |
| The PingOne Privilege **Agent** | A TPM / Secure-Enclave desktop app minting a device-bound **mTLS** identity for SSH/RDP/K8s/cloud CLIs. Not a credential issuer for MCP clients — adopting it means authenticating clients as Privilege-native devices, abandoning the PingOne token chain this demo exists to show. Console-download only (Settings → App Downloads); nothing scriptable |
| `AppUserToken` / `AIAgentAccount` objects | Neither issues a credential. `AppUserToken` is the guest-agent metadata envelope (`--guest-meta-*` flags only); `AIAgentAccount` is a shadow-AI inventory connector (Bedrock, Salesforce, Azure, Vertex, Copilot). High reference counts in the binary measure how widely a struct is passed, not what it does |
| Re-enrolling the node / swapping a key file | `infra-root-jwt` is fetched at runtime from Privilege's Notary PKI. No local artifact backs it |

**The one untested lever: `cyctl object idprovider create`.** Tenant-level IdP
registration is the only customer-authorable object in the chain
(`IDProvider → OidcServer → IssuerPublicKey`). That path is **inferred from the
object graph, not verified** — no live attempt has been made, and `cyctl` still needs
an HS256 console token to try it.

**`privilege-mcpgw` — now our binary, and the challenge is confirmed live, not just
by string search.** The original "no build we can pull emits a challenge" measurement
surveyed the wrong repository:

```
public.ecr.aws/s7q1z8z4/privilege-proxy    -> /procyon/bin/cyonproxy   (previous binary; zero challenge strings)
public.ecr.aws/s7q1z8z4/privilege-mcpgw    -> /procyon/bin/mcpgw       (current binary, since 2026-08-12)
```

`mcpgw`'s flag set is a strict superset of `cyonproxy`'s (adds `-mcpconfpath`,
`-mcpgw`) and its binary contains every string `cyonproxy` lacks: `Bearer realm=`,
`MCP OAuth Server`, `authorization_uri`, `resource_metadata`,
`/.well-known/oauth-protected-resource`. **This is no longer just a string-search
finding** — a live probe of this exact image (digest
`sha256:0faad5903a5bd72539b1df525e3c7bc5d458a5bd324aac9755b8af99dfa6647d`) running in
another engineer's cluster returned, on a tokenless request:

```
401
www-authenticate: Bearer realm="MCP OAuth Server", resource_metadata="...", authorization_uri="https://.../.well-known/authorize"
{"authorization_uri":"...","error":"unauthorized","error_description":"Bearer token required",...}
```

One vendor bug worth knowing before relying on it: `resource_metadata` doubles its
own path (`.../.well-known/oauth-protected-resource/.well-known/oauth-protected-resource`)
— don't copy that shape.

`ValidateInfraJwt` is present in `mcpgw` too, and both `.well-known` documents on
that live probe were *themselves* gated behind the same 401 (non-compliant — they
must be public per spec, same gap `cyonproxy` had). **So: the discovery/challenge
layer is proven; whether a PingOne token subsequently passes `kid` comparison on
this binary is not** — that requires a live token test we have not run against our
own enrollment. Do not describe this as "the wall is down" without that follow-up
test.

**The gate for both, and it is the same one:** a tokenless `POST /mcp` that answers
`401` **with** a `WWW-Authenticate` header. Anything less proves nothing — a bare
`401 Bearer Token not found.` proves nothing at all (the bearer check runs before host
evaluation, so even a garbage `Host` returns it).

There is **no vendor documentation to check any of this against.** The MCP gateway
feature GA'd 2026-07-13 with zero configuration docs. Every config fact here was
recovered from the binary, the `cyctl` flag surface, the console API and gateway logs.
A config that looks wrong here is more likely undocumented than misconfigured.

### `pingone.env` — loaded as env vars, but no build acts on them yet

⚠️ **This subsection describes `cyonproxy`, the previous binary.** As of the
2026-08-12 swap to `mcpgw`, item 2 below is **reversed**: `mcpgw` requires
`-mcpconfpath` pointing at this exact file and reads it directly — see item 6 in
"Read this first". The three facts below remain accurate as history for `cyonproxy`.

Precision matters here; the old heading ("never read — do not debug it") overstated
even for `cyonproxy`. Three facts, each verified 2026-08-10, **for `cyonproxy`**:

1. Compose `env_file` **does** inject its values — `OIDC_CLIENT_ID`, `SERVER_URL`,
   etc. are present in the `cyonproxy` process environment (`docker inspect … .Config.Env`).
2. The **binary never references the file itself** — proxy-log grep for
   `SERVER_URL`/`authorize`/`oidc` after clean restart: zero hits, both tenants,
   both modes. (Confirmed reversed on `mcpgw` — see above.)
3. **`grep -a` over `/procyon/bin/cyonproxy` v1.260806 finds zero occurrences of
   `authorization_uri` / `MCP OAuth Server` / `oauth-protected-resource`.**
   **Confirmed live on `mcpgw` (our current binary) that it does emit this
   challenge** — see "The PingOne token wall". ⚠️ Do not extrapolate the string
   search into "OAuth is unavailable on the gateway": the AI Gateway is run with
   OAuth in the field (item 0). Absent strings in one binary build bound what
   that build emits, nothing more.

So, for `cyonproxy`: keeping the file correct did not make a
`WWW-Authenticate` challenge appear on that binary. On `mcpgw` the file's correctness matters much more
directly: it is read eagerly and a missing/invalid file is now a fatal, crash-looping
error, not a silently-ignored one. Deck file map, all three present in our
container: `/var/lib/procyon/config/pingone.env` (bind mount of
`ping-mcpgw/procyon/`), `/var/lib/procyon/ssl/mcpgw-{cert,key}.pem` (host copies;
the runtime volume the deck refers to is `/procyon/ssl` — see `privilege/runbooks/ping-mcpgw.md`).

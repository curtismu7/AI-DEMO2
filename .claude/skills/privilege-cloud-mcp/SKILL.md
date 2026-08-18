# Privilege Cloud MCP — Gateway Integration

Use when troubleshooting, configuring, or extending the PingOne Privilege Cloud
MCP integration: the Privilege Gateway, the BFF MCP client relay, the
Privilege MCP Client UI page, or the K8s deployment.

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
| **Agentless / self-hosted frontend** (use this) | `https://aidemo.mcpgw.local.ping-devops.com/mcp` → nginx :443 → proxy :8623 | Reaches the gateway directly, bypassing Ping's cloud. Proven end to end with a console token **on the previous binary (`cyonproxy`)**: auth, routing, policy, backend, discovery. Not yet re-proven on `mcpgw` (current binary as of 2026-08-12) |
| **Mesh / cloud frontend** | `https://<app>-app-default.applications.privilege.pingone.com:8643/mcp` | Ping-assigned FQDN, routed through Ping's cloud and back over the mesh |
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

There is **no Frontend field in this modal**, and the Frontend Name the console
assigns afterwards is read-only. Instead, read the registered name from the console
API (see "The nginx front door") and add it as a `map` line in
`demo_mcpgw_nginx/nginx.conf` plus a `/etc/hosts` entry. That `Host` rewrite is what
routes to the app; without it every request gets `Domain not found` and an empty
`200`.

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
| Proxy Image (current, since 2026-08-12) | `public.ecr.aws/s7q1z8z4/privilege-mcpgw`, pinned by digest `sha256:0faad5903a5bd72539b1df525e3c7bc5d458a5bd324aac9755b8af99dfa6647d` (multi-arch manifest list). No public tag-listing access to confirm a stable version tag exists — this digest is the exact build verified live. Bump by re-pulling `:latest` and updating the digest |
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

**Option B — token file. It is an ENV FILE, not a bare JWT:**
```bash
printf 'ENV_PROXY_TOKEN=%s\n' 'eyJ...' > ping-mcpgw/procyon/config/proxy-token.env
./run-docker.sh optional start mcpgw
```
Compose loads it with `env_file`, so the `ENV_PROXY_TOKEN=` prefix is required and
there is no `export`/`cat` step. Writing a bare JWT (what earlier revisions of this
skill said) produces a file whose only "variable" is the JWT itself, and the proxy
starts with no token at all. Do not add a single-file bind of it either: cyonproxy
rewrites `/procyon/ssl/proxy-token.data` at startup (same token, rewritten — not
swapped for a long-lived one), so a `:ro` bind makes the container exit 1 with
*"ProxyToken write to /procyon/ssl/proxy-token.data failed … read-only file
system"*, and a `:rw` single-file bind breaks as soon as the proxy replaces rather
than truncates the file.

⚠️ **`run-docker.sh` warns about the wrong path.** It probes
`ping-mcpgw/config/proxy-token` (the pre-move location) and prints *"Set
PRIVILEGE_PROXY_TOKEN env or create …"* even when the real
`ping-mcpgw/procyon/config/proxy-token.env` exists and `.env` already carries the
token. It starts the profile anyway — the warning is cosmetic. Verified 2026-08-11
at `run-docker.sh:1206`.

### After enrollment
The proxy writes `proxy-config.data` into the `mcpgw-ssl` Docker volume.
Subsequent boots use this persisted config — no token needed. If the volume is
lost (Docker crash, prune), re-enroll with a fresh token.

### Re-enrollment (Docker crash recovery)
```bash
# 1. Get new token from console
# 2. Save it (env-file format — the ENV_PROXY_TOKEN= prefix is required):
printf 'ENV_PROXY_TOKEN=%s\n' 'eyJ...' > ping-mcpgw/procyon/config/proxy-token.env
# 3. Clear stale volume state:
docker volume rm ai-demo_mcpgw-ssl 2>/dev/null || true
# 4. Start fresh:
export PRIVILEGE_PROXY_TOKEN="eyJ..."
./run-docker.sh optional start mcpgw
# 5. Verify enrollment:
docker logs ai-demo-ping-mcpgw 2>&1 | grep -i "enrolled\|connected\|ready"
```

## Reading Ping's SE diagrams — three divergences from our deployment

Ping's "Priv Networking" diagram is a K8s reference topology, not our deployment.
Copying values off it sends requests to the wrong place. It is also worth noting
that the diagram **documents its own failure**, and the cause is visible in the
picture:

```
Ingress publishes    https://cj-mcpgw.ping-devops.com:443
Gateway listens      http://mcpgw.ping-devops-cjmuir.svc.cluster.local:8680   (in-cluster only)
Priv Agent dials     https://cj-mcpgw.ping-devops.com:8680   -> "Failed to connect"
```

External hostname, internal port — nothing public listens on 8680, the Ingress
terminates 443. Stacked on that, `https://` against a listener the same diagram
labels `http://`. Our agentless path (nginx :443 → proxy plain HTTP) is the same
shape as their *working* leg, so this failure is not ours — but the three
differences below are:

| Their diagram | Ours | Trap |
|---|---|---|
| Gateway on `:8680` | MCP frontend on `:8620` | `8680` is `cyonproxy --help`'s documented `-listen` default (see `docker-compose.yml`); we run `-listen` on 8623 and the MCP frontend `-alp-port` on 8620. Their `:8680` box fills the role our 8620 does. **Settle ports by probing, never by reading their diagram** |
| MCP server `http://…/sse`, no port | `http://mcp-server:8080/mcp` | Different MCP transport — SSE vs streamable HTTP. Pasting their URL shape into the console's MCP Server URL field breaks tool discovery |
| gRPC to `proxy-us-west-2.privilege.pingone.com` | `grpc.privilege.pingone.com:443`; `CNTRLUrl=https://privilege.pingone.com` in `procyon-guest-agent.env` | Three different control-plane names in play. If egress is allowlisted to only one, a regional endpoint is blocked — and that presents exactly like the diagram's "Failed to connect" |

The diagram also puts the **Priv Agent** in the client position. That is consistent
with the Agent being a device-bound mTLS product (see "The PingOne token wall"):
Ping's reference topology shows no PingOne-OAuth MCP client at all. Read that as
evidence the token path is an unsupported topology, not as something we
misconfigured.

## Proxy ports — 8623 is the MCP+OAuth frontend on `mcpgw` (current binary)

⚠️ **This flipped with the 2026-08-12 binary swap.** On the previous binary
(`cyonproxy`) 8620 was correct and 8623 was the mTLS mesh port — that table is kept
below for history. Do not mix the two tables up.

### Current binary: `mcpgw`

| Port | Flag | Purpose |
|------|------|---------|
| **8623** | `-mcpgw` | **The MCP+OAuth frontend. Plain HTTP, emits the WWW-Authenticate challenge.** Point nginx / the BFF / k8s Service here |
| 8680 | `-listen` | Mesh, by default on this binary (differs from `cyonproxy`'s `:8680` *-alp-port* default — a coincidence of the same number meaning something else) |
| 8620 | `-alp-port` | Untested on `mcpgw`. Was the frontend on `cyonproxy`; do not assume it still is |
| 8690 | `-medusa` | gRPC tunnel (also the node's `NodeURL`) |
| 8090 | `-debug-port` | Debug API, loopback only |

Settle it by probing, never by reading vendor material or by carrying over the
`cyonproxy` table below:

```bash
curl -i -X POST http://localhost:8623/mcp -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
# HTTP/1.1 401 Unauthorized
# www-authenticate: Bearer realm="MCP OAuth Server", ...      <- the gateway. This is the frontend.
```

A `www-authenticate` header on that 401 is the positive signal you are on the right
port. (Verified live against another engineer's cluster running this same image by
digest — not yet re-verified against our own enrollment.)

Listing what actually binds (busybox has no `ss`/`netstat`, and `awk` here lacks
`strtonum`, so parse the hex on the host):

```bash
docker exec ai-demo-ping-mcpgw cat /proc/net/tcp /proc/net/tcp6 > /tmp/t.txt
python3 -c "
print(sorted({int(f[1].rsplit(':',1)[1],16) for f in
  (l.split() for l in open('/tmp/t.txt')) if len(f)>3 and f[3]=='0A'}))"
```

### Previous binary: `cyonproxy` — kept for history, do not use for `mcpgw`

| Port | Flag | Purpose |
|------|------|---------|
| 8620 | `-alp-port` | The MCP frontend on `cyonproxy`. Plain HTTP |
| 8623 | `-listen` | Mesh on `cyonproxy`. Speaks **mTLS** and rejects everything else |
| 8690 | `-medusa` | gRPC tunnel (also the node's `NodeURL`) |
| 8090 | `-debug-port` | Debug API, loopback only |

This table was wrong until 2026-08-08 and cost hours twice, for the same reason a
naive port-number carryover from `cyonproxy` to `mcpgw` would cost hours now. Two
traps that applied to `cyonproxy`:

- Ping's SE deck says *"proxy forwards to MCPGW runtime, often 8623 in field
  examples."* Not true of `cyonproxy`.
- Pointing nginx at 8623 (on `cyonproxy`) yielded a bare **502** with the real cause
  only in the nginx error log (`SSL_read() failed … tlsv13 alert certificate
  required`). The response body said nothing.

Do **not** try to fix a `tlsv13 alert certificate required` response by giving the
port a server certificate. That was tried on `cyonproxy`'s mesh port (PR #1465,
reverted by #1466): mounting `/procyon/ssl/mcpgw-cert.pem` + `mcpgw-key.pem` changed
nothing. A mesh/`-listen` port requires mTLS by design, full stop — on whichever
binary is running.

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

## UI — PrivilegeMcpClientPage

- Route: `/privilege-mcp-client`
- Shows "Access Denied" modal when refreshTools gets a 401 "not authorized"
- If the underlying error is `403 … doesn't have access to MCP app`, that is a
  policy gap — assign the user a policy in the Privilege Cloud console (and check an
  existing one has not silently expired)
- If it is `401 … JWT signature validation failed`, no policy will help: this page
  sends a **PingOne** token, which the gateway rejects on `kid`. See "The PingOne
  token wall". The console-token path (`scripts/privilege-smoke.sh`) is what
  currently demonstrates the chain

## K8s deployment

Manifest: `k8s/75-ping-mcpgw-deployment.yaml`
- Reads `ENV_PROXY_TOKEN` from K8s secret `ping-mcpgw-secrets`
- Hostname: `ai-demo.ping-devops.com`
- Persists SSL state via `ssl-certs` volume
- Runs `mcpgw` on `:8623`, matching the local docker-compose swap (see "Read this
  first" item 0)

⚠️ **Was never actually deployed on the SE cluster until fixed.** The manifest
existed but `k8s/aws/deploy.sh` (the real SE deployer — not the local-only
`k8s/deploy.sh`) never included it in its apply loop, and `create-secrets.sh`
checked a pre-move token path, so `ping-mcpgw-secrets` was silently never created
either. An `ai-demo-mcpgw-ingress` routed `/mcpgw` to a service that didn't exist —
`503` end to end. Both fixed; deploying still needs a **fresh, unexpired**
enrollment token, since this cluster has no prior `ping-mcpgw-ssl` PVC (first
enrollment on a new host, unlike a restart on an already-enrolled one).

## Docker startup

```bash
# Local dev (compose optional group):
./run-docker.sh optional start mcpgw

# Standalone (host network; --net=host itself was proven on the previous binary,
# not re-verified on mcpgw):
docker run -d --name ai-demo-ping-mcpgw \
  --net=host \
  --env-file ping-mcpgw/procyon/config/proxy-token.env \
  -v ./ping-mcpgw/procyon:/var/lib/procyon \
  public.ecr.aws/s7q1z8z4/privilege-mcpgw@sha256:0faad5903a5bd72539b1df525e3c7bc5d458a5bd324aac9755b8af99dfa6647d \
  /procyon/bin/mcpgw -hostname local.ping-devops.com -mcpconfpath /var/lib/procyon/config/pingone.env
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
| "No Tools, Prompts, or Resources Discovered" in console | Proxy can't reach MCP server (mTLS blocks, wrong URL, wrong port) | Clear `MCP_MTLS_ON` in the root `.env`; set MCP Server URL to `http://mcp-server:8080/mcp` (compose DNS — the proxy shares that network) |
| 401 "User is not authorized" from MCP | User has no Privilege policy for the MCP app | Assign policy in Privilege console (requires discovery first) |
| 401 "Unsupported authentication method" on token exchange | Missing `client_secret` in POST body | Ensure `PINGONE_MCP_GATEWAY_CLIENT_SECRET` is set |
| redirect_uri mismatch | BFF detects wrong host (Docker internal hostname) | Set `PRIVILEGE_MCP_CALLBACK_HOST` or ensure `x-forwarded-host` passes through |
| Session not persisting between requests | Session cookie not sent / saveUninitialized | Use browser (cookies auto-sent), or pass `Cookie` header in curl |
| curl to MCP server gets "Empty reply" | mTLS enabled — server drops non-cert connections | Disable mTLS or provide gateway client cert |
| gRPC `UNAVAILABLE` / proxy silent hang | Firewall blocking outbound to `grpc.privilege.pingone.com:443` | Allow outbound 443; no inbound holes needed |
| `IssuerPublicKey:[]` in proxy logs | The gateway compares the token's `kid` with `infra-root-jwt`, a key it fetches from Privilege's internal Notary PKI. No PingOne credential can match | ⚠️ **Not fixable from here — stop.** `IssuerPublicKey` belongs to `OidcServer` (`cyctl` gives `get`/`list` only), not to the Application. Setting `--spec-mcp-app-config-resource-o-auth-*` was tried live and changed nothing — that field is the *outbound* challenge + DCR config. Use a **console** token, whose `kid` does match. See `privilege/PRIVILEGE-MCP.md` §2026-08-11 |
| `code_challenge is required` from PingOne | App `deff60f5` enforces `pkceEnforcement: S256_REQUIRED` | Set `--spec-mcp-app-config-resource-o-auth-use-pkce`; it is mandatory, not optional |
| `unexpected signing method: RS256` / `ES256` from `cyctl` | `cyctl` wants an HS256 console session token; it rejects PingOne (RS256) and proxy (ES256) tokens on algorithm alone | Grab `Authorization: Bearer …` from a console XHR. `cyctl token jwt` cannot bootstrap — it requires a token itself |
| `curl https://…:8623/mcp` fails to connect (`mcpgw`, current binary) | Are you sure this is the current binary? On `mcpgw` 8623 IS the correct frontend — a connection failure here means something else (container down, wrong host) | Check the container is up before assuming the port is wrong. (On the previous binary, `cyonproxy`, this row's original advice — 8623 is mesh/mTLS-only, use 8620 — was correct; it is not for `mcpgw`.) |
| `has same NodeURL - this happens because of misconfigured Node` | Two node registrations claim the same `NodeURL local.ping-devops.com:8690` — the live node is linking to a stale twin of itself | **Cosmetic — ignore.** Command streams stay up and discovery still dispatches. The console offers no way to delete the stale row. Avoid making it worse: do not enroll a second node on the same Host IP |
| BFF gets `UND_ERR_SOCKET` / connection refused to the gateway | Pointing at a port that accepts TCP but serves no MCP | Use `8623` on `mcpgw` (see "Proxy ports"; was 8620 on the previous binary) |
| nginx returns a bare `502`, body says nothing | On `mcpgw`, upstream is likely `8680` (mesh, mTLS) instead of `8623`. Check the nginx error log for `tlsv13 alert certificate required` | Point the upstream at `http://…:8623` |
| `401 Bearer Token not found.` | Normal — the gateway with no token. This is the **success** signal for "am I on the right port" | Nothing to fix |
| `Domain not found` in the proxy log, **empty `200`** to the client | `Host` is not the Frontend Name registered on the application object. Reads like a broken backend; it is the gateway matching no application | Rewrite `Host` — nginx `map $host $mcpgw_frontend`, k8s `upstream-vhost`. See "The nginx front door" |
| Host tried matches what the console shows, still `Domain not found` | The console UI displays a different domain than the object holds (`…privilege.pingone.com` vs `…procyon.ai`) | Read `FrontEndName.Elems` from the console applications API, never from the UI |
| `403 User <id> doesn't have access to MCP app <name>` | **Progress, not a regression.** Auth passed and routing matched; Privilege is enforcing policy | Author a policy binding that user to that MCP application resource |
| A previously working call goes back to `403 … doesn't have access` | Console policies can be created **time-boxed** (1h, 2h). An expired policy fails exactly like a missing one | Check the policy is still live before debugging anything else |
| `401` with **no** `WWW-Authenticate` header, on `mcpgw` (current binary) | Unexpected — the binary should emit one (confirmed live on another cluster). Check `-mcpconfpath`/`pingone.env` are actually mounted and readable; a crash-looped container answering through a stale connection can look like this too | Verify the container is actually running `mcpgw`, not a leftover `cyonproxy` container. Our local `cyonproxy` enrollment never emitted this header; that is a fact about that build, not about whether OAuth works on the AI Gateway (it does — see "Read this first" item 0) |
| A bare `401 Bearer Token not found.` treated as proof of routing | On `cyonproxy`'s `:8620` the bearer check ran **before** host evaluation — `garbage.nowhere.example.com` returned the same 401 (verified 2026-08-10). Not re-verified on `mcpgw`'s `:8623` | Only a request carrying a token exercises routing. Do not use a tokenless 401 as a routing signal, on either binary |
| `cyctl` fails in ways that look like auth errors | `--apigw` pointed at `https://privilege.pingone.com` — the data-plane host | Use `https://console.privilege.pingone.com` |
| `401 User is not authorized` on a console-API write | Object ownership, **not** header shape. Application objects do not list the console user under `WrOwners.ObjectRef`; `/v1/userpreferences/...` does, which is why one PUT succeeds and the rest 401 | The API is list + create only for these objects. Copying the working PUT's headers does not help — that was tried |
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
sed 's/^ENV_PROXY_TOKEN=//' ping-mcpgw/procyon/config/proxy-token.env | cut -d. -f2 | base64 -d 2>/dev/null | python3 -c "
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
4. Save locally — env-file format, the prefix is required:
   ```bash
   printf 'ENV_PROXY_TOKEN=%s\n' 'eyJ...<full JWT>' > ping-mcpgw/procyon/config/proxy-token.env
   ```
5. Clear stale enrollment state and restart:
   ```bash
   docker volume rm ai-demo_mcpgw-ssl 2>/dev/null || true
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

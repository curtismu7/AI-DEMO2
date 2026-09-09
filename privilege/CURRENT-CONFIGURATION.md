# PingOne Privilege MCP: current configuration index

Verified 2026-09-08. **There is now exactly one gateway.** The Agentless/Agent
split below the fold is history: the per-owner gateways were torn down on
2026-09-01 and replaced by a single AI Gateway (the product's own new name for
what this repo called "agentless").

## The current deployment

| | |
|---|---|
| Operational guide | `.claude/skills/privilege-mcpgw-agent-k8s/SKILL.md` (source of truth) |
| Namespace | `ping-devops-curtismuir` |
| Helm release | `agentless-mcpgw` (chart `pingone-privgateway-helm-main/agentless`) |
| Mesh cluster | `ai-demo-cmuir` |
| PingOne tenant | `0428ba4f-169c-436b-aff9-b230496e0e3b` ("AI Agent") |
| Agentic App | `opensearch22` |
| MCP client URL | `https://mcpgw.ai-demo.ping-devops.com/opensearch22/mcp` — see "The entry path is derived from the backend URL" |
| Backend registered as | `http://opensearch-mcp-server.ping-devops-curtismuir.svc.cluster.local/mcp` — **`/mcp`, not `/sse`** (corrected 2026-09-08 evening, see the rule below) |
| Authentication | Gateway-managed OAuth: RFC 7591 dynamic registration + PKCE, no client id configured on the client |
| Gateway's own OIDC | client `1a403855-81f6-45eb-b233-fed59abc5c73` in tenant `0428ba4f…`, from secret `agentless-mcpgw-oidc-config` (key `pingone.env`). This is what `PRIVILEGE_SSO_CLIENT_ID`/`_ENV_ID` must match — see "Which PingOne identity is which" |

## Rules that still bite

- **Register the backend with `/mcp`, never `/sse`** — and this file has now
  said the opposite twice, so here is the measurement rather than a rule. The
  gateway forwards the path after the app segment verbatim, and on this build
  (v1.260906) its discovery client **POSTs `initialize`** to the registered
  backend path — the morning's failure line read
  `sending "initialize": rejected by transport: Post "…/sse"`. On a FastMCP
  backend `/sse` is the legacy GET-only endpoint: `POST /sse -> 405, Allow:
  HEAD, GET` measured inside the pod (PR #2958). So an `/sse` registration
  breaks every JSON-RPC call, and the "GET and wait for the SSE `endpoint`
  event" description recorded here earlier no longer matches what this gateway
  does. `opensearch22` was re-registered as `…/mcp` on 2026-09-08 and its
  calls succeeded over `/opensearch22/mcp` (200/202/200 in the gateway log).
- **`svc.cluster.local` is the backend, not a client URL.** It resolves only
  inside the cluster; a client pointed there hangs. Clients use the client URL
  above.
- **The chart adds no release prefix.** Objects are `opensearch-mcp-server`,
  `opensearch`, `agentless-mcpgw`. Any `cm-mcpgw-*` or `ping-mcpgw-*` name is
  from a deleted release.
- **The gateway's DCR registry is in memory** — restarting it invalidates every
  registered client. The BFF re-registers automatically; standalone MCP clients
  must be removed and re-added.
- **Policies are per Agentic App and time-boxed.** A new app starts with none.
  Read `deployment/agentless-mcpgw -c log-tailer` for the real denial reason;
  the empty `Email=` in `User identity resolved` is cosmetic and never the cause.
  **An EXPIRED policy is indistinguishable from a missing one** — same bare 403.
  On 2026-09-08 `opensearch22` returned 403 for exactly this reason and re-adding
  the policy fixed it immediately; the log shows the flip:
  `policy denied <userID> access to opensearch22` then, once re-added,
  `User {…} has policy based capabilities for {Application …opensearch22}`.
  **A 403 from Privilege is a valid answer, never something to fix in code.**
- **The entry path is derived from the BACKEND URL, and is per app.** The gateway
  pins each Agentic App to one client-facing path and answers a bare 404 on any
  other; the only explanation is in the log:
  `[mcpgw] rejecting /mcp on app opensearch22: outside entry path "/sse"`. That
  line is what a `/sse`-registered app produces when a client correctly calls
  `/mcp` — the cure is to fix the registration, not the client. Combined with the
  rule above, every JSON-RPC door must be registered on, and called on, `/mcp`.
  `mcpFacade.js` still resolves the path per app (`privilegeEntryPath`, env
  override `MCP_FACADE_PRIVILEGE_GATEWAY_PATHS`) so that a console edit is an
  env change rather than a code change — but no app defaults to anything other
  than `/mcp` any more (PR #2958).
- **An unauthenticated probe cannot tell you the entry path.** The rejection
  happens AFTER the bearer is accepted, so `/mcp` and `/sse` both answer 401
  without a token. Only a real token — or the gateway log — distinguishes them.
- **Editing the backend in the console rewrites the entry path, and a typo is
  fatal but silent.** On 2026-09-08 a save left
  `http://opensearch22mcp-server…` (missing hyphen; the service is
  `opensearch-mcp-server`) and discovery died with
  `dial tcp: lookup … no such host` while the console still showed the previously
  discovered tools. **The tool list in the console can be stale cache** — the log
  says so explicitly: `keeping the N tools already discovered`.

## All apps registered on this gateway today (verified 2026-09-08)

| App | Type | Backend | Status |
| --- | --- | --- | --- |
| `opensearch22` | MCP Server (subdomain) | `http://opensearch-mcp-server.ping-devops-curtismuir.svc.cluster.local/mcp` | Working end-to-end 2026-09-08 — client path `/opensearch22/mcp` (calls logged 200/202/200 after the `/mcp` re-registration) |
| `opensearch` | MCP Server (subdomain) | same, older duplicate registration | Working — 9 tools |
| `pingone-mcp-server-2` | MCP Server (subdomain) | unrelated, pre-existing app kept for its own purpose | Not part of this demo — see the note below, this is NOT the demo's PingOne MCP |
| `mcp-brave-search` | Catalog sidecar | Privilege's own `mcp/brave-search:1.0.0` image, reaching our `mcp-brave` sidecar via the mesh | Working after the 2026-09-07 gateway restart (was stuck in a "Tenant not found" registration retry loop) |
| `mcp-grafana` | Catalog sidecar | Privilege's own `mcp/grafana:1.0.0` image → our `mcp-grafana` sidecar via the mesh | Working after the same restart |
| `openapi2` | OpenAPI MCP | Privilege's own `mcp/openapi:latest` image → our `mcp-banking-rest` sidecar via the mesh → AI-DEMO2's `mcp-resource-server` in `ping-devops-cmuir` | **Never discovers tools, and cannot from our side** — the `openapi:latest` image is not discoverable by Privilege's own runtime. Root cause and the replacement (`banking-mcp`) under "The banking door" below |

**`pingone-mcp-server-2` is not the demo's PingOne MCP — do not go looking for a
backend behind it.** The name invites the assumption and the table above has been
read that way at least once, costing a session's work: someone concluded the demo
had no working PingOne MCP, went looking for one in `ping-devops-cmuir` and
`ping-devops-curtismuir` (neither has one), and started building a replacement
that already existed.

The demo's PingOne MCP is the **`mcp-pingone`** sidecar
(`ghcr.io/curtismu7/ai-demo-mcp-pingone`), which wraps PingOne's own MCP server
behind a stdio-to-HTTP bridge. It arrives with PR #2913 and is absent from the
table above only because that PR is unmerged — add its row when it lands.

One measured constraint from that work, worth knowing before anyone designs
around it: the gateway does **not** relay MCP elicitation, so PingOne's
interactive device-code prompt never reaches a human and a caller arriving
through the gateway hangs on "Waiting for authorization..." forever
(measured 2026-09-07).

### Two registration mechanisms, and why "localhost" shows up in the console

**Plain "MCP Server" apps** (`opensearch22`, `opensearch`) get their own
subdomain and a directly-editable backend URL — the `/mcp`-not-`/sse` rule
above applies to these.

**Catalog and OpenAPI-MCP apps** (`mcp-brave-search`, `mcp-grafana`,
`openapi2`) work completely differently, and the console's "localhost"
fields are not a mistake: Privilege runs its **own** adapter image
(`public.ecr.aws/n2z2g8w6/mcp/...`) somewhere in its own infrastructure, and
that adapter's `localhost:<port>` is tunneled through the mesh back to *this
gateway's own registered node* — i.e. to a sidecar running in the
`agentless-mcpgw` pod itself (`extraContainers` in the Helm chart, see the
skill). That is the entire reason these three run as sidecars in this pod at
all: "apps added from the Privilege catalog pin their backend to
`http://localhost:8080/mcp` and that field is not editable" (see
`demo_mcp_grafana/server.js`'s own header comment). Confirmed live 2026-09-07
by reading each app's actual saved config off the gateway pod's disk
(`/procyon/ssl/app-containers/*.json` inside the `agentless-mcpgw` container —
this is the ground truth, not the console's field styling, which is
indistinguishable between a real value and a placeholder at a glance).

**The port has to match the actual sidecar, and nothing checks that for you.**
`banking-rest2` shipped with `OPENAPIMCP_ENDPOINT=http://localhost:8081` (our
`mcp-grafana` sidecar's port) while its own `OPENAPIMCP_SPEC_URL` correctly
used `:8082` (`mcp-banking-rest`'s port) — a copy-paste-from-the-grafana-app
bug. Fixed by editing the app in the console to `http://localhost:8082`.

**Do not confuse the two "resource server" deployments.** AI-DEMO2's own
`demo_mcp_resource_server` runs as the `mcp-resource-server` service in
**`ping-devops-cmuir`** (part of the full app stack) and is the one with the
banking-rest OpenAPI feature (PR #2861). A separate, unrelated handoff project
(`curtismu7/mcp-resource-server`, a different GitHub repo entirely, config-driven
verticals, only 3 PRs) runs as `mcp-config-standalone-mcp-resource-server` in
**`ping-devops-curtismuir`** — same-looking name, same port (8081), zero
banking-rest code. `mcp-banking-rest`'s `BANKING_UPSTREAM_URL` must point at
the `ping-devops-cmuir` one:
`http://mcp-resource-server.ping-devops-cmuir.svc.cluster.local:8081`. Pointing
it at the local `curtismuir` one (an easy mistake — it's same-namespace as the
gateway, which looks like the "tidier" choice) 404s on every real route.

### The banking door: `banking-rest2` → `openapi2`

`banking-rest2` was **deleted** on 2026-09-08 and re-created from scratch as
`openapi2` (same Mesh Cluster, same sidecar, same spec). Anything still naming
`banking-rest2` is stale — its client URL now 404s. `mcpProfileStore.js`'s
`built-in-privilege-mcp` profile was repointed at `/openapi2/mcp`; the profile
**id** deliberately did not change, because `routes/mcpPrivilegeAuth.js`'s
post-login redirect deep-links to it.

Two settings on this app type that cost hours, both verified live:

- **`OPENAPIMCP_ENDPOINT` takes no `/mcp` suffix.** The adapter appends the
  spec's own paths to it, so `http://localhost:8082` + `/banking` is the real
  call. With `/mcp` on the end you get `…/mcp/banking`, which 404s. (The `/mcp`
  convention belongs to the catalog apps — Brave, Grafana — which really do
  speak MCP JSON-RPC at that path.)
- **The console's "Backend Name" field is not this setting** and does not sync
  with it. Only the `Configuration` block (`OPENAPIMCP_*`) drives behaviour;
  "Backend Name" sat at a stale `http://localhost:8080/mcp` the whole time the
  live config was correct. Read the app-container JSON on the pod, not the form.

**`openapi2` never discovers tools, and the cause is Privilege's image, not our
response — settled 2026-09-08 evening.** The gateway itself is healthy
(`LinkStatus:Active`, certs valid, enrollment PVC intact), the config on the pod
is correct, and our side was proven good by running the **identical** adapter
image (`public.ecr.aws/n2z2g8w6/mcp/openapi:latest`) with the identical config
against the identical sidecar by hand: it mints 5 tools (`list_banking_accounts`,
`get_banking_account`, plus the three discovery-mode tools).

The differential is the image itself. Every working catalog image is fronted by
Privilege's own `mcp-shim` (`mcp-shim listening on 0.0.0.0:8080, child:
[mcp-grafana]`) and answers `GET /mcp -> 200`; `openapi:latest` is a bare Go
binary built on `NewStreamableHTTPHandler` — `GET /mcp -> 405`, `GET /sse ->
404`, no transport or listen switch in its entire env surface (`ENDPOINT`,
`SPEC_URL`, `SPEC_PATH`, `SPEC_INLINE`, `TOOL_MODE`, `HEADER_DENYLIST`), and
`latest` is the only tag published. Privilege's runtime cannot discover its own
openapi image. **Raise with Ping; nothing in the console or this repo changes
it.** Also: absence of gateway log lines for this app proves nothing —
`mcp-grafana` and `mcp-brave-search`, both working, log zero lines too, because
catalog adapters run in Privilege's infrastructure and this pod only provides
the mesh tunnel.

**The replacement: `banking-mcp`, a plain MCP Server app on our own
`mcp-resource-server`.** PR #2891 built that server's legacy transport "so this
server could be registered as a native MCP Server Agentic App", and it needs no
shim: measured from inside the gateway pod, a tokenless `POST /mcp initialize`
answers 200 (`protocolVersion 2025-11-25`) and `tools/list` returns 33 tools
including both banking tools — which is exactly the discovery this gateway build
performs. Register it in the console as:

| Field | Value |
|---|---|
| Application type | MCP Server |
| Application Name | `banking-mcp` |
| MCP Server URL | `http://mcp-resource-server.ping-devops-cmuir.svc.cluster.local:8081/mcp` |
| Auth Mode | None (discovery is tokenless by that server's design) |
| Mesh Cluster | `ai-demo-cmuir` |

`/mcp`, not `/sse` — that server answers `GET /mcp -> 404`, so an `/sse`
registration would hand the gateway a path it cannot POST to. Check the hostname
character by character; it is a cross-namespace FQDN (`cmuir`, not
`curtismuir`), the same shape `opensearch22` uses. `mcpFacade.js`'s `agentless`
door and the "Privilege — banking" preset default to this app name.

**What this does and does not unblock.** Tools appear, so a policy can be
authored — the blocker all day. `tools/call` is a separate matter: the server
exempts only `initialize`/`tools/list` from its bearer gate, and the banking
tools require scope `banking:read`, a **user** scope that reaches this server via
the BFF's RFC 8693 exchange (`docs/TOKEN_FLOW.md`), not a scope any client can
hold on a machine token. Its validator is the demo env's JWKS (`01d89b06…`) with
accepted audiences `mcp-invest.ping.demo`, `mcp-resource-server.ping.demo`,
`mcpgateway.ping.demo`. A Privilege-forwarded user token has the wrong issuer,
Static Token is parsed as a JWT (see PRIVILEGE-MCP.md) and short-lived, so calls
through this door will answer `insufficient_scope` until the backend hop gets a
real design — most likely Auth Mode OAuth pointed at the demo env with
`banking:read` made client-grantable. The door also exposes all 33 tools;
narrow it with Privilege policy.

**Two leads recorded here previously are now closed — do not re-chase them:**

- **The console's `401` on `/api/<tenant>/v1/github-account` is irrelevant.**
  Settled by reading the console's own JS bundle
  (`https://local.procyon.ai:8643/ui/static/js/main.*.js`): the Tools panel
  renders from the app object in `applicationList`
  (`ye = Array.isArray(ge?.Tools) ? ge.Tools : []`), not from any API call.
  `github-account` appears only in `switch($.Spec.AppType){case "github":}` — a
  PAM resource type fetched eagerly and unrelated. An empty Tools panel means the
  controller genuinely has no Tools for the app.
- **`has same NodeURL` and mesh-controller `not found` are cosmetic** — the
  `privilege-mcpgw-agent-k8s` skill says so, and a session was lost to it.
  Success in the log is `LinkStatus:Active`.

The Mac agent's device cert being rejected by Ping's regional proxy
(`remote error: tls: unknown certificate`) is still open, but its control-plane
connection reports READY so it is likely data-plane only and unrelated.

The three checks that `opensearch22` taught us still apply to **any** plain MCP
Server app, `banking-mcp` included: confirm the backend hostname resolves from
inside the gateway pod (a one-character typo cost an hour); confirm the entry
path the gateway actually pins is `/mcp`; then check whether a policy exists AND
has not expired.

**The packaged chart `.tgz` goes stale silently.** See
`.claude/skills/privilege-mcpgw-agent-k8s/SKILL.md`'s "packaged `.tgz` goes
stale silently" section — a 16-day-stale `.tgz` dropped all three sidecars and
the GHCR pull secret from a live `helm upgrade` on 2026-09-07, while
`helm get values` kept reporting them as present. Always upgrade against the
chart source directory, or repackage after every template/values edit.

## Which PingOne identity is which (settled 2026-09-08)

Three different things get confused here, and every one of them cost time. All
values below were measured, not inferred.

| | Tenant | Client | Purpose |
|---|---|---|---|
| **Gateway OIDC** | `0428ba4f…` (Privilege) | `1a403855…` | The gateway signs users in with this. Lives in secret `agentless-mcpgw-oidc-config`, key `pingone.env`. **This is what `PRIVILEGE_SSO_CLIENT_ID` / `PRIVILEGE_SSO_ENV_ID` must be set to.** |
| **Console API** | `0428ba4f…` (Privilege) | none — an `auth_token` cookie | Lists Agentic Apps and `pacpolicys`. Set `PRIVILEGE_CONSOLE_ENV_ID`; it is a **separate variable** because `PRIVILEGE_SSO_ENV_ID` is paired with a client id. |
| **Banking worker** | `01d89b06…` (demo) | `6586d3de…` (`PINGONE_MCP_GATEWAY_*`) | `client_credentials` for `aud=mcpserver.ping.demo`. What `privilegeMcpSimple.js` needs. |

Facts that settle arguments:

- **`a6219652…` is NOT a PingOne app.** It 404s in `01d89b06` and its credentials
  fail `invalid_client` in both tenants. It is the Privilege **service** client
  (never rotate it — that kills console sign-in permanently) and it does not
  belong in `PRIVILEGE_SSO_*`, where it sat until 2026-09-08 and produced a bare
  `code: NOT_FOUND` PingOne page whenever anything fell back to it.
- **`invalid_client` vs `unauthorized_client` is the differential.** The latter
  means PingOne **accepted** the secret and refused only the grant type — the
  correct answer for `1a403855`, which is an authorization_code web app. See
  `docs/vault.md`.
- **The vault is authoritative for `PRIVILEGE_SSO_CLIENT_SECRET`**, and
  `k8s/create-secrets.sh` refuses to deploy if `.env` holds a different non-empty
  value. Write the vault, then match or blank the `.env` line — never the reverse.
- **The gateway federates into the demo's own tenant, so there is no double
  login.** Measured chain: `0428ba4f/as/authorize` →
  `0428ba4f/rp/authenticate?providerId=122422d9…` →
  `01d89b06/as/authorize` (client `fa486771…`, "Demo AI App - Privilege Tenant
  Federation") → `01d89b06` sign-on. No `prompt=login`, no `max_age`. One login,
  at the demo's own tenant. **k8s namespaces are irrelevant to any of this** —
  `ping-devops-curtismuir` holds no identity config at all.

## Doors that are deliberately dark

`mcpFacade.js`'s `agentless` (banking) door still points at torn-down
infrastructure — `PRIVILEGE_AGENTLESS_MCPGW_URL_BANKING` is still
`https://cmuir-agentless-mcpgw.ping-devops.com/external/mcp`, a host deleted on
2026-09-01, so it fails `ENOTFOUND`. `openapi2` (above) is its replacement, but
the BFF's own facade config has not been repointed at it and no policy has been
authored on the app. See the 2026-09-01 entry in
[`../TECH_DEBT.md`](../TECH_DEBT.md) for the remaining steps.

A dead door used to be **much** harder to diagnose than that: with no reachable
door there is no RFC 9728 challenge, `discoverAuth()` fell through to its PingOne
branch, and the browser landed on a bare `code: NOT_FOUND` page naming neither
the door nor the client. Fixed 2026-09-08 — a door on the app's own
`PUBLIC_APP_URL` origin now errors by name instead, because those doors always
self-advertise and PingOne is never their AS.

Two façade traps fixed the same day, worth knowing if either resurfaces:

- **The façade's own doors are unreachable from inside the BFF unless
  `MCP_FACADE_HTTP_PORT` is set.** `toInternalMcpUrl()` rewrites every own-origin
  door to `http://localhost:3002` (deliberately — the HTTPS listener uses mkcert
  certs a self-call would have to trust), but `server.js` only starts that
  listener when the variable is set. compose set it; k8s did not, so on any
  cluster deploy every Direct and Façade door failed `fetch failed`. External
  clients were unaffected, since they arrive over the ingress.
- **The façade resolves the gateway entry path per app** (`privilegeEntryPath`),
  overridable with `MCP_FACADE_PRIVILEGE_GATEWAY_PATHS` as `app:path` pairs —
  because the path follows a console edit, not a release.

The `agent` and `agent-cmuir` (agent-mode) doors were **removed** 2026-09-05.
They hung rather than failing fast: their `*.applications.procyon.ai:8643`
frontends still resolve through the Priv Agent's DNS proxy while nothing serves
the mesh port. Restoring agent mode needs inbound mesh exposure this chart does
not ship; the live client path is the `privilege-gateway` door.

Historical investigation and product reference material remains indexed in
[`PRIVILEGE-MCP.md`](PRIVILEGE-MCP.md); `AGENTLESS-CONFIGURATION.md` and
`AGENT-CONFIGURATION.md` describe the retired two-gateway split and are kept for
history only. Dated files do not override this index or the skill.

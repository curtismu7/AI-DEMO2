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
| `openapi2` | OpenAPI MCP | Privilege's own `mcp/openapi:latest` image → our `mcp-banking-rest` sidecar via the mesh → AI-DEMO2's `mcp-resource-server` in `ping-devops-cmuir` | **Never discovers tools** — Privilege runs that image on its side and it is the only catalog image shipped without Ping's `mcp-shim`. Retire it: we now run the same binary ourselves as the `mcp-openapi-banking` sidecar, to be registered as an **MCP Server** app. See "The banking door" below |

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
it.** (Superseded in part on 2026-09-09 — we no longer depend on
Ping fixing it; see "Self-hosting Ping's OpenAPI adapter" below.) Also: absence of gateway log lines for this app proves nothing —
`mcp-grafana` and `mcp-brave-search`, both working, log zero lines too, because
catalog adapters run in Privilege's infrastructure and this pod only provides
the mesh tunnel.

### Self-hosting Ping's OpenAPI adapter (2026-09-09)

`openapi2` fails because of how Privilege *packages* the adapter, not because
the adapter is broken. Measured today against both published tags:

| Image | Entrypoint | `GET /mcp` | `POST /mcp initialize` |
|---|---|---|---|
| `mcp/grafana:1.0.0` (works) | `sh -c "mcp-shim --port=${PORT} -- mcp-grafana"` | 200 | 200 |
| `mcp/openapi:latest` | `/openapimcp` — no shim | 405 | 200 |
| `mcp/openapi:dev` | `/openapimcp` — no shim | 405 | 200 |

`dev` was published after 2026-09-08, so "`latest` is the only tag" is no longer
true — but it is byte-for-byte the same packaging and the same behaviour, so
Ping has not fixed this. The binary is fine: run by hand it answers `initialize`
and mints `list_banking_accounts`, `get_banking_account` and the three discovery
tools. It simply declines `GET`, which the streamable-HTTP spec allows, since
that stream is optional.

That matters because **this gateway discovers by POSTing `initialize`** — its own
words in `/var/log/procyon/cyonproxy.log`: `Error discovering MCP server: calling
"initialize": sending "initialize": ...`, attempted over both `/mcp` and `/sse`.
That machinery runs for **MCP Server** apps only; container apps (`mcp-grafana`,
`mcp-brave-search`, `openapi2`) get no local frontend/backend/authz node and no
discovery line at all, because Privilege runs and discovers those on its side.
Which is why no amount of reading this pod's logs will ever explain `openapi2`.

So: run Ping's own `openapimcp` ourselves and register it as an MCP Server app,
the same shape as `pingone-admin-local` (`http://localhost:8083/mcp`).
`sidecars.values.yaml` gained `mcp-openapi-banking` on **8080**, and `mcp-brave`
moved 8080 → 8084 to make room — safe, because no Agentic App addresses that
sidecar and the gateway log references no `localhost:8080`.

**That move was not actually necessary.** `openapimcp` honours the standard
`PORT` env var (`PORT=9999` → `listening on :9999/mcp`); it is simply absent
from the documented `OPENAPIMCP_*` surface, so the first reading of its config
concluded the port was fixed at 8080. The adapter could have taken 8085 and left
`mcp-brave` alone. It is left as-is because the Agentic App is registered against
`http://localhost:8080/mcp`, and re-pointing it costs a console edit for no
functional gain.

Register it in the console as:

| Field | Value |
|---|---|
| Application type | MCP Server |
| Application Name | `banking-openapi` |
| MCP Server URL | `http://localhost:8080/mcp` |
| Auth Mode | None |
| Mesh Cluster | `ai-demo-cmuir` |

Two traps carried over: the readiness probe must be `tcpSocket`, not `httpGet`
(kubelet scores the adapter's honest `405` as a failed probe), and
`OPENAPIMCP_ENDPOINT` still takes **no** `/mcp` suffix.

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
| Auth Mode | None — see "The call hop is a platform blocker" below; OAuth was tried first and made things worse, not better |
| AI Gateway | `ai-demo-cmuir — https://mcpgw.ai-demo.ping-devops.com` — a field the console does not always default; an app saved with the `Select Gateway…` placeholder never reaches any node and produces zero gateway-log activity, indistinguishable from a silent create failure |
| Mesh Cluster | `ai-demo-cmuir` |

`/mcp`, not `/sse` — that server answers `GET /mcp -> 404`, so an `/sse`
registration would hand the gateway a path it cannot POST to. Check the hostname
character by character; it is a cross-namespace FQDN (`cmuir`, not
`curtismuir`), the same shape `opensearch22` uses. `mcpFacade.js`'s `agentless`
door and the "Privilege — banking" preset default to this app name.

The repo-side half of the design (2026-09-08) is real and shipped in PR #2995:
the two banking tools required `banking:read`, a scope that exists in no
PingOne resource and nowhere in `scope-topology.json` —
`scripts/check-tool-scope-registration.js` had carried both as known-bad
declarations, exempt only while unrouted. They now require `read`, the
topology's scope for banking reads (same as the gateway's `get_my_accounts`),
and a sub-less machine token (no `sub` claim) resolves to the seed subject
`demo-user` in `bankingToolHandler.ts` instead of throwing on the undefined
SQLite binding. Both are verified by request-level tests
(`demo_mcp_resource_server/tests/httpMcp.test.ts`, `bankingTools.test.ts`) and
hold regardless of what happens below.

**The call hop is a platform blocker, not a config gap.** The original plan —
Auth Mode OAuth, with the gateway using `Demo AI App - Fraud Watch Agent`'s
credentials (`read` on `mcpgateway.ping.demo`, its only grant) to authenticate
the backend hop — turned out to rest on a false premise, measured live on
2026-09-09 against the actual public door
(`https://mcpgw.ai-demo.ping-devops.com/banking-mcp/mcp`), not from inside the
gateway pod:

1. **Auth Mode OAuth gates the client, not just the backend.** With Auth Mode
   set to OAuth, even a tokenless `initialize` — discovery — 401s: `Bearer
   token required`, `WWW-Authenticate: realm="MCP OAuth Server"`. The console's
   own Tools panel read Empty for the same reason; its discovery probe hit the
   same wall. This contradicts the skill note and PRIVILEGE-MCP.md's own
   earlier reading that Auth Mode is upstream-only ("not how clients are
   challenged") — true for `Static Token`, false for `OAuth` on this gateway
   build.
2. **The gateway's own `/banking-mcp/token` endpoint rejects the PingOne
   credentials entered in the console form.** `POST .../banking-mcp/token`
   with Fraud Watch Agent's real client_id/secret (client_secret_post — basic
   auth gets `invalid_client`) returns `401 Invalid client credentials`. The
   OAuth fields in the wizard are not consumed as a client the gateway
   authenticates *with*; DCR is the only client-facing path the gateway
   advertises (`authorization_uri`/`token_uri` in its own 401 body).
3. **Reverting Auth Mode to None does not help either.** A real PingOne
   `client_credentials` token was minted for Fraud Watch Agent
   (`aud: mcpgateway.ping.demo`, `scope: read`, correctly signed, unexpired)
   and sent as the bearer on both `initialize` and `tools/call
   list_banking_accounts`. Both still 401. The gateway's own log
   (`agentless-mcpgw`, container `agentless-mcpgw`, pod
   `agentless-mcpgw-*` in `ping-devops-curtismuir` — read with
   `kubectl logs --all-containers`, **not** `-c agentless-mcpgw`, which
   returned nothing despite being the right container name) shows why:

   ```text
   level=warning msg="[mcpgw] auth rejected: reason=token_not_found app=banking-mcp method=POST path=/banking-mcp/mcp"
   ```

   `token_not_found` is a lookup against the gateway's own internal token
   registry, not a JWT/JWKS validation failure — no externally-minted token,
   PingOne or otherwise, can ever satisfy it regardless of signature,
   audience, or scope correctness.
4. **No door in this repo has ever actually cleared this gate.** The
   `banking-mcp`/`opensearch22` "tokenless discovery" measurements this
   document previously cited were taken from inside the gateway pod (a raw
   probe against the backend or an internal port), not through the public
   HTTPS URL a real caller uses — confirmed by checking `mcpFacade.js`'s own
   default (`privilegeGatewayBase()` is literally
   `https://mcpgw.ai-demo.ping-devops.com`, the same URL that just failed).
   The one row in `PRIVILEGE-MCP.md` marked "verified end to end" via a
   machine token (`/api/privilege-mcp-simple`) targets `mcp-server:8080`
   directly over mTLS — it bypasses Privilege's gateway entirely and never
   exercised this wall.

This reproduces, on gateway build `v1.260906`, the exact `infra-root-jwt`
signer wall `PRIVILEGE-MCP.md` documented months ago on an older build and
marked "raised with Ping; not fixable from the console or this repo": the
front door trusts only a token it minted or a console session, never a
PingOne-issued JWKS-signed token.

**Where this leaves the door:** discovery works and a policy can be authored
(33 tools visible, `banking-mcp` on Auth Mode None, AI Gateway
`ai-demo-cmuir` — reselect it if it reverts to the `Select Gateway…`
placeholder, which happens on some edits). `tools/call` is blocked at the
gateway's public entry point for any caller, ours or otherwise, and is not
fixable from this repo or the console. Raised as an open item for Ping; do
not re-attempt "mint a scoped bearer ourselves" as a fix — it is now
disproven, not just unverified.

A second app, `bankingmcp` (no hyphen), was created by mistake while chasing
this — Application Name is not editable after creation, so the attempted
rename created a duplicate instead of renaming in place. It is not referenced
by any code in this repo (`BANKING_GATEWAY_APP` defaults to `banking-mcp`) and
is safe to delete from the console as cleanup; harmless if left.

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

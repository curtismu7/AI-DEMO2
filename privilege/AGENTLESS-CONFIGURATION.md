# PingOne Privilege MCP: Agentless configuration

Verified 2026-08-20 against the live `ping-devops-cmuir` deployment. This is the
operational source of truth for Agentless mode.

## 2026-09-06 — Banking REST added as an OpenAPI MCP app (`banking-rest`), as a pod sidecar

| Item | Value |
|---|---|
| Privilege application type | **Add OpenAPI MCP** (not the MCP Server catalog tile — this app takes a REST API Endpoint + OpenAPI Spec URL directly, no JSON-RPC/SSE handshake) |
| Privilege application | `banking-rest` |
| Mesh Cluster | `ai-demo-cmuir — https://mcpgw.ai-demo.ping-devops.com` |
| REST API Endpoint | `http://localhost:8082` |
| OpenAPI Spec URL | `http://localhost:8082/openapi/banking-rest.json` |
| Auth Mode | None — the sidecar attaches the real `X-API-Key` itself, Privilege never sees it |
| Server | `demo_mcp_banking_rest/`, image `ghcr.io/curtismu7/ai-demo-mcp-banking-rest:latest` |
| Runs as | `extraContainers` sidecar `mcp-banking-rest` in the `agentless-mcpgw` pod (`ping-devops-curtismuir`), port 8082 (8080=mcp-brave, 8081=mcp-grafana) |
| Upstream | `http://mcp-resource-server.ping-devops-cmuir.svc.cluster.local:8081` — the real `demo_mcp_resource_server`'s `GET /banking`, `/banking/:id`, `/openapi/banking-rest.json` (see `demo_mcp_resource_server/src/index.ts`, PR #2861) |
| Key | k8s Secret `banking-rest-secrets` / key `BANKING_API_KEY`, in the **gateway's** namespace — must equal `MCP_RESOURCE_SERVER_API_KEY` set directly on the `mcp-resource-server` Deployment in `ping-devops-cmuir` (that service has no dedicated `.env`-backed k8s Secret, so this is a plain `kubectl set env`, not the create-secrets.sh pipeline) |

Verified live end-to-end 2026-09-06: `wget` from inside the `mcp-banking-rest`
container to its own `http://127.0.0.1:8082/banking` returned the real seeded
accounts (`acct-001`/`002`/`003`), proving sidecar → in-cluster DNS → real
mcp-resource-server → API-key auth all work together.

### Same sidecar mechanics as `mcp-grafana`, different app type

This app is an **OpenAPI MCP** app, not an **MCP Server** catalog app — Privilege
translates OpenAPI-described REST calls into MCP tools on its own side, so the
sidecar just has to BE the REST API the spec describes. No SSE discovery probe,
no JSON-RPC `initialize`/`tools/list` handshake like `demo_mcp_grafana`/
`demo_mcp_brave` implement — `demo_mcp_banking_rest/server.js` is a ~90-line
plain HTTP GET proxy.

The reachability constraint is identical to the catalog apps though: the
console's Mesh Cluster field still ties the app to one gateway pod, and this
pod can only reach `localhost:<port>` for a manually-registered backend the
same way a catalog app's fixed default does — confirmed by trying the real
in-cluster Service DNS name first (`mcp-resource-server.ping-devops-cmuir...`)
directly as the REST API Endpoint and finding no ingress/route makes it
reachable from the gateway pod's namespace by any other means. Proxying
through a `localhost` sidecar was the only working path, exactly as it was
for Grafana.

### `extraContainers` is a list — the patch must carry every sidecar

Same trap as documented below for `mcp-grafana`: `helm upgrade --reuse-values`
replaces `extraContainers` wholesale. Adding banking meant re-supplying
`mcp-brave` and `mcp-grafana` verbatim (pulled fresh via `helm get values
agentless-mcpgw -o yaml` immediately before the upgrade, not retyped from
memory or from this repo's checked-in `values.yaml` example — that file's
`extraContainers: []` is illustrative only and does not reflect the live
release) alongside the new `mcp-banking-rest` block. Confirmed with a
container count after: pod went 5/5, not 3/5.

```bash
helm --kube-context us -n ping-devops-curtismuir upgrade agentless-mcpgw \
  pingone-privgateway-helm-main/agentless/agentless-mcpgw \
  --reuse-values -f <patch>.yaml
```

### `mcp-resource-server` needed its own fixed key first

Unlike Grafana (whose token already lived in a real k8s Secret), the SE
cluster's `mcp-resource-server` Deployment had never been given a fixed
`MCP_RESOURCE_SERVER_API_KEY` — without one it generates a random ephemeral
key on every restart (logged as a warning, the value itself never printed),
which no sidecar could ever know. Fixed with a plain `kubectl set env` on that
one Deployment (not the `create-secrets.sh`/vault pipeline, which doesn't
manage a secret for this service at all) — the same value then went into the
gateway-namespace `banking-rest-secrets` Secret the sidecar reads from.

**Trap that cost time:** `kubectl set env KEY="$(cat file)"` truncates
differently than the file itself — command substitution strips the trailing
newline `openssl rand -hex 24 > file` leaves behind, but `kubectl create
secret generic --from-file=KEY=file` does NOT strip it. Setting the Deployment
env var from the file via `$(cat ...)` and the sidecar's Secret via
`--from-file` from the *same* file produces two different values that look
identical printed, and every proxied call 401s as `api_key_invalid` with no
other symptom. Fix: write a byte-exact, newline-free copy of the key
(`printf '%s' "$(cat file)" > file2`) and build both the env var and the
Secret from the same newline-free source.

## 2026-09-06 — Grafana added from the MCP catalog (`mcp-grafana`), as a pod sidecar

| Item | Value |
|---|---|
| Privilege application | `mcp-grafana` (created from the console's **Add Grafana** catalog wizard) |
| MCP client URL | `https://mcpgw.ai-demo.ping-devops.com/mcp-grafana/mcp` |
| AI Gateway | `ai-demo-cmuir — https://mcpgw.ai-demo.ping-devops.com` |
| Backend Name | `http://localhost:8081/mcp` — edited off the 8080 default, see below |
| Auth Mode | None |
| Server | `demo_mcp_grafana/`, image `ghcr.io/curtismu7/ai-demo-mcp-grafana:latest` |
| Runs as | `extraContainers` sidecar `mcp-grafana` in the `agentless-mcpgw` pod (`ping-devops-curtismuir`) |
| Upstream Grafana | `http://grafana.ping-devops-cmuir.svc.cluster.local:3000` |
| Token | k8s Secret `grafana-secrets` / key `GRAFANA_SERVICE_ACCOUNT_TOKEN`, in the **gateway's** namespace |

Verified live: 6 dashboards, 4 datasources (Alertmanager, Jaeger, Loki,
Prometheus), and the "MCP Servers" dashboard's 7 panels.

### Creating the app in the console configures nothing that runs

The catalog wizard collects `GRAFANA_URL` and `GRAFANA_SERVICE_ACCOUNT_TOKEN`
and shows them under **Configuration** on the app — but **those values never
reach the server.** They stay on the app record. The connector is a container
*you* run as a sidecar in the gateway pod, and it reads its own env from the
Helm release. `mcp-brave` is the same story: its key comes from the
`brave-secrets` Secret, not from anything typed into the console. So the URL
lives in two places and only the Helm one does anything; rotating the token
means updating the **Secret**, not the console field.

The Secret must exist in the **gateway's** namespace (`ping-devops-curtismuir`),
which is not the namespace Grafana itself runs in (`ping-devops-cmuir`).

### The backend port collides, and the field IS editable

A catalog app's Backend Name defaults to `http://localhost:8080/mcp` — the
gateway reaches its sidecar over pod loopback, which is why an ordinary
in-cluster Service cannot serve one of these apps. `mcp-brave` already held
8080, and containers in a pod share one network namespace, so the second
connector cannot bind it. Left alone, `mcp-grafana` would have resolved to
**Brave** and come back with Brave's tool list — populated, and wrong.

**Backend Name is editable via Edit on the app** (proven 2026-09-06). An earlier
note in the chart's `values.yaml` said it was locked; acting on that would mean
standing up a whole second gateway for nothing. Setting it to `:8081` and giving
the sidecar `PORT=8081` is the entire fix.

### `extraContainers` is a list — `--reuse-values` deletes what you omit

```bash
helm --kube-context us -n ping-devops-curtismuir upgrade agentless-mcpgw \
  pingone-privgateway-helm-main/agentless/agentless-mcpgw \
  --reuse-values -f <patch>.yaml
```

Helm replaces a list wholesale rather than merging it, so the patch has to carry
**every** sidecar you intend to keep. A patch naming only `mcp-grafana` silently
removes `mcp-brave` and kills the Brave door. Confirm with a container count: the
pod goes 3/4 containers, not 4/4.

### Testing traps

- `grafana.ping-devops-cmuir.svc.cluster.local` is cluster-internal DNS. It does
  not resolve from a laptop, so curling it from your Mac proves nothing. Test it
  from inside the gateway pod (`kubectl exec … -c log-tailer -- wget -qO-
  http://grafana.ping-devops-cmuir.svc.cluster.local:3000/api/health` → 200).
- Grafana **service accounts require Admin**, and this deployment pins every
  PingOne SSO user to Viewer (`GF_AUTH_GENERIC_OAUTH_ROLE_ATTRIBUTE_PATH:
  'Viewer'`). Create the token signed in through the **local admin form**, not SSO.
- The gateway only probes the backend when the console triggers discovery
  (the app's refresh control). Until then "Tools" stays empty and the gateway log
  shows no discovery attempt — that is not a failure.

### Building the image

All 27 cluster nodes are Graviton, so the image is `linux/arm64` (as is
`ai-demo-mcp-brave`); an amd64 build crash-loops with an exec format error.

```bash
docker buildx build --platform linux/arm64 --build-arg GIT_SHA=$(git rev-parse --short HEAD) \
  -t ghcr.io/curtismu7/ai-demo-mcp-grafana:latest --push demo_mcp_grafana
```

Deliberately **not** wired into `se-update-code.sh`: that path needs matching
entries in five cross-checked maps plus a compose service and a k8s Deployment,
none of which a sidecar-only image has. `mcp-brave` is in there because it also
runs standalone for the Agent Gateway/IG path; this connector never does.

## 2026-08-24 — banking flow verified end-to-end through a second application (`external`)

A second Agentless application, `external`, was created on the same gateway
deployment to route the banking-demo external-door flow (`oauth-mcp`'s
`mcp-server`, the same backend `docs/superpowers/plans/2026-08-23-external-door-token-chain-bridge.md`
covers) through Privilege — separate from `cmuir`, which stays pointed at
`pingone-mcp-server-2` for its own purpose. **Confirmed working, live, real
data**, end to end for the first time: real PingOne login as `demoUser` →
Privilege OAuth (PKCE, DCR) → policy-enforced RBAC → routed to
`mcp-server` → `get_my_accounts` returned real account data, schema-valid.

| Item | Value |
|---|---|
| Privilege application | `external` |
| MCP client URL | `https://cmuir-agentless-mcpgw.ping-devops.com/external/mcp` |
| Backend (MCP Server URL) | `http://mcp-server.ping-devops-cmuir.svc.cluster.local:8080/mcp` |
| Mesh cluster | `ai-demo-cmuir` (same gateway/node as `cmuir`) |
| Auth Mode | Static Token, empty (matches `mcp-server`'s `MCP_AUTH_DISABLED=true`, `MCP_MTLS_ENABLED` unset) |

### Bug found and fixed: the gateway's own `pingone.env` had every OIDC field empty

This is the actual, real root cause of every "unauthorized"/broken-login
symptom hit while wiring this up — **not** a reappearance of the historical
"PingOne token wall" documented in the `privilege-cloud-mcp` skill (see that
skill's "Read this first" section — item 0 already says OAuth is run with the
AI Gateway in the field; the skill's own memory note now flags the "token
wall" table as stale as of this date).

`kubectl get secret agentless-mcpgw-oidc-config -n ping-devops-cmuir -o
jsonpath='{.data.pingone\.env}' | base64 -d` showed:

```text
SERVER_URL=https://cmuir-agentless-mcpgw.ping-devops.com
OIDC_CLIENT_ID=
OIDC_CLIENT_SECRET=
OIDC_AUTH_URL=
OIDC_TOKEN_URL=
OIDC_USER_URL=
OIDC_SCOPES=openid profile email p1:read:env p1:read:user p1:read:application
```

Every OIDC field was blank. `GET /external/authorize` correctly built a
redirect, but with `client_id=` empty — the gateway had no PingOne client to
send the browser to, so the OAuth flow could never start. Fixed by populating
the same fields the BFF already uses for its own `PRIVILEGE_SSO_*` config
(same PingOne application, `a6219652-47af-4ed2-8dea-20e9940b3377`, per the
"Current deployment" table above):

```text
OIDC_CLIENT_ID=a6219652-47af-4ed2-8dea-20e9940b3377
OIDC_CLIENT_SECRET=<from PingOne app a6219652's secret, or ai-demo-secrets' PRIVILEGE_SSO_CLIENT_SECRET>
OIDC_AUTH_URL=https://auth.pingone.com/01d89b06-66d5-430e-9f28-65636843788b/as/authorize
OIDC_TOKEN_URL=https://auth.pingone.com/01d89b06-66d5-430e-9f28-65636843788b/as/token
OIDC_USER_URL=https://auth.pingone.com/01d89b06-66d5-430e-9f28-65636843788b/as/userinfo
```

Apply via `kubectl create secret generic agentless-mcpgw-oidc-config -n
ping-devops-cmuir --from-file=pingone.env=<file> --dry-run=client -o yaml |
kubectl apply -f -`, then `kubectl rollout restart deployment/agentless-mcpgw
-n ping-devops-cmuir` — the binary reads this file eagerly at startup (see
the `privilege-cloud-mcp` skill's item 6), it is not hot-reloaded.

**If `cmuir` also shows this same empty-OIDC symptom, it shares this secret**
(one `pingone.env` per gateway deployment, not per application) and is
already fixed by the same change — there is nothing app-specific to redo.

### Dead end: an app created outside "Add Application → MCP Server" gets no working route

A first attempt created an app named `http-external` by editing/reusing an
existing object rather than through the console's dedicated "Add Application
→ MCP Server" flow. Its backend URL saved correctly and its Graph
backend/frontend nodes synced fine (`kubectl logs ... -c log-tailer | grep
"Created backend node"` showed successful re-syncs on every edit), but every
request to `/http-external/mcp` failed with:

```text
[mcpgw] app http-external not found or has no FrontEndName, falling back to synthesized host: application not found: Application/<env>/default/http-external
Finding frontend for domain http-external.default.applications.procyon.ai
Domain http-external.default.applications.procyon.ai not found: Domain not found
```

This is a **different internal object** from the Graph backend/frontend
nodes that did resync — `mcpgw`'s own `Application` lookup (with its
`FrontEndName` field) never got populated for this app, and re-saving in the
console did not fix it. Deleting `http-external` and creating a fresh
application through "Agentic Apps → Add Application → MCP Server" (named
`external`) worked immediately with no other changes. If a new app's routing
fails the same way, don't debug the Graph nodes — recreate the app through
the dedicated MCP Server creation flow instead of editing/repurposing an
existing object.

### MCP Inspector-specific: `tools/list` hangs through this gateway, `curl` does not — root cause confirmed

Once auth and routing both worked, MCP Inspector's UI showed "Couldn't load
tools — Request timed out" — but `curl` issuing the identical `tools/list`
call (same session ID, same bearer token, fresh connection) returned
`HTTP/2 200` with the full tool catalog in well under a second, and a
follow-up `tools/call` for `get_my_accounts` likewise succeeded instantly.
The gateway's own logs showed **zero** trace of Inspector's `tools/list`
request ever arriving — not a policy denial, not a filter-processing hang,
nothing.

**Confirmed root cause, verified against our own BFF client's code**
(`demo_api_server/routes/privilegeMcpClient.js`'s `fetchMcp`): our BFF issues
every MCP message — `initialize`, `notifications/initialized`, `tools/list`,
`tools/call` — as an independent, standalone `fetch()` POST that reads the
whole response body and returns; it never opens a persistent `GET /mcp`
stream. `curl`'s working calls match this exact shape (fresh connection,
POST, read full response). MCP Inspector implements the *fuller* Streamable
HTTP transport: after `initialize` it opens a long-lived `GET /mcp` with
`Accept: text/event-stream` for server-pushed messages, and sends later
calls as separate POSTs over that same session while the GET stream stays
open — spec-legal MCP behavior, just a harder case. `mcpgw` runs its own
response-rewriting `mcpfilter` layer on streamed channels (per-request
`X-Procyon-Mcp-Cap` capability headers); the working theory is that layer
doesn't handle a concurrent POST arriving while it's already holding a
stream open on the same session, and that's a real gap in the vendor's
proxy — not a bug in the banking flow, `mcp-server`, or Privilege's policy
enforcement, all confirmed correct via `curl`.

**This is why the BFF's own Privilege MCP client (`/privilege-mcp-client`,
"Agentless gateway — banking (external)" preset, see "Demo client
configuration" below) works today where MCP Inspector doesn't** — not
because it's smarter, but because its simpler transport happens to avoid
the exact case that trips up this proxy. If this needs a working
browser-based demo before the transport gap above is understood/fixed on
the vendor side, use the BFF's own client or drive `curl`/Postman for the
live proof — not MCP Inspector.

**Open follow-up, not yet done:** try upgrading the BFF's `fetchMcp` to the
fuller Streamable HTTP pattern (persistent SSE GET alongside POSTs) behind a
flag, to see whether it reproduces the same hang — that would confirm the
theory definitively and tell us whether a real fix exists on our side (e.g.
a retry/reconnect) versus something only the vendor can fix. Needs a safe
fallback to the current known-working POST-only mode if the fuller pattern
does turn out to break, since this is the client tonight's fix intends to be
the primary external-client demo path going forward.

## What Agentless means

The MCP client connects directly to customer-owned DNS and TLS. The gateway runs
the OAuth/PKCE flow, validates the resulting access token, applies Privilege policy,
and proxies allowed MCP calls to the backend registered on the `cmuir` application.

Agentless mode requires an OIDC client. It does not use the installed Privilege
Agent and must not inherit Agent-mode settings.

## Current deployment

| Item | Current value |
|---|---|
| Kubernetes context | `us` |
| Namespace | `ping-devops-cmuir` |
| Helm release/chart | `agentless-mcpgw` / `agentless-mcpgw-0.1.0` |
| Mesh cluster | `ai-demo-cmuir` |
| Active node | `bf42a9fd-d2e8-461e-bee3-16aacfa18ebf` |
| Gateway hostname | `cmuir-agentless-mcpgw.ping-devops.com` |
| Privilege application | `cmuir` |
| MCP client URL | `https://cmuir-agentless-mcpgw.ping-devops.com/cmuir/mcp` |
| OIDC environment | `01d89b06-66d5-430e-9f28-65636843788b` |
| OIDC client ID | `a6219652-47af-4ed2-8dea-20e9940b3377` |
| OIDC callback | `https://cmuir-agentless-mcpgw.ping-devops.com/callback` |
| Console callback | `https://callback.login.privilege.pingone.com/oidc/callback` |
| Gateway version | `v1.260729` |
| Gateway image | `public.ecr.aws/s7q1z8z4/privilege-mcpgw@sha256:0faad5903a5bd72539b1df525e3c7bc5d458a5bd324aac9755b8af99dfa6647d` |

The public route is:

```text
MCP client
  -> HTTPS cmuir-agentless-mcpgw.ping-devops.com/cmuir/mcp
  -> ingress-nginx
  -> service agentless-mcpgw:8623
  -> privilege-mcpgw
  -> backend registered on Privilege application cmuir
```

The backend URL is not the client URL. Do not put a Kubernetes
`svc.cluster.local` backend address into Postman. The current `cmuir` Agentless
application is not OpenSearch; OpenSearch belongs to Agent mode.

## PingOne OIDC application

Create an OIDC Web App for the gateway with:

- Authorization Code flow
- Client Secret Basic
- PKCE `S256`
- scopes `openid profile email` plus any required environment/user/application
  read scopes used by the deployment
- redirect URI `https://cmuir-agentless-mcpgw.ping-devops.com/callback`

The Privilege console login application also needs
`https://callback.login.privilege.pingone.com/oidc/callback`. Do not keep unrelated
or obsolete callback URLs unless another deployed application still uses them.

## Gateway enrollment token

Generate the token from Privilege console > Gateways > Add New > Add via Docker.
Before installation, validate the JWT payload without printing the token:

- `clusterID` must be `ai-demo-cmuir`
- `nodeType` must be `PrivateProxy`
- the token must have exactly three JWT segments
- the raw value must contain no whitespace or characters outside the JWT alphabet
- `exp` must still be in the future for first enrollment

Store the token only in Kubernetes Secret `agentless-mcpgw-secret`, key
`ENV_PROXY_TOKEN`. Never commit it or put it into a checked-in values file. Once
the pod is enrolled and verified, remove the local plaintext token file.

## Privilege application and policy

In AI Security > Agentic Apps, configure:

- Application name: `cmuir`
- Mesh cluster: `ai-demo-cmuir`
- MCP Server URL: the backend service intended for this Agentless use case
- policy: publish the required tools and bind the intended user or group
- recording/approval: enable according to the demo policy

The gateway derives the client route from the application name:
`/<application-name>/mcp`, therefore this deployment uses `/cmuir/mcp`.

## Demo client configuration

The BFF owns OAuth tokens and implements MCP Streamable HTTP. Agentless settings
are stored independently in `gatewayConfigs.agentless`.

```text
gatewayMode: agentless
mcpUrl: https://cmuir-agentless-mcpgw.ping-devops.com/cmuir/mcp
clientId: a6219652-47af-4ed2-8dea-20e9940b3377
scopes: openid profile email
```

Agentless mode shows the Privilege sign-in control. It may use the existing main
demo PingOne browser session for silent `prompt=none` authentication.

`PRIVILEGE_AGENTLESS_MCPGW_URL` is the preferred BFF environment variable;
`PRIVILEGE_MCPGW_URL` remains a compatibility fallback. `pingone.env` belongs to
the Agentless gateway only.

## Postman

Create an MCP request with transport **HTTP** and URL:

```text
https://cmuir-agentless-mcpgw.ping-devops.com/cmuir/mcp
```

Let Postman complete the OAuth flow advertised by the gateway. Use `/mcp`, not
`/sse`. `/sse` may be a backend transport on some applications, but it is not this
Streamable HTTP client URL.

## Verification

```bash
kubectl get deploy agentless-mcpgw -n ping-devops-cmuir
kubectl get pod -l app=agentless-mcpgw -n ping-devops-cmuir \
  -o jsonpath='{.items[0].status.containerStatuses[0].imageID}'

curl -i -X POST \
  https://cmuir-agentless-mcpgw.ping-devops.com/cmuir/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"probe","version":"1.0.0"}}}'
```

Expected tokenless result: HTTP `401` advertising protected-resource metadata and
`/cmuir/authorize`. After OAuth, the client must perform `initialize`,
`notifications/initialized`, `tools/list`, and `tools/call`, preserving
`MCP-Session-Id` and negotiated protocol headers.

⚠️ **A tokenless `401` does NOT prove the application path is right.** An earlier
revision of this section said "a plain `404` means the application path is wrong";
that is false on this binary. Measured 2026-08-31 — invented app names answer
identically to real ones:

```text
/cmuir/mcp     401      /opensearch/mcp  401
/external/mcp  401      /mcp/mcp         401   <- no such application
/banking/mcp   401      /admin/mcp       401   <- no such application
```

The bearer check runs *before* application resolution, so the challenge is emitted
for any path. This is the same trap the `privilege-cloud-mcp` skill records for
`cyonproxy` ("tokenless 401 proves nothing"), and it means **the doors cannot be
enumerated by probing** — only a request carrying a token exercises routing. To
list the real applications, read the console API (below).

## Listing applications and policies (console API)

The BFF exposes this at `/api/privilege-mcp/console/*`, behind the Policies tab of
`/privilege-mcp-client`. Two facts settle how it authenticates, both probed live
2026-08-31:

```text
GET  https://console.privilege.pingone.com/session-token      (no cookie)  -> 200 {"session_id":"<uuid>"}
GET  .../api/<envId>/v1/pacpolicys       (junk auth_token, valid session id) -> 401 "User is not authorized"
```

So `x-procyon-session-id` is a **correlation id, not a credential** — anyone can
mint one, and the BFF does. Its *absence* is what produces the misleading
`400 Procyon required header is missing`, which is raised before the token is
examined at all. The only real credential is the `auth_token` cookie from a console
browser session (~60 min), which has to be pasted; there is no programmatic way to
obtain it.

| Endpoint | Returns |
|---|---|
| `/api/<envId>/v1/applications?ObjectMeta.Namespace=default` | the doors — `ObjectMeta.Name` is the `/<name>/mcp` route; `Spec.McpAppConfig` (**not** `MCPAppConfig`) carries `Backends`, `FrontEndName`, `EntryPath` |
| `/api/<envId>/v1/pacpolicys` | the grants — `PacPolicys` \| `Items` \| `items`; each has `ObjectMeta.Name` and an **undocumented** `Spec` |

Because `Spec` is undocumented, do not parse it. Compare against whole string
values inside it, never substrings: the door `cmuir` is a substring of the
principal `cmuir+demo@pingone.com`, so a naive `includes()` reports every policy as
covering every door.

## A policy denial is silent

The gateway answers a denied `tools/list` with a bare `403 Forbidden` — no JSON, no
policy name, no user id, `www-authenticate: null` — and writes **nothing** to
`/var/log/procyon/cyonproxy.log`. Verified 2026-08-31: zero log lines in the window
of a reproduced denial. Contrast Agent mode, which returns
`403 User <id> doesn't have access to MCP app <name>`.

So nothing can name the denying policy on this path. The client page instead shows
the door, the identity, the verbatim upstream error, any policies that *mention*
that door, and a live probe of the other doors with the same token — which is how
you tell a missing grant from a request aimed at the wrong door.

## Known cleanup

Old `ai-demo-mine` and `asdf` records may appear with the same public address.
They are stale Privilege control-plane registrations, not additional Kubernetes
deployments. Do not generate another token to hide them. Remove them through the
Privilege console/API when deletion is available.

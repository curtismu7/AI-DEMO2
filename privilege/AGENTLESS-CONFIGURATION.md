# PingOne Privilege MCP: Agentless configuration

Verified 2026-08-20 against the live `ping-devops-cmuir` deployment. This is the
operational source of truth for Agentless mode.

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
`/cmuir/authorize`. A plain `404` means the application path is wrong. After OAuth,
the client must perform `initialize`, `notifications/initialized`, `tools/list`, and
`tools/call`, preserving `MCP-Session-Id` and negotiated protocol headers.

## Known cleanup

Old `ai-demo-mine` and `asdf` records may appear with the same public address.
They are stale Privilege control-plane registrations, not additional Kubernetes
deployments. Do not generate another token to hide them. Remove them through the
Privilege console/API when deletion is available.

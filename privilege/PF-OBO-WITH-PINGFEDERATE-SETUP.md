# Setting up OBO (on-behalf-of) with PingFederate in Privilege

A setup guide for the full chain: a user signs in to PingFederate, PingFederate issues a
token on behalf of that user for an AI agent, the agent presents the token to a PingOne
Privilege gateway (P1 Privilege Agent App), and Privilege governs what the agent may do
while keeping the user and the agent distinct.

Written 2026-11-11; OBO path verified end to end 2026-11-13. Builds on two measured docs in
this directory:
[`PF-TOKEN-EXCHANGE-PASS-AGENT-TOKEN.md`](PF-TOKEN-EXCHANGE-PASS-AGENT-TOKEN.md) (the
verified autonomous-agent path and the working configuration) and
[`PF-TOKEN-ON-PRIVILEGE-STATUS.md`](PF-TOKEN-ON-PRIVILEGE-STATUS.md) (status and restart
checklist). Claims are tagged:

- **[verified]** — reproduced live on our tenant.
- **[ping]** — stated by Ping engineers; not verified here.
- **[expected]** — our reading; not tested.

## 1. What OBO means here

Three principals on every call:

| Principal | Where it lives in the token |
|---|---|
| The **user** (human, signed in via PingFederate SSO) | `sub` |
| The **agent** (the AI actor calling on the user's behalf) | `act.sub` (RFC 8693 actor claim) |
| The **client** making the token request | `client_id` |

The token is produced by a PingFederate **token exchange** (RFC 8693): the client presents a
subject token that carries the user (an OIDC ID token or refresh token) and PingFederate
mints an access token with `sub` = user, `act.sub` = agent, audience = the Privilege agent
app, and the scopes the user's grant allows.

> **Terminology:** the Privilege console currently calls the trusting-issuer object a
> **Non-Human Identity** (NHI). Ping's 2026-11 release notes rename it **Federated Identity**.
> This guide uses the console's labels.

## 2. Architecture

```
User ──SSO──► PingFederate ──subject token──► Client/agent
                                               │ token exchange (grant_type=token-exchange)
                                               ▼
                                    PF access token
                                    sub = user, act.sub = agent
                                    aud = <agent app URL>
                                               │ Bearer
                                               ▼
                              Privilege gateway  ── verifies iss/JWKS, aud,
                              (P1 Privilege         required claims, lifetime
                               Agent App)           ── checks the key's grant (tools)
                                               │ Pass Agent Token
                                               ▼
                                     MCP backend (verifies the same token)
```

## 3. Prerequisites

1. **PingFederate 13.1+** running, admin access (console or admin API). If standing one up,
   see the `pingfederate-install` skill and the SE ID-JAG guide at
   `.claude/skills/pingfederate-id-jag/references/PingFederate-IDJAG-SE-Guide.html`.
2. **Privilege gateway `privilege-aigw:v1.261024` or later.** Earlier versions cannot
   discover tools on a Pass Agent Token agent app. [verified]
3. The MCP backend is reachable from **every** gateway pod (Service + network policies).
4. Access to both consoles: PingFederate admin and the Privilege console.
5. The user who will be impersonated exists in the PingFederate identity store (or is
   federated into it).

## 4. PingFederate: the token side

### 4.1 Client

Create an OAuth client for the agent with these grants enabled:

- **Token Exchange** (`urn:ietf:params:oauth:grant-type:token-exchange`) — for the OBO
  exchange itself.
- **Authorization Code** — if the client first signs the user in to get a subject token.
- **Client Credentials** — only if you also want an autonomous-agent variant (see
  `PF-TOKEN-EXCHANGE-PASS-AGENT-TOKEN.md` part A).

### 4.2 Token processor + processor policy

The subject token (what proves the user) is exchanged for the OBO access token:

1. **Authentication → Token Exchange → Token Processor.** Depending on your subject token:
   - *OAuth Refresh Token Token Processor* if the client holds a refresh token for the user.
     Extended-contract attribute names must match the persistent-grant attribute names
     exactly, including case.
   - *JWT Token Processor 2.0* if the client holds an OIDC ID token from the SSO sign-in.
     Set the issuer and JWKS; `aud` and `exp` are validated by default, so the allowed
     audiences must include the client that received the ID token.
2. **Applications → Token Exchange → Processor Policy.** Map the processor as the subject
   token processor. Subject token type is `urn:ietf:params:oauth:token-type:refresh_token`
   or `urn:ietf:params:oauth:token-type:id_token` respectively. Fulfil the attribute
   contract and add issuance criteria as needed.

### 4.3 Access token manager (the OBO token itself)

Create a **JWT** token manager (clone an existing JWT one; unique Key ID):

| Setting | Value |
|---|---|
| Audience claim value | the agent app URL, e.g. `https://<gateway-host>/<agent-app>/mcp` [verified] |
| Resource URIs | the same agent app URL [verified] |
| Scope Claim Name | `scope` (default). Do **not** add `scope` to the attribute contract — the manager writes the granted scopes itself [verified] |
| Lifetime | short; the NHI's max-lifetime check rejects longer tokens (gateway default 3600 s) |

**Access token mapping** for the token-exchange context on that manager — this is what makes
the token OBO-shaped:

- `sub` ← the **subject token's** subject (the user)
- `act` ← expression producing an **object**, e.g. `#{"sub": "<agent-id>"}`. It must be a
  JSON object; the text `"{}"` will not work and the gateway rejects the token with
  `required claim "act.sub" does not match`. [verified]
- `client_id` ← Context: ClientId (the agent's client)

### 4.4 Scopes

Define on the authorization server every scope your policies will use (e.g. `mcp`,
`opensearch:read`, `opensearch:search`). Restrict the client's allowed scopes to what the
agent should be able to request.

**Scope-check gotcha [verified on PF 13.1.3]:** processor-policy issuance criteria see the
*original grant's* scope, not the `scope` parameter on the exchange request. A client can
request an exchange scope its grant never had and PF still mints the token with it. The
boundaries that do hold: the client allowlist caps scopes at grant time, and the resource AS
(including Privilege's `RequiredClaims` scope rules) rejects anything undefined at
redemption. Never phrase the demo as "the exchange can't exceed the grant" — say "the grant
is capped by policy, and anything else dies at redemption".

### 4.5 Always pin the token manager (`audience`, formerly `resource`)

**Every token request must pin the manager with `audience=<agent app URL>`.** Without it, a
request that names a scope can be served by a different (default) token manager — we got a
token with audience `enduser.ping.demo` and no `sub`/`act`, and the gateway answered 401
`token_not_found`. [verified]

**2026-11-13, PF 13.1.3: send `audience=`, not `resource=`.** The JWT access-token manager
no longer carries a Resource URIs table, so `resource=` fails with `invalid_target`
("The specified resource(s) did not match any access token manager"); `audience=` matches
through the token-exchange SP connection and works for both the client-credentials and the
exchange request. [verified] The pinning rule itself is unchanged.

## 5. Privilege: the identity (NHI)

Console: **Non-Human Identities → Register Identity**.

| Field | Value | Why |
|---|---|---|
| Token issuer type | OIDC Provider | |
| Issuer | exactly the PF token's `iss` | exact match |
| Key source | Fetch from URL; JWKS URL = PF's JWKS (e.g. `https://<pf-host>/pf/JWKS`) | gateway fetches and refreshes keys |
| Subject (sub) | `*` (Allow any subject on) | the user varies; the agent is pinned by required claims instead [verified] |
| End user in a presented token | **Resolved** if the user exists in Privilege (shows the user in audit logs, enables per-user model rules); **Opaque** with claim `sub` otherwise | |
| Audience | the agent app URL — the same value PF puts in `aud` | no wildcard; an exact-match agent app URL is proven to work [verified]. Ping's guidance: the audience must include the gateway [ping] |
| Required claims | `act.sub` = `<agent id>` and `client_id` = `<client id>` | accepts only this agent acting on behalf of users [verified] |
| Max token lifetime | e.g. 7200 s (0 = gateway default 3600) | self-minting workloads pick their own `exp` |
| Permissions / scopes | `mcp` (add `llm`/`a2a` only if needed) | least privilege |

If the console refuses with *"Spec.UserClaim resolves to \"sub\" … every caller reads as the
same end user"*: the subject is pinned while the end user claim reads `sub`. Widen Subject to
`*` + Allow any subject and pin the agent with the required claims instead. [verified]

## 6. Privilege: the agent app (P1 Privilege Agent App)

Console: **Agentic Apps → Add Application → MCP Server**.

1. **MCP Server URL:** a backend address that resolves from every gateway pod, ending in
   exactly `/mcp`. A URL saved as `…/mc` gave 404 with gateway log
   `outside entry path "/mc"` — the gateway splits the URL path off as the entry path.
   [verified]
2. **Auth Mode: Pass Agent Token.** The gateway forwards the *verified PF token unchanged* to
   the backend — proven with a `whoami` tool that reported every claim it received.
   [verified]. Consequence: the backend must itself trust the PF issuer/JWKS and accept the
   audience. Also: the gateway cannot down-scope the forwarded token — a down-scoped token
   needs a token exchange in front of the gateway.
3. **Mesh cluster:** the one your gateway pods serve.
4. Tool discovery happens automatically on the first accepted agent call (gateway
   v1.261024+). Before that the Overview reads "Awaiting first agent call - tools will be
   discovered from a forwarded assertion". A refused first call still triggers discovery.

## 7. Privilege: the agent key and its grant

Console: **Agent Registry → Add Agent**.

1. **Custodian:** the NHI from section 5. Scope: `mcp`.
2. **Gateway & Apps:** select the agent app from section 6. Selecting it is the grant —
   saving auto-creates a `pacpolicys` policy tied to this key.
3. **Tool access:** select the tools per agent app (none selected = every tool; per-tool
   hiding works).
4. Finish and save.

**Rules that cost us hours [verified]:**

- **Do not `POST` a new separate grant policy through the API.** Every such policy was
  deleted by the gateway within 11–80 s (`RDP terminate: policy deleted`). Edit the key's
  existing console-made grant instead (console tool-access screen, or a `PUT` of that policy
  object).
- Do **not** press **Sync** after saving the grant — it did not populate tools and may
  reconcile policies.
- Changes take ~4 minutes to reach the gateway for app/policy edits; don't re-test sooner.
- Keys and grants expire — check the "Ends in N days" before a demo.

### Optional: tools by scope (tiers)

Two rules for the same app in the key's grant, each with `RequiredClaims` on `scope`, give
different tool lists per token scope [verified]:

```json
{ "Capabilities": { "Map": { "tools": { "Elems": ["ListIndexTool", "SearchIndexTool"] } } },
  "RequiredClaims": { "Map": { "scope": { "Elems": ["opensearch:read"] } } } }
```

A value list means any-of; each scope in the token is matched individually; dotted claim
paths work (`act.sub`). Remove a condition by deleting the `RequiredClaims` field (a PUT with
`{"Map": {}}` is ignored).

### Optional: Cedar policy on token scopes

Cedar reads the token's scopes as `context.token.scopes` (other claims, including
`act.sub`, are not in Cedar yet — `context.token.claims` is coming in a later release
[ping]):

```cedar
@reason("SearchIndexTool needs the opensearch:search scope in the agent's token")
forbid (principal, action == Action::"mcp:Invoke", resource == Tool::"SearchIndexTool")
when   { context.app == "<agent app>" }
unless { context has token && context.token.scopes.contains("opensearch:search") };
```

**Make the policy Active.** An API-created AI policy has `State: ""` — compiled and logged
but never enforced. Use the console's **Enforce** button or a `PUT` with `"State": "Active"`.
[verified]

## 8. First call and test

1. Mint the OBO token (the user's subject token + the exchange):

```bash
curl -s https://<pf-host>/as/token.oauth2 -u "<client id>:$CLIENT_SECRET" \
  -d grant_type="urn:ietf:params:oauth:grant-type:token-exchange" \
  -d requested_token_type="urn:ietf:params:oauth:token-type:access_token" \
  -d subject_token="$SUBJECT_TOKEN" \
  -d subject_token_type="urn:ietf:params:oauth:token-type:id_token" \
  -d "audience=https://<gateway-host>/<agent-app>/mcp" \
  -d "audience=https://<gateway-host>/<agent-app>/mcp" \
  -d "scope=mcp"
```

2. Decode the payload (`cut -d. -f2 | base64 -d`) and check `iss`, `sub` (user), `aud`,
   `client_id`, `act.sub` (agent), `scope`, and `exp - iat` against the NHI *before* blaming
   Privilege.
3. Call the agent app:

```bash
curl -s https://<gateway-host>/<agent-app>/mcp \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Expected: the first call may be refused on policy but triggers tool discovery; the second
returns 200 with the tools. A garbage bearer always gets 401.

### Reading refusals

| Client sees | Gateway log | Cause / fix |
|---|---|---|
| 401 `Bearer token required` | `workload token rejected: <reason>` (or no workload line at all) | issuer, audience, required claim, lifetime, or the wrong PF token manager (`token_not_found` → missing `resource`) |
| 401, required-claim error | `required claim "act.sub" does not match` | `act` was emitted as text, not an object; fix the PF mapping |
| bare 403 Forbidden | `policy denied <NHI> access to <app> (agent=true)` | no grant rule for the key on this app — edit the key's existing grant |
| 403 Forbidden | nothing denied, grant present | no tier's `RequiredClaims` matched the token's scopes |
| 404 | `outside entry path "/mc"` | the agent app's MCP Server URL must end in exactly `/mcp` |
| 200 with empty body | `Domain … not found` | stale gateway node — restart the pod, not an auth problem |
| tools stay empty | `tool discovery … failed: no such host` | backend URL doesn't resolve from the gateway pods |

The gateway logs the request only on the pod that served it — search all pods
(`kubectl logs <pod> --all-containers`) and grep for `workload token|policy denied|tool
discovery|auth rejected`.

## 9. What is verified vs. open

| Item | Status |
|---|---|
| Autonomous-agent shape (PF client-credentials token, agent in `sub`) accepted end to end, tools listed, passthrough proven, scope tiers, Cedar scope block | **verified** (2026-10-26/27, gateway v1.261024+) |
| OBO shape (`sub` = user, `act.sub` = agent) accepted end to end: user sign-in (pi.flow, `demouser`) → id token → RFC 8693 exchange → gateway accepts (`workload token accepted for key pftoken-agent subject=demouser`) → `tools/list` 200 with tools → passthrough proven (`pftoken-rs` `whoami` reports `sub=demouser`, `act.sub=pf-route-c-test`) | **verified** (2026-11-13) |
| Per-MCP audience in production | our exact-match agent-app-URL audience was accepted [verified]; Ping's guidance is gateway-scoped audience, allow-list on request [ping] — open |
| Down-scoping the forwarded token | **not supported** — needs a token exchange in front of the gateway |

## 9.1 What it took (differences from the sections above) — 2026-11-13

Everything above held except four things the sections above get wrong or omit:

1. **The subject token is an OIDC ID token, not a refresh token.** PF's refresh-token
   processor validates the token against the client that received it, so a refresh token
   minted for `ai-demo-pf-user` is refused at `pf-route-c-test` (`unknown, invalid, or
   expired refresh token`). The JWT processor accepts the id token once its Allowed Issuers
   carry the PF **public** issuer (`https://cmuir-pf.ping-devops.com` — not the internal
   `https://local.ping-devops.com:9031` it lists by default) and Allowed Audiences carry
   `ai-demo-pf-user`.
2. **The exchange's `audience`/`resource` must match a token-exchange SP connection.**
   Without an SP whose `resourceUris` contains the door URL, PF answers `invalid_target`
   ("audience value is invalid") and, without `resource` at all,
   `Unable to find ATM, token generation policy instance or SP connection to issue
   [access_token]`. Section 4.3/4.5 describe this as an ATM property; on PF 13.1.3 it is
   the SP connection (`aiDemoPfPrivilegeOboSp`, `idJagEnabled: true`, policy mapping).
3. **The ATM must sign with a published key.** "Use Centralized Signing Key" fails with 422
   ("not a valid selection") and its key is NOT in `/pf/JWKS` — the gateway refreshed the
   JWKS and still refused: `workload token rejected: signature does not verify against any
   known key`. Use the per-ATM certificate with a **unique Key ID** (`…-routec`; PF rejects
   a Key ID already used by another ATM) and **Publish Keys to the PingFederate JWKS
   Endpoint = true**.
4. **The Privilege grant's scope tiers gate the tools.** The `pftoken` rules require
   `opensearch:read` / `opensearch:admin`; a token with only `scope=mcp` is accepted
   ("workload token accepted") then denied on policy (403). The exchange must request
   `scope=mcp opensearch:read` (and `whoami:read` for the `pftoken-rs` `whoami` call), and
   the client allowlist + AS scope list must carry them.

The whole PF side is scripted: `scripts/pingfederate/provision-pf-obo-privilege.js`
(idempotent, dry run by default, `--apply`). It restores everything PF-side after a PF
rebuild; the Privilege side (NHI `PFtoken`, key `pftoken-agent`, doors) survived and needed
nothing. The BFF needs `PF_TOKEN_DEMO_CLIENT_SECRET` (the vault secret the script creates)
in its environment; `GET /api/pf-token-demo/state` reports `configured: false` when absent.

One-off test transcript (2026-11-13): pi.flow sign-in as `demouser` on `ai-demo-pf-user`
(PKCE + `response_mode=pi.flow` → `checkUsernamePassword` → `authorizeResponse.code` →
token endpoint returns `id_token`), then the exchange above → claims `sub=demouser`,
`act.sub=pf-route-c-test`, `aud=<door>`, `scope=mcp opensearch:read` → `tools/list` 200
(three tools per the read tier) → `whoami` at `pftoken-rs` verified and reported every
claim. Gateway log lines: `workload token accepted for key pftoken-agent
issuer=https://cmuir-pf.ping-devops.com subject=demouser`, no `policy denied`.

Before a customer demo of the OBO shape: re-run the provision script (`--apply` is a no-op
when in place), then one exchange with a real user subject token and one `tools/list` —
see section 9.1 for the exact transcript from 2026-11-13.

## 10. Related

- [`PF-TOKEN-EXCHANGE-PASS-AGENT-TOKEN.md`](PF-TOKEN-EXCHANGE-PASS-AGENT-TOKEN.md) — the
  measured autonomous-agent variant, full working configuration, and troubleshooting table.
- [`PF-CLAIMS-IN-CEDAR-POLICIES.md`](PF-CLAIMS-IN-CEDAR-POLICIES.md) — claims and Cedar.
- [`WORKLOAD-IDENTITY-AGENT-CALLERS.md`](WORKLOAD-IDENTITY-AGENT-CALLERS.md) — workload
  identity callers.
- The `pingfederate-id-jag` skill — ID-JAG (cross-app access) variant and SE guide.
- The `privilege-nhi-setup` skill — refusal table, lifecycle, rotation.

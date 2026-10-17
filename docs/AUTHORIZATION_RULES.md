# Authorization Rules — AI Demo

> **Purpose:** Reference document for building and auditing PingOne authorization policies for this demo.
> Contains the real client IDs, resource server audiences, scope definitions, delegation rules, and HITL/step-up thresholds.
> Keep this file in sync with [`docs/PINGONE_CONFIG.md`](user-guide/PINGONE_CONFIG.md) and [`scope-topology.json`](../scope-topology.json).

---

## Environment

| Key | Value |
|---|---|
| Environment ID | `01d89b06-66d5-430e-9f28-65636843788b` |
| Region | `com` |
| Auth base | `https://auth.pingone.com/01d89b06-66d5-430e-9f28-65636843788b` |

---

## 1. Applications (Clients)

| Role | App Name | Client ID | Type | Token Auth Method | Grant Types |
|---|---|---|---|---|---|
| Admin browser login | Demo Admin App | `3937cbfd-8824-4f0d-adb2-178702fe9518` | WEB_APP | CLIENT_SECRET_POST | authorization_code, refresh_token, token_exchange |
| Customer browser login | Demo User App | `b7d00976-405f-4c55-914a-a3ebe8f369d8` | WEB_APP | CLIENT_SECRET_POST | authorization_code, refresh_token |
| AI Agent actor (RFC 8693) | Demo AI Agent | `d21c5124-8ac5-43d1-81f2-31a7ec649b96` | WEB_APP | CLIENT_SECRET_POST | authorization_code, client_credentials, token_exchange |
| MCP Gateway CC actor | Demo MCP Gateway | `3fc5ec99-48dd-42d2-b5fd-ec34055769d2` | WEB_APP | CLIENT_SECRET_POST | client_credentials, token_exchange |
| PingOne Management API | Demo Worker Token App | `15881ac7-4d83-4cbf-9ab0-4d7cda31fab8` | WORKER | CLIENT_SECRET_BASIC | client_credentials |
| Agent service (internal) | Demo Agent | `cf314c00-1fa8-470f-ab55-2ce58504e318` | WORKER | — | client_credentials |

> **Demo AI Agent packaging:** `WEB_APP` (not PingOne **AI Agents** product UI) is
> intentional — same CC + TE grants as the IDAI tutorial, stable client ID for the
> TE chain. See [`PINGONE_APP_CONFIG.md`](PINGONE_APP_CONFIG.md) §5.

### Redirect URIs

| App | Redirect URI |
|---|---|
| Demo Admin App | `https://api.ping.demo:4000/api/auth/oauth/callback` |
| Demo User App | `https://api.ping.demo:4000/api/auth/oauth/user/callback` |
| Demo AI Agent | `https://api.ping.demo:4000/api/auth/oauth/ai-agent-placeholder-callback` |

---

## 2. Resource Servers

| Role | Resource Name | Resource ID | Audience (`aud`) |
|---|---|---|---|
| User access token (BFF) | Demo API | `9b0f9ae4-463c-458e-9c5e-7e1dd8e6323d` | `enduser.ping.demo` |
| MCP Gateway token | Demo Agent Gateway | `ed88ddf3-065c-456b-a87b-4b44af85d33e` | `agentgateway.ping.demo` |
| MCP Gateway token | Demo MCP Gateway | `fb2d09cb-4f45-4c1a-abef-695fb0adfc86` | `mcpgateway.ping.demo` |
| MCP Server token | Demo MCP Server | `8fb4d1a8-3896-4a26-bf56-b678f2fcf15e` | `mcpserver.ping.demo` |

---

## 3. Scopes

### 3a. Demo API resource (`enduser.ping.demo`)

| Scope | Canonical Name | Purpose |
|---|---|---|
| `read` | BANKING_READ | Read own accounts and transactions |
| `write` | BANKING_WRITE | Deposits, withdrawals, transfers |
| `transfer` | — | Explicit transfer permission (see HITL rules) |
| `mortgage:read` | MORTGAGE_READ | Read mortgage data via MCP Gateway api_key disposition |
| `accounts:read` | ACCOUNTS_READ | Legacy compound scope (to be deprecated) |
| `transactions:read` | TRANSACTIONS_READ | Legacy compound scope (to be deprecated) |
| `ai_agent` | AI_AGENT_IDENTITY | Agent identity marker (OIDC scope) |
| `ai:agent:read` | AI_AGENT | AI agent identification (resource server scope) |
| `users:read` | — | Read user profiles |
| `users:manage` | — | Manage user profiles |
| `admin:read` | ADMIN | Admin read access |
| `admin:write` | — | Admin write access |
| `admin:delete` | — | Admin delete access |

### 3b. Demo Agent Gateway resource (`agentgateway.ping.demo`)

| Scope | Purpose |
|---|---|
| `agent:invoke` | Invoke agent capabilities |
| `banking:agent:invoke` | Banking-specific agent invocation |

### 3c. Demo MCP Gateway resource (`mcpgateway.ping.demo`)

| Scope | Purpose |
|---|---|
| `read` | Read via MCP |
| `write` | Write via MCP |
| `transfer` | Transfers via MCP |
| `mortgage:read` | Mortgage data via MCP |
| `mcp:invoke` | Invoke MCP tools |

### 3d. Demo MCP Server resource (`mcpserver.ping.demo`)

| Scope | Purpose |
|---|---|
| `read`, `write` | Core banking read/write |
| `mortgage:read` | Mortgage data |
| `mcp:invoke` | MCP tool invocation |
| `banking:read`, `banking:write` | Banking operations (prefixed form) |
| `banking:mcp:invoke` | Banking MCP invocation |
| `banking:mortgage:read` | Banking mortgage read |
| `ai:agent:read`, `banking:ai:agent:read` | Agent identification |
| `users:read`, `users:manage` | User management |
| `admin:read`, `admin:write`, `admin:delete` | Admin access |

---

## 4. User Type → Scope Assignments

| User Type | Granted Scopes |
|---|---|
| **admin** | `admin:read`, `read`, `write`, `sensitive:read`, `ai:agent:read` |
| **customer** | `read`, `write`, `ai:agent:read`, `mortgage:read` |
| **readonly** | `read` |
| **ai_agent** | `ai:agent:read`, `ai_agent`, `read`, `write`, `mortgage:read` |

### Admin role detection (4-signal check, in priority order)

1. Username allowlist (`admin_username` configStore key)
2. PingOne population ID (`admin_population_id` configStore key)
3. Custom token claim (`admin_role_claim` configStore key)
4. Existing session record

When `role === 'admin'` is set on `req.user`, all scope gates are bypassed.

---

## 5. Token Audience Rules

The BFF (`enduser.ping.demo`) validates the `aud` claim on every incoming token:

- **If `ENDUSER_AUDIENCE` is configured:** token must include `enduser.ping.demo` — fail-closed (missing `aud` = 401).
- **If not configured:** only the PingOne default `https://api.pingone.com` is accepted.
- Tokens issued for MCP, gateway, or other resource servers are **never** accepted by the BFF.

---

## 6. RFC 8693 Token Exchange Chain (Agent Delegation)

The demo implements a **two-hop** RFC 8693 chain. The BFF is the sole token custodian — the browser never holds a token.

```
User login (Demo User App b7d00976)
  └─ Issues T1: aud=enduser.ping.demo
               (no may_act by default; consent is a server-side grant record.
                Legacy ff_may_act_seed ON: may_act.sub=d21c5124, Demo AI Agent)

Exchange #1 — BFF performs:
  subject_token = T1 (user access token)
  actor_token   = Demo AI Agent CC token (d21c5124, aud=agentgateway.ping.demo)
  requested_audience = mcpgateway.ping.demo
  └─ Issues T2: aud=mcpgateway.ping.demo
               sub=<user>, act.sub=d21c5124

Exchange #2 — MCP Gateway performs:
  subject_token = T2
  actor_token   = Demo MCP Gateway CC token (3fc5ec99)
  requested_audience = mcpserver.ping.demo
  └─ Issues T3: aud=mcpserver.ping.demo
               sub=<user>, act.sub=3fc5ec99
```

### Consent and `may_act` (act-only model, PR #1443)

By default the user token has **no `may_act`**. The user's consent ("this agent may act for me") is a **server-side grant record** (`delegationStore`, `POST /api/agent-authorization/grant|revoke`), checked by the authorization policy on **every** tool call (Rule 2.6). Revoke denies the next call; no re-login. `act` is minted by PingOne from the actor token. See [ACT_ONLY_DELEGATION_MODEL.md](ACT_ONLY_DELEGATION_MODEL.md).

**Legacy only** (`ff_may_act_seed` ON, and PingOne AIC): `may_act` is the user's consent declaration on user access tokens (RFC 8693 §4.2) and seeds `act`. The rest of this section applies to that mode only.

In legacy mode the `may_act` claim is set on the **Demo API** resource token policy using PingOne SpEL.

| Resource | Attribute | SpEL Value |
|---|---|---|
| Demo API (`enduser.ping.demo`) | `may_act` | `#{'sub': 'd21c5124-8ac5-43d1-81f2-31a7ec649b96'}` |
| Demo MCP Server (`mcpserver.ping.demo`) | `may_act` | `#{'sub': 'd21c5124-8ac5-43d1-81f2-31a7ec649b96'}` |

> **Critical format note:** Value MUST be SpEL map literal `#{'sub': '...'}`.
> A JSON string like `{"sub":"..."}` causes double-encoding in the JWT and breaks RFC 8693 §4.1.
> `may_act.sub` MUST equal the Demo AI Agent client ID `d21c5124-8ac5-43d1-81f2-31a7ec649b96`.

---

## 7. BFF Middleware — Access Control Chain

Every protected BFF route runs through this chain in order:

```
authenticateToken          — validates PingOne JWKS signature + aud claim; sets req.user
  └─ requireAdmin          — role=admin OR scope=admin:read
  └─ requireScopes([...])  — scope gate (OR logic by default; AND if requireAll=true)
  └─ requireDelegation     — agent requests MUST carry act claim
  └─ requireNotBankDelegate — blocks delegates from write operations (see §9)
  └─ requireSession        — session cookie present (browser-only routes)
```

### Scope gate logic

- **OR logic (default):** user must have at least ONE of the required scopes.
- **AND logic:** pass `requireAll=true` — user must have ALL required scopes.
- `admin:read` scope **always bypasses** scope gates.
- `role === 'admin'` **always bypasses** scope gates.
- `ff_oidc_only_authorize = true` bypasses scope gates (demo feature flag — OIDC-only mode).

### Route → required scope map

| Route pattern | Required scope |
|---|---|
| `GET /api/accounts*` | `read` |
| `POST /api/accounts` | `write` |
| `GET /api/transactions*` | `read` |
| `POST /api/transactions/transfer` | `write` |
| `POST /api/transactions/deposit` | `write` |
| `POST /api/transactions/withdraw` | `write` |
| `GET /api/admin/*` | `admin:read` |
| `POST /api/admin/*` | `admin:read` |
| `GET /api/sensitive/*` | `sensitive:read` |

> **Note:** `GET /api/transactions/my` and `POST /api/transactions` intentionally have NO `requireScopes()` gate.
> Standard PingOne tokens without a custom resource server only carry OIDC scopes.
> These routes authenticate the caller but use row-level ownership checks instead.

---

## 8. MCP Tool Authorization Gate

Every call to `POST /api/mcp/tool` passes through `evaluateMcpFirstToolGate` — this gate is **always-on**, no feature flag.

The gate evaluates:
1. Token `aud` and scope sufficiency
2. Amount-based business rules (HITL and step-up)

**Decision source:** Either PingOne Authorize (production) or the simulated policy service (demo/education mode, `ff_authorize_real=false`).

### Simulated policy thresholds (configurable at runtime)

| Threshold | Config key | Default | Effect |
|---|---|---|---|
| Confirm (consent) | `SIMULATED_AUTHORIZE_CONFIRM_AMOUNT` | $250 | Requires human approval (HITL) |
| Step-up (MFA) | `SIMULATED_AUTHORIZE_STEPUP_AMOUNT` | $500 | Requires consent + MFA |
| Deny | `SIMULATED_AUTHORIZE_DENY_AMOUNT` | $2,000 | Hard deny |

### Per-tool rules

| Tool | Rule |
|---|---|
| `create_transfer` | **Always** requires HITL consent (regardless of amount) |
| `create_withdrawal` ≥ step-up threshold | Requires MFA + consent |
| `create_withdrawal` ≥ confirm threshold | Requires consent |
| `create_deposit` | Permit (no HITL) |
| Read tools | Permit |

After MFA step-up (`acr` looks strong), the consent gate is suppressed — no double-gate.

### Per-user consent enforcement (act-only model)

Agent-mediated tools additionally require the signed-in user's bridged consent (an active grant record for the acting agent) to match the acting agent — enforced identically on all three engines:

| Engine | Where | Escape hatch |
|---|---|---|
| Mock PDP (demo_authz_server) | `decision.js` Rule 2.6 (`no_user_consent` / `may_act_mismatch` denies) | `REQUIRE_USER_CONSENT=false` |
| BFF simulated engine | `simulatedAuthorizeService.js` consent guard (same two deny codes) | `REQUIRE_USER_CONSENT=false` |
| Cloud P1AZ policy | `UserConsentMissing` / `UserConsentMismatch` rules in the MCP Delegation policy | Import a snapshot generated with the rule (no runtime toggle) |

Carve-outs (all engines): A2A-delegated tools (the act chain is their authorization, Rule 1c) and named customer workload agents (`PINGONE_WORKLOAD_AGENT_CLIENT_IDS`, UC38/44 — their own identity authorizes them). The consent value is bridged per call via `X-May-Act-Sub`: the agent client id when the user has an active grant record, empty otherwise (`services/agentConsent.js` `consentSub`); in legacy mode it falls back to the session's `may_act.sub`.

---

## 9. Delegation and Delegate User Rules

### RFC 8693 delegation (`act` claim)

- AI agent requests (where `clientType === 'ai_agent'`) MUST carry a valid `act` claim.
- The `act.sub` must identify a known actor (Demo AI Agent `d21c5124` or Demo MCP Gateway `3fc5ec99`).
- Missing or malformed `act` → 401 `DELEGATION_REQUIRED`.

### Bank delegate users (`is_delegate` claim)

PingOne emits an `is_delegate` custom claim on user tokens (SpEL: `${user.isDelegate}`).
This is a separate concept from RFC 8693 delegation.

| Operation | Customer | Bank Delegate |
|---|---|---|
| Read accounts and balances | Allowed | Allowed |
| Make deposits | Allowed | Allowed |
| Make transfers | Allowed | **Blocked** |
| Make payments | Allowed | **Blocked** |
| Create / close accounts | Allowed | **Blocked** |
| Change profile | Allowed | **Blocked** |

Blocked operations return: `403 forbidden_for_delegate` (`DELEGATE_RESTRICTED`).

---

## 10. HITL Consent Flow

Transfers above the confirm threshold (default $250) require a consent challenge.

### HITL MFA mode (enum `hitl_consent_mfa_mode`)

| Mode | Behavior |
|---|---|
| `onetime` (default) | PingOne one-time passcode via user's enrolled contact |
| `device_picker` | PingOne device authentication (for amounts ≥ `confirm_stepup_threshold_usd`) |
| `homegrown` | BFF-generated email OTP (fallback) |

- Transfer route returns `428 Precondition Required` if no valid consent challenge exists.
- Challenge must be created first via `POST /api/transactions/confirm-challenge`.
- OTP verification via `POST /api/transactions/verify-otp`.

---

## 11. Feature Flags Affecting Authorization

These flags are runtime-configurable via `/api/admin/feature-flags`.

| Flag | Effect on Authorization |
|---|---|
| `ff_hitl_enabled` | Enables HITL consent enforcement on transfers |
| `step_up_enabled` | Enables MFA step-up for high-value transactions |
| `ff_authorize_real` | Uses local policy simulation instead of PingOne Authorize |
| `ff_oidc_only_authorize` | Strips banking scopes from authorize request; disables scope gates (OIDC-only mode) |
| `ff_inject_may_act` | Synthetically injects `may_act` claim for demo (legacy path; never use in production) |
| `ff_may_act_seed` | Legacy mint mode: seeds `act` from the user's `may_act` at exchange. Default OFF — `act` mints from the actor token and consent (may_act) is enforced per call by the policy |
| `ff_skip_token_exchange` | Bypasses RFC 8693 exchange (demo bypass — never production) |

> **Important:** `GET` and `PATCH /api/admin/feature-flags` are intentionally unauthenticated (demo ergonomics).
> Any caller can flip security-relevant flags. Do not harden without updating `REGRESSION_PLAN.md`.

---

## 12. PingOne Token Policy Configuration Checklist

> The `may_act` items below are **legacy mode only** (`ff_may_act_seed` ON). By default provisioning skips them; the audience resources instead carry `act` = `${{'sub': #root.context.requestData.actorToken.client_id}}`.

When building PingOne policies for this demo, verify the following:

### Demo API resource (`enduser.ping.demo`)
- [ ] Token attribute `sub` → SpEL: `${user.id}`
- [ ] Token attribute `may_act` → SpEL: `#{'sub': 'd21c5124-8ac5-43d1-81f2-31a7ec649b96'}` (map literal, not string)
- [ ] Token attribute `is_delegate` → SpEL: `${user.isDelegate}`

### Demo MCP Server resource (`mcpserver.ping.demo`)
- [ ] Token attribute `sub` → SpEL: `${user.id}`
- [ ] Token attribute `may_act` → SpEL: `#{'sub': 'd21c5124-8ac5-43d1-81f2-31a7ec649b96'}`

### Demo AI Agent app (`d21c5124`)
- [ ] Grant types include `token_exchange` and `client_credentials`
- [ ] App is type `AI_AGENT`
- [ ] Token auth method is `CLIENT_SECRET_POST`
- [ ] Has scopes from `agentgateway.ping.demo` resource: `agent:invoke`, `banking:agent:invoke`

### Demo Admin App (`3937cbfd`)
- [ ] Grant types include `token_exchange`
- [ ] Redirect URI: `https://api.ping.demo:4000/api/auth/oauth/callback`

### Demo User App (`b7d00976`)
- [ ] Redirect URI: `https://api.ping.demo:4000/api/auth/oauth/user/callback`
- [ ] Scopes include `read`, `write`, `ai_agent`, `ai:agent:read`, `mortgage:read` on `enduser.ping.demo`

### PKCE enforcement
- [ ] All public-client authorization code flows use `pkceEnforcement=S256_REQUIRED`

---

## 13. Quick Reference — Management API

Obtain a worker token (CLIENT_SECRET_BASIC):

```bash
MGT_TOKEN=$(curl -s -X POST \
  "https://auth.pingone.com/01d89b06-66d5-430e-9f28-65636843788b/as/token" \
  -u "<WORKER_CLIENT_ID>:<WORKER_CLIENT_SECRET>" \
  -d "grant_type=client_credentials" \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['access_token'])")
```

Update a resource attribute (e.g. `may_act` on Demo API; legacy mode only):

```bash
curl -X PUT \
  "https://api.pingone.com/v1/environments/01d89b06-66d5-430e-9f28-65636843788b/resources/9b0f9ae4-463c-458e-9c5e-7e1dd8e6323d/attributes/<attr_id>" \
  -H "Authorization: Bearer $MGT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"may_act","value":"#{'\''sub'\'': '\''d21c5124-8ac5-43d1-81f2-31a7ec649b96'\''}"}'
```

List attributes for a resource:

```bash
curl "https://api.pingone.com/v1/environments/01d89b06-66d5-430e-9f28-65636843788b/resources/9b0f9ae4-463c-458e-9c5e-7e1dd8e6323d/attributes" \
  -H "Authorization: Bearer $MGT_TOKEN"
```

---

*Cross-references: [`docs/PINGONE_CONFIG.md`](user-guide/PINGONE_CONFIG.md) — full entity IDs and token chain details | [`scope-topology.json`](../scope-topology.json) — canonical scope SSOT | [`REGRESSION_PLAN.md`](../REGRESSION_PLAN.md) — do-not-break rules*

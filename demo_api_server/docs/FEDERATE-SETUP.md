# PingFederate Migration Guide

Complete instructions for replacing PingOne with PingFederate as the OAuth IDP for this banking demo.

## Prerequisites

- PingFederate instance (e.g., `https://federate.example.com:9031`)
- OAuth 2.0 Authorization Server configured
- Two OAuth clients: one for admin, one for end users

---

## Step 1: Create OAuth Clients in Federate

### Admin Client
| Setting | Value |
|---------|-------|
| Grant Types | Authorization Code, Refresh Token |
| Client Authentication | Client Secret Basic |
| Redirect URI | `https://your-app.example.com/oauth2/callback` |
| Scopes | `openid profile email offline_access` |

Note the **Client ID** and **Client Secret**.

### User Client
Same settings as Admin Client but with a distinct Client ID/Secret. Use the same Redirect URI (or a different path if preferred).

---

## Step 2: Configure BFF Environment

### Ordinary demo-step exchange client

Create two PingFederate OAuth clients for ordinary Demo Steps. Configure the first
client with an access-token-to-access-token processor policy that issues the
intermediate audience and the requested tool-scope intersection. Configure the
second with a policy that issues the same effective final audience and requested
scopes as PingOne. Both must accept an access-token subject and actor token, and
both must return ordinary access tokens. The final policy should map the
MCP-service actor and preserve the AI-agent actor from the intermediate token
in the nested `act` claim. The BFF also accepts PingOne's documented flat
`act.sub` shape when it identifies the AI-agent actor. The actor identities are
separate client-credentials applications.

These clients and policies are used by PF login for ordinary demo steps; they are
distinct from the ID-JAG issuer/redemption configuration, which is selected only
by the explicit Enterprise-Managed MCP demo. PF derives each output audience from
the policy assigned to the exchange client, so the BFF does not send an audience
request parameter and validates the actual output claim.

```bash
export PF_STANDARD_TOKEN_EXCHANGE_CLIENT_ID=<ordinary-exchange-client-id>
export PF_STANDARD_TOKEN_EXCHANGE_CLIENT_SECRET=<ordinary-exchange-client-secret>
export PF_STANDARD_TOKEN_EXCHANGE_TOKEN_ENDPOINT_AUTH_METHOD=basic
export PF_STANDARD_TOKEN_EXCHANGE_ACTOR_SCOPE=agent:invoke
export PF_STANDARD_AGENT_EXCHANGE_CLIENT_ID=<first-hop-exchange-client-id>
export PF_STANDARD_AGENT_EXCHANGE_CLIENT_SECRET=<first-hop-exchange-client-secret>
export PF_STANDARD_AGENT_EXCHANGE_TOKEN_ENDPOINT_AUTH_METHOD=basic
export PF_STANDARD_INTERMEDIATE_AUDIENCE=<intermediate-resource-audience>
export PF_AI_AGENT_ACTOR_CLIENT_ID=<pf-ai-agent-actor-client-id>
export PF_AI_AGENT_ACTOR_CLIENT_SECRET=<pf-ai-agent-actor-client-secret>
export PF_AI_AGENT_ACTOR_TOKEN_ENDPOINT_AUTH_METHOD=basic
export PF_MCP_SERVICE_ACTOR_CLIENT_ID=<pf-mcp-service-actor-client-id>
export PF_MCP_SERVICE_ACTOR_CLIENT_SECRET=<pf-mcp-service-actor-client-secret>
export PF_MCP_SERVICE_ACTOR_TOKEN_ENDPOINT_AUTH_METHOD=basic
export PF_STANDARD_MCP_ACTOR_SCOPE=mcp:invoke
```

Do not configure an ID-JAG-only SP connection as either ordinary exchange client.

```bash
# ── IDP endpoints ──────────────────────────────────────────────────────
# Option A: auto-discover (recommended if Federate has .well-known/openid-configuration)
export OAUTH_ISSUER=https://federate.example.com:9031
export OAUTH_DISCOVERY_ENABLED=true

# Option B: explicit endpoints (if discovery not available)
export OAUTH_AUTHORIZATION_ENDPOINT=https://federate.example.com:9031/as/authorization.oauth2
export OAUTH_TOKEN_ENDPOINT=https://federate.example.com:9031/as/token.oauth2
export OAUTH_USERINFO_ENDPOINT=https://federate.example.com:9031/idp/userinfo.openid
export OAUTH_JWKS_URI=https://federate.example.com:9031/pf/JWKS
export OAUTH_ISSUER=https://federate.example.com:9031

# ── Callback paths ─────────────────────────────────────────────────────
export OAUTH_ADMIN_CALLBACK_PATH=/oauth2/callback
export OAUTH_USER_CALLBACK_PATH=/oauth2/callback

# ── Admin OAuth client ──────────────────────────────────────────────────
export PINGONE_ADMIN_CLIENT_ID=<admin-client-id>
export PINGONE_ADMIN_CLIENT_SECRET=<admin-client-secret>
export PINGONE_ADMIN_REDIRECT_URI=https://your-app.example.com/oauth2/callback

# ── User OAuth client ───────────────────────────────────────────────────
export PINGONE_USER_CLIENT_ID=<user-client-id>
export PINGONE_USER_CLIENT_SECRET=<user-client-secret>
export PINGONE_USER_REDIRECT_URI=https://your-app.example.com/oauth2/callback

# ── Role claim mapping (adjust to your Federate attribute config) ───────
export OAUTH_ROLE_CLAIM_NAME=groups
export OAUTH_ROLE_CLAIM_VALUE_ADMIN=banking-admins
export OAUTH_ROLE_CLAIM_VALUE_CUSTOMER=banking-users
export OAUTH_ROLE_CLAIM_IS_ARRAY=true

# ── Unset PingOne-specific vars (so BFF uses configured endpoints) ──────
unset PINGONE_ENVIRONMENT_ID
unset PINGONE_REGION
```

---

## Step 3: Verify via Config UI

1. Navigate to `/admin/config`
2. Under **OAuth Endpoints**, verify all fields are populated (from discovery or explicit config)
3. Under **Role Mapping**, confirm claim name and values
4. Save

---

## Step 4: Test the Login Flow

1. Open the app and click **Login**
2. Verify redirect goes to `https://federate.example.com:9031/as/authorization.oauth2`
3. Log in with Federate credentials
4. Verify redirect returns to `/oauth2/callback?code=...&state=...`
5. Verify dashboard loads with correct role (admin or customer)

---

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| Redirect URI mismatch error | Registered URI ≠ configured URI | Check `OAUTH_ADMIN_CALLBACK_PATH` and Federate client Redirect URIs match exactly |
| `invalid_scope` error | Federate client missing scopes | Add `openid profile email offline_access` to client's allowed scopes |
| Discovery fails, no endpoints | Federate doesn't serve `.well-known` | Set `OAUTH_DISCOVERY_ENABLED=false` and configure explicit endpoints |
| Wrong role assigned | Role claim name or value mismatch | Check `OAUTH_ROLE_CLAIM_NAME` matches the actual claim in the token; use Config UI debug panel to inspect token |
| JWKS validation fails | Wrong JWKS URI | Verify `OAUTH_JWKS_URI` points to Federate's JWKS endpoint |
| Token endpoint auth failure | Wrong auth method | Check `PINGONE_ADMIN_TOKEN_ENDPOINT_AUTH_METHOD` (default: `basic`) matches Federate client config |

---

## Rollback to PingOne

```bash
unset OAUTH_AUTHORIZATION_ENDPOINT
unset OAUTH_TOKEN_ENDPOINT
unset OAUTH_USERINFO_ENDPOINT
unset OAUTH_JWKS_URI
unset OAUTH_ISSUER
unset OAUTH_DISCOVERY_ENABLED
unset OAUTH_ADMIN_CALLBACK_PATH
unset OAUTH_USER_CALLBACK_PATH
unset OAUTH_ROLE_CLAIM_NAME
unset OAUTH_ROLE_CLAIM_VALUE_ADMIN
unset OAUTH_ROLE_CLAIM_VALUE_CUSTOMER
unset OAUTH_ROLE_CLAIM_IS_ARRAY

export PINGONE_ENVIRONMENT_ID=<your-env-id>
export PINGONE_REGION=com
# ... other PingOne credentials
```

Restart the BFF — all defaults revert to PingOne computed endpoints.

---

## Related docs

- [OIDC-DISCOVERY.md](OIDC-DISCOVERY.md) — auto-discovery from `.well-known/openid-configuration`
- [CALLBACK-PATHS.md](CALLBACK-PATHS.md) — configuring OAuth redirect URI paths
- [ROLE-MAPPING.md](ROLE-MAPPING.md) — mapping IDP claims to admin/customer roles

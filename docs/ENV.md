# Environment Variables Reference

## Quick Start

Copy `demo_api_server/.env` to your deployment. All secrets are required.

## OAuth provider selection

The default remains PingOne:

```dotenv
OAUTH_PROVIDER=pingone
```

To use PingFederate for the browser login and ID-JAG token chain, set the
following non-secret values and provide the secrets through the deployment
secret store. Do not commit PF secrets or tokens.

```dotenv
OAUTH_PROVIDER=pingfederate
PF_ISSUER=https://pf.example.com
PF_DISCOVERY_ENDPOINT=https://pf.example.com/.well-known/openid-configuration
PF_AUTHORIZATION_ENDPOINT=https://pf.example.com/as/authorization.oauth2
PF_TOKEN_ENDPOINT=https://pf.example.com/as/token.oauth2
PF_USERINFO_ENDPOINT=https://pf.example.com/idp/userinfo.openid
PF_JWKS_URI=https://pf.example.com/pf/JWKS

PF_ADMIN_CLIENT_ID=<bff-admin-client-id>
PF_ADMIN_REDIRECT_URI=https://local.ping-devops.com:4000/api/auth/oauth/admin/callback
PF_USER_CLIENT_ID=<bff-user-client-id>
PF_USER_REDIRECT_URI=https://local.ping-devops.com:4000/api/auth/oauth/user/callback
PF_TOKEN_EXCHANGE_CLIENT_ID=<pf-id-jag-client-id>
PF_ID_JAG_ENABLED=true
PF_ID_JAG_AUDIENCE=<downstream-authorization-server-issuer>
PF_ID_JAG_RESOURCE=<mcp-resource-uri>
PF_ID_JAG_SCOPE=<space-separated-least-privilege-scopes>
PF_ID_JAG_SUBJECT_TOKEN_TYPE=urn:ietf:params:oauth:token-type:refresh_token
PF_ID_JAG_REDEMPTION_TOKEN_ENDPOINT=<downstream-token-endpoint>
PF_ID_JAG_REDEMPTION_CLIENT_ID=<downstream-client-id>
```

Secret-store variables are `PF_ADMIN_CLIENT_SECRET`, `PF_USER_CLIENT_SECRET`,
`PF_TOKEN_EXCHANGE_CLIENT_SECRET`, and
`PF_ID_JAG_REDEMPTION_CLIENT_SECRET`. The PF token-exchange and redemption
authentication methods default to `basic`; set the corresponding
`*_TOKEN_ENDPOINT_AUTH_METHOD` or `PF_ID_JAG_REDEMPTION_AUTH_METHOD` to `post`
or `private_key_jwt` when that is how the PF client is configured.

PF mode is intentionally fail-closed: the ID-JAG is redeemed only at the
explicit downstream endpoint. It is never treated as a final MCP bearer and
does not fall back to the PingOne or local mock exchange.

## MCP Streamable HTTP Origin allowlist

`MCP_ALLOWED_ORIGINS` is a comma-separated list of exact browser origins
(scheme, host, and optional port; no paths). Docker Compose defaults to
`https://local.ping-devops.com:4000`; the hosted Kubernetes deployment allows
`https://ai-demo.ping-devops.com`. Requests with a supplied Origin outside the
list receive HTTP 403. Requests without an Origin remain available to CLI and
server-to-server MCP clients. An empty list denies all supplied Origins.

## PingFederate AI Agent feature demos

The separate `/pingfederate-ai-agent` page exercises PingFederate CIMD,
PF-issued ID-JAG cross-domain exchange, and PF RAR. These flags are off by
default and do not require changing `OAUTH_PROVIDER`. The cross-domain page
requires the user to select the current session's provider as the subject
source; the BFF uses that session's access token and does not accept a token
from the browser request.

```dotenv
PF_AI_CIMD_ENABLED=true
PF_AI_CROSS_DOMAIN_ENABLED=true
PF_AI_CROSS_DOMAIN_CLIENT_ID=<pf-token-exchange-client-id>
PF_AI_CROSS_DOMAIN_TOKEN_ENDPOINT_AUTH_METHOD=basic
PF_AI_CROSS_DOMAIN_AUDIENCE=<third-party-authorization-server-issuer>
PF_AI_CROSS_DOMAIN_RESOURCE=<third-party-resource-uri>
PF_AI_CROSS_DOMAIN_SCOPE=<space-separated-downstream-scopes>
PF_AI_THIRD_PARTY_TOKEN_ENDPOINT=<third-party-token-endpoint>
PF_AI_THIRD_PARTY_CLIENT_ID=<third-party-jwt-bearer-client-id>
PF_AI_THIRD_PARTY_TOKEN_ENDPOINT_AUTH_METHOD=basic
PF_AI_THIRD_PARTY_RESOURCE=<third-party-resource-uri>
PF_AI_THIRD_PARTY_SCOPE=<space-separated-downstream-scopes>
PF_AI_RAR_ENABLED=true
PF_AI_RAR_CLIENT_ID=ai-demo-pf-rar
```

Store `PF_AI_CROSS_DOMAIN_CLIENT_SECRET` and
`PF_AI_THIRD_PARTY_CLIENT_SECRET` in the deployment secret store. Configure
`PF_PAR_ENDPOINT` and deploy/configure the custom RAR processor before setting
`PF_AI_RAR_ENABLED=true`.

RAR uses its own public PKCE client, `PF_AI_RAR_CLIENT_ID`, because PingFederate
13.1 gives a CIMD client no authorization detail types; leave it empty to fall
back to the CIMD client. `PF_AI_RAR_LOOKUP_SECRET` is the bearer credential the
PingFederate processor presents to `GET /api/pf-ai-agent/rar/user-limits`. It
belongs in the secret store: `scripts/pingfederate/provision-ai-agent-features.js
--apply` creates it once and never replaces it, and pushes the same value into
the processor's config. The public CIMD metadata document and callback are
served at `/api/pf-ai-agent/cimd/client-metadata.json` and
`/api/pf-ai-agent/cimd/callback` on `PUBLIC_APP_URL`.

On the local stack the cross-domain and third-party values above are defaults in
`docker-compose.yml`, and `scripts/pingfederate/provision-cross-domain-exchange.js
--apply` creates the PingFederate side plus the two client secrets in the vault
(until it has run, that path stays "Not configured"). The third party there is the
BFF's own opt-in stand-in: `PF_AI_THIRD_PARTY_MOCK_ENABLED=true` turns on
`POST /api/pf-ai-agent/mock-third-party/token`, which answers 404 otherwise and
authenticates with the third-party client id and secret. To use a real third-party
authorization server instead, leave the mock off and point
`PF_AI_THIRD_PARTY_TOKEN_ENDPOINT` at it (it must be `https`).

## Credential Variables (PingOne Apps)

### Core Apps

- **User App**: `PINGONE_USER_CLIENT_ID` (no secret — see below)
  - Used by: BFF OAuth flow for end-user login
  - **PKCE-only since 2026-08-24**: the PingOne app's Token Endpoint Auth
    Method is `NONE` (public client), PKCE S256 is `REQUIRED`. `oauthUserService.js`
    already sends `client_secret` only when one is configured, so
    `PINGONE_USER_CLIENT_SECRET` is unused and does not need to be set anywhere
    (vault, `.env`, or the K8s `ai-demo-secrets` Secret). A `user_secret=MISSING`
    line in the BFF's `[oauth/user/login]` diagnostic log is expected, not a bug.

- **Admin App**: `PINGONE_ADMIN_CLIENT_ID` + `PINGONE_ADMIN_CLIENT_SECRET`
  - Used by: BFF admin login & dashboard backend

- **MCP Gateway**: `PINGONE_MCP_GATEWAY_CLIENT_ID` + `PINGONE_MCP_GATEWAY_CLIENT_SECRET`
  - Used by: MCP Gateway client credentials flow

- **Token Exchanger**: `PINGONE_TOKEN_EXCHANGER_CLIENT_ID` + `PINGONE_TOKEN_EXCHANGER_CLIENT_SECRET`
  - Used by: RFC 8693 token exchange (Step 1 of Two-Exchange flow)

- **AI Agent Actor**: `PINGONE_AI_AGENT_ACTOR_CLIENT_ID` + `PINGONE_AI_AGENT_ACTOR_CLIENT_SECRET`
  - Used by: AI Agent OAuth actor for A2A delegation

- **Agent**: `PINGONE_AGENT_CLIENT_ID` + `PINGONE_AGENT_CLIENT_SECRET`
  - Used by: Agent service authentication

- **Worker**: `PINGONE_WORKER_CLIENT_ID` + `PINGONE_WORKER_CLIENT_SECRET`
  - Used by: Token introspection worker

## PingOne Verify Identity Proofing

The signed-in customer profile can start a PingOne Verify hosted web transaction
through the BFF. The feature flag defaults off. Configure these non-secret
values only after the non-production tenant has Verify enabled and the selected
policy and worker permissions have been checked:

```dotenv
PINGONE_VERIFY_ENABLED=false
PINGONE_VERIFY_POLICY_ID=<verify-policy-uuid>
# Optional, only for a tenant-configured custom Verify web domain:
PINGONE_VERIFY_WEB_HOST=<custom-verify-hostname>
```

The existing PingOne Management API worker credentials are used server-side.
The optional web host must be the exact hostname configured for PingOne Verify
(for example, `verify.example.com`), without a scheme or path. The BFF accepts
only that configured host or PingOne's standard regional Verify hosts.
Grant that worker `idverifications:create:verifyTransactions` and
`idverifications:read:verifyTransactions`. Set the BFF's canonical
`PUBLIC_APP_URL` to the browser app origin; the handoff returns to
`/profile?verify=return` on that origin. Never add a localhost redirect.

The first implementation accepts only a customer access token whose validated
issuer is the configured PingOne issuer and whose `sub` is the PingOne
environment user UUID. PingFederate, local sessions, delegated tokens, admin
tokens, and open-access demo bindings fail closed until a trusted mapping to a
PingOne user UUID is designed and confirmed. The browser cannot choose the
PingOne user ID, submit proofing PII, or set a verification result. Only the
server's read of `transactionStatus.status === SUCCESS` records completion;
manual approval, `NOT_REQUIRED`, and unknown states do not unlock proofing.

Enable `pingone_verify_enabled` in the authenticated Feature Flags page for a
non-production pilot, or set `PINGONE_VERIFY_ENABLED=true` as a deployment
override. Keep it off until the Verify service/BOM, policy, required API
permissions, identity mapping, and canonical origin are confirmed. The BFF
persists only transaction ownership and lifecycle metadata, not documents,
selfies, submitted identity values, or upstream response bodies.

## PingOne Recognize Readiness

The direct React integration uses the PingOne Recognize Web SDK. Do not enable
the current integration until Ping/Keyless confirms the tenant's customer name,
regional Authentication Service URL, approved package version, and complete
backend JWT result-validation contract (JWKS/issuer/algorithm, required claims,
user/operation binding, key rotation, and enrollment removal behavior). The SDK
success callback alone is not proof. Keep transfer approval tied to the existing
server challenge and OTP fallback; do not claim transaction signing from the
Web SDK unless Ping confirms the exact supported Web flow and signed claims.

### A2A Specialist Agents (8 verticals)

- **Investment Advisor**: `PINGONE_A2A_INVESTMENT_AGENT_CLIENT_ID` + `PINGONE_A2A_INVESTMENT_AGENT_CLIENT_SECRET`
- **Records Specialist**: `PINGONE_A2A_RECORDS_AGENT_CLIENT_ID` + `PINGONE_A2A_RECORDS_AGENT_CLIENT_SECRET`
- **Purchase Specialist**: `PINGONE_A2A_PURCHASE_AGENT_CLIENT_ID` + `PINGONE_A2A_PURCHASE_AGENT_CLIENT_SECRET`
- **Membership Specialist**: `PINGONE_A2A_MEMBERSHIP_AGENT_CLIENT_ID` + `PINGONE_A2A_MEMBERSHIP_AGENT_CLIENT_SECRET`
- **Payroll Specialist**: `PINGONE_A2A_PAYROLL_AGENT_CLIENT_ID` + `PINGONE_A2A_PAYROLL_AGENT_CLIENT_SECRET`
- **Tax Records Specialist**: `PINGONE_A2A_TAX_AGENT_CLIENT_ID` + `PINGONE_A2A_TAX_AGENT_CLIENT_SECRET`
- **Financial Aid Specialist**: `PINGONE_A2A_FINAID_AGENT_CLIENT_ID` + `PINGONE_A2A_FINAID_AGENT_CLIENT_SECRET`
- **Holdings Specialist**: `PINGONE_A2A_HOLDINGS_AGENT_CLIENT_ID` + `PINGONE_A2A_HOLDINGS_AGENT_CLIENT_SECRET`

## Resource URIs (Non-Secret Config)

| URI Variable | Value | Purpose |
|---|---|---|
| `PINGONE_RESOURCE_MCP_GATEWAY_URI` | `mcpgateway.ping.demo` | MCP Gateway audience (token exchange target) |
| `PINGONE_RESOURCE_MCP_SERVER_URI` | `mcpserver.ping.demo` | MCP Server audience |
| `PINGONE_RESOURCE_AGENT_GATEWAY_URI` | `agentgateway.ping.demo` | Agent Gateway audience (Two-Exchange Step 1) |
| `PINGONE_RESOURCE_MCP_RESOURCE_SERVER_URI` | `mcp-invest.ping.demo` | Investment vertical MCP scope target — the audience the PingOne "Demo Demo MCP Resource Server" resource actually carries |
| `PINGONE_RESOURCE_JWT_VERIFIER_URI` | `mcp-jwt-verifier.ping.demo` | JWT diagnostic tool resource |
| `PINGONE_RESOURCE_A2A_INTERMEDIATE_<VERTICAL>_URI` | `a2a-intermediate-<vertical>.ping.demo` | A2A Delegation intermediary (per specialist) |

## Cleanup Notes (2026-07-28)

**Removed duplicates:**
- ✅ `GW_INTROSPECTION_CLIENT_ID/SECRET` → consolidated into `PINGONE_TOKEN_EXCHANGER_*`
- ✅ `AGENT_CLIENT_ID/SECRET` → renamed to `PINGONE_AGENT_CLIENT_*` (code updated; env still accepts both names via backward-compat fallback in configStore.js)

**Consolidated resource URIs:**
- ✅ `MCP_RESOURCE_URI`, `MCP_SERVER_RESOURCE_URI`, `MCP_GW_RESOURCE_URI`, `PINGONE_RESOURCE_TWO_EXCHANGE_URI` → single `PINGONE_RESOURCE_MCP_GATEWAY_URI`
- ✅ `A2A_INTERMEDIATE_AUDIENCE_*` → renamed to `PINGONE_RESOURCE_A2A_INTERMEDIATE_*_URI`

**Result:** 105 lines → ~85 lines, zero duplication, app mappings clear from .env comments.

## Adding New Apps

Follow these patterns:

1. **New PingOne app credentials:**
   ```
   PINGONE_<APP_SHORTHAND>_CLIENT_ID=<value>
   PINGONE_<APP_SHORTHAND>_CLIENT_SECRET=<value>
   ```
   Example: `PINGONE_NEW_SERVICE_CLIENT_ID` for a service called "New Service"

2. **New resource URIs:**
   ```
   PINGONE_RESOURCE_<SERVICE>_URI=<uri.ping.demo>
   ```
   Example: `PINGONE_RESOURCE_NEW_SERVICE_URI=new-service.ping.demo`

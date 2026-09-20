# PingFederate ID-JAG Provider Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an explicit runtime OAuth provider mode that points the demo at PingFederate and performs real ID-JAG exchanges, while preserving PingOne as the alternate provider and never falling back to the local mock exchange in PF mode.

**Architecture:** The BFF remains the only browser-token custodian. A provider selector chooses either the current PingOne OAuth/token-exchange implementation or a PingFederate implementation; PF mode uses OIDC discovery for login and RFC 8693 with `requested_token_type=urn:ietf:params:oauth:token-type:id-jag` for the real ID-JAG path. The existing simulated authorization engine is a separate concern controlled by `authorize_mode`/`ff_authorize_real` and must not be used as a token-provider fallback.

**Tech Stack:** Node.js >=22, CommonJS, Express BFF, Jest, LMDB-backed `configStore`, Axios OAuth calls, PingFederate 13.1.3+.

**Spec:** User-approved requirements in this plan; no separate spec file.

## Global Constraints

- Preserve the BFF-only token custody contract in `docs/adr/0006-bff-only-token-custody.md`.
- Preserve the current PingOne path when `OAUTH_PROVIDER=pingone` or when provider mode is unset.
- In `OAUTH_PROVIDER=pingfederate`, call the configured PingFederate endpoints and request a real ID-JAG; do not call `simulatedAuthorizeService`, synthesize a token, or silently fall back to PingOne/mock behavior.
- Keep authorization-engine selection separate from OAuth-provider selection: `authorize_mode` controls PingOne Authorize versus the local authorization simulator, not PF versus PingOne identity.
- Do not expose access tokens, refresh tokens, ID-JAGs, client secrets, authorization codes, or raw session IDs to the browser or normal logs.
- Use the canonical browser origin `https://local.ping-devops.com:4000`; do not add localhost OAuth redirects.
- Read `REGRESSION_PLAN.md` §0–§1 and invoke the auth regression guard before editing protected OAuth/session/token-exchange code.
- Use a worktree branch, stage only intended paths, run `graphify update .` after code edits, and verify before claiming completion.

## Required decisions and access before implementation

- [ ] Confirm the PingFederate version is 13.1.3 or newer.
- [ ] Confirm the PF issuer/discovery URL and the PF virtual-server URL used by the BFF.
- [ ] Confirm whether PF itself issues the final resource access token or whether another authorization server consumes the PF-issued ID-JAG.
- [ ] Confirm the downstream authorization server, audience, resource URI, scopes, and JWT/JWKS trust configuration.
- [ ] Confirm the PF admin API endpoint and an authorized non-production administrative credential or approved configuration-export/import path.
- [ ] Store secrets through the environment/secret store; do not put PF secrets in Git or chat.
- [ ] Obtain a disposable PF test user and a test client before changing any shared PF configuration.

## File map

**Repository files expected to change:**

- Modify: `demo_api_server/services/configStore.js` — provider and PF configuration keys, defaults, bootstrap authority, and secret classification.
- Modify: `demo_api_server/services/oauthEndpointResolver.js` — provider-aware endpoint/discovery resolution without breaking PingOne fallback rules.
- Modify: `demo_api_server/config/oauth.js` and `demo_api_server/config/oauthUser.js` — provider-aware client and endpoint accessors where the current admin/user configurations are PingOne-specific.
- Modify: `demo_api_server/services/oauthDiscoveryService.js` — discovery validation for PF issuer/JWKS metadata and ID-JAG capability metadata.
- Modify: `demo_api_server/services/oauthService.js` — real PF ID-JAG issuance and provider-neutral exchange telemetry/error handling.
- Modify: `demo_api_server/services/oauthUserService.js` — PF authorization-code exchange and provider-specific client authentication.
- Modify: `demo_api_server/services/tokenVerificationService.js` and related JWT/JWKS callers — trust the selected issuer and selected JWKS, with strict issuer/audience validation.
- Modify: `demo_api_server/services/startupConfigGuard.js` — validate PF mode without applying PingOne-only URL invariants.
- Modify: `demo_api_server/docs/ENV.md` or the canonical environment documentation location — document provider selection and PF variables.
- Test: focused BFF tests beside each touched service, plus a provider-mode regression suite.

**PingFederate configuration objects:**

- Create/update: BFF OIDC client.
- Create/update: refresh-token token processor.
- Create/update: token-exchange processor policy.
- Create/update: OAuth Token Exchange SP Connection that permits ID-JAG issuance.
- Create/update: OAuth Assertion Grant IdP Connection for the downstream AS that consumes the ID-JAG.
- Configure: claim contracts, token lifetimes, issuer/audience/resource restrictions, signing keys, and audit masking.

### Task 1: Establish the provider contract and configuration keys

**Files:**
- Modify: `demo_api_server/services/configStore.js`
- Modify: `demo_api_server/config/oauth.js`
- Modify: `demo_api_server/config/oauthUser.js`
- Test: `demo_api_server/src/__tests__/configStore-providerMode.test.js`
- Test: existing OAuth config tests covering admin and user clients

**Interfaces:**
- Produces `getOAuthProvider()` returning exactly `pingone` or `pingfederate`.
- Produces PF configuration accessors for issuer, discovery, authorization endpoint, token endpoint, UserInfo endpoint, JWKS URI, client IDs, client secrets, token-exchange client, ID-JAG audience/resource, and subject-token type.
- Consumes existing `configStore.getEffective()` precedence and encrypted-secret handling.

- [ ] Add `OAUTH_PROVIDER` with default `pingone` and reject unsupported values at startup/config validation.
- [ ] Add `PF_ISSUER`, `PF_DISCOVERY_ENDPOINT`, `PF_AUTHORIZATION_ENDPOINT`, `PF_TOKEN_ENDPOINT`, `PF_USERINFO_ENDPOINT`, and `PF_JWKS_URI`.
- [ ] Add separate PF client settings for the browser BFF and token-exchange client when PF requires distinct clients.
- [ ] Add `PF_ID_JAG_ENABLED`, `PF_ID_JAG_AUDIENCE`, `PF_ID_JAG_RESOURCE`, `PF_ID_JAG_SCOPE`, and `PF_ID_JAG_SUBJECT_TOKEN_TYPE`.
- [ ] Mark every PF secret as encrypted-at-rest and add identity-critical PF endpoint/provider keys to bootstrap-authoritative configuration.
- [ ] Write tests proving unset mode preserves PingOne behavior, PF mode resolves PF values, and invalid modes fail closed.
- [ ] Run the focused config tests and commit the configuration contract.

### Task 2: Make discovery and endpoint resolution provider-aware

**Files:**
- Modify: `demo_api_server/services/oauthEndpointResolver.js`
- Modify: `demo_api_server/services/oauthDiscoveryService.js`
- Modify: `demo_api_server/services/startupConfigGuard.js`
- Test: `demo_api_server/src/__tests__/oauthDiscoveryService.test.js`
- Test: `demo_api_server/src/__tests__/oauthEndpointResolver.test.js`

**Interfaces:**
- `oauthEndpointResolver.getOAuthEndpoints()` returns the active provider’s endpoints.
- `oauthDiscoveryService.fetchDiscoveryMetadata()` validates the configured issuer against discovered metadata for both providers.

- [ ] Resolve PF endpoints from explicit PF configuration, then PF discovery, without deriving PF URLs from PingOne environment IDs.
- [ ] Keep the existing PingOne fallback and issuer `/as` normalization limited to PingOne hosts.
- [ ] Validate that PF discovery provides issuer, authorization endpoint, token endpoint, and JWKS URI.
- [ ] Validate ID-JAG capability metadata when PF mode is enabled, including the requested-token-type metadata where PF publishes it.
- [ ] Skip PingOne-only resource/JWKS host warnings in PF mode and add equivalent PF issuer/JWKS checks.
- [ ] Test issuer mismatch, HTTP discovery rejection in production, missing metadata, PF endpoint selection, and PingOne compatibility.
- [ ] Run the focused discovery/resolver tests and commit the provider-aware endpoint layer.

### Task 3: Implement the real PF browser login path

**Files:**
- Modify: `demo_api_server/services/oauthUserService.js`
- Modify: `demo_api_server/services/oauthService.js`
- Modify: OAuth callback routes only where provider-specific assumptions are present.
- Test: `demo_api_server/src/__tests__/oauth-callback.test.js`
- Test: `demo_api_server/src/__tests__/oauthUserService.test.js`

**Interfaces:**
- Existing login methods continue to return the same normalized session token shape.
- PF mode uses the active provider’s endpoints and client-auth method without changing session storage.

- [ ] Send PF Authorization Code + PKCE requests using the PF client and canonical callback URI.
- [ ] Exchange the code at PF and normalize `access_token`, `id_token`, `refresh_token`, expiry, and user claims into the existing session structure.
- [ ] Support PF’s configured token-endpoint authentication method, preferring private-key JWT or client secret according to PF configuration.
- [ ] Preserve nonce/state/PKCE validation and hosted-access checks.
- [ ] Ensure callback errors identify PF configuration failures without leaking response bodies or credentials.
- [ ] Test successful PF login, issuer mismatch, missing email/subject, invalid state, PKCE failure, and token endpoint failure.
- [ ] Run the focused callback/user OAuth tests and commit the login path.

### Task 4: Add the real PF ID-JAG exchange path

**Files:**
- Modify: `demo_api_server/services/oauthService.js`
- Modify: `demo_api_server/services/mcpToolPipeline.js` only if it directly assumes PingOne exchange responses.
- Test: `demo_api_server/src/__tests__/oauthService.idJag.test.js`
- Test: `demo_api_server/src/__tests__/mcpToolPipeline.*` tests covering exchange failures and token custody.

**Interfaces:**
- Add `performIdJagExchange(subjectToken, subjectTokenType, audience, resource, scopes, options)` returning the real downstream token-exchange response or a normalized error.
- Preserve existing `performTokenExchange*` methods for PingOne mode.
- Emit provider-neutral telemetry with `provider=pingfederate` and `requestedTokenType=id-jag`; never log assertion or token values.

- [ ] Build the PF request with `grant_type=urn:ietf:params:oauth:grant-type:token-exchange`.
- [ ] Set `requested_token_type=urn:ietf:params:oauth:token-type:id-jag`.
- [ ] Send the configured subject-token type, defaulting to the PF refresh-token type when the PF deployment is configured for refresh-token-to-ID-JAG exchange.
- [ ] Send the configured `audience`, `resource`, and least-privilege scope values.
- [ ] Authenticate the token-exchange client according to PF configuration.
- [ ] Require a valid ID-JAG response and reject missing token type, malformed JWT, wrong issuer, wrong audience, wrong type header, expired timestamps, or missing required subject claims.
- [ ] Exchange the ID-JAG at the configured downstream AS when the architecture uses a two-party exchange; do not treat the ID-JAG itself as a final access token unless the downstream resource explicitly accepts it.
- [ ] Make PF exchange failure terminal in PF mode; do not invoke a simulated or local exchange fallback.
- [ ] Test request parameters, provider selection, ID-JAG header/claims, downstream exchange, failure handling, and token redaction.
- [ ] Run focused OAuth/token-pipeline tests and commit the real ID-JAG path.

### Task 5: Keep authorization-engine and provider flags independent

**Files:**
- Modify only if needed: `demo_api_server/services/simulatedAuthorizeService.js`, `demo_api_server/services/pingOneAuthorizeService.js`, or their selector.
- Test: existing `authorize_mode`/`ff_authorize_real` regression tests.

- [ ] Confirm PF provider mode does not change `authorize_mode` semantics.
- [ ] Confirm `authorize_mode=simulated` remains an explicit policy-engine choice, not an OAuth-provider fallback.
- [ ] Confirm `OAUTH_PROVIDER=pingfederate` never routes token issuance through the local simulated service.
- [ ] Add a regression test that fails if PF mode imports/calls the mock token or authorization path for token issuance.
- [ ] Run the authorization parity tests and commit only if a selector change is required.

### Task 6: Configure PingFederate

**Files/artifacts:**
- Create: versioned PF configuration notes or an Admin API script under `scripts/` only after the PF API schema and target environment are confirmed.
- Modify: deployment secret/config templates only for non-secret variable names; never commit secret values.

- [ ] Verify PF 13.1.3+ and backup/export the target non-production PF configuration.
- [ ] Create the BFF OIDC client with Authorization Code, PKCE S256, refresh-token/offline access, required scopes, and exact local callback URI.
- [ ] Create the refresh-token token processor and expose only the claims needed for ID-JAG creation.
- [ ] Create the token-exchange processor policy with explicit client, audience, resource, and scope restrictions.
- [ ] Create the OAuth Token Exchange SP Connection for the downstream authorization server.
- [ ] Allow `urn:ietf:params:oauth:token-type:id-jag` as the requested token type.
- [ ] Map `sub`, `iss`, `aud`, scope, identity attributes, and any approved delegation claims into the ID-JAG contract.
- [ ] Set a short ID-JAG lifetime and enable assertion replay protection according to the PF deployment policy.
- [ ] Configure the downstream OAuth Assertion Grant IdP Connection to trust PF’s issuer and JWKS and to accept ID-JAG assertions.
- [ ] Enable token exchange only on the designated PF client; do not enable it broadly for unrelated clients.
- [ ] Verify PF discovery metadata, JWKS, authorization, token, and assertion-grant endpoints with non-secret probes.
- [ ] Execute one end-to-end exchange using a disposable user and confirm the returned JWT has `typ=oauth-id-jag+jwt`.
- [ ] Record PF object IDs, issuer, audience, resource, scopes, lifetimes, and rollback steps in the configuration notes without recording secrets or tokens.

### Task 7: Wire deployment configuration

**Files:**
- Modify: `docs/ENV.md`
- Modify: appropriate local Docker/Kubernetes config templates after identifying the canonical variable source.
- Test: configuration/hygiene checks and startup guard tests.

- [ ] Add documented `OAUTH_PROVIDER=pingfederate` configuration with PF endpoint and client variables.
- [ ] Add the PF variables to local Docker and deployment secret templates without values.
- [ ] Keep PingOne variables intact for the alternate mode and management APIs that still require PingOne.
- [ ] Ensure PF mode does not require a PingOne environment ID merely to resolve browser OAuth endpoints.
- [ ] Run `npm run hygiene:check` and the relevant topology/config verification commands.
- [ ] Commit deployment wiring separately from application behavior.

### Task 8: Verification and controlled rollout

- [ ] Run focused BFF tests for provider selection, discovery, browser callback, ID-JAG exchange, token validation, and token custody.
- [ ] Run `cd demo_api_server && CI=true npm test -- --forceExit` if shared OAuth/session/token-exchange code was changed broadly.
- [ ] Run `npm run topology:verify` if resource URIs, service boundaries, or generated topology are affected.
- [ ] Start the local stack with PF mode only through the approved worktree-serving workflow; do not run Docker Compose from this worktree.
- [ ] Pin and verify stack generation before and after live browser validation.
- [ ] Log in through PF at `https://local.ping-devops.com:4000`.
- [ ] Confirm the BFF session contains server-side PF tokens and the browser receives no raw token.
- [ ] Run one read-only Super Sports tool request and verify the real ID-JAG/downstream token chain.
- [ ] Run one denied or step-up transaction and verify authorization behavior remains governed by the selected authorization engine.
- [ ] Confirm PF outage produces a clear fail-closed error and never invokes the mock token path.
- [ ] Confirm switching back to `OAUTH_PROVIDER=pingone` restores the existing PingOne flow.
- [ ] Run `npm run authz:verify` and the required regression-guard checks.
- [ ] Review logs for leaked codes, tokens, assertions, secrets, or raw session IDs.
- [ ] Record verification evidence and mark the completed checklist items in this plan.

## Rollback

- [ ] Set `OAUTH_PROVIDER=pingone`.
- [ ] Remove PF-only deployment secrets from the active environment while retaining the configuration backup.
- [ ] Disable the PF token-exchange client or revoke its credentials if the PF test configuration was exposed.
- [ ] Restore the pre-change PF configuration export only if PF configuration changes affected existing clients.
- [ ] Re-run the PingOne login, token exchange, authorization, and Super Sports smoke checks.

## Completion criteria

- [ ] PF mode is selected by configuration, not by code edits or a hidden fallback.
- [ ] PF browser login succeeds with the canonical callback URI.
- [ ] PF returns a real ID-JAG with the expected type, issuer, audience, subject, scope, and lifetime.
- [ ] The downstream authorization server accepts the ID-JAG and returns the access token used by the demo.
- [ ] PF mode has no mock token-exchange path.
- [ ] PingOne mode remains backward compatible.
- [ ] BFF-only token custody, authorization semantics, issuer validation, and logging protections remain intact.
- [ ] Focused tests, required broad tests, and verification commands have fresh passing evidence.

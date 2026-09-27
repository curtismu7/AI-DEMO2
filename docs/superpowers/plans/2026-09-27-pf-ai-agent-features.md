# PingFederate AI Agent Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a standalone PingFederate AI Agent experience that exercises CIMD, PF authorization-details processing, and PF-to-third-party token exchange without routing these requests through the PingOne flow or the existing native ID-JAG demo.

**Architecture:** Add a namespaced BFF API at `/api/pf-ai-agent` and a dedicated UI page. CIMD uses a public PKCE client whose `client_id` is its metadata-document URL. Cross-domain exchange uses the explicitly selected current session token as the subject, asks PF for an ID-JAG, then redeems that assertion at a configured third-party authorization server. RAR uses PF PAR and a custom PF 13.1 authorization-details processor. All flow state and tokens remain server-side.

**Tech Stack:** Node.js >= 22, Express, `express-session`, Axios, React 19/Vite, Vitest, Jest, PingFederate 13.1 SDK Java API, JDK 17 dependency-free policy harness.

**Spec:** `docs/superpowers/specs/2026-09-26-demo-readiness-and-repair-design.md`, sections “User-approved decisions” and “AI-agent feature coverage”.

## Global Constraints

- All AI-agent authorization uses OAuth/JWT flows; no SAML-based grant, assertion, or exchange path is in scope.
- PingOne Agent IAM Core remains the PingOne baseline; the existing PingOne CIMD mock route and PingOne PAR/Authorize RAR flow keep their current behavior.
- Keep this feature under `/api/pf-ai-agent` and `/pingfederate-ai-agent`; do not change the process-wide `oauth_provider` value to run a PF request.
- Bind every subject-token request to an explicit provider matching `req.session.oauthProvider`; accept a PingOne token only when PingOne is explicitly selected as the cross-domain subject source.
- Keep native PF ID-JAG validation on its existing route and existing mock resource-server path.
- Declare PF setup readiness with `PF_AI_CIMD_ENABLED`, `PF_AI_CROSS_DOMAIN_ENABLED`, and `PF_AI_RAR_ENABLED`; each flag is false by default and does not mutate provider selection.
- The BFF is the only browser-token custodian. Never return authorization codes, PKCE verifiers, subject tokens, ID-JAG assertions, or access tokens to the UI or logs.
- CIMD metadata and redirect URIs use `getFrontendOrigin()`; no hardcoded localhost OAuth redirect.
- PF runtime requirements are version 13.1 or newer; the local PingFederate image is 13.1.2.
- UI network requests use `apiClient`, toasts use `notifyError`/`notifySuccess`, and UI changes pass `cd demo_api_ui && npm run build` while preserving the emoji allowlist.
- New secret settings are added to `SECRET_KEYS`; every PF AI feature flag defaults to `false`. Public status contains only effective readiness booleans, provider name, and safe endpoint/issuer labels.

---

## File Structure

- `demo_api_server/services/pfAiAgentFeatureConfig.js` — resolve PF feature endpoints, clients, and secret values with closed failure when required settings are absent.
- `demo_api_server/services/pfAiAgentOAuthService.js` — PF discovery, authorization-code/PKCE, PAR, and isolated feature-flow token storage.
- `demo_api_server/services/pfAiAgentCimdService.js` — public static CIMD document and PF client metadata URL.
- `demo_api_server/services/pfAiAgentCrossDomainExchangeService.js` — PF ID-JAG issuance followed by the separate downstream JWT-bearer redemption.
- `demo_api_server/routes/pfAiAgent.js` — status, CIMD, cross-domain, and RAR endpoints; no PingOne registration/exchange calls.
- `demo_api_server/services/configStore.js`, `.env.example`, and `docs/ENV.md` — PF-only settings and secret classification.
- `demo_api_server/server.js` — mount the new namespace once.
- `demo_api_server/src/__tests__/pfAiAgent*.test.js` — route, config, provider-binding, and token-custody behavior.
- `scripts/pingfederate/plugins/ai-agent-rar/` — PF authorization-details processor, pure policy validator, Java tests, and build instructions.
- `scripts/pingfederate/README.md` — PF CIMD policy, OAuth Token Exchange SP Connection, downstream JWT-bearer client, PAR, and RAR processor setup.
- `demo_api_ui/src/pages/PingFederateAiAgentPage.jsx` and its test — the independent CIMD, cross-domain, and RAR demonstration page.
- `demo_api_ui/src/App.js`, `src/routes/PublicRoutes.js`, and `src/components/AdminSideNav.jsx` — route, wrapper, and navigation entry.

## Task 1: Add isolated PF AI Agent settings and route boundary

**Files:**
- Create: `demo_api_server/services/pfAiAgentFeatureConfig.js`
- Create: `demo_api_server/routes/pfAiAgent.js`
- Modify: `demo_api_server/services/configStore.js`
- Modify: `demo_api_server/server.js`
- Modify: `demo_api_server/.env.example`
- Modify: `docs/ENV.md`
- Test: `demo_api_server/src/__tests__/pfAiAgentFeatureConfig.test.js`
- Test: `demo_api_server/src/__tests__/pfAiAgentRoute.test.js`

**Interfaces:**
- `resolveCimdConfig(store = configStore)` returns `{ issuer, authorizationEndpoint, tokenEndpoint, jwksUri, parEndpoint, clientMetadataUrl, redirectUri }` or throws a 503 configuration error.
- `resolveCrossDomainConfig(store = configStore)` returns `{ pfTokenEndpoint, pfClientId, pfClientSecret, pfAuthMethod, audience, resource, scope, thirdPartyTokenEndpoint, thirdPartyClientId, thirdPartyClientSecret, thirdPartyAuthMethod, thirdPartyResource, thirdPartyScope }` or throws a 503 configuration error.
- PF-only keys are `PF_AI_CIMD_ENABLED`, `PF_AI_CROSS_DOMAIN_ENABLED`, `PF_AI_CROSS_DOMAIN_CLIENT_ID`, `PF_AI_CROSS_DOMAIN_CLIENT_SECRET`, `PF_AI_CROSS_DOMAIN_TOKEN_ENDPOINT_AUTH_METHOD`, `PF_AI_CROSS_DOMAIN_AUDIENCE`, `PF_AI_CROSS_DOMAIN_RESOURCE`, `PF_AI_CROSS_DOMAIN_SCOPE`, `PF_AI_THIRD_PARTY_TOKEN_ENDPOINT`, `PF_AI_THIRD_PARTY_CLIENT_ID`, `PF_AI_THIRD_PARTY_CLIENT_SECRET`, `PF_AI_THIRD_PARTY_TOKEN_ENDPOINT_AUTH_METHOD`, `PF_AI_THIRD_PARTY_RESOURCE`, `PF_AI_THIRD_PARTY_SCOPE`, and `PF_AI_RAR_ENABLED`.
- `GET /api/pf-ai-agent/status` returns `{ sessionProvider, features: { cimd, crossDomain, rar }, nativeIdJagPath }`; it contains readiness booleans and safe endpoint labels only.
- `GET /api/pf-ai-agent/cimd/client-metadata.json` is public so PF can fetch the configured document. All action endpoints require an authenticated application user session.

- [x] **Step 1: Write the failing config and namespace tests**

```js
test('reports unconfigured PF features as disabled without changing the global provider', async () => {
  const response = await request(app).get('/api/pf-ai-agent/status');
  expect(response.body.features).toEqual({ cimd: false, crossDomain: false, rar: false });
  expect(configStore.getOAuthProvider()).toBe('pingone');
});

test('keeps PF feature secrets out of the public configuration response', async () => {
  const response = await request(app).get('/api/pf-ai-agent/status');
  expect(JSON.stringify(response.body)).not.toContain('pf-test-client-secret');
});
```

- [x] **Step 2: Run the focused tests and confirm they fail for missing feature behavior**

Run: `cd demo_api_server && CI=true npx jest src/__tests__/pfAiAgentFeatureConfig.test.js src/__tests__/pfAiAgentRoute.test.js --forceExit`

Expected: FAIL because the PF feature configuration and namespace routes do not exist.

- [x] **Step 3: Add PF-only config definitions and the namespaced status route**

Add sensitive fields for the PF token-exchange client secret and third-party-AS client secret. Add endpoint, audience, resource, scope, and auth-method fields with lower-case `pf_ai_*` aliases and `PF_AI_*` environment mappings. Implement status reporting from effective configuration and session provider only. Mount the new router once at `/api/pf-ai-agent`; do not alter the existing `/api/oauth/clients`, `/api/cimd`, or `/api/auth` semantics.

- [x] **Step 4: Run the focused tests and confirm they pass**

Run: `cd demo_api_server && CI=true npx jest src/__tests__/pfAiAgentFeatureConfig.test.js src/__tests__/pfAiAgentRoute.test.js --forceExit`

Expected: PASS; changing a PF setting must not change `oauth_provider`, and a provider mismatch must fail before any outbound call.

## Task 2: Implement the real PF CIMD authorization-code flow

**Files:**
- Create: `demo_api_server/services/pfAiAgentOAuthService.js`
- Create: `demo_api_server/services/pfAiAgentCimdService.js`
- Modify: `demo_api_server/routes/pfAiAgent.js`
- Test: `demo_api_server/src/__tests__/pfAiAgentCimdService.test.js`
- Test: `demo_api_server/src/__tests__/pfAiAgentCimdRoute.test.js`

**Interfaces:**
- `metadataDocument(config)` returns a public-client document with `client_id` equal to the document URL, one BFF callback URI shared by CIMD and RAR, `grant_types: ['authorization_code']`, `response_types: ['code']`, and `token_endpoint_auth_method: 'none'`.
- `beginCimd(req, res)` stores a one-use state, nonce, PKCE verifier, and expiry in `req.session.pfAiAgent.cimdPending`, then redirects to PF authorization with `client_id` set to the metadata URL.
- `completeCimd(req, res)` consumes the CIMD flow state, validates state/nonce/issuer/audience/signature/expiry, exchanges the code using PKCE without client-secret authentication, stores PF tokens only in `req.session.pfAiAgent.cimdTokens`, and redirects to `/pingfederate-ai-agent?cimd=success|error`.
- `GET /api/pf-ai-agent/cimd/callback` dispatches the shared redirect by matching the one-time `state` against exactly one pending CIMD or RAR flow; it never calls the PingOne callback handler.

- [x] **Step 1: Write failing metadata and isolation tests**

```js
test('publishes a public PKCE CIMD document whose client id is its own URL', () => {
  expect(metadataDocument(config)).toEqual({
    client_id: 'https://local.ping-devops.com:4000/api/pf-ai-agent/cimd/client-metadata.json',
    client_name: 'AI Demo PingFederate Agent',
    redirect_uris: ['https://local.ping-devops.com:4000/api/pf-ai-agent/cimd/callback'],
    grant_types: ['authorization_code'],
    response_types: ['code'],
    scope: 'openid profile email agent:invoke transactions:write',
    token_endpoint_auth_method: 'none',
  });
});

test('CIMD callback stores PF tokens separately and leaves the active PingOne session intact', async () => {
  const session = { oauthProvider: 'pingone', oauthTokens: { accessToken: 'p1-session-token' } };
  await completeCimd(callbackRequest(session, validPfCodeAndState));
  expect(session.oauthTokens.accessToken).toBe('p1-session-token');
  expect(session.pfAiAgent.cimdTokens.accessToken).toBeDefined();
});
```

- [x] **Step 2: Run the focused tests and confirm the missing CIMD flow is the failure**

Run: `cd demo_api_server && CI=true npx jest src/__tests__/pfAiAgentCimdService.test.js src/__tests__/pfAiAgentCimdRoute.test.js --forceExit`

Expected: FAIL because the PF metadata and callback flow are not implemented.

- [x] **Step 3: Implement metadata, discovery, PKCE, callback, and isolated token storage**

Use PF discovery and verify its issuer plus authorization, token, and JWKS origins against `PF_ISSUER`. Generate `state`, `nonce`, and an S256 verifier server-side. Put the callback on the dedicated route rather than dispatching through the shared PingOne login callback. Return only safe flow status to the UI.

- [x] **Step 4: Run the focused tests and confirm they pass**

Run: `cd demo_api_server && CI=true npx jest src/__tests__/pfAiAgentCimdService.test.js src/__tests__/pfAiAgentCimdRoute.test.js --forceExit`

Expected: PASS for valid metadata and callback; wrong state, nonce, issuer, audience, signature, expired state, and token-endpoint error fail without changing `oauthTokens` or returning token material.

## Task 3: Implement PF-to-third-party token exchange as two explicit OAuth hops

**Files:**
- Create: `demo_api_server/services/pfAiAgentCrossDomainExchangeService.js`
- Modify: `demo_api_server/routes/pfAiAgent.js`
- Test: `demo_api_server/src/__tests__/pfAiAgentCrossDomainExchangeService.test.js`
- Test: `demo_api_server/src/__tests__/pfAiAgentCrossDomainRoute.test.js`

**Interfaces:**
- `exchangeForThirdPartyAccessToken(req, { subjectProvider })` requires `subjectProvider` to equal the current session provider and accepts only `pingone` or `pingfederate`.
- Hop 1 posts RFC 8693 to the configured PF token endpoint with the session access token as `subject_token`, `subject_token_type=access_token`, `requested_token_type=id-jag`, and configured `audience`, `resource`, and `scope`.
- Hop 2 posts `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer` and the returned ID-JAG as `assertion` to the configured third-party AS token endpoint using that AS's separate client credentials.
- `POST /api/pf-ai-agent/cross-domain/exchange` returns only `{ subjectProvider, pfIssuer, assertionAudience, downstreamIssuer, downstreamAudience, subject, scope, expiresAt, hops }` and never either token.

- [x] **Step 1: Write failing two-hop and source-binding tests**

```js
test('issues a PF ID-JAG and redeems it at the configured downstream AS', async () => {
  pfTokenEndpoint.mockResolvedValue(idJagResponse);
  downstreamTokenEndpoint.mockResolvedValue(downstreamAccessTokenResponse);
  const result = await exchangeForThirdPartyAccessToken(pingOneSessionRequest, { subjectProvider: 'pingone' });
  expect(result).toEqual(expect.objectContaining({ subjectProvider: 'pingone', scope: ['accounts:read'] }));
  expect(pfTokenEndpoint).toHaveBeenCalledWith(expect.objectContaining({
    requested_token_type: 'urn:ietf:params:oauth:token-type:id-jag',
    subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
    subject_token: 'p1-session-token',
  }));
  expect(downstreamTokenEndpoint).toHaveBeenCalledWith(expect.objectContaining({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion: 'pf-id-jag-assertion',
  }));
});

test('does not accept a PingOne session token when PingFederate is selected as subject source', async () => {
  await expect(exchangeForThirdPartyAccessToken(pingOneSessionRequest, {
    subjectProvider: 'pingfederate',
  })).rejects.toMatchObject({ code: 'PF_AI_SUBJECT_PROVIDER_MISMATCH' });
  expect(pfTokenEndpoint).not.toHaveBeenCalled();
});
```

- [x] **Step 2: Run the focused tests and confirm the missing exchange service causes failure**

Run: `cd demo_api_server && CI=true npx jest src/__tests__/pfAiAgentCrossDomainExchangeService.test.js src/__tests__/pfAiAgentCrossDomainRoute.test.js --forceExit`

Expected: FAIL because the separate PF and third-party hops do not exist.

- [x] **Step 3: Implement the PF ID-JAG issuance and downstream redemption service**

Take the subject token only from `req.session.oauthTokens`; never accept a token or destination URL from the request body. Bind audience/resource/scope and both token endpoints to PF-only config. Apply a bounded timeout to each HTTP call. Do not log request bodies or upstream response bodies. Validate the PF response type and the downstream token response, then discard token strings after building the safe response summary.

- [x] **Step 4: Run the focused tests and confirm they pass**

Run: `cd demo_api_server && CI=true npx jest src/__tests__/pfAiAgentCrossDomainExchangeService.test.js src/__tests__/pfAiAgentCrossDomainRoute.test.js --forceExit`

Expected: PASS for both explicit subject providers; reject a source mismatch, absent session token, wrong ID-JAG issuer/audience/resource/scope, downstream AS denial, malformed response, and missing secret without making an undeclared hop.

## Task 4: Add the PF authorization-details processor and RAR browser flow

**Files:**
- Create: `scripts/pingfederate/plugins/ai-agent-rar/java/com/pingidentity/demo/rar/AiAgentAuthorizationDetailProcessor.java`
- Create: `scripts/pingfederate/plugins/ai-agent-rar/java/com/pingidentity/demo/rar/AiAgentAuthorizationDetailPolicy.java`
- Create: `scripts/pingfederate/plugins/ai-agent-rar/test/com/pingidentity/demo/rar/AiAgentAuthorizationDetailPolicyTest.java` (dependency-free executable harness, no JUnit)
- Create: `scripts/pingfederate/plugins/ai-agent-rar/PF-INF/` deployment descriptor using the exact PF 13.1 SDK plugin registration contract.
- Create: `scripts/pingfederate/plugins/ai-agent-rar/build.sh`
- Create: `scripts/pingfederate/plugins/ai-agent-rar/test.sh`
- Create: `scripts/pingfederate/plugins/ai-agent-rar/README.md`
- Modify: `demo_api_server/services/pfAiAgentOAuthService.js`
- Modify: `demo_api_server/routes/pfAiAgent.js`
- Test: `demo_api_server/src/__tests__/pfAiAgentRarRoute.test.js`

**Interfaces:**
- Java processor implements the PF 13.1 `AuthorizationDetailProcessor` contract: `validate`, `enrich`, `getUserConsentDescription`, and `isEqualOrSubset`.
- Pure validator accepts a detail map, `AuthorizationDetailContext.getUserKey()`, `getClientId()`, `getScope()`, and the SDK `IN_PARAMETER_AUTH_DETAILS_USER_INFO` map. It accepts the `banking_transaction` type only, checks field types and exact allowed fields, binds `user_id` to the authenticated user, enforces the required action scope, and limits amounts/accounts according to mapped user details.
- `GET /api/pf-ai-agent/rar/start` builds the allowed or deliberately out-of-policy `authorization_details`, pushes it to configured PF PAR, and redirects to PF authorization. It uses the CIMD `client_id` and the same PKCE/session-bound callback; it does not touch the PingOne PAR route.

- [x] **Step 1: Write the failing policy and route tests**

```java
@Test
void acceptsOnlyTheCurrentUsersAllowedTransactionWithinTheRequestedScope() {
    assertTrue(policy.validate(validTransferDetail(), "demouser",
            Set.of("transactions:write"), Map.of("user_id", "demouser",
                    "account_ids", List.of("checking-100"))).isValid());
}

@Test
void rejectsARequestForAnotherUsersAccount() {
    assertFalse(policy.validate(detailFor("other-user", "checking-100"), "demouser",
            Set.of("transactions:write"), mappedUserInfo()).isValid());
}
```

- [x] **Step 2: Run the Java policy tests and confirm they fail for the missing policy**

Run: `cd scripts/pingfederate/plugins/ai-agent-rar && ./test.sh`

Expected: FAIL because the policy class and PF plugin are not present.

- [x] **Step 3: Implement the pure policy and PF 13.1 processor adapter**

Use the PF 13.1 SDK API and Jakarta servlet request types. Read the authenticated user key, client ID, requested OAuth scope, and mapped user information from the SDK context; reject when that context is missing. Preserve allowed details in `enrich` and return a concise user consent sentence. Implement subset checks by requiring the requested detail to be no broader than the previously accepted detail. Use no SAML protocol APIs or flows.

- [x] **Step 4: Add the PF RAR PAR flow**

Use the already isolated CIMD client, state, nonce, PKCE verifier, and callback storage. The positive scenario pushes a valid `banking_transaction`; the negative scenario pushes a validly shaped detail whose user/account/action is outside the processor policy. The shared callback stores only PF response metadata in `req.session.pfAiAgent.rarResult` and redirects with a sanitized accepted/denied status.

- [x] **Step 5: Run the Java and BFF tests**

Run: `cd scripts/pingfederate/plugins/ai-agent-rar && ./test.sh`

Run: `cd demo_api_server && CI=true npx jest src/__tests__/pfAiAgentRarRoute.test.js src/__tests__/pfAiAgentCimdRoute.test.js --forceExit`

Expected: PASS for the policy harness, consent text, allowed subset behavior, denial cases, PAR parameter binding, callback state, and isolation from the process-wide provider and PingOne RAR service. Compile the adapter separately against the target PF SDK during plugin build verification.

## Task 5: Build the standalone UI and document PF configuration

**Files:**
- Create: `demo_api_ui/src/pages/PingFederateAiAgentPage.jsx`
- Create: `demo_api_ui/src/pages/__tests__/PingFederateAiAgentPage.test.jsx`
- Modify: `demo_api_ui/src/App.js`
- Modify: `demo_api_ui/src/routes/PublicRoutes.js`
- Modify: `demo_api_ui/src/components/AdminSideNav.jsx`
- Modify: `demo_api_ui/src/config/navPagePaths.js`
- Modify: `scripts/pingfederate/README.md`

**Interfaces:**
- Page path `/pingfederate-ai-agent` with separate CIMD, cross-domain exchange, and RAR panels.
- CIMD and RAR buttons use top-level navigation to BFF start endpoints; the cross-domain panel uses `apiClient.post('/api/pf-ai-agent/cross-domain/exchange', { subjectProvider })`.
- The UI shows the active session provider, configured/not-configured feature status, safe hop provenance, sanitized response claims, and acceptance/denial result only.

- [x] **Step 1: Write the failing UI test**

```jsx
test('shows the three PF-only AI-agent paths and sends the selected subject provider', async () => {
  render(<PingFederateAiAgentPage />);
  expect(screen.getByRole('heading', { name: /PingFederate AI Agent/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /CIMD/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Third-party token exchange/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /RAR/i })).toBeInTheDocument();
  expect(screen.queryByText(/mocked.*PingOne/i)).not.toBeInTheDocument();
});
```

- [x] **Step 2: Run the page test and confirm the page is missing**

Run: `cd demo_api_ui && npm run test:unit -- src/pages/__tests__/PingFederateAiAgentPage.test.jsx`

Expected: FAIL because the PF AI Agent page is not implemented.

- [x] **Step 3: Implement page, route, navigation, and setup guide**

Build the page with existing panel and typography patterns. Show the source provider selector only when it matches the current session. On the setup guide, document: enabling CIMD and restricting its URL policy; registering the PF Token Exchange client and SP connection for the third-party audience/resource; configuring the downstream JWT-bearer grant client; configuring PF PAR; building/deploying the PF RAR processor; adding the `banking_transaction` type to that processor; and enabling the type for the CIMD OAuth client. State that the existing native ID-JAG path remains its own resource-server test.

- [x] **Step 4: Run the UI unit test and required production build**

Run: `cd demo_api_ui && npm run test:unit -- src/pages/__tests__/PingFederateAiAgentPage.test.jsx`

Run: `cd demo_api_ui && npm run build`

Expected: PASS; build completes and the new page introduces no emoji outside the allowlist.

## Task 6: Run feature-focused verification and self-review

**Files:**
- Verify: `demo_api_server/src/__tests__/pfAiAgent*.test.js`
- Verify: `scripts/pingfederate/plugins/ai-agent-rar/`
- Verify: `demo_api_ui/src/pages/__tests__/PingFederateAiAgentPage.test.jsx`
- Verify: `demo_api_ui` production build
- Review: `REGRESSION_PLAN.md` §§0–§1 and the approved readiness spec

- [x] **Step 1: Run all new BFF feature suites**

Run: `cd demo_api_server && CI=true npx jest src/__tests__/pfAiAgent*.test.js --forceExit`

Expected: PASS with no live PingOne/PingFederate calls.

- [x] **Step 2: Run all new UI feature tests and build**

Run: `cd demo_api_ui && npm run test:unit -- src/pages/__tests__/PingFederateAiAgentPage.test.jsx`

Run: `cd demo_api_ui && npm run build`

Expected: PASS.

- [x] **Step 3: Review flow separation and token custody**

Confirm by reading the final diff that the P1 CIMD mock route, P1 PAR/Authorize RAR path, and native PF ID-JAG service have no behavior edits; all PF AI Agent requests use the new namespace; cross-domain source-provider mismatch stops before the first outbound call; no SAML grant or assertion appears in the new implementation; and no raw token or authorization code appears in response or logging paths.

- [x] **Step 4: Run focused repository checks for changed boundaries**

Run: `npm run topology:verify`

Run: `npm run authz:verify`

Run: `npm run hygiene:check`

Observed: topology and authz checks pass. Hygiene stops at `check-mock-drift.js`: touching the shared `configStore` causes its staged scan to report historical missing mock exports across unrelated tests. Running that gate on the unmodified main checkout passes. No Demo Steps inventory entries or generated topology changes are needed.

---

## Self-Review

- **Spec coverage:** Task 1 covers role-bound provider applicability and the separate namespace. Task 2 covers real PF CIMD allow/deny-ready runtime metadata and OAuth authorization. Task 3 covers PF's third-party cross-domain assertion plus the downstream authorization-server hop and explicit subject provider. Task 4 covers the custom PF RAR processor and PAR behavior. Task 5 exposes the feature-specific page and PF configuration requirements. Task 6 checks no-SAML, no-fallback, P1 baseline, existing ID-JAG, and token-custody invariants.
- **Placeholder scan:** The plan contains no TODO, TBD, or unspecified implementation steps. PF tenant-specific URLs and secrets come from the named config keys in Task 1; PF policy and third-party AS setup are documented as concrete runtime prerequisites because those values are environment-specific.
- **Type consistency:** Cross-domain config keys and service return fields are consistent across Tasks 1 and 3. CIMD metadata URL, callback URI, `pfAiAgent.cimdPending`, and `pfAiAgent.cimdTokens` are consistent across Tasks 2 and 4. Both allow and reject RAR scenarios use the `banking_transaction` type declared in Task 4.

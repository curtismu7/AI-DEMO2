# PingOne → PingFederate / AIC Migration Analysis

*Analysis date: 2026-08-18. Full-repo dependency sweep + Ping docs verification. For later implementation planning — no code has been changed.*

## TL;DR

The **runtime protocol layer** (OIDC login, RFC 8693 token exchange, PAR, CIBA, introspection, JWKS) is largely portable — PingFederate and AIC both support the same RFCs. But "just Authentication" understates it badly: the app is deeply coupled to PingOne's **control plane**. Roughly **90 files in `demo_api_server/` alone call the PingOne Management API**, and the entire provisioning, Resources/scopes, P1AZ, MFA, DaVinci, and PingOne-MCP surface is proprietary. The AIC MCP server helps with dev-time provisioning but cannot replace the app's *runtime* Management API calls, and it is dev/sandbox-tenant only.

---

## 1. What works (portable, config-swap only)

Spec-conformant surfaces that survive with new issuer/endpoint config:

| Surface | Where | PF / AIC support |
|---|---|---|
| OIDC discovery + issuer validation | `demo_api_server/services/oauthDiscoveryService.js` | Both — already fetches `.well-known/openid-configuration` generically and validates issuer match |
| Auth code + PKCE login | `demo_api_server/routes/oauth.js`, `routes/oauthUser.js`, `services/oauthService.js`, `services/oauthUserService.js` | Both |
| JWKS validation | `services/jwksService.js`, `services/tokenValidationService.js`, `demo_mcp_gateway/src/tokenValidator.ts`, `ping-gateway/scripts/groovy/jwks-token-validation.groovy`, `langchain_agent/src/authentication/token_validator.py` | Both |
| RFC 8693 token exchange | `services/rfc8693TokenExchangeService.js` (canonical) + `oauthService.js`, `a2aDelegationService.js`, `agentMcpTokenService.js`, `subjectTokenService.js`, `delegatedCommerceService.js`, `demo_mcp_gateway/src/auth/McpTokenExchangeClient.ts`, `oauth-mcp/src/auth/TokenExchangeService.ts`, `ping-gateway/scripts/groovy/olb-token-exchange.groovy`, `demo_authz_server/routes/token.js` | Both: PF token exchange grant / processor policies; PingAM (AIC) supports it incl. delegation with actor tokens |
| Introspection (RFC 7662) | `services/tokenIntrospectionService.js`, `demo_authz_server/routes/introspect.js`, `demo_mcp_gateway/src/auth/GatewayIntrospectionClient.ts`, `oauth-mcp/src/auth/TokenIntrospector.ts` | Both — `PINGONE_INTROSPECTION_AUTH_METHOD` (basic/post) toggle already exists, handy for a new AS |
| PAR (RFC 9126) | `services/parService.js`, `routes/parDemo.js` | Both (PF `/as/par.oauth2`; AM supports PAR) |
| CIBA | `services/cibaService.js`, `cibaEnhanced.js`, `cibaSimulatedService.js`, `routes/ciba.js` | Both (PF CIBA endpoint; AIC backchannel request grant + Backchannel Initialize/Status journey nodes). Coupling is only `PINGONE_CIBA_CLIENT_ID/SECRET` falling back to oauthConfig — low cost |
| DPoP | `services/dpopKeyService.js`, `routes/dpopDemo.js` | Standard |
| RFC 9728 protected-resource metadata | `routes/protectedResourceMetadata.js`, `services/rfc9728ComplianceAuditService.js`, `demo_mcp_resource_server/src/index.ts` | Standard |
| Revocation / refresh | `services/tokenRevocation.js`, `services/tokenRefresh.js` | Standard |

### Portability caveats hiding inside "portable" code

1. **`resource` vs `audience`** — `rfc8693TokenExchangeService.js:90` always sends the exchange target as `resource` (RFC 8707 style; comment: "PingOne uses 'resource' for audience") and **never** sends RFC 8693 `audience`. PF/AIC prefer `audience`; whether they accept `resource` the same way depends on config. Every hop (mcp-gw, mcp, resource-server) inherits this. Small code change, touches the whole chain.
2. **`may_act` is the sleeper.** ~45 files reason about `act`/`may_act`, all assuming PingOne populated `may_act` from a **user attribute written via the Management API** (`services/pingOneUserService.js`, provisioning in `pingoneProvisionService.js` / `scripts/bootstrapPingOne.js`). In AIC, token exchange **requires a custom "OAuth2 May Act" script** — AM has no default token-exchange authorization, no wildcards, scripts must enumerate authorized clients/actors. In PF it's attribute-contract / processor-policy work. The claim is standard; how it gets into tokens is 100% PingOne-specific. **This blocks the entire delegation/A2A demo until re-plumbed.**
3. **Hardcoded host shapes** — `auth.pingone.${region}/${envId}/as` fallback at `oauthEndpointResolver.js:19` plus a PingOne-issuer-repair regex (`_PINGONE_ISSUER_NO_AS`, lines 98–103); similar baked-in URL builders in ~10 services (`mfaService.js`, `pingOneAuthorizeService.js:175-176`, `demo_authz_server/pingOneUserLookup.js`, `demo_mcp_gateway/src/config.ts`, `agent_token_service/src/config.ts`, `demo_agent_service/src/config.ts`, `oauth-mcp/src/server/AuthenticationIntegration.ts`, `demo_mcp_resource_server/src/index.ts`, `dev_mcp/banking-dev/src/shared/env.ts`). Mechanical fixes.
4. **Subject/actor token types** — exchange always uses `urn:ietf:params:oauth:token-type:access_token`; no ID-token/JWT subject path exists. Fine if the new AS accepts access tokens as subject tokens.
5. **`ping-gateway/scripts/groovy/olb-token-exchange.groovy:200`** emits a `pingone_error` field in its 401 body — PingOne-shaped error contract leaking into the gateway API.

### Unverified — spike before committing

- **RAR (`authorization_details`, RFC 9396) support on PF and AIC** — the demo uses it (`services/intentTokenService.js`, `demo_mcp_gateway/tests/rarIntentEmptyDetails.test.ts`, `demo_authz_server/tests/decision.rar.test.js`); docs did not confirm support on either target. Mitigation: RAR is enforced in the demo's own Node gateway, which softens the risk.

---

## 2. What breaks (ranked by effort)

### 2.1 Provisioning / bootstrap — the biggest block by far

All speak `api.pingone.com/v1/environments/...` for apps, resources, scopes, grants, populations, groups, users, roleAssignments, signOnPolicies, passwordPolicies, agreements, schemas, app secrets:

- `demo_api_server/services/pingoneProvisionService.js` — **3,896 lines**, master provisioner
- `demo_api_server/scripts/setupFresh.js` — 87 KB full env stand-up
- `demo_api_server/scripts/bootstrapPingOne.js` — 57 KB incl. `may_act` seeding
- `demo_api_server/scripts/refresh-service-envs.js` — 40 KB; reads apps back and rewrites `.env` for every service
- `scripts/importMigrationBundle.js` / `exportMigrationBundle.js` — PingOne-tenant export/import
- `services/pingoneBootstrapService.js`, `services/pingoneManagementService.js`, `scripts/setupResourceServers.js`, `scripts/provisionVerticalGroups.js`, `scripts/setupTratClaims.js`, `scripts/ensureAgentConsentAgreement.js`, `scripts/uninstall.js`
- Root `scripts/`: 38 of 98 reference PingOne (`rebuild-pingone.sh`, `cleanup-pingone-apps.sh`, `pingone-bootstrap.js`, `pac-*.sh`, `gen-scope-topology.js`, `topology-verify.sh`, …)
- Installers: `install.sh` (73 refs), `se-update-pingone.sh` (19), `run.sh` (13), `run-docker.sh` (5), `install-se.sh` (4)

Everything else assumes these ran. AIC equivalents are AM/IDM REST APIs with completely different shapes; PF's is the Admin API (`:9999/pf-admin-api/v1/`). **This is a rewrite, not a port.**

### 2.2 Resources / custom-scopes model (deepest structural coupling)

- `scope-topology.json` (1,500+ lines) — declared SoT for PingOne Resource audiences, per-app scope grants, app names, scope→attribute `mappedClaims`, deployment URLs. Depends on PingOne tenant feature flag `P14C-83315-custom-resource-scope-to-attributes-support`. Its own comment: `pingGatewayResourceUri` "stays on api.ping.demo because it is an OAuth AUDIENCE registered in PingOne… changing it causes invalid_aud."
- Runtime consumers: `demo_api_server/services/scopeTopology.js`, `demo_mcp_gateway/src/auth/scopeTopology.ts`, `config/audConfigTemplate.js`, `config/resourceAudience.js`, `config/scopes.js`, `config/tokenExchangeConfig.js`
- Audience env vars: `PINGONE_RESOURCE_MCP_SERVER_URI` (155 occ.), `_MCP_GATEWAY_URI` (104), `_AGENT_GATEWAY_URI` (66), `_TWO_EXCHANGE_URI` (57), `_PINGGATEWAY_URI` (27)
- **Runtime mutation too:** `services/agentBuilderService.js` creates apps + resources + scopes + grants on the fly for dynamically built agents — a *runtime* Management API dependency, not just setup-time. Also `services/pingoneScopeUpdateService.js`, `services/twoExchangeReconciler.js`.

PingFederate has no "Resource" object (scopes + Access Token Managers + attribute contracts instead); AIC models scopes on the OAuth2 Provider. **Conceptual re-expression, not a URL swap.**

### 2.3 PingOne Authorize (P1AZ)

- `services/pingOneAuthorizeService.js` — PingOne-only decision endpoints (`/decisionEndpoints/{id}`, governance PDP evaluate, recentDecisions, authorizationPolicies)
- `demo_mcp_gateway/src/auth/PingOneAuthorizeClient.ts`, `pingAuthorizeGuard.ts`, `authzPosture.ts`, `middleware/authorizeMcpRequest.ts`, `auth/authorizeObligations.ts`, `tierEnforce.ts`
- `ping-gateway/scripts/groovy/p1az-decision.groovy` + `p1az-readiness.groovy`
- Snapshot import/export: `snapshots/AI_Demo_Transaction_Authorization_P1AZ.snapshot.json`, `snapshots/gen-authorize-snapshot.js`, `se-skills-export/p1az-import-generator/`
- Policy-as-code pipeline: `pac/policies/*.yaml`, `scripts/pac-deploy.sh`, `scripts/check-pac-policy-drift.js`
- UI: `P1AzDashboard.jsx`, `PingOneAuthorizePage.jsx`, `AuthorizeConfigPage.jsx`, `PolicyDecisionTracePage.jsx`, `PingOneAuthorizeCapabilitiesPage.jsx`, `SnapshotImport.jsx`

Neither PF nor AIC has an equivalent cloud PDP (AIC has AM policies; software-suite answer is PingAuthorize, a separate product). **Silver lining / migration asset:** `demo_authz_server/` already mocks the full decision contract, and PingGateway toggles via `P1AZ_MOCK_BASE`/`P1AZ_REAL_BASE`. The demo can run authz entirely on the local mock from day one, deferring the real-PDP decision.

### 2.4 PingOne MFA

`services/mfaService.js` (1,359 lines) — proprietary `POST /deviceAuthentications`, `/users/{id}/devices` with vendor content types (`application/vnd.pingidentity.device.select+json`, `.otp.check+json`, `.assertion.check+json`); requires worker token, rejects user access tokens. Plus `routes/mfa.js`, `routes/mfaTest.js`, `fido2-fix/mfaService.js`, UI (`MFATestPage.tsx`, `SecurityCenter.js`, `SecuritySettings.js`, `Profile.js`), `PINGONE_MFA_POLICY_ID`. **Full rewrite:** AIC does MFA inside journeys; PF via adapters (incl. a PingOne MFA adapter, ironically).

### 2.5 DaVinci + Verified Trust

- `services/davinciFlowClient.js`, `services/verifiedTrustService.js` — hardcoded `https://orchestrate-api.pingone.com/v1`; need `PINGONE_DAVINCI_API_KEY`, `PINGONE_VERIFIED_TRUST_FLOW_ID`. Verified Trust is **fail-open by design** → can be stubbed initially.
- `config/davinci.js`, `routes/davinciLogin.js`, `routes/webhookDavinci.js`, `services/lmdb/davinciEventStore.lmdb.js`, `services/transactionConsentChallenge.js`
- UI: `lib/davinciWidgetClient.js` (widget SDK in package.json), `DavinciLoginPage.jsx`, `DavinciExplainerPage.jsx`, `CIBAPanel.js`
- Flow definitions: `docs/Super_Banking_MCP_Tool_Authorization_DaVinci.json`, `docs/Super_Banking_Transaction_Authorization_DaVinci.json`

AIC's native answer is **journeys** (rewrite); PF has neither. (DaVinci is separately licensable with AIC.)

### 2.6 PingOne hosted MCP admin vertical + PingCLI

- `services/mcpPingOneHttpAdapter.js` (`mcp.pingone.${region}/admin/${envId}/mcp`), `routes/mcpPingOneAdminAuth.js` (port-7474 OAuth), the entire `config/verticals/pingone-admin/` vertical (`list_pingone_tools`, `call_pingone_tool`), `routes/mcpInspector.js`, UI `PingOneMcpInspector.js`, `McpInspectorPage.jsx`
- `routes/pingcli.js` — shells out to `pingcli` binary with generated config; UI `PingCliPage`

**No PF equivalent — delete, or replace with an AIC-MCP-server-backed vertical** (see §4).

### 2.7 Startup coupling

`services/pingoneStartupValidator.js`, `startupConfigGuard.js`, `src/services/startupConfigProbe.js`, `pingOneWorkerPreflight.js`, `checks/gatewayPostureCheck.js` — all probe PingOne on boot; the app **fails or degrades at startup** if PingOne is unreachable. Migration isn't incremental by default; re-point validators first.

### 2.8 Other PingOne-only surfaces

- **Webhooks:** `routes/webhookPingOne.js` + `services/lmdb/pingoneEventStore.lmdb.js` — Ping Activity format parsing
- **Error classifier:** `src/services/pingoneErrorClassifier.js` — PingOne error codes
- **Worker client pattern:** `pingOneTokenAuth.js`, `adminTokenService.js`, `pingOneAdminAccessService.js`, `clientCredentialsTokenService.js` — grant is standard, "Worker app" naming/roles are PingOne-only
- **Users/sessions/directory:** `pingOneUserService.js`, `pingOneUserLookupService.js`, `pingOneAgentUserService.js`, `pingOneSessionService.js` (session termination), `delegationService.js`/`emailService.js` (`/users/{id}/messages` notifications)
- **Console deep-links:** `demo_api_ui/src/utils/pingOneConsoleUrl.js`
- **Helix agent conversations API:** `services/helixLlmService.js` — Ping-internal preview API

### Survives unchanged

- **PingOne Privilege / Procyon gateway** — independent product; survives if it trusts the new issuer (`routes/privilegeMcpClient.js`, `privilegeMcpSimple.js`, UI pages with ~12 hardcoded UUIDs)
- **PingOne Protect** — never actually implemented (narrative/diagram surfaces only). Zero migration cost today.

---

## 3. Architectural decision to make FIRST

"PingFederate **and** AIC" needs a split decision — either can be the OAuth AS:

- **AIC as the AS** (PF only as federation hub if needed): one cloud control plane, journeys replace DaVinci, IDM replaces populations/user provisioning, AIC MCP server becomes relevant. **Cheaper target for this app.**
- **PF as the AS** (AIC as directory/IdP behind it): more moving parts, PF Admin API for all client/scope provisioning, no managed journeys, AIC MCP server helps much less because the token plane isn't in AIC.

**Recommendation:** AIC-as-AS unless PF itself is the point of the demo. Center of gravity (token exchange chains, dynamic client creation, scope topology) fits AIC better.

AIC facts that matter here (from ping-foundation skill):
- Tenant → realm (`alpha`/`bravo`) → clients/journeys/policies; clients are realm-scoped
- OIDC discovery: `https://<tenant>.forgerock.io/am/oauth2/realms/root/realms/<realm>/.well-known/openid-configuration`
- AM REST `…/am/json/`, IDM REST `…/openidm/`
- Token exchange must be enabled per OAuth2 provider AND per client; requires custom May Act script; tokens only exchangeable at the issuing provider

---

## 4. The AIC MCP server: partial save

`@ping-identity/aic-mcp-server` (npm, open-source TypeScript) — **dev-time assist, not a runtime replacement.**

**Covers:** 40+ tools over AIC REST APIs — managed objects (users/roles/groups CRUD), OIDC application CRUD, journeys + decision-node scripts, themes, ESVs (secrets/variables), log queries, feature management.

**Saves:** much of the *setup* half — could do a large share of what `bootstrapPingOne.js`/`setupFresh.js` do, or let an agent author AIC-side config interactively instead of writing a 4,000-line provisioner first. Could also back a replacement `aic-admin` demo vertical (replacing `pingone-admin`).

**Does NOT save:**
- **Sandbox/dev tenants only — explicitly not production**
- Authenticates as an interactive user (PKCE / device code flow), not a service account → the app's **runtime** Management API calls (agentBuilderService dynamic app creation, session termination, `may_act` attribute writes, user lookups) cannot ride on it; those need direct AM/IDM REST calls regardless
- OAuth2 **scope management is not in its tool list**
- Docker deployments exclude application tools

---

## 5. Config surface (swap targets)

- ~90 distinct `PINGONE_*` env vars; top: `PINGONE_ENVIRONMENT_ID` (506 occ.), `PINGONE_REGION` (243), `PINGONE_BASE_URL` (167), plus endpoint vars, one client-id/secret pair per chain hop (~15 pairs), 5 resource-audience URIs, P1AZ vars, DaVinci vars
- 19 `.env.example` files across services; `docker-compose.yml` (90 KB) injects `PINGONE_*` into every service; K8s configmaps + `k8s/create-secrets.sh`; `secrets.vault`
- `demo_api_server/services/configStore.js` — 389 PingOne references (runtime config persistence + FIELD_DEFS)
- `planning/ENV-VAR-CANONICALIZATION.md` already exists — useful groundwork for renaming/abstracting

---

## 6. Test surface

~580 non-artifact test files reference PingOne (demo_api_server 348, demo_api_ui 115, demo_mcp_gateway 36, oauth-mcp 32, demo_authz_server 20, langchain_agent 13).

- **Survive with mocked-issuer swap:** `rfc8693-compliance.test.js`, `rfc9728-*.test.js` (6), `tokenIntrospection.test.js`, `resource-indicators/validation.test.js`, `mcpTokenExchangeClient.test.ts`, `oauth-mcp/tests/rfc9728-compliance.test.js`
- **Break outright (~50 suites asserting PingOne API shapes):** `pingone-api.test.js`, `pingoneProvisionService.regression`, `pingOneAuthorize*` (10+), `mfaService`/vendor content types (4), DaVinci suites (7), `mcpPingOneHttpAdapter`/admin-auth, privilege client suites (10), authz-server parity suites, `scopeTopology.regression`
- **Need a re-provisioned tenant:** `demo_api_server/tests/real/**` (all verticals), `demo_api_ui/tests/e2e/*.real.spec.js` (~15 Playwright), runner `scripts/run-real-tests.sh`
- **Fixtures with baked-in PingOne shape:** `tests/fixtures/trace-chip-run.json` (both server and UI copies) carry `auth.pingone.com` issuers + act-chain claims

Not enumerated: ~120 `docs/` markdown/postman/drawio files also carry PingOne URLs.

---

## 7. Implementation sequencing (rough shape)

**Weekend-sized (login works):**
1. Stand up AIC tenant, `alpha` realm, register BFF OIDC client(s)
2. Point `oauth_issuer` / discovery at AIC; strip the `auth.pingone.*` fallbacks in `oauthEndpointResolver.js`
3. Re-point startup validators (§2.7) so the stack boots
4. Login, JWKS, introspection, static pages work

**Real project:**
5. `resource`→`audience` in `rfc8693TokenExchangeService.js` + all hops; enable token exchange per provider/per client in AIC
6. `may_act`: custom OAuth2 May Act script(s) in AM + IDM attribute plumbing to replace the PingOne user-attribute writes — unblocks delegation/A2A
7. Re-express `scope-topology.json` model against AIC OAuth2 provider scopes; kill the 5 `PINGONE_RESOURCE_*_URI` audiences or remap
8. Provisioning rewrite: AIC MCP server (dev-time) + AM/IDM REST (runtime paths: agentBuilder, sessions, user lookup)
9. P1AZ → run on `demo_authz_server` mock (`P1AZ_MOCK_BASE` seam) initially; decide later between AM policies / PingAuthorize / keeping the mock
10. MFA rewrite (AIC journey-based), DaVinci → journeys, CIBA → backchannel grant + journey nodes
11. Spike RAR support (§1 unverified)

**Delete, don't port:** `pingone-admin` MCP vertical (optionally rebuild as `aic-admin` on the AIC MCP server), PingCLI route, PingOne webhooks, console deep-links.

**Best existing assets:** discovery-driven `oauthDiscoveryService.js`, the `demo_authz_server` P1AZ mock seam, `PINGONE_INTROSPECTION_AUTH_METHOD` toggle, `planning/ENV-VAR-CANONICALIZATION.md`.

---

## Sources

- [AIC MCP server announcement](https://developer.pingidentity.com/blog/introducing-the-aic-mcp-server/) · [github.com/pingidentity/aic-mcp-server](https://github.com/pingidentity/aic-mcp-server)
- [PingAM token exchange](https://docs.pingidentity.com/pingam/8/am-oauth2/token-exchange.html)
- [PF token exchange grant](https://docs.pingidentity.com/pingfederate/13.0/introduction_to_pingfederate/pf_token_exchange_grant.html)
- [PF PAR endpoint](https://docs.pingidentity.com/pingfederate/12.2/developers_reference_guide/pf_pushed_authoriz_request_endpoint.html) · [PF CIBA endpoint](https://docs.pingidentity.com/pingfederate/13.0/developers_reference_guide/pf_ciba_endpoint.html)
- [AIC backchannel grant](https://docs.pingidentity.com/pingoneaic/am-oidc1/openid-connect-backchannel-request-flow.html)

# Survey: Ping product and standards landscape (new standalone demo candidates)

Date of fetches: 2026-10-20. Paths below were verified with ls on 2026-10-20 (A = /Users/cmuir/Development/AI-DEMO2, P = /Users/cmuir/Development/oauthplayground, M = /Users/cmuir/Development/mcp-resource-server).
"Fetched" = WebFetch returned the page text. "Search" = WebSearch summary only. "Own knowledge" = not from a file or fetched page.
Size S/M/L = agent-sessions. Value 1-5 = audience value for a live SE.

## Sources fetched (all 2026-10-20)
- MCP authorization spec (draft): https://modelcontextprotocol.io/specification/draft/basic/authorization  (fetched)
- MCP ext-auth repo: https://github.com/modelcontextprotocol/ext-auth  (fetched; Enterprise-Managed Authorization = stable, Client Credentials = draft)
- OpenID SSF 1.0: https://openid.net/specs/openid-sharedsignals-framework-1_0.html (fetched, published 29 Aug 2025)
- OpenID CAEP 1.0: https://openid.net/specs/openid-caep-1_0.html (fetched, 29 Aug 2025)
- RFC 9470: https://www.rfc-editor.org/rfc/rfc9470.html (fetched)
- RFC 9701: https://www.rfc-editor.org/rfc/rfc9701.html (fetched)
- RFC 9700: https://www.rfc-editor.org/rfc/rfc9700.html (fetched, first 100k chars)
- RFC 9449: https://www.rfc-editor.org/rfc/rfc9449.html (fetched)
- Transaction Tokens: https://datatracker.ietf.org/doc/draft-ietf-oauth-transaction-tokens/ (fetched; -11, 30 Jul 2026, WG consensus, waiting for write-up)
- Browser-based apps: https://datatracker.ietf.org/doc/draft-ietf-oauth-browser-based-apps/ (fetched; page says now RFC 10017 / BCP 212, Aug 2026 - taken as reported)
- CIMD: https://datatracker.ietf.org/doc/draft-ietf-oauth-client-id-metadata-document/ (fetched; -02, 6 Jul 2026)
- OpenID4VP 1.0: https://openid.net/specs/openid-4-verifiable-presentations-1_0.html (fetched; Final, 9 Jul 2025)
- OpenID4VCI 1.0: https://openid.net/specs/openid-4-verifiable-credential-issuance-1_0.html (fetched; Final, 16 Sep 2025)
- AuthZEN 1.0: https://openid.net/specs/authorization-api-1_0.html (fetched; Final, 11 Jan 2026)
- A2A spec: https://a2a-protocol.org/latest/specification/ (fetched, first 100k chars only; auth sections 4.5/7/8.4 NOT read)
- IPSIE WG: https://openid.net/wg/ipsie/ (fetched; no profile levels or dates on page)
- Ping Identity for AI release notes: https://developer.pingidentity.com/identity-for-ai/release-notes/idai-whats-new.html (fetched)
- Search only: Ping Identity for AI GA 31 Mar 2026 (idm.net.au, itwire); PingOne OpenID4VCI docs https://developer.pingidentity.com/pingone-api/credentials/openid4vci-issuance.html; SSF in Ping products (no Ping page found).

Key landscape facts: Ping has Agent Gateway on PingGateway with McpAuditFilter/McpProtectionFilter/McpValidationFilter (31 Mar 2026), PingOne Protect computer-using-agent detection (31 Mar 2026, contact sales), AIC MCP Server and DaVinci MCP Server for admin (search result), PingOne as AS for MCP tutorial (1 Oct 2026). PingOne Credentials documents OpenID4VCI with SD-JWT; OpenID4VP/SD-JWT VC verifier side NOT confirmed. No Ping page found for SSF/CAEP/RISC, DPoP, or FAPI 2.0 on PingOne/AIC (the repo says PF only for DPoP; AI-DEMO2/docs/GARTNER_2026_DIGITAL_IDENTITY_COVERAGE.md line 75 says SSF is "Thin", no product page).

## Candidates (overlap with catalog stated; none duplicates an id outright)

| # | Name | Kind | Value | Size | Overlap |
|---|---|---|---|---|---|
| 1 | RFC 9470 step-up challenge tester | Tester | 4 | S | A5 |
| 2 | SSF stream tester (transmitter+receiver) | Tester | 4 | M | none |
| 3 | Revoke the session, stop the agent (CAEP to agent) | Demo | 5 | M | D14 |
| 4 | Transaction Token (txn-token) lab | Demo | 4 | M | C6, F1 |
| 5 | OAuth security BCP (RFC 9700) scanner | Tester | 5 | M | C4, C15 |
| 6 | Issuer mix-up attack (RFC 9207) demo | Demo | 3 | S | D2 |
| 7 | Audience confusion / token passthrough demo (RFC 8707) | Demo | 4 | S | D2, D8 |
| 8 | Stolen token vs DPoP-bound token | Demo | 4 | S | C9 |
| 9 | SD-JWT VC and disclosure inspector | Tool | 3 | S | C3, A9 |
| 10 | OpenID4VCI offer walker (pre-authorized code, tx_code) | Tester | 3 | M | A9 |
| 11 | FAPI 2.0 profile checker | Tester | 4 | M | C2 |
| 12 | Browser-based app patterns (BFF vs SPA vs mediating backend) | Demo | 4 | M | none |
| 13 | CIMD validator and SSRF guard | Tester | 4 | S | D2 |
| 14 | MCP authorization conformance scorecard | Tester | 5 | M | D2, D3 |
| 15 | MCP scope step-up (insufficient_scope) | Demo | 4 | S | D2, A5 |
| 16 | MCP spec-version negotiation tester | Tester | 3 | S | D3 |
| 17 | MCP URL elicitation for out-of-band consent | Demo | 3 | M | D15 |
| 18 | MCP attack lab (confused deputy, SSRF, passthrough) | Demo | 4 | M | D6, D8 |
| 19 | A2A in-task auth (AUTH_REQUIRED) demo | Demo | 4 | M | D9, D10 |
| 20 | AuthZEN PDP tester | Tester | 5 | M | B1-B5 |
| 21 | Agent Gateway MCP filters lab | Demo | 4 | M | A19, D1 |
| 22 | Human or agent? (Protect CUA detection) | Demo | 4 | M | A6, A7 |
| 23 | Governed admin agent (AIC and DaVinci MCP servers) | Demo | 3 | M | C17, D15 |
| 24 | Leaver cascades to agents (SCIM/lifecycle) | Demo | 4 | M | C14, D11 |
| 25 | Refresh-token rotation and reuse detection | Tester | 3 | S | C12 |
| 26 | SAML bearer assertion grant (legacy to API) | Demo | 3 | S | A16, A15 |
| 27 | JWT introspection response (RFC 9701) variant | Tester | 2 | S | C12 |
| 28 | Consent receipt viewer | Demo | 2 | S | B9, A17 |
| 29 | IPSIE readiness checklist | Tool | 2 | S | A22, C14 |

## Detail

1. RFC 9470 step-up tester. Story: an SE shows an API that answers 401 `insufficient_user_authentication` with acr_values/max_age, the client re-runs authorization, and the new token carries the acr/auth_time. Facts: RFC 9470 fetched (error name, acr_values, max_age, unmet_authentication_requirements). Seeds: A/demo_api_ui/src/utils/wwwAuthenticate.js (parses the challenge; flag ff_rfc9470_challenge), A/demo_api_ui/src/utils/__tests__/wwwAuthenticate.test.js, A/docs/MFA_TEST_PLAN.md. Needs: mock-able; live = PingOne with an acr/auth policy (UNVERIFIED which acr mapping PingOne issues). Overlap A5 (policy-driven step-up demo); different because it tests the protocol shape against any AS.
2. SSF stream tester. Story: a security engineer asks "do you support Shared Signals?"; the SE shows create stream, verification event, push/poll delivery, stream status. Facts: SSF 1.0 and CAEP 1.0 fetched (event types session-revoked, token-claims-change, credential-change, assurance-level-change, device-compliance-change, risk-level-change, plus session-established/presented). Ping support: not found; treat PingOne/PF/AIC as not supporting (community thread says AIC does not, undated). Seeds: none for SSF code; adjacent A/demo_api_ui/src/components/education/KillSwitchMechanismsPanel.js, A/demo_api_ui/public/learning-mirror/agent-kill-switch.html, A/docs/GARTNER_2026_DIGITAL_IDENTITY_COVERAGE.md. Needs: no tenant (mock transmitter + receiver, 2 containers). Honest framing: a standards lab, not a Ping feature.
3. CAEP to agent kill. Story: a user's session is revoked (CAEP session-revoked event, or PingOne session delete via API - own knowledge, UNVERIFIED), the receiver revokes the agent's tokens and the next tool call fails. Seeds: same as 2 plus A/docs/privilege-agent-features.md (exists per ls of docs). Overlap D14 (kill switch); different trigger (identity event, not rate/cost cap). Needs: mock-able; live = PingOne session/token revocation.
4. Txn-token lab. Story: external request enters, a token service exchanges (RFC 8693 profile: requested_token_type txn_token, audience = trust domain, scope required) for a short-lived txn token carrying sub, txn, scope, req_wl, tctx; downstream services see immutable context in the Txn-Token header. Facts: fetched draft -11. NOTE repo docs cite -08/-09 and claim claims "purp/azd"; the fetched draft says those were renamed (scope in -06, tctx in -04) - repo docs need correcting. Seeds: A/docs/TRANSACTION-TOKEN-RFC-SUMMARY.md, A/docs/TX-AT-TOKEN-MODEL.md, A/docs/IETF-AGENT-AUTH-DRAFTS-2026.md, A/docs/superpowers/specs/2026-05-20-transaction-tokens-trat-design.md. Needs: no tenant; no Ping product issues txn-tokens (UNVERIFIED; none found). Overlap C6 (RFC 8693) and F1/F2 (trace envelope); pitch as "the internal-hop token under OBO".
5. RFC 9700 scanner. Story: point at any AS (PingOne, PF, AIC, Okta public test) and get pass/fail on: exact redirect-URI match, PKCE required and downgrade rejected, ROPC/implicit disabled, code single-use, iss response param, S256 only, metadata published. Facts: RFC 9700 fetched (MUST/SHOULD list). Seeds: P/src/flows2/flows/oidcDiscovery.flow.tsx, P/src/pages/JWKSTroubleshooting.tsx, A/docs/RFC-STANDARDS.md, A/standalone/mcp-scanner (pattern for a scanner CLI). Needs: live AS for real results, mock AS for demo mode. Overlap C4 (discovery), C15 (redirect). Strongest "customer asks: is our config safe" tool.
6. Mix-up demo. Story: client talks to a good and an evil AS, evil AS replays a code; without RFC 9207 iss check the code goes to the wrong token endpoint; with it the client aborts. Facts: MCP draft requires recording issuer and RFC 9207 validation table (fetched); RFC 9700 4.4. Seeds: none. Needs: no tenant (2 mock AS containers). Overlap D2.
7. Audience confusion. Story: MCP server accepts a token minted for another resource (passthrough); with RFC 8707 resource + aud check it is rejected. Facts: MCP draft says servers MUST NOT accept other tokens (fetched). Seeds: A/docs/RFC8707_RESOURCE_INDICATORS.md, A/docs/adr/0002-mcp-resource-server-skips-token-introspection.md, M/src. Needs: mock or PingOne (resource indicators support on PingOne: UNVERIFIED). Overlap D2/D8.
8. Stolen token vs DPoP. Story: attacker replays a stolen bearer token; fails when bound by cnf.jkt and DPoP proof with htm/htu/ath/nonce. Facts: RFC 9449 fetched. Seeds: P/src/flows2/flows/dpop.flow.tsx. Needs: PF only per memory (ID-JAG/DPoP = PF only); mock otherwise. Overlap C9 (tester); this is the attack story.
9. SD-JWT VC inspector. Story: paste an SD-JWT VC, see disclosures, hidden claims, key binding. Facts: from OpenID4VP fetch (dc+sd-jwt, DCQL); SD-JWT RFC details own knowledge. Seeds: none; related P/src/pages/URLDecoder.tsx (decoder UI). No tenant. Overlap C3, A9.
10. OpenID4VCI walker. Story: PingOne issues a credential offer; show offer (30-minute validity per search), pre-authorized code, tx_code, nonce endpoint, jwt proof. Facts: VCI 1.0 fetched; PingOne doc by search (verifier side UNVERIFIED). Seeds: none. Needs: PingOne Credentials license, or a mock issuer. Overlap A9 (no existing code there).
11. FAPI 2.0 checker. Story: bank prospect asks for FAPI 2.0; SE runs the checklist (PAR required, PKCE S256, sender-constrained tokens DPoP or mTLS, iss, no implicit) against PF/P1. Facts: FAPI 2.0 final Feb 2025 from search (curity/openid.net results); PF/P1 support UNVERIFIED. Seeds: P/src/flows2/flows/par.flow.tsx, P/src/pages/PARvsRAR.tsx. Overlap C2 (workbench shows features; this scores a profile).
12. Browser-based app patterns. Story: SPA team asks where to keep tokens; show BFF vs token-mediating backend vs pure SPA and what malicious JS can steal. Facts: fetched (page reports RFC 10017/BCP 212; three patterns). Seeds: A/docs/adr/0006-bff-only-token-custody.md (project already BFF-only). Needs: no tenant. Overlap none.
13. CIMD validator. Story: AS fetches client_id URL; show checks (https+path, no redirects followed, client_id match, no secrets, SSRF block of RFC 6890 addresses, redirect_uri policy). Facts: draft -02 fetched. Seeds: A/docs/2026-10-07-cimd-privilege-client-documents.md. Needs: no tenant. Overlap D2.
14. MCP auth conformance scorecard. Story: give a URL; score PRM (RFC 9728), WWW-Authenticate scope, AS metadata, CIMD/DCR, PKCE S256, resource param, iss, 403 insufficient_scope. Facts: MCP draft fetched. Seeds: A/docs/RFC9728_COMPLIANCE_AUDIT_REPORT.md, A/docs/MCP_SPEC_2025_11_25_GAP_ANALYSIS.md, A/standalone/mcp-inspector, A/standalone/mcp-scanner. Overlap D2/D3/D4; different output (spec scorecard, CI-able).
15. MCP scope step-up. Story: tool needing files:write returns 403 insufficient_scope with scope + resource_metadata; client unions scopes and re-authorizes, retries limited. Facts: MCP draft fetched. Seeds: A/demo_api_ui/src/utils/wwwAuthenticate.js, M/src/tools. Needs: PingOne or mock. Overlap D2, A5.
16. MCP version negotiation tester. Story: dual-stack server vs 2025-11-25 and the 2026-07-28 RC clients. Facts: A/docs/MCP_2026_07_28_PHASE1.md (repo doc, RC date as stated there - UNVERIFIED externally). Seeds: M/src/modernNegotiation.ts, M/src/serverDiscover.ts. Overlap D3.
17. MCP URL elicitation. Story: tool needs the user to consent/authenticate out of band; server elicits via URL, user approves in browser, call resumes. Seeds: A/docs/MCP_ELICITATION_IMPLEMENTATION.md, A/docs/superpowers/specs/2026-05-20-education-panels-elicitation-design.md. Spec detail UNVERIFIED externally. Overlap D15.
18. MCP attack lab. Story: confused deputy via static client + DCR, token passthrough, SSRF via metadata, session hijack, each blocked by a named control. Facts: MCP draft security-considerations is linked, not fetched (UNVERIFIED section content). Seeds: A/standalone/hostile-mcp-server, A/standalone/mcp-scanner. Overlap D6/D8.
19. A2A in-task auth. Story: remote agent returns task state AUTH_REQUIRED; client obtains delegated token (OBO) and resumes; extended agent card shown only after auth. Facts: A2A spec excerpt fetched (extended card 3.1.11, TASK_STATE_AUTH_REQUIRED 4.1.3, A2A-Version header); section 7.6 NOT read. Seeds: A/docs/a2a-card-discovery.mmd, A/docs/A2A_ARCHITECTURE.md, A/standalone/hostile-a2a-agent. Overlap D9, D10.
20. AuthZEN PDP tester. Story: send one standard Access Evaluation request (subject/action/resource/context) to Cedar, PingOne Authorize and OPA-style PDPs and compare decisions; fetch /.well-known/authzen-configuration. Facts: AuthZEN 1.0 final 11 Jan 2026 fetched. Seeds: A/docs/education-panels.md (AuthZenPanel section), A/docs/PINGONE_AUTHORIZE_PLAN.md, A/docs/pingauthorize-policy-parity.md. Needs: mock PDP works; Ping Authorize AuthZEN endpoint UNVERIFIED. Overlap B1-B5 (policy engines), none for the standard API.
21. Agent Gateway lab. Story: PingGateway in front of an MCP server with McpValidationFilter/McpProtectionFilter/McpAuditFilter: validates delegation token, enforces scope, audits, throttles. Facts: Ping release notes fetched (31 Mar 2026). Seeds: A/ping-gateway (README.md, config, docker-compose.yml), A/docs/pinggateway-agent-plan.md. Needs: PingGateway license/image (UNVERIFIED availability). Overlap A19, D1.
22. Human or agent. Story: Protect flags computer-using agents (browser fingerprint, behavior); show allow / step-up / block. Facts: release notes fetched (Mar 31 2026; contact sales). Seeds: P/src/v8/flows/PingOneProtectFlowV8.tsx. Needs: Protect licence; mock signals possible. Overlap A6, A7.
23. Governed admin agent. Story: an agent administers AIC or DaVinci via Ping's MCP servers, with writes held for approval. Facts: search result only. Seeds: A/docs/pingone-mcp-server-report.md, skill pingone-mcp. Overlap C17, D15.
24. Leaver cascades. Story: HR disables a user (SCIM or PingOne API), the user's agents and delegated tokens die. Facts: own knowledge for PingOne provisioning; UNVERIFIED. Seeds: A/docs/privilege-agent-features.md, A/docs/PINGONE-WEBHOOK.md, P/src/pages/PingOneWebhookViewer.tsx. Overlap C14, C16, D11.
25. Refresh rotation tester. Story: replay an old refresh token, AS revokes the family. Facts: RFC 9700 2.2.2 fetched. Seeds: P/src/flows2/flows/refreshToken.flow.tsx, tokenRevocation.flow.tsx. PingOne behaviour UNVERIFIED. Overlap C12.
26. SAML bearer grant. Story: legacy SAML assertion swapped for an OAuth token. Seeds: P/src/flows2/flows/samlBearerAssertion.flow.tsx. Needs PF (own knowledge). Overlap A16/A15.
27. RFC 9701 tester. Story: RS asks for application/token-introspection+jwt; validate typ, iss, aud, iat, token_introspection.active. Facts: RFC 9701 fetched. Seeds: A/docs/INTROSPECTION_VALIDATION_GUIDE.md, P/src/flows2/flows/tokenIntrospection.flow.tsx. Ping support UNVERIFIED. Recommend folding into C12 rather than a repo.
28. Consent receipt viewer. Story: every grant produces a machine-readable receipt. Kantara receipt spec: own knowledge, not fetched. Seeds: A/docs/ACT_ONLY_DELEGATION_MODEL.md. Recommend fold into B9.
29. IPSIE readiness. Story: checklist of OIDC + SSF + SCIM + logout + revocation. Facts: IPSIE page fetched but gave no profile content. Low confidence; fold into notes.

## Not covered
- Ping docs for DPoP/FAPI 2.0 on PF/P1/AIC (searches found no Ping pages); PingAccess/PingDirectory product pages (not fetched).
- A2A auth sections 7 and 8.4 (signed cards) were beyond the fetched 100k characters.
- WebAuthn conditional UI, CIBA, device grant, SCIM tester, OAuth 2.1 draft: already in catalog (A2, A4, C11, C14) or covered under overlaps.
- MCP security best-practices page not fetched.

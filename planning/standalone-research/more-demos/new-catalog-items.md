# New catalog items for the Standalone Demo Family (editor's merge)

Date: 2026-10-20 · Status: PROPOSAL, read-only survey output, nothing built · Extends `planning/standalone-demo-family-plan.md` (94 items, A1-F10)

## How to read this

- **Inputs:** the plan's catalog (read in full) and five survey reports in this folder (`survey-usecases.md`, `survey-services.md`, `survey-skills.md`, `survey-repos.md`, `survey-landscape.md`). The structured candidate list handed to me was cut off mid-way (it ended inside the repos survey, at the "JWT/SAML bearer grant tester"). I recovered the missing tail from `survey-repos.md` and `survey-landscape.md`, so the 148 candidates are all accounted for below.
- **Result:** 148 candidates become **62 new rows** (A4, B5, C6, D27, E5, G11, H4, F0), **37 dropped as already covered** by a catalog id (they become seed additions), and **13 declined** (no home, too weak or unsafe).
- **Seed markers** follow the plan: ✅ substantial code exists, 🟡 partial, ❌ nothing yet. Paths are relative to `/Users/cmuir/Development/AI-DEMO2` ("A") unless a full path is given. I ran `ls` on 150+ of the cited paths on 2026-10-20 and all exist; the rest are marked UNVERIFIED. The AI-DEMO2 checkout may be behind origin.
- **Honesty flags:** "(own knowledge)" = not from a file or fetched page. "UNVERIFIED" = not confirmed in a file. Spec and product facts from the landscape survey were fetched by that surveyor on 2026-10-20; I did not re-fetch them (listed in `claimsToVerify`).
- **Size** S/M/L = agent-sessions. **Value** 1-5 = live-SE audience value.

## New groups

The plan's groups A-F stay. Two new groups hold items that do not fit them:

- **G. Platform and admin tools for SEs.** Tools that make every other demo cheaper to set up, run or clean up (tenant bootstrap, mock servers, tenant hygiene). Not customer stories.
- **H. Standards and interop labs.** Labs for open standards outside OAuth tokens (Shared Signals, credentials, HTTP signatures, browser-app guidance). Honest framing: some are standards labs, not Ping features.

No group I (industry demos): caregiver, booking, commerce and mortgage are vertical flavours of the base's vertical packs (E5), so they stay in A-D with a vertical pack, not their own group. No new F rows: every telemetry candidate was a seed for F1/F4/F7.

---

## A. Identity and authentication: Ping products (new: A24-A27)

| ID | Name | Kind | What it shows | Seed |
|---|---|---|---|---|
| A24 | **Support console with customer identity gate** | Demo | A support rep and an ops AI assistant cannot see a customer record until the customer proves identity by OTP on their own device through pi.flow; the BFF holds the customer token and the console sees only masked contacts. Works across 10 verticals via a config file | ✅ `demo_api_ui/src/components/supportConsole/` (SupportConsole.jsx, IdentityGate.jsx, OpsAssistantChat.jsx, supportConsoleConfig.js, resolvePermission.js); `demo_hitl_service`. Real-delegation design (impl status UNVERIFIED): `docs/superpowers/specs/2026-10-11-support-console-real-delegation-design.md` |
| A25 | **PingFederate + PingOne MFA wiring kit** | Demo | Customers on PingFederate add PingOne MFA (OTP, FIDO2, passwordless, step-up) without replacing PF: wire connection, adapter and policy, then run each flow | ✅ `scripts/pingfederate/create-pingone-mfa-adapter.js`, `create-pingone-connection.js`, `enable-pf-mfa-step-up.js`, `enable-pf-passwordless.js`, `scripts/test-mfa.js`, `docs/MFA_TEST_PLAN.md`, `docs/PINGFEDERATE_MFA_STATUS.md` |
| A26 | **PingFederate + DaVinci integration kit** | Demo | A PF authentication policy runs a DaVinci flow while PF stays in control of the session | ✅ `demo_api_ui/src/pages/PingFederateDavinciKitPage.jsx`, `demo_api_server/routes/pfDavinciAuth.js`, `docs/use-cases/pingfederate-davinci-integration-kit.md` |
| A27 | **Human or agent? (Protect computer-using-agent detection)** | Demo | Protect flags a computer-using agent by browser fingerprint and behaviour; allow, step-up or block. Per the Ping release notes the feature is "contact sales" (fetched by landscape surveyor) | 🟡 `/Users/cmuir/Development/oauthplayground/src/v8/flows/PingOneProtectFlowV8.tsx`, `se-skills-export/pingone-protect-ai-demo`, `demo_api_server/services/pingOneProtectService.js` (53 lines) |

## B. Authorization and policy (new: B10-B14)

| ID | Name | Kind | What it shows | Seed |
|---|---|---|---|---|
| B10 | **AuthZEN PDP tester** | Tester | Send one standard Access Evaluation request (subject, action, resource, context) to Cedar, PingOne Authorize and an OPA-style PDP and compare decisions; fetch `/.well-known/authzen-configuration`. AuthZEN 1.0 is Final (11 Jan 2026, fetched). Whether PingOne Authorize exposes an AuthZEN endpoint is UNVERIFIED, so P1AZ may need an adapter | 🟡 `docs/education-panels.md` (AuthZenPanel section), `docs/PINGONE_AUTHORIZE_PLAN.md`, `docs/pingauthorize-policy-parity.md` |
| B11 | **API access management side-band (PingGateway + P1 Authorize)** | Demo | An API owner gets permit/deny decisions without touching the API: PingGateway asks PingOne Authorize side-band using age and region headers, proxies to a content API, decision shown per request. 3 containers (gateway, api, page) | ✅ `/Users/cmuir/Development/content-api-aam-demo/` (README.md, `policy/restrictions.yaml`, ping-gateway, content-api, demo-page; jest tests). Live needs an AAM gateway credential (console setup half done per its docs); mock = local evaluator of the YAML rules. Also `se-skills-export/pingauthorize-aam-ai-demo/SKILL.md`, `docs/p1az-vs-gateway-token-checks.md` |
| B12 | **P1AZ plain-language policy generator and offline deny predictor** | Tool | Type rules in plain words, get an importable PingOne Authorize snapshot, then predict offline which deny rules fire. Obstacle: no API to import or evaluate a P1AZ policy, so the loop is edit, import, publish, replay. Import stays a manual console step. Also walks a policy tree via the EA Admin API (stability UNVERIFIED) | ✅ `se-skills-export/p1az-import-generator/SKILL.md` + `reference/example-import.snapshot.json`, `scripts/predict-p1az-denies.mjs`, `se-skills-export/pingone-authorize-ea-api-build/scripts/walk_policy_tree.py`, `docs/P1AZ_TOKENACTIVE_RULE_SETUP.md` |
| B13 | **Intent-bound transactions (PAR + RAR + intent token)** | Demo | A user authorizes "transfer up to X to payee Y" via a pushed request; the agent tries more or a different payee and is denied at the gateway; tampered or expired intent tokens are caught. Merges the money-movement demo, the tamper tester and the TraT/intent-binding demo | 🟡 `demo_api_server/services/intentTokenService.js`, `demo_mcp_gateway/src/rarEnforce.ts`, `demo_mcp_gateway/src/intentTokenValidator.ts`, `demo_authz_server/decision.intentTamper.test.js`, `decision.confused-deputy.test.js`, `demo_api_ui/src/pages/IntentInspectorPage.jsx`, `demo_api_server/routes/intentBinding.js`, `docs/INTENT_AUTHORIZATION_GUIDE.md`. UC15 (intent-token tampering) is `needs-build` per the usecases survey. Real PAR/RAR needs live P1 or PF; RAR support on PingOne UNVERIFIED |
| B14 | **Multi-party (caregiver) delegation** | Demo | A consumer authorizes a caregiver and the caregiver's agent within purpose, scope and expiry; low-risk reads pass, treatment changes are denied or approval-gated. Different from B9: a third-party delegate | 🟡 `demo_api_ui/src/pages/StandaloneDemoLauncherPage.jsx` (scenarios), `demo_api_ui/src/learning/lessonCatalog.js`, `demo_mcp_resource_server/seed/healthcare.seed.json` |

## C. Tokens and protocols (new: C20-C25)

| ID | Name | Kind | What it shows | Seed |
|---|---|---|---|---|
| C20 | **OAuth profile checker (RFC 9700 BCP + FAPI 2.0 pack)** | Tester | Point at any authorization server and get pass/fail on: exact redirect-URI match, PKCE required and downgrade rejected, ROPC/implicit off, single-use code, `iss` response param, S256 only, metadata published. A second rule pack scores FAPI 2.0 (PAR, S256, sender-constrained tokens, no implicit). RFC 9700 fetched; FAPI 2.0 final Feb 2025 came from search only, and whether PF/P1/AIC meet it is UNVERIFIED | 🟡 `/Users/cmuir/Development/oauthplayground/src/flows2/flows/oidcDiscovery.flow.tsx`, `.../par.flow.tsx`, `.../src/pages/PARvsRAR.tsx`, `docs/RFC-STANDARDS.md`, `standalone/mcp-scanner` (pattern for a scanner CLI) |
| C21 | **Step-up challenge tester (RFC 9470 + MCP insufficient_scope)** | Tester | An API answers 401 `insufficient_user_authentication` (acr_values, max_age) or 403 `insufficient_scope`; the client re-runs authorization; the new token carries the acr/auth_time or the unioned scopes. Tests the protocol shape against any AS. Which acr PingOne issues is UNVERIFIED | ✅ `demo_api_ui/src/utils/wwwAuthenticate.js` (+ test; flag `ff_rfc9470_challenge`), `docs/MFA_TEST_PLAN.md` |
| C22 | **Stolen-token lab (bearer vs DPoP / mTLS at the gateway)** | Demo | An attacker replays a captured agent token; audience binding and key binding (DPoP `cnf.jkt` + proof with htm/htu/ath/nonce, or mTLS) make it unusable; an over-broad `authorization_details` request is clipped. DPoP is PingFederate-only in the Ping stack (plan decision); mock-able otherwise. Merges the replay story, the DPoP attack story and the gateway enforcement lab | 🟡 `demo_mcp_gateway/src/dpopVerify.ts`, `mtls.ts`, `rarEnforce.ts`, `demo_mcp_gateway/src/middleware/authorizeMcpRequest.ts`, `demo_api_server/services/dpopKeyService.js`, `/Users/cmuir/Development/oauthplayground/src/flows2/flows/dpop.flow.tsx` |
| C23 | **Wrong-token rejection tester** | Tester | "What happens when my agent sends the wrong token?" Sends wrong-scope, wrong-audience, expired and user-vs-agent tokens (plus RFC 8707 passthrough) to an MCP resource server and shows each educational error | ✅ `demo_api_ui/src/components/TokenSecurityTester.jsx`, `demo_api_ui/src/components/__tests__/AIAgent.wrongAudience.test.js`, `AIAgent.wrongScope.test.js`, `demo_mcp_gateway/src/tokenValidator.ts`, `docs/RFC8707_RESOURCE_INDICATORS.md` |
| C24 | **JWT and SAML bearer grant tester (RFC 7523 / 7522)** | Tester | Send a SAML or JWT bearer assertion to a token endpoint and read the result; the legacy-SSO-to-API story. PF-side is own knowledge. The "SAML to ID-JAG bridge" is a mode of C1, not this item | 🟡 `/Users/cmuir/Development/oauthplayground/src/flows2/flows/samlBearerAssertion.flow.tsx`, `.../src/pages/flows/JWTBearerFlow.tsx`, `scripts/pingfederate/configure-saml-idjag.js` |
| C25 | **Transaction Token (txn-token) lab** | Demo | An external request enters; a token service exchanges (RFC 8693 profile, `requested_token_type` txn_token) for a short-lived token carrying sub, txn, scope, req_wl, tctx; downstream services see immutable context. Pitched as "the internal-hop token under OBO". No Ping product issues txn-tokens (none found; UNVERIFIED). **Repo docs are stale vs draft -11** (see Decisions) | 🟡 `docs/TRANSACTION-TOKEN-RFC-SUMMARY.md`, `docs/TX-AT-TOKEN-MODEL.md`, `docs/IETF-AGENT-AUTH-DRAFTS-2026.md`, `demo_api_server/scripts/setupTratClaims.js`, `docs/superpowers/specs/2026-05-20-transaction-tokens-trat-design.md` |

## D. Agents, MCP and AI security (new: D27-D53)

| ID | Name | Kind | What it shows | Seed |
|---|---|---|---|---|
| D27 | **Governing the PingOne and AIC admin MCP servers** | Demo | An agent administers the IdP itself through Ping's own MCP server and Privilege applies per-tool policy (read free, writes held for approval). AIC and DaVinci MCP servers exist per a search result only (UNVERIFIED) | ✅ `demo_mcp_pingone/README.md` (runs `pingidentity/pingone-mcp-server` as sidecar), `pingone/pingone-mcp/SKILL.md`, `demo_api_ui/src/components/PingOneMcpInspector.js`, `docs/pingone-mcp-server-report.md` |
| D28 | **Enterprise-managed MCP access and central revocation** | Demo | Employee signs in once; IT pre-approves MCP servers (no per-server consent) and revokes in one console when someone changes teams; native ID-JAG underneath. **Overlaps C1 heavily: likely a mode of the ID-JAG kit, not a new repo (Decision 2)** | ✅ `demo_api_server/services/enterpriseMcpPolicyService.js`, `enterpriseMcpMetadata.js`, `idJagService.js`, `demo_api_server/routes/enterpriseIdp.js`, `oauth-mcp/src/oauth/IdJagGrantHandler.ts`, `demo_mcp_gateway/src/enterpriseMcpAuth.ts`, `planning/ENTERPRISE-MANAGED-MCP-AUTH-PLAN.md` (plan only). The plan says PingOne has no native ID-JAG, so PF is needed |
| D29 | **Progressive trust ladder** | Demo | A bank customer's personal agent starts public (no sign-in), then needs sign-in, in-app step-up and CIBA approval as risk rises; each rung gated by Ping | ✅ `docs/planning/PLAN-progressive-trust-demo.md`, `demo_api_server/services/agentModeResolver.js`, `demo_api_server/data/publicBranchCatalog.js`, `demo_api_server/routes/ciba.js` |
| D30 | **Consumer agent booking** | Demo | "Book a flight under $800": the price must pass a transaction policy and a human must approve; token exchange, PingOne Authorize, HITL receipt. D24 (curated use cases) would otherwise hold it as a subset | ✅ `demo_mcp_resource_server/src/tools/airlinesToolHandler.ts`, `src/db/airlinesDb.ts`, `demo_api_server/services/mcpToolAuthorizationService.js`, `demo_api_server/config/verticals/airlines/manifest.json` |
| D31 | **No tool, no promise (tool set as authorization boundary)** | Demo | A chat agent is asked to waive a fee and would promise it; no waive tool exists, so no commitment can be made. Fully mock-able, no tenant (UC28; the "Air Canada pattern" is named in the UC title only) | ✅ `oauth-mcp/src/tools/BankingToolRegistry.ts`, `oauth-mcp/src/tools/handlers/commitmentHandlers.ts`, `demo_api_server/services/intentTokenService.js`, `docs/use-cases/unauthorized-commitment-fee-waiver.md` |
| D32 | **Agent Gateway MCP tool guard** | Demo | Weather and web-search MCP tools allowed only for the business footprint and no crypto queries; PingGateway filters tool arguments before the vendor runs, and policy is flipped live. Per release notes, Agent Gateway ships McpValidation/Protection/Audit filters on PingGateway (31 Mar 2026, fetched); image availability UNVERIFIED. Brave needs an API key live (mock UNVERIFIED) | ✅ `ping-gateway/scripts/groovy/tx-weather-scope.groovy`, `tx-brave-scope.groovy`, `ping-gateway/config/routes/00-mcp-weather.json`, `00-mcp-brave.json`, `demo_mcp_weather`, `demo_mcp_brave`, `docs/pinggateway-agent-plan.md` |
| D33 | **Agent attack gallery** | Tester | An SE launches named attacks (wrong scope, other user's account, bad client, rogue actor in `act`, impersonation, raw token forwarding) and sees each refused with the reason. D13 explains denials; this launches the attacks | ✅ `demo_api_server/routes/attackSimulator.js`, `demoAttackSeeds.js`, `demo_api_server/services/attackSimulatorService.js`, `demo_mcp_gateway/src/auth/GatewayTokenPolicy.ts`, `demo_authz_server/routes/decision.js`, `docs/use-cases/confused-deputy-actor-injection.md` |
| D34 | **MCP authorization attack lab** | Demo | Issuer mix-up (RFC 9207: good vs evil AS), token passthrough / audience confusion (RFC 8707), confused deputy via static client + DCR, SSRF via metadata, each blocked by a named control. The MCP security-considerations section was linked, not fetched (UNVERIFIED) | 🟡 `standalone/hostile-mcp-server`, `standalone/mcp-scanner`, `docs/RFC8707_RESOURCE_INDICATORS.md`, `docs/adr/0002-mcp-resource-server-skips-token-introspection.md`. Mix-up needs two mock AS containers |
| D35 | **MCP authorization conformance scorecard** | Tester | Give a URL; score PRM (RFC 9728), WWW-Authenticate scope, AS metadata, CIMD/DCR, PKCE S256, `resource` param, `iss`, 403 insufficient_scope, and spec-version negotiation (2025-11-25 vs the 2026-07-28 RC claimed by a repo doc). CI-able spec scorecard, unlike D3 (inspect) and D4 (risky tools) | ✅ `docs/RFC9728_COMPLIANCE_AUDIT_REPORT.md`, `docs/MCP_SPEC_2025_11_25_GAP_ANALYSIS.md`, `docs/MCP_2026_07_28_PHASE1.md`, `standalone/mcp-inspector`, `standalone/mcp-scanner`, `/Users/cmuir/Development/mcp-resource-server/src/modernNegotiation.ts` (UNVERIFIED path) |
| D36 | **CIMD lab (generate, validate, register an agent)** | Demo/Tester | A client-ID metadata document: generate one, fetch by URL, validate (https path, no redirects, client_id match, no secrets, SSRF block of RFC 6890 ranges), show why a gateway refuses it; then a partner agent registers by publishing it. CIMD draft -02, 6 Jul 2026 (fetched). D2 only names CIMD | ✅ `demo_api_ui/src/components/CimdSimPanel.js`, `demo_api_ui/src/components/cimdPrivilege/`, `demo_api_server/services/personalAgentCimdService.js`, `demo_api_server/routes/cimdAgentMetadata.js`, `docs/2026-10-07-cimd-privilege-client-documents.md` |
| D37 | **MCP elicitation lab** | Demo | An MCP server mid-call needs more input or URL consent; the client shows a form or URL dialog; accept/decline/cancel and error -32042 are mapped. Spec version claims come from a repo doc, UNVERIFIED externally | ✅ `demo_mcp_gateway/src/elicitationStore.ts`, `demo_api_ui/src/components/ElicitationDialog.jsx`, `ElicitationModal.js`, `docs/MCP_ELICITATION_IMPLEMENTATION.md` |
| D38 | **A2A in-task auth (AUTH_REQUIRED) and extended card** | Demo | A remote agent returns task state AUTH_REQUIRED; the client obtains a delegated token and resumes; the extended agent card appears only after auth. A2A spec: only the first 100k chars were fetched, auth sections 7 and 8.4 NOT read (UNVERIFIED) | 🟡 `docs/A2A_ARCHITECTURE.md`, `docs/a2a-card-discovery.mmd` (note: a mermaid file, convert to ReactFlow data), `standalone/hostile-a2a-agent` |
| D39 | **A2A trust tester (unauthorized caller, signed card, verified-trust assertion)** | Tester | Three probes: an unauthorized agent drives a specialist over A2A JSON-RPC with no bearer (gateway verdict shown); a signed agent card verifies with real jose; a signed assertion lets a receiving org verify the sender where a bearer cannot. Flag `ff_verified_trust_a2a` | ✅ `demo_api_ui/src/components/InterAgentAbuseTester.jsx`, `demo_authz_server/decision.a2a.test.js`, `demo_api_server/scripts/verifyCardSigningInterop.mjs`, `demo_api_server/services/verifiedTrustService.js`, `a2aAgentCardService.js`, `standalone/hostile-a2a-agent` |
| D40 | **Stateless HITL challenge and receipt binding** | Demo | A sensitive tool call gets 401 with a WWW-Authenticate challenge and transaction_id; the UI shows an OTP or QR widget; the agent retries with a receipt bound to caller, agent, tool and arguments; replaying a $10 approval for $5000 is refused. Differs from D15 (hold, approve, retry). Real mode needs P1 Authorize and a gateway (Kong in the source; PingGateway UNVERIFIED) | ✅ `/Users/cmuir/Development/NotFlux-MCP-main/docs/HITL.md` (not read in full), `.../src/index.ts`, `.../notflux-app/frontend`; `demo_hitl_service/src/receiptVerification.js`, `demo_hitl_service/tests/challenges.verify.test.js` |
| D41 | **Agent lifecycle with IGA and leaver cascade** | Demo | Governance sees live AI agents authenticating through Ping (NHI inventory), gets join/move/leave events forwarded to an IGA tool (SailPoint-style; a stub target likely works, UNVERIFIED); and when HR disables a user, that user's agents and delegated tokens die. PingOne provisioning behaviour is own knowledge | ✅ `demo_api_server/services/controlPlane/liveAgentInfo.js`, `agentLifecycleEvents.js`, `sailpointForwarder.js`, `demo_api_server/services/lmdb/agentLifecycleEventStore.lmdb.js`, `demo_api_ui/src/components/ControlPlaneRoster.jsx`, `docs/privilege-agent-features.md`, `docs/PINGONE-WEBHOOK.md` |
| D42 | **Ungoverned agent: before and after (session riding)** | Demo | An agent drives the user's logged-in browser session and moves money, looking identical to the user in logs; the governed path shows a distinct actor and scope. The standalone "before" picture to pair with any governed demo. Different threat from D6 (hostile server). No tenant needed for the "before" half | ✅ `demo_ungoverned_agent/agent.js` (+ `run-with-token.sh`), `demo_api_ui/src/components/UngovernedAgentPage.js`, `docs/use-cases/ungoverned-agent.md`, `docs/runbooks/ungoverned-agent-opencli.md`, `standalone/hostile-mcp-server` |
| D43 | **Agent-token broker for third-party platforms (Copilot Studio)** | Demo | A Copilot Studio agent needs a PingOne AI_AGENT identity but must never hold the client secret; a broker holds it and callers hold one API key; rotate in one place. Copilot Studio behaviour is from the repo runbook, UNVERIFIED | ✅ `agent_token_service/README.md`, `agent_token_service/src`, `docs/COPILOT_PART3_RUNBOOK.md`, `demo_api_ui/src/components/CopilotAgent.jsx` |
| D44 | **Bedrock AgentCore + PingOne agent** | Demo | An agent hosted on AWS Bedrock AgentCore Runtime authenticates with PingOne for M2M and user-federated (3LO) flows. Skill says verified 2026-08-12 against SDK 1.21.0. Needs an AWS account; no runnable sample found (UNVERIFIED) | 🟡 `se-skills-export/bedrock-agentcore-pingone/SKILL.md`, `/Users/cmuir/Development/se-skill-catalog/skills/bedrock-agentcore-pingone` (+ references) |
| D45 | **Bring your own agent framework (LangChain, LlamaIndex, Pydantic AI)** | Demo | A customer team on LangChain or LlamaIndex sees the same OAuth, token exchange and gateway working from each framework; includes the AML compliance agent as a Pydantic AI example. L because three runtimes | ✅ `langchain_agent/README.md`, `langchain_agent/src`, `llamaindex_agent/agent.py`, `compliance_agent/agent.py` + `rules.py` (mock-able), `docs/AGENT_FRAMEWORK_COMPARISON.md` |
| D46 | **Real MCP clients kit (LibreChat, LM Studio, Muse)** | Demo | Unmodified real MCP clients do RFC 9728 discovery, DCR and PKCE against the governed door (standard lane and AI-gateway lane). Overlaps D2/D25, kept because of the pre-wired client stacks | ✅ `librechat/docker-compose.yml`, `librechat/seed-demo-agents.js`, `lmstudio/mcp.json`, `lmstudio/demo-steps.json`, `oauth-mcp/src/oauth/OAuthRouter.ts`, `docs/EXTERNAL_DOOR_MCP_FLOW.md` |
| D47 | **Privilege A2A access review** | Demo | A security analyst asks an agent to review access; a delegated worker gathers evidence through governed hops; a three-deep chain controls who may call whom. Already largely standalone inside AI-DEMO2; needs an Anthropic API key and the Privilege gateway live | ✅ `standalone/privilege-a2a-anthropic-demo/src/main-agent/chain.ts`, `.../worker-agent/index.ts`, `langchain_agent/src/agent/a2a_delegation.py`, `demo_api_server/routes/privilegeA2aClient.js` |
| D48 | **Protected RAG (authorization on retrieval + grounding on/off)** | Demo | A developer asks an indexed repo questions through an MCP search tool while authorization controls who may search which codebase; plus the same agent with grounding off vs on. Needs Weaviate and an LLM, partly mock. Authorization story for grounded documents UNVERIFIED | 🟡 `demo_mcp_code_search`, `demo_api_ui/src/pages/CodeSearchPage.jsx`, `demo_api_ui/src/components/CodebaseUploader.jsx`, `llamaindex_agent/retriever.py`, `docs/knowledge-grounding-demo-script.md` |
| D49 | **Delegated-agent commerce lifecycle** | Demo | A shopper registers an agent, claims it with a code, consents, the agent buys through a protected MCP call, CIBA approves the big one, the shopper revokes | ✅ `demo_api_ui/src/pages/DelegatedCommercePage.jsx`, `demo_api_ui/src/config/delegatedCommerceDiagram.js`, `demo_api_server/routes/delegatedCommerce.js` |
| D50 | **SaaS-embedded worker** | Demo | A SaaS site embeds a worker that acts for a signed-in customer (miles redemption, CRM-style accounts and cases) under delegated identity while keeping its own workload identity. Distinct from D22 (autonomous worker) | ✅ `demo_api_server/routes/embeddedWorker.js`, `demo_api_server/services/agentBuilderService.js`, `demo_api_ui/src/pages/EmbeddedWorkerPage.jsx`, `demo_api_ui/src/components/aiFootprintMocks` |
| D51 | **JIT tool-bound credential broker** | Demo | A platform team removes the static backend API key from the wire; a broker mints short-TTL tool-bound credentials; replaying one against another tool fails. No Ping product tie-in confirmed (UNVERIFIED), so frame it carefully | ✅ `demo_api_server/services/jitCredentialBroker.js`, `schemas/jit-credential.contract.json`, `demo_api_resource_server/server.js`, `demo_mcp_gateway/src/apiKeyDispatch.ts` |
| D52 | **Agent red-team runner** | Tester | Run promptfoo correctness, routing and red-team suites against any agent endpoint, signed in, and read a pass/fail matrix | ✅ `demo_api_server/promptfoo/redteam-eval.yaml`, `agent-eval.yaml`, `auth-cookie.js`, `demo_api_server/scripts/promptfoo-eval-authed.sh`, `demo_api_server/routes/promptfoo.js` |
| D53 | **Overscoped agent auditor** | Tool | Compare the scopes an agent holds with what its tools need and flag overscoped agents (UC4/UC5). Agent-level, unlike G3 (tenant-level) | ✅ `scope-topology.json`, `ping-gateway/config/scope-topology.json`, `demo_api_server/config/scopes.js`, `oauth-mcp/src/auth/validateTokenScopes.js` |

## E. Learning and enablement (new: E8-E12)

| ID | Name | Kind | What it shows | Seed |
|---|---|---|---|---|
| E8 | **OWASP agentic threats mapper** | Tool | A CISO asks how this maps to the OWASP Securing Agentic Applications Guide; links threats T1-T15 and KC1-KC6 to the demo that shows the control. No tenant. The guide itself was not fetched (UNVERIFIED) | ✅ `demo_api_ui/src/components/OwaspLearnerPage.js`, `OWASPBadge.jsx` |
| E9 | **OAuth teaching agent** | Demo | A conversational teacher for OAuth 2.x and OIDC that answers questions or runs a real flow live. Differs from E1 (content hub). Code location UNVERIFIED | 🟡 `demo_api_ui/src/components/OAuthAcademyPage.jsx`, `docs/OAUTH_TEACHING_AGENT_PLAN.md`, `demo_api_server/config/verticals/oauth-teaching`, `.claude/skills/oauth-teaching-agent/SKILL.md` |
| E10 | **Sign-in portal skin pack** | Skin | Per-customer branded login portals and screens (PF login theme, PingOne MFA theme, DaVinci consent/approved/declined screens branded by a 2-char vertical code, config-driven mock company portals). Use fictional brands by default (Decision 6) | ✅ `scripts/pingfederate/apply-login-theme.sh` + `assets/login-theme-ping.css`, `scripts/davinci-brand-ciba-flows.mjs`, `/Users/cmuir/Development/oauthplayground/company-portal-mocks/shared/companies.json`, `.../src/pages/protect-portal/themes/` |
| E11 | **Client-chrome costume shells** | Skin | Show the personal agent inside familiar client chrome (terminal, code editor, chat, SaaS); avoid imitating real vendor branding in a published repo | ✅ `demo_api_ui/src/components/aiFootprintMocks/` (ShellTerminalView, ShellVsCodeView, ShellDesktopView), `demo_api_ui/src/pages/FootprintMockGalleryPage.jsx` |
| E12 | **Jev decision model (fast typed judgments vs generative)** | Demo | System One (block, route, score) versus a generative model; teaches when not to use an LLM | ✅ `demo_api_server/services/jevService.js`, `demo_api_ui/src/pages/JevLearningPage.jsx`, `demo_api_ui/src/pages/jevLessons.js` |

## G. Platform and admin tools for SEs (new group, G1-G11)

| ID | Name | Kind | What it shows | Seed |
|---|---|---|---|---|
| G1 | **PingOne tenant bootstrap CLI** | Tool | An SE with an empty sandbox runs one command to get resource servers, scopes, apps, users and groups instead of console clicking; Management API worker app. Live tenant only, no mock. The 4212-line provisioner must be reduced to a recipe subset; the prior bootstrap run against a clean tenant was never observed (per fresh-environment doc) | ✅ `demo_api_server/scripts/bootstrapPingOne.js`, `demo_api_server/services/pingoneProvisionService.js`, `demo_api_server/scripts/setupFresh.js`, `scripts/pingone-bootstrap.js`, `docs/SETUP_AUTOMATION_PLAN.md`, `docs/editions/fresh-environment-gaps.md` |
| G2 | **PingOne app inventory and tenant cleaner** | Tool | List, classify (agent vs normal) and delete stale demo apps against a keep-list with dry-run default. The script hard-codes one environment ID and must be parameterised | ✅ `scripts/cleanup-pingone-apps.sh`, `scripts/pingone-audit-249.js`, `demo_api_server/scripts/describeApp.js`, `docs/pingone-app-organization.md` |
| G3 | **Scope, audience and grant matrix verifier** | Tool | "Why is my token missing scope X or aud Y": compare tenant resources, scopes and app grants to an expected matrix, name the gap, optionally fix. Read-only by default | ✅ `demo_api_server/scripts/verify-scope-configuration.js`, `scripts/check-resource-server-audience-drift.js`, `scripts/check-tool-scope-registration.js`, `demo_api_ui/src/components/ScopeAuditPage.js`, `docs/PINGONE_APP_SCOPE_MATRIX.md`, `docs/SCOPE_AUDIENCE_MAPPING.md` |
| G4 | **Mock Authorize server (decision, sideband, rules)** | Tool | Container that returns the same PingOne Authorize decision and sideband shapes from editable rules, so every Authorize-dependent demo runs with no tenant (the real decision API needs a worker app). `sideband.js` header records the live contract of 2026-07-27 | ✅ `demo_authz_server/routes/decision.js`, `routes/sideband.js`, `routes/rules.js`, `ruleStore.js`, `decision.mockCloudParity.test.js` |
| G5 | **Vertical-in-a-box MCP resource server** | Tool | Set `VERTICAL=healthcare` and tools, scopes and data change while auth stays the same. One container, bundled SQLite; reusable as the resource server for many testers; its `vertical.json` format could seed E5 | ✅ `/Users/cmuir/Development/mcp-resource-server/verticals/banking/vertical.json`, `.../verticals/healthcare/vertical.json`, `.../README.md`, `.../docker-compose.yml`; also `demo_mcp_resource_server` (10 verticals) |
| G6 | **PingFederate in a box** | Tool | Stand up a clean local PF with licence check, ports, Java, admin readiness and base config in one command. PF image and licence access UNVERIFIED in files. A licence/limits checker is an idea only (own knowledge, no code) | ✅ `se-skills-export/pingfederate-install/SKILL.md`, `scripts/pingfederate/docker-compose.fresh.yml`, `docker-compose.local.yml`, `ensure-se-pingfederate.sh`, `provision-all.sh`, `docs/editions/pf-baseline.md` |
| G7 | **Tenant snapshot and diff** | Tool | Export apps, resources, scopes and policy to JSON; diff two tenants or two moments. P1AZ is compare-only (no import or evaluate API). Extends B8 beyond policy | ✅ `demo_api_server/scripts/exportBootstrapData.js`, `exportMigrationBundle.js`, `importMigrationBundle.js`, `verifySnapshotParity.js`, `verifyAuthorizeCloudParity.js`, `scripts/check-pac-policy-drift.js` |
| G8 | **Postman / Bruno collection pack** | Tool | Hand a customer ready collections (pi.flow auth code, 1- and 2-exchange delegation, MFA v4, MCP tools) with an environment file generated from setup output. Check for embedded secrets before reuse | ✅ `postman/`, `docs/The-AI-Demo-Shared.postman_environment.json`, `docs/PingOne Authentication v4 - MFA included.postman_collection.json` |
| G9 | **PingCLI command playground** | Demo | Show PingOne config is scriptable: pick an allow-listed pingcli command, see the string, run it live, read output in a terminal pane. Live tenant. UI component location UNVERIFIED | 🟡 `~/.claude/skills/pingcli-demo-page/SKILL.md`, `demo_api_server/routes/pingcli.js` |
| G10 | **SE cluster deploy tool (internal)** | Tool | Deploy a family demo to the shared Ping SE Kubernetes cluster with the Ping-email rule and kubeconfig install. Internal SE only | ✅ `se-skills-export/ping-se-cluster-deploy/SKILL.md`, `scripts/install-se-kubeconfig.sh`, `scripts/ping-email.sh`, `scripts/se-gateways.sh` |
| G11 | **PingOne sample-app runner (custom-admin-role, m2m-credentials)** | Tester | Run the devdocs sample apps for custom admin roles and machine-to-machine credentials against a tenant. The sample source is NOT on this machine (UNVERIFIED), only the in-app runner | 🟡 `demo_api_ui/src/pages/StandaloneSamples.jsx`, `SampleRunner.jsx`, `M2mCredentialsSamplePage.jsx`, skill `pingone-sample-apps` |

## H. Standards and interop labs (new group, H1-H4)

| ID | Name | Kind | What it shows | Seed |
|---|---|---|---|---|
| H1 | **Shared Signals lab: revoke the session, stop the agent** | Demo/Tester | Create an SSF stream, send a verification event, push/poll delivery, then a CAEP `session-revoked` event makes the receiver revoke the agent's tokens and the next tool call fails. SSF 1.0 and CAEP 1.0 fetched (29 Aug 2025). **No Ping product support found**, so this is a standards lab, not a Ping feature; a live variant could use PingOne session delete (own knowledge, UNVERIFIED). Trigger differs from D14 (identity event, not a cap) | ❌ no SSF code. Adjacent: `demo_api_ui/src/components/education/KillSwitchMechanismsPanel.js`, `demo_api_ui/public/learning-mirror/agent-kill-switch.html`, `docs/GARTNER_2026_DIGITAL_IDENTITY_COVERAGE.md` (calls SSF "Thin"). 2 mock containers |
| H2 | **Credential tester (SD-JWT VC inspector + OpenID4VCI offer walker)** | Tester | Paste an SD-JWT VC and see disclosures, hidden claims and key binding; walk an issuance offer (pre-authorized code, tx_code, nonce, jwt proof). OpenID4VP 1.0 and OpenID4VCI 1.0 are Final (fetched). PingOne Credentials documents OpenID4VCI with SD-JWT (search only); the verifier side is NOT confirmed. SD-JWT detail is own knowledge. Gives A9 a seed | ❌ nothing for credentials; related decoder UI `/Users/cmuir/Development/oauthplayground/src/pages/URLDecoder.tsx` |
| H3 | **Browser-based app token patterns (BFF vs SPA vs mediating backend)** | Demo | An SPA team asks where to keep tokens; show the three patterns and what malicious JS can steal. The fetched page reports RFC 10017 / BCP 212 (Aug 2026), taken as reported. AI-DEMO2 is already BFF-only. No tenant | 🟡 `docs/adr/0006-bff-only-token-custody.md` |
| H4 | **Web Bot Auth / RFC 9421 message-signature verifier** | Tester | Sign a request, verify it, tamper one covered header and watch it fail; plus the WebSocket fail-closed guard. Self-contained Ed25519, mock-able. No Ping product tie-in confirmed (UNVERIFIED) | ✅ `demo_mcp_gateway/src/webBotAuthVerify.ts`, `httpMessageSignature.ts`, `wsBindingGuard.ts`, `wsDenyClassifier.ts` |

---

## Ranking of the 62 new items

Score = audience value, seed readiness, small size, mock-ability, and fit with the Wave-1 priorities (B7 Group Policy, E1 Learning Hub, A1 MFA tester, C2 token-flow workbench; plus the base). "Feeds" notes which priority an item helps.

| Rank | ID | Name | Value | Seed | Size | Mock-able | Why |
|---|---|---|---|---|---|---|---|
| 1 | G4 | Mock Authorize server | 4 | ✅ | M | yes (it is the mock) | Gives B7 and every Authorize demo an offline mode; base requirement 12 |
| 2 | G1 | PingOne tenant bootstrap CLI | 5 | ✅ | M | no | Every SE needs a ready tenant; shares worker-app auth with the base setup |
| 3 | D31 | No tool, no promise | 4 | ✅ | S | yes | Cheapest strong story; no tenant |
| 4 | C20 | OAuth profile checker | 5 | 🟡 | M | yes (mock AS) | "Is our config safe" answers a real customer question; sits beside C2/C3 |
| 5 | D35 | MCP authorization conformance scorecard | 5 | ✅ | M | yes | Most-asked topic now; CI-able |
| 6 | A24 | Support console with identity gate | 5 | ✅ | M | yes | Highest value row with full seed |
| 7 | D27 | Governing the PingOne/AIC admin MCP | 5 | ✅ | M | no | Unique "agent administers the IdP" story |
| 8 | D28 | Enterprise-managed MCP access | 5 | ✅ | M | yes | Reuses ID-JAG kit; coordinate with C1 |
| 9 | B12 | P1AZ policy generator / predictor | 4 | ✅ | M | yes | Feeds B7 and fills the no-import-API gap |
| 10 | D33 | Agent attack gallery | 4 | ✅ | M | yes | Visual, repeatable, mock gateway |
| 11 | C23 | Wrong-token rejection tester | 4 | ✅ | S | yes | Small, mock, direct answer to common question |
| 12 | H1 | Shared Signals lab | 5 | ❌ | M | yes | High value but no seed and not a Ping feature; hence not top 10 |
| 13 | B10 | AuthZEN PDP tester | 5 | 🟡 | M | yes | Ties Cedar and P1AZ together; Ping endpoint UNVERIFIED |
| 14 | B11 | AAM side-band | 4 | ✅ | S | partial | Small, tests exist, live needs credential |
| 15 | C22 | Stolen-token lab | 4 | 🟡 | M | yes | DPoP half PF-only |
| 16 | D40 | Stateless HITL and receipts | 4 | ✅ | M | yes | Strong second HITL story |
| 17 | D42 | Ungoverned before/after | 4 | ✅ | S-M | yes | Contrast for every governed demo |
| 18 | E8 | OWASP agentic mapper | 4 | ✅ | S | yes | Cheap, CISO-facing |
| 19 | D29 | Progressive trust ladder | 4 | ✅ | M | yes | Uses A5/A4 pieces |
| 20 | D36 | CIMD lab | 4 | ✅ | S | yes | Small, timely (draft -02) |
| 21 | G3 | Scope/audience/grant verifier | 4 | ✅ | S | no | Fixes setup 401/403 |
| 22 | G2 | Tenant cleaner | 4 | ✅ | S | no | Small hygiene tool |
| 23 | C21 | Step-up challenge tester | 4 | ✅ | S | yes | Pairs with A5 |
| 24 | B13 | Intent-bound transactions | 4 | 🟡 | M | yes | UC15 needs build |
| 25 | A25 | PF + PingOne MFA kit | 4 | ✅ | M | no | PF-first customers |
| 26 | D32 | Agent Gateway tool guard | 4 | ✅ | M | partial | PingGateway needed |
| 27 | D43 | Agent-token broker | 4 | ✅ | S | yes | Small |
| 28 | D30 | Consumer agent booking | 4 | ✅ | M | yes | |
| 29 | D34 | MCP attack lab | 4 | 🟡 | M | yes | |
| 30 | D41 | Agent lifecycle with IGA | 4 | ✅ | M | yes | |
| 31 | D47 | Privilege A2A access review | 4 | ✅ | M | no | Already standalone |
| 32 | D38 | A2A in-task auth | 4 | 🟡 | M | yes | Spec sections unread |
| 33 | B14 | Caregiver delegation | 4 | 🟡 | M | yes | |
| 34 | D49 | Commerce lifecycle | 4 | ✅ | M | yes | |
| 35 | C25 | Txn-token lab | 4 | 🟡 | M | yes | Draft; docs stale |
| 36 | G5 | Vertical MCP server | 3 | ✅ | S | yes | Reusable resource server |
| 37 | G6 | PingFederate in a box | 4 | ✅ | M | no | Licence risk |
| 38 | D44 | Bedrock AgentCore | 4 | 🟡 | M | no | Needs AWS |
| 39 | D46 | Real MCP clients kit | 3 | ✅ | M | no | |
| 40 | A26 | PF + DaVinci kit | 4 | ✅ | M | no | |
| 41 | A27 | Human or agent | 4 | 🟡 | M | partial | Protect licence |
| 42 | D39 | A2A trust tester | 3 | ✅ | S | yes | |
| 43 | D37 | Elicitation lab | 3 | ✅ | S | yes | |
| 44 | D50 | SaaS-embedded worker | 4 | ✅ | M | yes | |
| 45 | D45 | BYO agent framework | 4 | ✅ | L | partial | |
| 46 | D48 | Protected RAG | 4 | 🟡 | L | partial | Weaviate + LLM |
| 47 | H3 | Browser-app patterns | 4 | 🟡 | M | yes | |
| 48 | H4 | Web Bot Auth verifier | 3 | ✅ | S | yes | |
| 49 | D51 | JIT credential broker | 3 | ✅ | S | yes | Product tie-in unclear |
| 50 | D52 | Red-team runner | 3 | ✅ | M | partial | |
| 51 | C24 | Bearer grant tester | 3 | 🟡 | S | partial | |
| 52 | E10 | Portal skin pack | 3 | ✅ | M | yes | Brand risk |
| 53 | H2 | Credential tester | 3 | ❌ | M | yes | |
| 54 | G8 | Postman/Bruno pack | 3 | ✅ | S | no | |
| 55 | D53 | Overscoped agent auditor | 3 | ✅ | S | yes | |
| 56 | E9 | OAuth teaching agent | 3 | 🟡 | M | needs LLM | |
| 57 | G7 | Tenant snapshot and diff | 3 | ✅ | M | no | |
| 58 | G9 | PingCLI playground | 3 | 🟡 | S | no | |
| 59 | E12 | Jev decision model | 3 | ✅ | S | yes | |
| 60 | G11 | Sample-app runner | 3 | 🟡 | S | no | |
| 61 | E11 | Client-chrome shells | 3 | ✅ | M | yes | |
| 62 | G10 | SE cluster deploy tool | 3 | ✅ | M | no | Internal only |

## Wave placement (consistent with the plan's wave table)

| Wave | New items |
|---|---|
| 1 (with B7, E1, E2, C2, C3, A1, F2/F3) | **G4** Mock Authorize (supports B7), **G1** bootstrap, **B12** predictor (B7 seed), **C20** profile checker (token suite with C2/C3) |
| 2 (with D1 to D9, C6) | **A24**, **C21**, **C22**, **C23**, **D27**, **D28**, **D31**, **D33**, **D34**, **D35**, **D36**, **D37**, **D38**, **D39**, **D42**, **E8**, **G2**, **G3**, **G5** |
| 3 (with B1, B3 to B5, A6, A3/A4, A10, A15, A19) | **A25**, **A26**, **B10** (with Cedar), **B11** (with A19), **B13**, **B14**, **C24**, **D29**, **D30**, **D32**, **D40**, **G6**, **G9**, **G11** |
| 4 (with D11 to D17) | **D41**, **D43**, **D51**, **D52**, **D53**, **C25**, **H1**, **H4** |
| 5 (with D21 to D24, F-series) | **A27**, **D44**, **D45**, **D46**, **D47**, **D48**, **D49**, **D50**, **E12** |
| 6 (with E5/E6 and testers) | **E9**, **E10**, **E11**, **G7**, **G8**, **G10**, **H2**, **H3** |

## First-release proposal (about 20, old and new)

Rule: Wave 0-2 only, mostly existing code, mock-able, each with one clear story. Base items (F2/F3, presenter mode, story engine, doctor, Reset) ship inside every item and are not counted.

| # | ID | Item | Old/New | Why in the cut |
|---|---|---|---|---|
| 1 | C1 | ID-JAG | old | Template; already built |
| 2 | B7 | Group Policy | old | Wave-1 priority |
| 3 | A1 | MFA tester | old | Wave-1 priority; own repo |
| 4 | E1 | Learning Hub | old | Wave-1 priority; content-pack host |
| 5 | C2 | Token-flow workbench | old | Wave-1 priority |
| 6 | C3 | Token inspector | old | Cheap; ID-JAG Inspector exists |
| 7 | E2 | SE demo shelf | old | Launcher for the family |
| 8 | E3 | Diagram studio | old | Base dependency for all diagrams |
| 9 | D1 | Privilege (Cedar) | old | Built and hardened locally |
| 10 | **G4** | Mock Authorize server | new | Offline B7 and Authorize demos |
| 11 | **G1** | Tenant bootstrap CLI | new | Removes the biggest setup pain |
| 12 | **B12** | P1AZ policy predictor | new | B7 seed; fills no-import-API gap |
| 13 | **C20** | OAuth profile checker | new | Answers "is our config safe" |
| 14 | **C23** | Wrong-token rejection tester | new | Small token-suite member |
| 15 | **D31** | No tool, no promise | new | S, no tenant, strong story |
| 16 | **D35** | MCP conformance scorecard | new | Most-asked topic |
| 17 | **D33** | Agent attack gallery | new | Reusable mock-gateway attacks |
| 18 | **A24** | Support console identity gate | new | Value 5, full seed |
| 19 | **D27** | Governing PingOne/AIC admin MCP | new | Value 5, unique story |
| 20 | **D28** | Enterprise-managed MCP (as a C1 mode) | new | Value 5; free if done as a mode of C1 |

Deliberately left out of the first release: H1 (no seed, not a Ping feature), B10 (AuthZEN, Ping endpoint unverified, belongs with Cedar in Wave 3), G6 (licence risk), anything needing AWS, Protect licence or Weaviate.

## Dropped as already covered (37)

These become seed additions to the existing catalog row, not new rows.

| Candidate (source) | Covered by | Action |
|---|---|---|
| Orchestration SDK custom sign-in UI (usecases) | A10, A11 | Add seed `demo_api_ui/src/pages/OrchestrationSdkExplainerPage.jsx` |
| DaVinci adaptive-MFA flow pack (repos) | A10, A6, A3 | Add seeds `/Users/cmuir/Development/CDN/*-mf-configObject.json` (UNVERIFIED names) |
| Response-modes explainer (repos) | A11 | Add seed `oauthplayground/.../ResponseModesLearnPage.tsx`, `redirectless.flow.tsx` |
| Retail MFA scenario, Kroger-style (repos) | A1 + E5 | Vertical story for the MFA tester |
| HelioMart password reset (repos) | A12 | Add seed `oauthplayground/src/pages/security/HelioMartPasswordReset.tsx` |
| Risk-aware login portal (repos) | A6 | Add seed `protect-portal/components/RiskEvaluationDisplay.tsx` |
| Branded sign-in skins; company portal generator; PF login theming; DaVinci per-vertical branding (repos, skills) | merged into E10 | Four candidates become one row |
| PingID MFA demo (skills) | A1 | Declined as a separate row: no code, PingID tenant (see Declined) |
| PingDirectory / PingAccess skills (skills) | A17, A18 | Update seed column to `se-skills-export/pingdirectory-ai-demo/SKILL.md`, `pingaccess-ai-demo/SKILL.md` (skills only, no code checked) |
| Gateway resilience: rate limit and fail closed (usecases) | D14 | Add seeds `demo_mcp_gateway/src/rateLimit.ts`, `GatewayIntrospectionClient.ts`, `docs/use-cases/oauth-fail-closed.md` |
| Policy conformance matrix (services) | D13, E7 | Add seed `PolicyConformancePanel.jsx` |
| Denial explainer and pattern analyst (usecases) | D13, D17 | Add as AI-explain mode of D13; seeds `appEventService.js`, `docs/use-cases/ai-explain-last-denial.md` |
| Governance timeline (services) | D17, F7 | Add seed `GovernanceTimelinePage.jsx` |
| Mortgage vertical pack (usecases) | E5 | A vertical, not a demo |
| Signed Agent Card interop verifier (skills) | D10 | Merged into D39; also add seed to D10 |
| HITL approval receipt verifier (services) | D15 | Merged into D40 |
| Third-party tool guard + Agent Gateway MCP filters lab (usecases, landscape) | partial A19 | Merged into D32 (kept as new) |
| SAML assertion to ID-JAG bridge (skills) | C1 | Mode of the ID-JAG kit; seeds `configure-saml-idjag.js`, `outside-agent.js` |
| Enterprise-managed MCP authorization (services, duplicate of usecases) | merged into D28 | Two candidates become one |
| RFC 9701 JWT introspection tester (landscape) | C12 | Fold into C12; seed `docs/INTROSPECTION_VALIDATION_GUIDE.md` |
| Refresh-token rotation and reuse tester (landscape) | C12 | Fold into C12; seed `refreshToken.flow.tsx` |
| JIT ephemeral credentials tester (usecases) | merged into D51 | One row |
| PAR vs RAR comparator (repos) | C7, C8 | Add seed `oauthplayground/src/pages/PARvsRAR.tsx` |
| CIBA vs device authorization explainer (repos) | A4, C11 | Add seed `oauthplayground/src/pages/CIBAvsDeviceAuthz.tsx` |
| JWKS troubleshooting (repos) | C5 | Add seed `oauthplayground/src/pages/JWKSTroubleshooting.tsx` |
| Webhook and audit-activity viewer (repos) | C16 | Seed for C16: `PingOneWebhookViewer.tsx`, `PingOneAuditActivities.tsx` |
| Audit and event streaming to SIEM (skills) | C16, F4 | Add seeds `docs/PINGONE-WEBHOOK.md`, `docs/observability/datadog-scaffold.md` |
| PingOne Authorize decision dashboard, Grafana (services) | F4 | Content for F4: `monitoring/grafana/dashboards/p1az-decisions.json` |
| Delegation-chain hop tracer (skills) | C6, F1, C3 | Seed `demo_api_server/scripts/tokenChainTrace.js` |
| Three-hop token chain with audience isolation (repos) | C6 | Add negative tests and NotFlux seed `NotFlux-MCP-main/README.md` to C6 |
| OAuth/JWT toolbelt as MCP tools (repos) | C3, D5 | Seeds `oauthplayground/jwt-verifier-mcp-server` (completeness UNVERIFIED) |
| Mock-MCP agent flow explainer (repos) | D2 | Low value |
| Prompt redaction filter (repos) | D12, D19 | Seed `Privilege-standalone/llm-gateway/promptRedact.js` |
| Guardrail verdict live feed (skills) | D12, D13 | Seed `scripts/gateway-verdict-feed.sh` |
| Privilege console probe (skills) | D1, D11 | Seed `scripts/privilege-console-probe.mjs` |
| Privilege JIT cloud access (usecases) | D1 | L, real VMs and AWS; keep as a D1 script |
| Worker-app role doctor (skills) | base doctor 0.7 | Feature of the base `doctor`, not a repo |
| PingOne MCP connect and smoke (skills) | C17 | Feature of C17 |
| Demo state export/import (skills) | base Reset 0.8 | Base feature |
| Edition / standalone extractor (skills) | Phase 1 base distribution | Maker tool; reuse `scripts/export-edition.js` |
| Consent receipt viewer; IPSIE readiness (landscape) | B9; A22/C14 | Fold into notes; IPSIE page had no profile content |
| PingFederate + PingOne MFA wiring (services dupe) | merged into A25 | n/a |
| Mattermost HITL; pingone-mcp-server clone; iOS authenticator sample; AI-DEMO2 copies and exports (repos) | D15 (closed track), C17, A4 companion, n/a | Ignored as demos |

Note: the count of 37 is the number of table lines that map to a catalog id, some lines grouping two or three candidates.

## Declined (no catalog home, not proposed) (13)

| Candidate | Reason |
|---|---|
| PingOne client-secret rotation runner / helper (services, skills) | Handles real secrets; internal tool, tied to this repo's vault, value 2 |
| Terraform local-stack lifecycle (skills) | No Ping resources; do not copy `terraform.tfvars` or tfstate |
| Gateway A/B parity harness (skills) | Value 2, only meaningful with both gateways |
| PingID MFA demo (skills) | No runnable code, needs PingID tenant, low confidence |
| WebMCP demo (services) | Meaning UNVERIFIED beyond the page; value 2 |
| PAT to OAuth migration checker (skills) | Relevance to PingOne UNVERIFIED |
| Diagram conversion tools (skills) | Seed material for E3, not a demo |
| Mortgage vertical pack | See above, E5 |
| PingFederate RAR processor (usecases) | L, Java plugin build, hard to mock; revisit under B13 only if PF-side limit is wanted |
| Compliance (AML) agent standalone (services) | Merged into D45 as a Pydantic AI example |
| Knowledge grounding on/off (skills) | Merged into D48 |
| Ungoverned laptop agent / session-riding (skills, services) | Merged into D42 |
| Ping SE sample apps handoff (repos) | Context doc only |

## Decisions the owner must make

1. **First-release cut.** Confirm or edit the 20 above. Biggest swing items: whether H1 (Shared Signals) and B10 (AuthZEN) join despite weak seed/Ping support.
2. **D28 and C1 overlap.** Is enterprise-managed MCP a mode of `id-jag-standalone` (cheapest, my recommendation) or its own repo? The ID-JAG kit is PF-token-only by decision, and the plan says PingOne has no native ID-JAG, so a P1-only stand-in would contradict that.
3. **C22 versus C9.** Keep the stolen-token lab as its own demo or fold into the DPoP tester (C9)? Recommendation: own row, because it is an attack story at an MCP gateway; but DPoP stays PF-only.
4. **Txn-token facts need correcting before any customer sees C25.** `docs/TRANSACTION-TOKEN-RFC-SUMMARY.md` cites drafts -08/-09 and claims `purp`/`azd`; the fetched draft -11 (30 Jul 2026) says those were renamed (scope in -06, tctx in -04). Decide whether to fix the AI-DEMO2 docs first.
5. **Counts.** The plan says 84 use cases for D24; the usecases survey found **87** in `demo_api_server/config/useCases.js`. Update D24 and any Learning Hub copy.
6. **Brand risk.** E10 and E11 touch real company names and logos (airline, bank, shipping themes in `oauthplayground`, logos in `CDN`). Default to fictional brands in published repos, real ones only for private customer packs (E6)?
7. **Standards-lab honesty.** H1, H2, H3, H4, C25, B10 are not confirmed Ping features. Allow them in the family under a "Standards lab" label with an on-screen "not a Ping feature" banner?
8. **Live-only tools (G1, G2, G3, G6, G9).** They break base requirement 1 (mock mode). Exempt Group G from "mock mode" and require a dry-run default instead?
9. **Tester packaging.** Many new testers (C20, C21, C23, C24, D35, D36, D37, D39, H2, H4). Create suite repos: `token-testers`, `mcp-testers`, `standards-labs`? (Matches the plan's default of suites per area.)
10. **Where does G4 live?** Standalone container repo, or part of `demo-kit-base`? Recommendation: base profile `--profile mock-authorize`, because the plan already requires mock mode in the base.
11. **PF licence and images (G6) and Protect/Agent Gateway licences (A27, D32).** Confirm availability to SEs before scheduling; none verified in files.
12. **Repo pointers.** NotFlux-MCP-main has no git history and needs Vertex AI + Kong + AIC for the full stack; D40 uses only its HITL pattern. Confirm that is acceptable and that the source may be reused (ownership/licence of NotFlux UNVERIFIED).
13. **Sensitive material.** `postman/` collections (G8), `CDN` DaVinci exports and `terraform/` were not scanned for secrets. Run the forbidden-string gate before any extraction.
14. **Wave 1 grows by 4.** Adding G4, G1, B12, C20 to Wave 1 increases load on the same agent-sessions as the base build. Accept, or move G1 and C20 to Wave 2?

## Plan corrections found while editing

- D24 says 84 use cases; actual is 87 (usecases survey, `useCases.js`).
- Plan line 255 already names `scripts/export-edition.js` and `sync-to-app.mjs` as reusable; no change.
- `docs/a2a-card-discovery.mmd` is a mermaid file; the family rule is ReactFlow only, so D38 must convert it.
- Seeds to add to existing rows: A17/A18 skills (above), C16 viewer pages, C5 JWKS page, C7/C8 PARvsRAR, A4/C11 CIBAvsDevice, D10 signed-card verifier, D12 promptRedact and verdict feed, F4 Grafana dashboards, E7 conformance panel.

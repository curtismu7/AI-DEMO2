# Survey: AI-DEMO2 use cases -> standalone demos

Source of truth: `/Users/cmuir/Development/AI-DEMO2/demo_api_server/config/useCases.js` (loaded with node; exports USE_CASES, **87 entries**, not 84). Per-UC docs are generated into `/Users/cmuir/Development/AI-DEMO2/docs/use-cases/*.md` (96 files). Fields used: id, track, buyerStory, codeRefs, maturity. All seed paths below were checked with ls (exist). Anything marked UNVERIFIED is my inference (I did not run any demo or read every file in full). Catalog = `/Users/cmuir/Development/AI-DEMO2-plan-docs/planning/standalone-demo-family-plan.md`.

Maturity flags seen in the data: `works` for most; flag-gated: UC9 (ff_authorize_group_policy), UC12 (ff_dpop), UC14/14b (ff_rar), UC22 (ciba_enabled), UC25/39/40 (ff_enterprise_managed_mcp_auth), UC37 (ff_verified_trust_a2a), UC38 (ff_personal_agent_concierge); UC15 is `needs-build`.

## 1. Every UC mapped

| UC | Title | Maps to |
|---|---|---|
| UC1 | Delegated access (consent only) | B9 / C6 (existing) |
| UC2, UC2.5, UC2.6, UC2.7 | A2A delegation, orchestrator, generalist mismatch, protocol walkthrough | D9 (existing); UC2.6 is a story inside D9 / D10 |
| UC3 | act gate (may_act) | B9 / C6 (existing) |
| UC19 | Agent identity lifecycle | D11 (existing) |
| UC20 | Agent observability / audit trail | D17 / F1 / F7 (existing) |
| UC33 | My mortgage | NEW N-26 (vertical pack, Skin) |
| UC34 | Spot unusual patterns | NEW N-20 |
| UC35 | Why was that blocked? | NEW N-20 (overlaps D13) |
| UC4 | Overscoped agent | NEW N-19 |
| UC5 | Insufficient scope | NEW N-5 (also N-19) |
| UC6 | Authz denied (amount over limit) | B1 (existing) |
| UC7 | MFA step-up (HITL) | A5 / D15 (existing) |
| UC8 | MFA + HITL consent | D15 (existing) |
| UC9, UC9A | Group / entitlement check, live board | B7 (existing) |
| UC21 | Entitlement-tiered capability | B7 (existing; a second story, same repo) |
| UC22 | CIBA out-of-band approval | A4 (existing) |
| UC23, UC24 | Progressive trust, public catalog | NEW N-1 |
| UC26 | Proof of enforcement | NOT standalone: base feature (rides F3 timeline / D13) |
| UC10, UC11, UC13, UC16, UC16b | Cross-owner, bad client, confused deputy, impersonation, raw-token forwarding | NEW N-5 |
| UC12 | Token theft / replay (audience + DPoP) | NEW N-6 (overlaps C9) |
| UC14, UC14b, UC15 | PAR+RAR violation / verified / intent-token tampering | NEW N-8 (overlaps C7, C8) |
| UC17 | JIT / ephemeral credentials | NEW N-27 (low value) |
| UC18, UC29 | Rate-limit defense, fail closed | NEW N-7 (overlaps D14) |
| UC30, UC31, UC32, UC41, UC42 | Weather (Texas) and Brave search MCP scoped at PingGateway; live reconfigure | NEW N-4 (overlaps A19) |
| UC-TOOL1 | Protected RAG / code search | NEW N-24 |
| UC-TOOL2 | Code Explorer | NOT standalone (internal dev tool) |
| UC-TOOL3 | LLM Gateway | D19 (existing) |
| UC46, UC46A, UC47 | Privilege A2A access review, in agent, three-deep chain | NEW N-17 (overlaps D1, D9) |
| UC-MUSE1, UC-MUSE2 | External agent, standard lane / AI-gateway lane | NEW N-18 (overlaps D2, D25) |
| UC-NHI1, UC-NHI2 | NHI inventory, lifecycle export (JML) | NEW N-12 (overlaps D11, D16) |
| UC-LEARN1 | OAuth Academy | NEW N-22 (overlaps E1) |
| UC-LEARN2, UC-LEARN3 | PingOne MCP Inspector, generic MCP Inspector | D3 (existing) |
| UC-LEARN4, UC-LEARN5 | MCP Tools, Learning Hub | E1 (existing) |
| UC-LEARN6 | Token Flow (interactive) | C2 / F1 (existing) |
| UC-LEARN7 | Ungoverned Agent (OpenCLI) | NEW N-16 (overlaps D6, D8) |
| UC-PAM-SETUP, UC-PAM-SCRIPT | Privilege demo SE setup / request-access script | NEW N-23 (overlaps D1) |
| UC-LEARN8, UC25, UC39, UC40 | Enterprise-managed MCP auth/access/revocation/native ID-JAG | NEW N-10 (overlaps C1) |
| UC-LEARN9 | ID-JAG / Cross-App Access | C1 (existing) |
| UC-LEARN10 | Orchestration SDK custom UI | NEW N-30 (overlaps A10, A11) |
| UC-LEARN12 | PF + DaVinci integration kit | NEW N-31 (overlaps A10, A15) |
| UC-LEARN13 | PingFederate RAR processor | NEW N-9 (overlaps A15, C8) |
| UC-LEARN14 | CIBA by signed-in provider | A4 (existing) |
| UC-LEARN15 | Jev decision model | NEW N-21 |
| UC-LEARN11 | Privilege LLM prompt injection | D8 / D12 (existing) |
| UC-LEARN16 | MFA test (FIDO2) | A1 / A2 (existing) |
| UC-LEARN17 | OAuth debug logs | C3 / base trace (existing) |
| UC-LEARN18 | LLM test harness | D19 / D8 (existing; the "no guard" half of D8) |
| UC-LEARN19 | Intent Inspector | C8 (existing) / N-8 |
| UC-LOGIN, UC-LOGIN-PF, UC-LOGIN-AIC | P1 / PF / AIC person login | A11, A15, A14 (existing) |
| UC-AIC-TX | AIC token exchange (delegation) | A14 / C6 (existing) |
| UC-OBO | OBO delegation inspector | C6 (existing) |
| UC27 | HITL consent bypass attempt | D15 (existing; attack story) |
| UC28 | Tool set as authorization boundary (fee waiver) | NEW N-3 |
| UC37 | Verified Trust A2A assertion | NEW N-11 (overlaps D9, D10) |
| UC38 | Personal agent concierge / workload MFA-gated action | D21 / D23 (existing) |
| UC43 | Consumer and partner agent CIMD registration | NEW N-13 (overlaps D2, D11) |
| UC44 | Hosted digital assistant OBO read | D22 / D23 (existing) |
| UC45 | SaaS-embedded website worker | NEW N-14 (overlaps D22) |
| UC48 | Consumer agent governed flight booking | NEW N-2 (overlaps D24) |

## 2. UCs that should NOT be standalone

- UC26 Proof of enforcement: a cross-cutting UI strip (`demo_api_ui/src/components/ProofStrip.jsx`, `context/ProofOfEnforcementContext.js`); belongs in base/F3, not a repo.
- UC-TOOL2 Code Explorer: internal developer tool over this repo's own code; no customer story.
- UC-LEARN4, UC-LEARN5, UC-LEARN6, UC-LEARN17: pure landing/teaching pages; fold into E1 (Learning Hub) or C3 / base trace.
- UC2.5 (orchestrator learning), UC2.7 (protocol walkthrough): teaching panes of A2A; content for the D9 Learn pack, not a repo.
- UC9A: live board = the B7 demo itself.
- UC-LOGIN / -PF / -AIC: base-setup (P1/PF/AIC picker) concern, not a demo.
- UC6, UC7, UC8, UC22, UC27: each is a single decision/story inside B1, A5, D15, A4; splitting them would duplicate.
- UC-PAM-SETUP: an SE checklist (VM onboarding, agent install), no runnable story; only its script half (N-23) is a candidate and it is L and depends on external VMs.
- UC33 mortgage: a vertical (E5 pack), not a demo (kept as a Skin candidate only).

## 3. New standalone candidates

Size: S = 1 agent-session, M = 2-3, L = 4+. Value 1-5 is my judgement of audience value. "Seeds" were ls-verified.

### N-1 Progressive Trust Ladder (Demo, M, value 4, UC23 + UC24)
Story: a bank customer's personal agent starts public (branch hours, no sign-in), then needs sign-in, in-app step-up, then out-of-band approval as the request gets riskier; obstacle = "auth only when value is clear"; control = PingOne sign-in + step-up + CIBA.
Seeds: `docs/planning/PLAN-progressive-trust-demo.md`, `demo_api_server/services/agentModeResolver.js`, `demo_api_server/data/publicBranchCatalog.js`, `demo_api_server/routes/ciba.js`, `docs/use-cases/progressive-trust-demo.md`.
Needs: mock-able; live P1 (or PF) for step-up/CIBA. Overlap: none (touches A5, A4, D21).

### N-2 Consumer Agent Booking (Demo, M, value 4, UC48)
Story: consumer asks an agent to "book a flight to Paris under $800"; obstacle = price must pass transaction policy and a human must approve; control = token exchange + PingOne Authorize price policy + HITL receipt.
Seeds: `demo_mcp_resource_server/src/tools/airlinesToolHandler.ts`, `demo_mcp_resource_server/src/db/airlinesDb.ts`, `demo_api_server/services/mcpToolAuthorizationService.js`, `demo_api_server/config/verticals/airlines/manifest.json`.
Needs: mock-able; live = P1 Authorize. Overlap: D24 (subset), D15 (the HITL half).

### N-3 No Tool, No Promise (fee-waiver) (Demo, S, value 4, UC28)
Story: a chat agent is asked to waive a fee; obstacle = it will happily promise; control = the tool set is the authorization boundary (no waive tool exists), so a commitment cannot be made (Air Canada pattern, as named in the UC title).
Seeds: `oauth-mcp/src/tools/BankingToolRegistry.ts`, `oauth-mcp/src/tools/handlers/commitmentHandlers.ts`, `demo_api_server/services/intentTokenService.js`, `docs/use-cases/unauthorized-commitment-fee-waiver.md`.
Needs: fully mock-able, no tenant needed to teach it. Overlap: none (D1 adjacent).

### N-4 Third-Party Tool Guard at the Gateway (Demo, M, value 4, UC30/31/32/41/42)
Story: business wants a weather MCP and a Brave search MCP but only for its Texas footprint and no crypto queries; obstacle = third-party vendor runs the call before any check; control = PingGateway scope filter with live reconfigure (flip policy, no redeploy).
Seeds: `ping-gateway/scripts/groovy/tx-weather-scope.groovy`, `ping-gateway/scripts/groovy/tx-brave-scope.groovy`, `ping-gateway/config/routes/00-mcp-weather.json`, `ping-gateway/config/routes/00-mcp-brave.json`, `demo_mcp_weather`, `demo_mcp_brave`, `demo_api_ui/src/components/WeatherStateControl.jsx`, `demo_api_server/routes/featureFlags.js`.
Needs: PingGateway container + the two MCP servers (about 4 containers); weather is mock-able, Brave needs a Brave API key for live (UNVERIFIED whether mock exists). Overlap: A19 (PingGateway route lab) - differs: tool-argument policy, not WWW-Authenticate shape.

### N-5 Agent Attack Gallery (Tester/Demo, M, value 4, UC5/10/11/13/16/16b)
Story: SE runs named attacks (wrong scope, other user's account, bad client, rogue actor in `act`, impersonation without act, raw user-token forwarding) and sees each refused with the reason; control = gateway token policy + Authorize.
Seeds: `demo_api_server/routes/attackSimulator.js`, `demo_api_server/routes/demoAttackSeeds.js`, `demo_api_server/services/attackSimulatorService.js`, `demo_mcp_gateway/src/auth/GatewayTokenPolicy.ts`, `demo_authz_server/routes/decision.js`, `docs/use-cases/confused-deputy-actor-injection.md`.
Needs: mock-able gateway + stub IdP; live optional. Overlap: D13 (Caught errors - explains denials, not launches attacks), D1.

### N-6 Stolen Token Replay (Demo, S, value 3, UC12)
Story: attacker replays a captured agent token; audience binding and DPoP key binding make it unusable. DPoP is PingFederate-only in the Ping stack (per plan decision). 
Seeds: `demo_mcp_gateway/src/dpopVerify.ts`, `demo_mcp_gateway/src/middleware/authorizeMcpRequest.ts`, `demo_api_server/services/dpopKeyService.js`, `docs/use-cases/token-theft-replay.md`. Needs: mock-able; live needs PF. Overlap: C9 (DPoP tester) - this is the story, C9 the protocol tester; consider merging into C9.

### N-7 Gateway Resilience: Rate Limit + Fail Closed (Demo, S, value 3, UC18/UC29)
Story: agent floods the gateway; separately the token validator goes down; gateway throttles then rejects everything rather than failing open.
Seeds: `demo_mcp_gateway/src/rateLimit.ts`, `demo_mcp_gateway/src/tokenValidator.ts`, `demo_mcp_gateway/src/auth/GatewayIntrospectionClient.ts`, `docs/use-cases/rate-limit-defense.md`, `docs/use-cases/oauth-fail-closed.md`. Needs: mock-able, 1-2 containers. Overlap: D14 (kill switch / runaway agent) - partial.

### N-8 Intent-Bound Money Movement, PAR+RAR (Demo, M, value 4, UC14/14b/15 + UC-LEARN19)
Story: user authorizes "transfer up to X to payee Y" via pushed request; agent tries more; obstacle = agent can exceed intent; control = PAR request_uri + `authorization_details` enforced at the gateway; tampered/expired intent token detected.
Seeds: `demo_api_server/services/intentTokenService.js`, `demo_mcp_gateway/src/rarEnforce.ts`, `demo_api_server/services/attackSimulatorService.js`, `demo_api_ui/src/pages/IntentInspectorPage.jsx`. Note UC15 is `needs-build`. Needs: live P1 or PF for real PAR; mock-able. Overlap: C7, C8, C2 (testers); this is the agent story on top.

### N-9 PingFederate RAR Processor (Demo, L, value 3, UC-LEARN13)
Story: authorization server, not the agent, holds the transfer limit; custom PF authorization-detail processor refuses out-of-policy transfer.
Seeds: `scripts/pingfederate/plugins/ai-agent-rar` (Java), `demo_api_server/services/pfAiAgentRarService.js`, `demo_api_ui/src/pages/PingFederateAiAgentPage.jsx`. Needs: live PingFederate + Java plugin build (hard to mock). Overlap: A15, C8.

### N-10 Enterprise-Managed MCP Access and Central Revocation (Demo, M, value 5, UC25/39/40/LEARN8)
Story: employee signs in once with corporate SSO; IT pre-approves MCP servers (no per-server consent); on team change IT revokes in one console; native ID-JAG underneath.
Seeds: `demo_api_server/services/enterpriseMcpPolicyService.js`, `demo_api_server/services/enterpriseMcpMetadata.js`, `demo_api_server/services/idJagService.js`, `demo_api_server/routes/enterpriseIdp.js`, `oauth-mcp/src/oauth/IdJagGrantHandler.ts`, `demo_api_ui/src/components/education/EnterpriseManagedAuthPanel.js`. Needs: PF for native ID-JAG (plan fact); mock-able. Overlap: C1 (ID-JAG demo) - this is the IT-admin/revocation story reusing the grant; coordinate to avoid duplicate code.

### N-11 Verified Trust: Signed Agent Assertion on A2A (Demo, M, value 3, UC37)
Story: agent hands off to another organization's agent; a bearer token alone does not tell the receiver who the sender is; a signed assertion plus agent card does.
Seeds: `demo_api_server/services/verifiedTrustService.js`, `demo_api_server/services/a2aAgentCardService.js`, `demo_api_server/services/a2aDelegationService.js`. Needs: mock-able; flag ff_verified_trust_a2a. Overlap: D9, D10.

### N-12 Agent Join/Move/Leave to IGA + NHI Inventory (Demo, M, value 4, UC-NHI1/2)
Story: governance team sees live AI agents authenticating through Ping and gets lifecycle events forwarded to SailPoint-style IGA.
Seeds: `demo_api_server/services/controlPlane/liveAgentInfo.js`, `demo_api_server/services/agentLifecycleEvents.js`, `demo_api_server/services/sailpointForwarder.js`, `demo_api_server/services/lmdb/agentLifecycleEventStore.lmdb.js` (LMDB store), `demo_api_ui/src/components/ControlPlaneRoster.jsx`. Needs: mock-able; SailPoint not required (forwarder can target a stub; UNVERIFIED). Overlap: D11, D16.

### N-13 Consumer/Partner Agent CIMD Registration (Demo, S, value 4, UC43)
Story: a customer-facing or partner agent registers by publishing a client-ID metadata document; trust is established without pretending the agent is a person.
Seeds: `demo_api_server/services/personalAgentCimdService.js`, `demo_api_server/routes/cimdAgentMetadata.js`, `demo_api_server/services/agentRegistryService.js`, `docs/2026-10-07-cimd-privilege-client-documents.md`. Needs: mock-able; live gateway/AS for CIMD gate. Overlap: D2 (MCP auth lab covers CIMD), D11.

### N-14 SaaS-Embedded Website Worker (Demo, M, value 4, UC45)
Story: a SaaS site embeds a worker that acts for a signed-in customer while keeping its own workload identity (miles redemption example).
Seeds: `demo_api_server/routes/embeddedWorker.js`, `demo_api_server/services/agentBuilderService.js`, `demo_api_server/services/personalAgentCimdService.js`. Needs: mock-able; P1 for the live OBO. Overlap: D22 (worker agent).

### N-16 Ungoverned Agent, the "Before" Picture (Demo, S, value 4, UC-LEARN7)
Story: agent rides the user's logged-in browser session and moves money; shows what Ping removes; pairs with any governed demo as contrast.
Seeds: `demo_ungoverned_agent/agent.js`, `demo_api_ui/src/components/UngovernedAgentPage.js`, `docs/use-cases/ungoverned-agent.md`. Needs: fully mock-able, no Ping tenant. Overlap: D6, D8 (side-by-sides), but this is the standalone "before".

### N-17 Privilege A2A Access Review (Demo, M, value 4, UC46/46A/47)
Story: security analyst asks an agent to review access; a delegated worker gathers evidence through governed hops; three-deep chain keeps control of who may call whom.
Seeds: `standalone/privilege-a2a-anthropic-demo/src/main-agent/index.ts`, `.../worker-agent/index.ts`, `.../main-agent/chain.ts`, `langchain_agent/src/agent/a2a_delegation.py`, `demo_api_server/routes/privilegeA2aClient.js`. Already partly standalone inside AI-DEMO2. Needs: Anthropic API key + Privilege gateway for live. Overlap: D1, D9.

### N-18 Bring Your Own Agent (Demo, M, value 4, UC-MUSE1/2)
Story: customer's existing agent (Muse, LM Studio, LibreChat, ChatGPT) connects to the governed MCP door, standard lane or AI-gateway lane.
Seeds: `oauth-mcp/src/oauth/OAuthRouter.ts`, `ping-gateway/scripts/groovy/p1az-decision.groovy`, `demo_api_server/routes/mcpFacade.js`, `demo_api_server/services/privilegeGatewaySession.js`, `docs/EXTERNAL_DOOR_MCP_FLOW.md`. Needs: live door + the client app. Overlap: D2, D25.

### N-19 Scope Least-Privilege Auditor (Tool, S, value 3, UC4/UC5)
Story: compare scopes an agent holds against what its tools need; flag overscoped agents.
Seeds: `scope-topology.json`, `demo_api_server/config/scopes.js`, `ping-gateway/config/scope-topology.json`, `oauth-mcp/src/auth/validateTokenScopes.js`. Needs: mock-able. Overlap: none.

### N-20 Denial Explainer and Pattern Analyst (Demo, M, value 3, UC34/UC35)
Story: after a block, ask the agent "why was that blocked?" or "anything unusual?" and get plain-language answers grounded in the live event log.
Seeds: `demo_api_server/services/appEventService.js`, `demo_api_server/services/demoAgentLangGraphService.js`, `docs/use-cases/ai-explain-last-denial.md`. Needs: LLM (llama.cpp or API). Overlap: D13, D17.

### N-21 Jev Decision Model (Demo, S, value 3, UC-LEARN15)
Story: System One (fast typed judgments: block this text, route, score risk) vs System Two (generative); teaches when not to use an LLM.
Seeds: `demo_api_server/services/jevService.js`, `demo_api_ui/src/pages/JevLearningPage.jsx`, `demo_api_ui/src/pages/jevLessons.js`. Needs: mock-able. Overlap: none (D12 adjacent).

### N-22 OAuth Academy Teaching Agent (Tool, M, value 3, UC-LEARN1)
Seeds: `demo_api_ui/src/components/OAuthAcademyPage.jsx`, `docs/OAUTH_TEACHING_AGENT_PLAN.md`, `demo_api_server/config/verticals/oauth-teaching`. Needs: LLM; live flow optional. Overlap: E1.

### N-23 Privilege JIT Cloud Access (Demo, L, value 3, UC-PAM-SCRIPT)
Story: end user requests JIT access to AWS AppRoles / S3 buckets; MFA-gated; Privilege agent on VMs. Seeds: `demo_api_ui/src/pages/PrivilegeDemoPage.jsx`, `demo_api_ui/src/components/privilege/PrivilegeScriptGuide.jsx`, `docs/use-cases/privilege-demo-script.md`. Needs real VMs, AWS (hard to mock). Overlap: D1.

### N-24 Protected RAG Tool (Demo, S, value 3, UC-TOOL1)
Story: grounded retrieval useful only if agent cannot widen access to indexed source. Seeds: `demo_mcp_code_search`, `oauth-mcp/src/tools/handlers/codeSearchHandlers.ts`, `demo_api_server/services/bffMcpToolExecutor.js`. Overlap: D1.

### N-26 Mortgage Vertical Pack (Skin, S, value 2, UC33)
Seed: `demo_api_server/config/verticals/*` (banking exists; mortgage tool `show_mortgage`). Overlap: E5.

### N-27 JIT Ephemeral Credentials (Tester, S, value 2, UC17)
Short-lived token TTL demo. Seeds: `demo_api_server/services/oauthService.js`, `agentMcpTokenService.js`. Overlap: C12.

### N-30 Orchestration SDK Custom Sign-In UI (Demo, M, value 3, UC-LEARN10)
Seeds: `demo_api_ui/src/pages/OrchestrationSdkExplainerPage.jsx`. Needs P1/DaVinci. Overlap: A10, A11.

### N-31 PingFederate + DaVinci Integration Kit (Demo, M, value 4, UC-LEARN12)
Story: PF auth policy runs a DaVinci flow while PF stays in control. Seeds: `demo_api_ui/src/pages/PingFederateDavinciKitPage.jsx`, `demo_api_server/routes/pfDavinciAuth.js`, `docs/use-cases/pingfederate-davinci-integration-kit.md`. Needs live PF + DaVinci. Overlap: A10, A15.

## 4. Gaps in this survey
- Did not read each UC doc in full; stories come from `buyerStory` and docs headers.
- UC15 `needs-build`: N-8 may need that finished.
- Whether Brave/SailPoint/AIC have working mock modes: UNVERIFIED.
- Did not look at demoReadinessInventory.json for per-UC runtime dependencies.

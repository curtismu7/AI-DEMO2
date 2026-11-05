# Survey: AI-DEMO2 services, pages and infrastructure -> standalone demo candidates

Scope: top-level service dirs and SPA pages in /Users/cmuir/Development/AI-DEMO2 (may be behind origin).
Catalog compared against: /Users/cmuir/Development/AI-DEMO2-plan-docs/planning/standalone-demo-family-plan.md (94 items, A1-F10).
Method: ls/grep/head of files only (no builds, no servers). Every seed path below was checked with ls. Anything marked UNVERIFIED was not confirmed in a file.
Kinds: Demo | Tester | Tool | Skin. Size in agent-sessions. Value 1-5 = audience value for a live SE.

## Part 1. Inventory: what each service is, and catalog coverage

| Dir | What it is (from README/headers) | Catalog |
|---|---|---|
| demo_agent_service | TS reasoning-only agent service (reasoningGraph.ts, helixClient.ts, promptStore.ts); never executes tools or touches tokens | Part of D21/D22; no standalone |
| demo_authz_server | Node mock PingOne Authorize: routes/decision.js, sideband.js, rules.js, introspect.js, token.js, snapshot import; many decision.*.test.js (confused-deputy, intent-tamper, d05-bypass, a2a) | B1 uses it; the mock server itself is not a catalog item (candidate 1) |
| demo_hitl_service | HITL challenges, notifier, receipt binding rules (receiptVerification.js) | D15 |
| demo_llm_proxy | 2-tier local LLM routing proxy (README.md) | D19 |
| demo_mcp_* | audit, banking_rest, brave, code_search, gateway (TS, DPoP/mTLS/RAR/RFC9421/Web Bot Auth), grafana, jwt_verifier (Python FastMCP), pingone (PingOne MCP behind Privilege), promptguard, proxy, resource_server (10 verticals SQLite), weather | D1, D4, D12, D17, D26 cover some; gateway protocol modules and several tool servers are uncovered |
| demo_mcpgw / demo_mcpgw_nginx / ping-mcpgw | IG-based gateway compose, nginx front, privilege enroll material | D1 (infra) |
| demo_ungoverned_agent | headless Chromium that rides a human session and moves money (agent.js) | D8/D16 partial |
| langchain_agent, llamaindex_agent | LangChain MCP OAuth agent (Python); LlamaIndex tool-calling agent over a code index | none |
| compliance_agent | Pydantic AI AML/compliance microservice (agent.py, rules.py) | none |
| agent_token_service | broker: API-key in, PingOne AI_AGENT client-credentials token out (Copilot Studio) | none |
| oauth-mcp | older TS banking MCP server, PKCE, dual token | D26 (older) |
| ping-gateway | PingGateway (IG) as alternate MCP gateway: introspect, Authorize call (Groovy), RFC 8693, audit | A19 |
| privilege | docs only (runbooks, demo scripts, specs) | D1 |
| spiffe | SPIRE profile + PF mappings | C18, F8-F10 |
| terraform, k8s | local-Docker Terraform lifecycle; k8s manifests | infra, not demos |
| monitoring | Prometheus, alert rules, Alloy, 9 Grafana dashboards (agent-gateway, p1az-decisions, pingone-webhook, privilege-sensor...) | F4 |
| pac | P1AZ policy-as-code YAML (3 policies) | B8 |
| security | codeql, semgrep, sarif-parsing | not demo |
| schemas | jit-credential.contract.json, knowledge-bundle.schema.json (OKF bundles) | none / E1 |
| editions | pingone.json / pingfederate.json edition definitions, gitleaks.toml | base concern |
| librechat | standalone LibreChat+Mongo stack, MCP OAuth (RFC 9728+DCR+PKCE), seed agents, client overrides | D2/D25 partial |
| lmstudio | mcp.json + demo-steps.json + preset installer | D19 partial |
| mockups | HTML mock-ups of header and launcher | not demo |
| standalone/ | already standalone: ai-gateway-client, hostile-a2a-agent, hostile-mcp-server, mcp-demo-client-privilege, mcp-discovery-agent, mcp-inspector, mcp-scanner, mcp-toolkit, privilege-a2a-anthropic-demo | D3-D7, D20 |
| fido2-fix, pingone/ | FIDO2 fix notes, PingOne skills (ciba, mfa, recognize, session-termination...) | A1/A2/A4/A8 |

## Part 2. SPA pages (demo_api_ui/src)

Roughly 700 files in components, 90+ in pages. Routes were listed from App.js and routes/*.js. Pages that stand alone and are NOT in the catalog: support console, Copilot/agent-token broker, delegated commerce, embedded worker, WebMCP, elicitation, OWASP mapper, promptfoo runner, scope audit, secret rotation, policy conformance, token-security tester, inter-agent abuse tester, governance timeline, footprint mock shells, devdocs sample runner (custom-admin-role, m2m).
Already represented: /group-policy (B7), /diagrams (E3), /welcome (base), /transaction-consent (A4/B9), /digital-worker (D23), /architecture/* (E3), ID-JAG pages (C1), /mfa-test (A1), /mcp-inspector, /mcp-scanner (D3/D4), /llm-gateway (D19), /privilege-* (D1), /obo-demo (C6), /protect-auth-demo (A6), /ping-products/verify-recognize (A8/A9), telemetry/tracing/transaction-trace (F1), /learning* (E1), /standalone launcher (E2).

## Part 3. Candidates (31)

Each: kind | size | needs | value | overlap. Story = who, goal, obstacle, Ping control.

### Platform pieces (make every other demo cheaper)

**1. Mock Authorize server (decision, sideband, rules)** | Tool | M | no tenant needed; mocks PingOne Authorize + Sideband API | value 4 | overlap B1/B2 (base mock mode) but distinct as a reusable container
- Story: an SE with no tenant wants every Authorize-dependent demo to run offline; the obstacle is the real decision API needs a worker app; the mock returns the same shape with editable rules.
- Seeds: demo_authz_server/routes/decision.js, routes/sideband.js, routes/rules.js, ruleStore.js, decision.contract.test.js, decision.mockCloudParity.test.js. sideband.js header says it records the live contract 2026-07-27 (read in file).

**2. HITL approval receipt verifier** | Tester | S | mock-able | value 3 | overlap D15 (but D15 is hold/approve/retry; this proves receipts cannot be replayed)
- Story: security reviewer asks "can an approval for a $10 transfer be reused for $5000?"; receipt is bound to caller, agent, tool and arguments; tester tries replays and shows each refusal.
- Seeds: demo_hitl_service/src/receiptVerification.js (header states binding rules), tests/challenges.verify.test.js, src/store/challengeStore.js.

**3. JIT tool-bound credential broker** | Demo | S | mock-able, no Ping product required (BFF broker + backend) | value 3 | overlap none
- Story: platform team does not want a static backend API key on the wire; the broker mints short-TTL, tool-bound credentials; replaying one against another tool fails.
- Seeds: demo_api_server/services/jitCredentialBroker.js, schemas/jit-credential.contract.json, demo_api_resource_server/server.js, demo_mcp_gateway/src/apiKeyDispatch.ts.

**4. Agent-token broker for third-party agent platforms (Copilot Studio)** | Demo | S | live PingOne (AI_AGENT client-credentials app) or mock | value 4 | overlap D11 loosely; none exact
- Story: a Microsoft Copilot Studio agent needs a PingOne agent identity but must never hold the client secret; broker holds secret, caller holds one API key; rotate in one place.
- Seeds: agent_token_service/README.md, agent_token_service/src, docs/COPILOT_PART3_RUNBOOK.md, demo_api_ui/src/components/CopilotAgent.jsx, CopilotPage.jsx. Copilot Studio behavior is from the runbook, UNVERIFIED by me.

### Gateway and protocol labs

**5. Web Bot Auth / RFC 9421 HTTP message signature verifier** | Tester | S | mock-able (self-contained Ed25519) | value 3 | overlap none
- Story: an SE asked "how do you know this bot is who it says?" signs a request, verifies it, tampers one covered header and watches it fail; also shows the WS fail-closed guard.
- Seeds: demo_mcp_gateway/src/webBotAuthVerify.ts, httpMessageSignature.ts (RFC 9421 App. B vectors per header), wsBindingGuard.ts, wsDenyClassifier.ts. Ping product tie-in: none confirmed (UNVERIFIED that any Ping product ships this).

**6. Sender-constrained MCP gateway lab (DPoP + mTLS + RAR enforce at the gateway)** | Tester | M | PF for DPoP (per ping-idjag-dpop-pf-only memory); mock-able | value 4 | overlap C9, C10, C8 (token-level testers). Distinct: enforcement at an MCP gateway, call-level.
- Story: gateway engineer shows a stolen bearer fails while the bound token passes, and an over-broad authorization_details request is clipped.
- Seeds: demo_mcp_gateway/src/dpopVerify.ts, mtls.ts, rarEnforce.ts, scopePolicies.ts, tests/.

**7. MCP elicitation lab** | Demo | S | mock-able | value 3 | overlap none (D2 is auth discovery)
- Story: an MCP server mid-call needs more input or a URL consent; client shows a form or URL dialog; accept/decline/cancel map to results; error -32042 shown.
- Seeds: demo_mcp_gateway/src/elicitationStore.ts, demo_api_ui/src/components/ElicitationDialog.jsx, ElicitationModal.js, docs/MCP_ELICITATION_IMPLEMENTATION.md. MCP spec version claims are from that doc, UNVERIFIED.

**8. Enterprise-managed MCP authorization (IT picks the servers)** | Demo | L | PF ID-JAG not native in PingOne; plan says RFC 8693 stand-in | value 4 | overlap C1/D2 heavily; keep as skin of ID-JAG kit unless it diverges
- Story: employee signs in once; IT controls which MCP servers they may use; no per-server OAuth consent.
- Seeds: planning/ENTERPRISE-MANAGED-MCP-AUTH-PLAN.md (status: plan only), demo_mcp_gateway/src/enterpriseMcpAuth.ts, enterpriseMcpAuthSync.ts, demo_api_ui/src/pages/EnterpriseMcpDemoPage.jsx. Treat as an ID-JAG variant, probably not a new repo.

**9. CIMD client-document generator and validator** | Tester | S | mock-able; live check via Privilege | value 3 | overlap D2 (names DCR/CIMD) but a focused tester
- Story: an MCP client author wants a Client ID Metadata Document that the gateway accepts; tester fetches the doc by URL, validates fields and shows why it is refused.
- Seeds: demo_api_ui/src/components/CimdSimPanel.js, components/cimdPrivilege/, docs/2026-10-07-cimd-privilege-client-documents.md.

**10. Intent binding / confused-deputy / tamper tester** | Tester | M | mock via candidate 1; live P1AZ optional | value 4 | overlap none (B5 is Cedar on tools)
- Story: a user authorizes "pay bill X, $50"; an agent (or injected prompt) tries a different payee or amount; intent token mismatch is denied at the gateway.
- Seeds: demo_mcp_gateway/src/intentTokenValidator.ts, demo_authz_server/decision.intentTamper.test.js, decision.confused-deputy.test.js, decision.intentGovernance.test.js, demo_api_ui/src/pages/IntentInspectorPage.jsx, IntentBindingLearningPage.js, docs/INTENT_AUTHORIZATION_GUIDE.md.

**11. Token rejection tester (wrong scope, wrong audience, expired, user-vs-agent token)** | Tester | S | mock-able | value 4 | overlap C3, C12 (inspect/introspect). Distinct: negative cases against an MCP resource server with educational error text.
- Story: customer asks "what happens if my agent sends the wrong token?"; tester sends 5 bad tokens and shows each error.
- Seeds: demo_api_ui/src/components/TokenSecurityTester.jsx (SCENARIOS array incl. wrong-scope), demo_api_ui/src/components/__tests__/AIAgent.wrongAudience.test.js, AIAgent.wrongScope.test.js, demo_mcp_gateway/src/tokenValidator.ts.

**12. Inter-agent abuse tester (A2A wire gate)** | Tester | S | live gateway or mock | value 3 | overlap D7 (hostile agent), D10 (card validator); distinct: unauthorized caller driving a specialist over A2A JSON-RPC, three call shapes
- Seeds: demo_api_ui/src/components/InterAgentAbuseTester.jsx (header describes raw fetch with no bearer), demo_authz_server/decision.a2a.test.js, standalone/hostile-a2a-agent.

**13. Policy conformance matrix** | Tool | M | live stack needed to be meaningful | value 3 | overlap D13/E7
- Story: SE claims "this chip is stopped by HITL, that one by DENY"; matrix runs every chip and proves the control that fired is the control the catalog claims (a green card can hide a wrong control).
- Seeds: demo_api_ui/src/components/PolicyConformancePanel.jsx, PolicyDecisionTracePage.jsx, PolicyDecisionTree.jsx, scripts/check-use-cases-maturity.js.

**14. Scope and audience auditor for PingOne resources** | Tool | S | live PingOne tenant (admin) | value 3 | overlap C17, C19 partially
- Story: after setup, 401/403s appear; auditor lists resources, scopes expected vs present, fixes missing in one click.
- Seeds: demo_api_ui/src/components/ScopeAuditPage.js, docs/SCOPE_AUDIENCE_MAPPING.md, docs/SCOPE_AUDIT_FINAL_REPORT.md, scripts/check-resource-server-audience-drift.js, check-tool-scope-registration.js.

**15. PingOne client-secret rotation runner** | Tool | M | live PingOne; sensitive | value 2 | overlap none
- Story: after a leak, rotate many app secrets and verify by fingerprint without ever showing the secret.
- Seeds: demo_api_ui/src/pages/SecretRotationPage.jsx (fingerprint= log line). Caution: touches real secrets; fits an internal tool better than a customer demo.

**16. PingOne Authorize decision dashboard (Grafana)** | Tool | S | OTel profile; mock-able | value 3 | overlap F4
- Seeds: monitoring/grafana/dashboards/p1az-decisions.json, agent-gateway.json, privilege-sensor.json, pingone-webhook.json, monitoring/prometheus.yml. Better delivered as content for F4.

### Agent demos

**17. Support console with customer identity gate** | Demo | M | live PingOne (pi.flow OTP) or mock | value 5 | overlap A5/A3 loosely; none exact
- Story: a support rep (and an ops AI assistant) needs a customer's record, but cannot see it until the customer proves identity by OTP on their own device; the BFF holds the customer token, the console only sees masked contacts. Works across 10 verticals via supportConsoleConfig.js.
- Seeds: demo_api_ui/src/components/supportConsole/ (SupportConsole.jsx, IdentityGate.jsx, OpsAssistantChat.jsx, RecordDrawer.jsx, supportConsoleConfig.js, resolvePermission.js), demo_hitl_service.

**18. Delegated-agent commerce lifecycle** | Demo | M | live PingOne (CIBA) or mock phone | value 4 | overlap B9/C6/D11 partly
- Story: shopper registers an agent, claims it with a code, consents, the agent buys through a protected MCP call, CIBA approves the big one, shopper revokes.
- Seeds: demo_api_ui/src/pages/DelegatedCommercePage.jsx, config/delegatedCommerceDiagram.js (header lists register/claim/consent/revoke), demo_api_server/routes/delegatedCommerce.js.

**19. Multi-party (caregiver) delegation** | Demo | M | PingOne + Authorize; mock-able | value 4 | overlap B9 (act-only consent). Distinct: a third party (caregiver) and their agent, purpose limits
- Seeds: demo_api_ui/src/pages/StandaloneDemoLauncherPage.jsx (scenarios multi-party-delegation, healthcare-caregiver-delegation), demo_api_ui/src/learning/lessonCatalog.js, demo_mcp_resource_server/seed/healthcare.seed.json.

**20. Embedded worker in a SaaS app (CRM-style)** | Demo | M | mock-able | value 3 | overlap D22/D23 (worker agents). Distinct: agent embedded inside a third-party SaaS UI
- Seeds: demo_api_ui/src/pages/EmbeddedWorkerPage.jsx (use case saas-embedded-worker, tabs Accounts/Contacts/Opportunities/Cases/Reports), components/aiFootprintMocks/.

**21. Session-riding browser agent (ungoverned) vs governed** | Demo | M | one live bank session or mock | value 4 | overlap D8, D16, D6 (side-by-side idea) but this is a different threat: agent drives the human's UI session
- Story: an agent clicks through the bank as the user and looks identical to the user in logs; governed path shows a distinct actor and scope.
- Seeds: demo_ungoverned_agent/agent.js (header: carries no agent identity; "demo prop"), demo_api_ui route /ungoverned-agent, standalone/hostile-mcp-server.

**22. Compliance (AML) agent as an isolated governed microservice** | Demo | M | mock-able (rules.py), LLM optional | value 3 | overlap D15 (hold on high risk), D26
- Story: transfers pass a compliance agent that returns an AML score and flags; high-risk results route to human approval.
- Seeds: compliance_agent/README.md, agent.py, rules.py, models.py, llm_route.py.

**23. Bring your own agent framework (LangChain / LlamaIndex / Pydantic AI) with Ping auth** | Demo | L | live PingOne or mock | value 4 | overlap none
- Story: customer's team uses LangChain or LlamaIndex; show the same OAuth, token exchange and gateway working from each framework.
- Seeds: langchain_agent/README.md, langchain_agent/src, llamaindex_agent/agent.py, retriever.py, compliance_agent/agent.py, docs/AGENT_FRAMEWORK_COMPARISON.md, AGENT_FRAMEWORK_TECHNICAL_COMPARISON.md.

**24. Governing the PingOne MCP server (admin actions through Privilege)** | Demo | M | live PingOne + Privilege | value 5 | overlap D1 (Privilege demo) and C17 (API explorer). Distinct: an agent administering the IdP itself, per-tool policy
- Seeds: demo_mcp_pingone/README.md (runs pingidentity/pingone-mcp-server as sidecar), pingone/pingone-mcp/SKILL.md, demo_api_ui/src/components/PingOneMcpInspector.js.

**25. Protected RAG over a codebase** | Demo | L | needs Weaviate + LLM; partly mock | value 4 | overlap E1 (RAG Q&A in Learning Hub) - different: authorization on retrieval
- Story: developer asks questions of an indexed repo through an MCP search tool; who may search which codebase is enforced.
- Seeds: demo_mcp_code_search/src, demo_api_ui/src/pages/CodeSearchPage.jsx (PROTECTED_RAG_STEPS), components/CodebaseUploader.jsx, llamaindex_agent/retriever.py, docs/ plan docs/planning/PLAN-learning-hub-document-rag-tika.md (in AI-DEMO2/planning).

**26. Real MCP client kit (LibreChat + LM Studio pre-wired)** | Demo | M | Docker; live gateway | value 3 | overlap D2/D25
- Story: prove the door works with real unmodified clients, not just our UI.
- Seeds: librechat/docker-compose.yml, librechat/seed-demo-agents.js, librechat/client-overrides/McpErrorRecovery.ts, lmstudio/mcp.json, lmstudio/demo-steps.json, lmstudio/install-presets.js.

**27. WebMCP (browser-exposed tools) demo** | Demo | S | mock-able | value 2 | overlap none
- Seeds: demo_api_ui/src/components/WebMcpPanel.js, WebMcpExplainer.js, demo_api_ui/src/services/webMcpClient.js, education/WebMcpEduPanel.js. What WebMCP is: UNVERIFIED (from the page only; I did not fetch a spec).

### Learning and SE tools

**28. OWASP agentic threats mapper (T1-T15 to controls)** | Tool | S | no tenant | value 4 | overlap E1/D13 (content), none exact
- Story: CISO asks how this maps to OWASP Securing Agentic Applications Guide; mapper links each threat to the use case that shows the control.
- Seeds: demo_api_ui/src/components/OwaspLearnerPage.js (KC1-KC6, T1-T15 per header), OWASPBadge.jsx, docs/ files.

**29. Promptfoo red-team runner** | Tester | M | live agent endpoint | value 3 | overlap D8 (prompt injection side by side)
- Seeds: demo_api_server/promptfoo/redteam-eval.yaml, agent-eval.yaml, demo_api_server/routes/promptfoo.js, demo_api_ui/src/components/PromptFooPage.js.

**30. Governance timeline (identity / authz / privilege / governance lanes)** | Demo | S | mock-able from audit | value 3 | overlap D17, F7
- Seeds: demo_api_ui/src/pages/GovernanceTimelinePage.jsx (LANES), demo_mcp_audit/server.js.

**31. Client costume shells (agent shown inside terminal / VS Code / ChatGPT-style / SaaS chrome)** | Skin | M | none | value 3 | overlap E5/E6 (skins differ: these skin the client, not the customer)
- Seeds: demo_api_ui/src/components/aiFootprintMocks/ (ShellTerminalView, ShellVsCodeView, ShellDesktopView), pages/FootprintMockGalleryPage.jsx (categories coding, vscode, chatgpt, saas). Caution: do not imitate a real vendor's branding in a published repo.

### Considered and folded into catalog items (overlaps, not proposed)

PingGateway MCP route lab (A19; ping-gateway/config/routes), Shadow AI detector (D16; ShadowAiDetectorPage.jsx), Agent lifecycle (D11; AgentLifecyclePage.jsx), Agentic Access Console (D11), kill switch (D14; KillSwitchConfirmModal.jsx), SPIFFE bridge (F8-F10; SpiffePingoneBridgePage.jsx), DaVinci SDK vs widget login (A10/A11), Verify/Recognize pages (A8/A9), MFA test page (A1; components/MFATestPage.tsx), PAC drift (B8), trace panels (F3; OpikTracePanel.jsx), mock phone (A4/base component), 10-vertical resource server (E5).

### Not worth a repo
PingCLI page (components/PingCliPage.js; pingcli-demo-page skill) and Postman collections (components/PostmanCollectionsPage.js, postman/) are C17 content; devdocs sample runner (pages/StandaloneSamples.jsx, SampleAppPage.jsx, M2mCredentialsSamplePage.jsx) is useful for custom-admin-role and m2m-credentials, which are not in the catalog: candidate "PingOne sample-app runner" below.

**32 (bonus). PingOne sample-app runner (custom-admin-role, m2m-credentials)** | Tester | S | live PingOne | value 3 | overlap A12 for user-registration only
- Seeds: demo_api_ui/src/pages/StandaloneSamples.jsx, SampleRunner.jsx, M2mCredentialsSamplePage.jsx; pingone-sample-apps skill.

## Part 4. Not covered
- Did not read bodies of the 62 files in demo_api_ui/src/services nor most of the 700 components; pages judged by header comments and names.
- Did not open any running UI; routes listed from source (list truncated for sub-routes like /standalone/runner/*).
- terraform/, k8s/, security/, editions/, mockups/, externals/ treated as infra; not demos.
- Did not verify product claims (PingOne Verify, Recognize, DaVinci specifics) beyond file headers.

# UI audit: nested `<main>` and missing `<h1>` per route

Generated 2026-11-10 by a static scan (TypeScript AST) of every `<Route element=...>` in `src/App.js` and `src/routes/*.js`, following imports of the page component up to 3 levels (2 for `<main>`). It is a best-effort map, not a render: a page whose title comes from a component reached only at run time may be reported wrong. The shell's own `<main className="main-content">` (App.js, `routes/AppShell.js`, `routes/AcademyRoutes.jsx`, `routes/SignInRequired.js`) is the one `<main>` a page should have.

## Totals

| | before | after this PR |
|---|---|---|
| routes scanned (redirects excluded) | 296 | 296 |
| routes inside the shell that also render a second `<main>` (own file or direct child) | 50 | 23 |
| routes with no `<h1>` anywhere in the page tree | 52 | 46 |

Counts are per route; one page file can serve several routes (for example `PersonalAgentDesignPage` serves two). The 22 `<Navigate>` redirect routes are left out. Container routes that mount a nested `<Routes>` (`/architecture/*`, `/monitoring/*`) are covered by their child routes.

## Routes (state before this PR)

Columns: nested main = a second `<main>` rendered inside the shell's `<main>`; h1 = a heading level 1 exists in the page tree; status = what this PR did.

| Route | File | Shell main | Nested main | h1 | Status |
|---|---|---|---|---|---|
| `(index)` | `components/SetupPage.js` | yes | YES | yes (via child) | main left: route reached via wildcard |
| `*` | `components/Dashboard.js` | yes | YES | yes (via child) | main left: scan false positive: Dashboard.js already renders a region, not a second main |
| `*` | `components/NotFoundPage.js` | yes | no | yes |  |
| `/` | `components/LandingPage.js` | yes | no | yes |  |
| `/` | `components/Dashboard.js` | yes | no | yes (via child) |  |
| `/a2a-architecture` | `components/a2aArchitecture/A2aArchitecturePage.jsx` | yes | YES | yes | main fixed |
| `/a2a-protocol-learning` | `pages/A2AProtocolLearningPage.jsx` | yes | no | yes (via child) |  |
| `/academy/:lessonId` | `components/TopNav.js` | yes | no | yes (via child) |  |
| `/academy/:lessonId/:mode` | `components/TopNav.js` | yes | no | yes (via child) |  |
| `/academy/academy/:lessonId/:mode` | `routes/AcademyRoutes.jsx` | yes | no | no | h1 left |
| `/academy/identity` | `pages/AgentIdentityAcademyPage.jsx` | yes | no | no | h1 left |
| `/accounts` | `components/Accounts.js` | yes | no | yes (via child) |  |
| `/actor-token-education` | `components/ActorTokenEducation.tsx` | yes | no | no | h1 added |
| `/admin` | `components/Dashboard.js` | yes | no | yes (via child) |  |
| `/admin/agentic-access-console` | `pages/AgenticAccessConsolePage.js` | yes | no | yes (via child) |  |
| `/admin/banking` | `components/BankingAdminOps.js` | yes | no | yes (via child) |  |
| `/admin/government` | `components/GovernmentAdminOps.js` | yes | no | yes (via child) |  |
| `/admin/healthcare` | `components/HealthcareAdminOps.js` | yes | no | yes (via child) |  |
| `/admin/investment` | `components/InvestmentAdminOps.js` | yes | no | yes (via child) |  |
| `/admin/manufacturing` | `components/ManufacturingAdminOps.js` | yes | no | yes (via child) |  |
| `/admin/pingone` | `components/Dashboard.js` | yes | no | yes (via child) |  |
| `/admin/retail` | `components/RetailAdminOps.js` | yes | no | yes (via child) |  |
| `/admin/skin-studio` | `pages/SkinStudioPage.jsx` | yes | no | yes |  |
| `/admin/sporting-goods` | `components/SportingGoodsAdminOps.js` | yes | no | yes (via child) |  |
| `/admin/university` | `components/UniversityAdminOps.js` | yes | no | yes (via child) |  |
| `/admin/verticals` | `vertical/AdminEditor/VerticalEditorPage.jsx` | yes | YES | no | main left: editor layout; no h1 either; h1 left |
| `/admin/walbuy` | `components/AbercrombieFitchAdminOps.js` | yes | no | yes (via child) |  |
| `/admin/workforce` | `components/WorkforceAdminOps.js` | yes | no | yes (via child) |  |
| `/agent-builder` | `components/AgentBuilderPage.jsx` | yes | no | yes (via child) |  |
| `/agent-flow-inspector` | `pages/AgentFlowHistoryPage.jsx` | yes | YES | yes | main left: inner detail <main>, needs a look |
| `/agent-gateway-authorization` | `pages/AgentGatewayAuthorizationLessonPage.jsx` | yes | no | yes (via child) |  |
| `/agent-gateway-capabilities` | `context/InspectorFieldContext.js` | yes | no | no | h1 left |
| `/agent-gateway-inspector` | `context/InspectorFieldContext.js` | yes | no | yes (via child) |  |
| `/agent-guardrails` | `pages/AgentGuardrailsPage.jsx` | yes | no | yes (via child) |  |
| `/agent-lifecycle` | `pages/AgentLifecyclePage.jsx` | yes | no | yes (via child) |  |
| `/agent-onboarding-flow` | `components/AgentOnboardingFlowDiagram.jsx` | yes | no | yes |  |
| `/agent-onboarding-flow-mermaid` | `components/AgentOnboardingMermaidPage.jsx` | yes | no | yes (via child) |  |
| `/agent-onboarding-flow-subway` | `components/AgentOnboardingSubwayPage.jsx` | yes | no | yes |  |
| `/agent-registry` | `pages/AgentRegistryPage.jsx` | yes | no | no | h1 left |
| `/agent-studio-preview` | `components/agentStudioPreview/AgentStudioPreviewPage.jsx` | yes | no | yes (via child) |  |
| `/agentic-trust` | `components/AgenticTrustEducation.tsx` | yes | no | yes |  |
| `/ai-control-plane` | `pages/AiControlPlanePage.jsx` | yes | no | no | h1 left |
| `/ai-gateway/shadow-ai-detector` | `pages/ShadowAiDetectorPage.jsx` | yes | YES | yes (via child) | main fixed |
| `/ai-products/authorize` | `pages/PingAiProductPage.jsx` | yes | no | yes (via child) |  |
| `/ai-products/core` | `pages/PingAiProductPage.jsx` | yes | no | yes (via child) |  |
| `/ai-products/gateway` | `pages/PingAiProductPage.jsx` | yes | no | yes (via child) |  |
| `/ai-products/privilege-a2a` | `pages/PingAiProductPage.jsx` | yes | no | yes (via child) |  |
| `/ai-products/privilege-llm` | `pages/PingAiProductPage.jsx` | yes | no | yes (via child) |  |
| `/ai-products/privilege-mcp` | `pages/PingAiProductPage.jsx` | yes | no | yes (via child) |  |
| `/ai-products/protect` | `pages/PingAiProductPage.jsx` | yes | no | yes (via child) |  |
| `/aic-token-exchange` | `pages/AicTokenExchangePage.jsx` | yes | no | yes (via child) |  |
| `/api-traffic` | `components/ApiTrafficPage.js` | yes | no | no | h1 left |
| `/architecture/*` | `components/ArchitectureTabsPanel.jsx` | yes | YES | yes (via child) | main left: child ServerTopologyPage (see server-topology) |
| `/audit` | `components/AuditPage.js` | yes | no | no | h1 left |
| `/audit-agent` | `pages/AuditAgentPage.jsx` | yes | no | yes (via child) |  |
| `/authorization-flow` | `pages/AuthorizationFlowPage.jsx` | yes | no | yes (via child) |  |
| `/authz-server-rules` | `components/MockAuthzRulesPage.jsx` | yes | no | no | h1 left |
| `/autonomous-agents` | `pages/AutonomousAgentsPage.jsx` | yes | no | yes (via child) |  |
| `/brave-mcp` | `pages/McpShowcasePage.jsx` | yes | no | yes (via child) |  |
| `/chatgpt-login` | `pages/ChatgptLoginPage.jsx` | yes | YES | yes | main left: vendor mock (excluded from the token ratchets) |
| `/check` | `pages/CheckPage.jsx` | yes | no | yes |  |
| `/ciba-approve` | `pages/CibaApprovalPage.js` | no | no | no | h1 left |
| `/ciba-email-approve` | `pages/CibaEmailApprovePage.js` | no | no | no | h1 left |
| `/cimd-privilege` | `components/cimdPrivilege/CimdPrivilegePage.jsx` | yes | YES | yes (via child) | main fixed |
| `/claude-skills` | `pages/SkillsIndexPage.jsx` | yes | no | yes (via child) |  |
| `/client-registration` | `components/ClientRegistrationPage.js` | yes | no | yes (via child) |  |
| `/code-explorer` | `components/CodeExplorerPage.jsx` | yes | no | yes (via child) |  |
| `/code-search` | `pages/CodeSearchPage.jsx` | yes | no | yes (via child) |  |
| `/compliance-modal-popout` | `components/ComplianceModalPopout.js` | no | no | no | h1 left |
| `/configure` | `components/Configuration/UnifiedConfigurationPage.tsx` | yes | no | yes |  |
| `/control-plane` | `pages/ControlPlanePage.jsx` | yes | no | yes |  |
| `/copilot` | `components/CopilotPage.jsx` | yes | no | no | h1 left |
| `/dashboard` | `components/UserDashboardPing2026.js` | yes | YES | yes (via child) | main left: scan finds the clinical-vertical host child (AgentClinicalHost main); the page itself already renders a div |
| `/davinci-ciba-flows` | `pages/DavinciCibaFlowsPage.jsx` | yes | no | yes (via child) |  |
| `/davinci-login/callback` | `pages/DavinciLoginCallback.jsx` | yes | no | no | h1 left |
| `/davinci-login/confirmed` | `pages/DavinciLoginConfirmedPage.jsx` | yes | no | yes |  |
| `/davinci-orchestration-sdk` | `components/PingOneProviderGuard.jsx` | yes | no | yes (via child) |  |
| `/davinci-sdk` | `pages/OrchestrationSdkExplainerPage.jsx` | yes | no | yes (via child) |  |
| `/davinci-widget` | `components/PingOneProviderGuard.jsx` | yes | no | yes (via child) |  |
| `/delegated-commerce` | `pages/DelegatedCommercePage.jsx` | yes | no | yes (via child) |  |
| `/delegation` | `components/DelegationPage.js` | yes | no | yes |  |
| `/delegation-chain-value` | `pages/DelegationChainValuePage.jsx` | yes | no | yes (via child) |  |
| `/demo-arch-slides/ciba-hitl` | `components/DemoArchSlidesPage.jsx` | yes | no | no | h1 left |
| `/demo-arch-slides/coding-agents` | `components/DemoArchSlidesPage.jsx` | yes | no | no | h1 left |
| `/demo-arch-slides/control-plane` | `components/DemoArchSlidesPage.jsx` | yes | no | no | h1 left |
| `/demo-arch-slides/id-jag` | `components/DemoArchSlidesPage.jsx` | yes | no | no | h1 left |
| `/demo-arch-slides/obo-assistant` | `components/DemoArchSlidesPage.jsx` | yes | no | no | h1 left |
| `/demo-arch-slides/workload-agents` | `components/DemoArchSlidesPage.jsx` | yes | no | no | h1 left |
| `/demo-config` | `components/DemoConfigPage.js` | yes | no | yes (via child) |  |
| `/demo-guide-popout` | `components/DemoGuidePopout.jsx` | no | no | yes (via child) |  |
| `/demo-map` | `components/DemoMapPage.jsx` | yes | no | yes (via child) |  |
| `/demo-steps-lifeline-audit` | `components/DemoStepsLifelineAuditPage.jsx` | yes | no | yes (via child) |  |
| `/demo-summary` | `pages/DemoSummaryPage.jsx` | yes | no | yes (via child) |  |
| `/demo-track` | `pages/DemoTrackPage.jsx` | yes | no | yes (via child) |  |
| `/demo/:shellSlug` | `pages/FootprintLiveShellPage.jsx` | yes | YES | no | main left: mock browser chrome (intentional); h1 left |
| `/demo/enterprise-mcp` | `pages/EnterpriseMcpDemoPage.jsx` | yes | no | yes (via child) |  |
| `/demo/footprint-mocks` | `pages/FootprintMockGalleryPage.jsx` | yes | YES | yes | main left: mock browser chrome (intentional) |
| `/demo/footprint-picks` | `pages/FootprintPicksPage.jsx` | yes | YES | yes | main left: mock browser chrome (intentional) |
| `/dev-tools` | `components/DevToolsDashboard.jsx` | yes | no | yes (via child) |  |
| `/diagrams` | `components/diagramsIndex/DiagramsIndexPage.jsx` | yes | no | yes (via child) |  |
| `/digital-worker` | `pages/DigitalWorkerPage.jsx` | yes | no | yes (via child) |  |
| `/discovery-preview` | `components/agentStudioPreview/DiscoveryPreviewPage.jsx` | yes | no | yes (via child) |  |
| `/embedded-worker` | `pages/EmbeddedWorkerPage.jsx` | yes | no | yes (via child) |  |
| `/error-audit` | `components/AdminErrorAuditLog.js` | yes | no | no | h1 added |
| `/external-agents/:agentId` | `pages/ExternalAgentLessonPage.jsx` | yes | no | yes |  |
| `/external-door-diagrams` | `components/ExternalDoorDiagramPage.jsx` | yes | no | yes (via child) |  |
| `/feature-flags` | `components/FeatureFlagsPage.js` | yes | no | yes (via child) |  |
| `/gateway-claims` | `pages/GatewayClaimsPage.jsx` | yes | no | yes (via child) |  |
| `/gateway-enforcement-map` | `components/GatewayEnforcementMapPage.jsx` | yes | no | yes (via child) |  |
| `/gateway-stats` | `components/GatewayStatsPage.jsx` | yes | no | yes (via child) |  |
| `/governance-timeline` | `pages/GovernanceTimelinePage.jsx` | yes | no | yes (via child) |  |
| `/graphify` | `components/GraphifyPage.jsx` | yes | no | yes (via child) |  |
| `/group-policy` | `pages/GroupPolicyBoardPage.jsx` | yes | no | yes (via child) |  |
| `/group-policy/full` | `pages/GroupPolicyBoardPage.jsx` | no | no | yes (via child) |  |
| `/hosted-registrations` | `pages/HostedRegistrationAdminPage.jsx` | yes | YES | yes | main fixed |
| `/id4ai-slides/:slideId` | `components/DemoArchSlidesPage.jsx` | yes | no | no | h1 left |
| `/iga-for-ai` | `components/agentStudioPreview/IgaForAiPage.jsx` | yes | no | yes (via child) |  |
| `/intent-binding-learning` | `pages/IntentBindingLearningPage.js` | yes | no | yes (via child) |  |
| `/intent-inspector` | `pages/IntentInspectorPage.jsx` | yes | no | no | h1 left |
| `/invest-dual-auth` | `components/InvestDualAuthDiagramPage.jsx` | yes | no | yes (via child) |  |
| `/jev-demos/:demoId` | `pages/JevDemoGalleryPage.jsx` | yes | no | yes |  |
| `/jev-learning` | `pages/JevLearningPage.jsx` | yes | no | yes (via child) |  |
| `/langchain` | `pages/LangChainPage.js` | yes | no | yes (via child) |  |
| `/learning` | `components/LearningHub.tsx` | yes | no | yes |  |
| `/learning-lab/:lab` | `pages/LearningProtocolLabPage.jsx` | yes | YES | yes | main fixed |
| `/llama-vscode-guide` | `components/LlamaVscodeGuidePage.jsx` | yes | no | no | h1 left |
| `/llm-config` | `components/LlmConfigPage.jsx` | yes | no | no | h1 added |
| `/llm-gateway` | `pages/LlmGatewayCombinedPage.jsx` | yes | YES | yes (via child) | main left: child AttackLabTab main (tab content) |
| `/llm-test` | `pages/LlmGatewayCombinedPage.jsx` | yes | YES | yes (via child) | main left: child AttackLabTab main (tab content) |
| `/login-flow` | `pages/LoginFlowDiagramPage.jsx` | yes | no | yes |  |
| `/logout` | `components/LogoutPage.js` | no | no | yes |  |
| `/logs` | `components/LogViewerPage.js` | yes | no | no | h1 left |
| `/m2m-sample` | `pages/M2mCredentialsSamplePage.jsx` | yes | no | no | h1 left |
| `/mcp-discovery` | `pages/McpDiscoveryPage.jsx` | yes | YES | yes (via child) | main fixed |
| `/mcp-gateway-oauth-flow` | `components/McpGatewayOauthFlowPage.jsx` | yes | no | yes (via child) |  |
| `/mcp-observability` | `pages/McpObservabilityPage.jsx` | yes | no | yes (via child) |  |
| `/mcp-scanner` | `pages/McpScannerPage.jsx` | yes | no | yes (via child) |  |
| `/mcp-scope-topology` | `pages/McpScopeTopologyPage.jsx` | yes | YES | yes (via child) | main fixed |
| `/mcp-traffic` | `components/McpTrafficPage.js` | yes | no | yes |  |
| `/mfa-test` | `components/MFATestPage.tsx` | yes | no | yes |  |
| `/mgmt-api` | `components/MgmtApiRunnerPage.jsx` | yes | no | no | h1 left |
| `/monitoring/*` | `components/TokenChainTraceRail.jsx` | yes | no | yes (via child) |  |
| `/monitoring/new-relic` | `components/NewRelicDashboard.jsx` | yes | no | yes (via child) |  |
| `/monitoring/p1az` | `components/P1AzDashboard.jsx` | yes | no | yes (via child) |  |
| `/monitoring/pingone-events` | `components/PingOneEventPanel.jsx` | yes | no | no | h1 left |
| `/monitoring/token-exchange` | `components/TokenExchangeDashboard.jsx` | yes | no | yes (via child) |  |
| `/oas-demo` | `components/OASDemoPage.jsx` | yes | no | yes (via child) |  |
| `/oauth-academy` | `components/OAuthAcademyPage.jsx` | yes | no | yes (via child) |  |
| `/oauth-debug-logs` | `components/OAuthDebugLogViewer.js` | yes | no | yes (via child) |  |
| `/oauth/token-display` | `components/OAuthTokenDisplayPage.jsx` | yes | no | no | h1 left |
| `/obo-demo` | `pages/OboDemoPage.jsx` | yes | no | yes (via child) |  |
| `/owasp` | `components/OwaspLearnerPage.js` | yes | no | yes (via child) |  |
| `/p1-third-party-exchange` | `pages/P1ThirdPartyExchangePage.jsx` | yes | no | yes (via child) |  |
| `/page-catalog` | `pages/PageCatalogPage.jsx` | yes | no | yes (via child) |  |
| `/path/apikey-info` | `components/ApiKeyPathPage.jsx` | yes | no | yes |  |
| `/path/dualtoken-info` | `components/AccessIdTokenPathPage.jsx` | yes | no | yes |  |
| `/path/feature` | `components/VerticalFeaturePage.jsx` | yes | no | yes |  |
| `/path/mortgage` | `components/MortgagePathPage.jsx` | yes | no | yes |  |
| `/personal-agent` | `pages/PersonalAgentStudioPage.jsx` | yes | no | yes |  |
| `/personal-agent-design` | `components/personalAgent/PersonalAgentDesignPage.jsx` | yes | YES | yes (via child) | main fixed |
| `/personal-agent-dual-gateway` | `components/personalAgent/PersonalAgentDesignPage.jsx` | yes | YES | yes (via child) | main fixed |
| `/personal-agent-flow` | `pages/PersonalAgentFlowPage.jsx` | yes | YES | yes (via child) | main fixed |
| `/personal-agent-review` | `components/personalAgent/PersonalAgentReviewPage.jsx` | yes | YES | yes (via child) | main fixed |
| `/personal-agent/client` | `pages/PersonalAgentClientWindow.jsx` | no | yes, but no shell main | yes |  |
| `/personal-agent/dot` | `pages/DotWorkbenchPage.jsx` | yes | YES | no | main left: DotWorkbenchPage has no h1 either; the header needs a design decision first; h1 left |
| `/personal-agent/dot/full` | `pages/DotWorkbenchPage.jsx` | no | yes, but no shell main | no | h1 left |
| `/personal-agent/full` | `pages/PersonalAgentStudioPage.jsx` | no | no | yes |  |
| `/personal-agent/learn` | `pages/PersonalAgentLearnPage.jsx` | no | yes, but no shell main | yes (via child) |  |
| `/personal-agent/muse` | `pages/MusePage.jsx` | yes | YES | yes (via child) | main left: two state-dependent mains, 3 test files |
| `/ping-products/verify-recognize` | `pages/PingOneVerifyRecognizePage.jsx` | yes | no | yes (via child) |  |
| `/pingcli` | `components/PingCliPage.js` | yes | no | yes |  |
| `/pingfederate-ai-agent` | `pages/PingFederateAiAgentPage.jsx` | yes | no | yes (via child) |  |
| `/pingfederate-config` | `pages/PingFederateConfigByUseCasePage.jsx` | yes | no | yes (via child) |  |
| `/pingfederate-davinci-kit` | `pages/PingFederateDavinciKitPage.jsx` | yes | YES | yes (via child) | main fixed |
| `/pingfederate-id-jag` | `pages/PingFederateIdJagExplainerPage.jsx` | yes | no | yes (via child) |  |
| `/pingfederate-id-jag/demo` | `pages/EnterpriseMcpDemoPage.jsx` | yes | no | yes (via child) |  |
| `/pingfederate-id-jag/diagram` | `components/PingFederateIdJagPage.jsx` | yes | YES | yes (via child) | main fixed |
| `/pingfederate-id-jag/implementation` | `pages/PingFederateIdJagImplementationPage.jsx` | yes | no | yes |  |
| `/pingfederate-id-jag/inspect` | `pages/IdJagInspectPage.jsx` | yes | YES | yes | main fixed |
| `/pingfederate-id-jag/learn` | `pages/IdJagLearnPage.jsx` | yes | YES | yes | main fixed |
| `/pingfederate-id-jag/playground` | `pages/IdJagPlaygroundPage.jsx` | yes | YES | yes | main left: 1244-line page with 5 test files; do in its own PR |
| `/pingfederate-id-jag/playground/diagram/:mode` | `pages/IdJagPlaygroundDiagramPage.jsx` | yes | YES | yes | main left: bare <main> wrapper plus nested usage; do with the playground |
| `/pingfederate-id-jag/runner` | `pages/IdJagRunnerLabPage.jsx` | yes | YES | yes | main fixed |
| `/pinggateway-routes` | `pages/PingGatewayRoutesPage.jsx` | yes | YES | yes (via child) | main fixed |
| `/pingone-authorize` | `components/PingOneAuthorizePage.jsx` | yes | no | yes (via child) |  |
| `/pingone-authorize-capabilities` | `pages/PingOneAuthorizeCapabilitiesPage.jsx` | yes | no | yes (via child) |  |
| `/pingone-authorize-config` | `pages/PingOneAuthorizeConfigByUseCasePage.jsx` | yes | YES | yes (via child) | main fixed |
| `/pingone-mcp-inspector` | `context/InspectorFieldContext.js` | yes | no | yes (via child) |  |
| `/pingone-platform-config` | `pages/PingOnePlatformConfigPage.jsx` | yes | no | yes (via child) |  |
| `/pingone-setup` | `pages/PingOneSetup.jsx` | yes | no | yes (via child) |  |
| `/pingone-test` | `components/PingOneTestPage.jsx` | yes | no | yes |  |
| `/platform-gaps` | `components/agentStudioPreview/PlatformGapsPage.jsx` | yes | no | yes (via child) |  |
| `/poc-flow` | `pages/PocFlowPage.jsx` | yes | YES | yes (via child) | main fixed |
| `/policy-decision-trace` | `components/PolicyDecisionTracePage.jsx` | yes | no | yes (via child) |  |
| `/poppy` | `pages/PoppyPage.jsx` | yes | YES | yes (via child) | main fixed |
| `/postman` | `components/PostmanCollectionsPage.js` | yes | YES | yes | main left: not attempted: themingRatchet pins on this file |
| `/privilege-a2a` | `pages/PrivilegeA2aPage.jsx` | yes | no | yes (via child) |  |
| `/privilege-ai-policies` | `pages/PrivilegeAiPoliciesDemoPage.jsx` | yes | no | yes (via child) |  |
| `/privilege-coding-agents` | `pages/PrivilegeCodingAgentsPage.jsx` | yes | no | yes (via child) |  |
| `/privilege-demo` | `pages/PrivilegeDemoPage.jsx` | yes | no | yes (via child) |  |
| `/privilege-docs-index` | `pages/PrivilegeDocsIndexPage.jsx` | yes | no | yes (via child) |  |
| `/privilege-first-gateway` | `components/PrivilegeFirstGatewayPage.jsx` | yes | YES | yes (via child) | main fixed |
| `/privilege-for-ai` | `pages/PrivilegeAiDemoPage.jsx` | yes | no | yes (via child) |  |
| `/privilege-gateway-topologies` | `components/PrivilegeGatewayTopologyPage.jsx` | yes | no | yes (via child) |  |
| `/privilege-intent-triage` | `pages/PrivilegeIntentTriagePage.jsx` | yes | no | yes (via child) |  |
| `/privilege-map` | `pages/PrivilegeMapPage.jsx` | yes | no | yes (via child) |  |
| `/privilege-mcp-client` | `pages/PrivilegeMcpClientPage.jsx` | yes | YES | yes (via child) | main left: vendor-style client, 2300-line page |
| `/privilege-mcp-diagrams` | `components/PrivilegeMcpDiagramPage.jsx` | yes | no | yes (via child) |  |
| `/privilege-mcp-learning` | `pages/PrivilegeMcpLearningPage.jsx` | yes | no | yes (via child) |  |
| `/privilege-pf-token` | `pages/PrivilegePfTokenDemoPage.jsx` | yes | no | yes (via child) |  |
| `/privilege-pii-detection` | `pages/PrivilegePiiDetectionPage.jsx` | yes | no | yes (via child) |  |
| `/privilege-prompt-log` | `pages/PrivilegePromptLogPage.jsx` | yes | no | yes (via child) |  |
| `/privilege-saas-access` | `pages/PrivilegeSaasAccessPage.jsx` | yes | no | yes (via child) |  |
| `/privilege-shelf` | `pages/PrivilegeShelfPage.jsx` | yes | no | yes (via child) |  |
| `/privileges-gateway-preview` | `components/agentStudioPreview/PrivilegesGatewayPreviewPage.jsx` | yes | no | yes (via child) |  |
| `/profile` | `components/Profile.js` | yes | no | yes |  |
| `/promptfoo` | `components/PromptFooPage.js` | yes | no | yes (via child) |  |
| `/protect-auth-demo` | `pages/PingOneProtectBrowserDemo.jsx` | yes | no | no | h1 left |
| `/protect-auth-demo/popout` | `pages/PingOneProtectBrowserDemo.jsx` | no | no | no | h1 left |
| `/protocol-playground` | `components/ProtocolPlayground/ProtocolPlayground.jsx` | yes | YES | yes | main left: inner viewer <main> |
| `/reports` | `components/RunReportPage.js` | yes | no | yes (via child) |  |
| `/request-access` | `pages/HostedRegistrationPage.jsx` | yes | YES | yes | main fixed |
| `/resource-server` | `components/ResourceServerPage.jsx` | yes | no | yes (via child) |  |
| `/resource-server-cc` | `components/ClientCredentialsResourcePage.jsx` | yes | no | yes |  |
| `/resource-server-checkpoint` | `components/ResourceServerCheckpointPage.jsx` | yes | no | yes (via child) |  |
| `/resource-server-placement` | `components/ResourceServerPlacementPage.jsx` | yes | no | yes (via child) |  |
| `/rs/api` | `pages/ResourceServerJourneyPage.jsx` | yes | no | no | h1 left |
| `/rs/invest` | `pages/ResourceServerJourneyPage.jsx` | yes | no | no | h1 left |
| `/rs/olb` | `pages/ResourceServerJourneyPage.jsx` | yes | no | no | h1 left |
| `/samples/custom-admin-role` | `pages/SampleAppPage.jsx` | yes | no | yes |  |
| `/samples/m2m-credentials` | `pages/SampleAppPage.jsx` | yes | no | yes |  |
| `/samples/mfa-demo` | `pages/SampleAppPage.jsx` | yes | no | yes |  |
| `/samples/user-registration` | `pages/SampleAppPage.jsx` | yes | no | yes |  |
| `/scope-audit` | `components/ScopeAuditPage.js` | yes | no | yes (via child) |  |
| `/scope-reference` | `components/ScopeReferencePage.js` | yes | no | yes (via child) |  |
| `/sdk-login` | `pages/SdkLoginPage.jsx` | yes | no | yes |  |
| `/sdk-login/callback` | `pages/SdkLoginCallback.jsx` | no | no | no | h1 left |
| `/secret-rotation` | `pages/SecretRotationPage.jsx` | yes | no | yes (via child) |  |
| `/security` | `components/SecurityCenter.js` | yes | no | no | h1 left |
| `/security-dashboard` | `components/SecurityRiskDashboard.jsx` | yes | YES | yes | main left: three state-dependent mains |
| `/self-service` | `components/SelfServicePage.js` | yes | no | yes |  |
| `/sequence-diagram` | `components/SequenceDiagramPage.js` | yes | no | no | h1 left |
| `/session-lab` | `pages/SessionLabPage.jsx` | yes | no | yes (via child) |  |
| `/settings` | `components/SecuritySettings.js` | yes | no | yes (via child) |  |
| `/setup/*` | `components/PingOneSetupGuidePage.js` | yes | YES | yes | main left: child SetupPage.js renders its own main |
| `/snapshot-import` | `pages/SnapshotImport.jsx` | yes | no | no | h1 added |
| `/spiffe-pingone-bridge` | `components/SpiffePingoneBridgePage.jsx` | yes | no | yes (via child) |  |
| `/spinner-showcase` | `pages/SpinnerShowcasePage.jsx` | yes | YES | yes (via child) | main fixed |
| `/standalone` | `pages/StandaloneSamples.jsx` | no | yes, but no shell main | yes |  |
| `/standalone/:sampleId` | `pages/StandaloneSamples.jsx` | no | yes, but no shell main | yes |  |
| `/standalone/ai-policies` | `pages/StandaloneSamples.jsx` | no | yes, but no shell main | yes |  |
| `/standalone/runner/m2m` | `pages/StandaloneSamples.jsx` | no | yes, but no shell main | yes |  |
| `/telemetry` | `pages/TelemetryPage.jsx` | yes | no | yes |  |
| `/token-compliance` | `components/AdminTokenComplianceAudit.jsx` | yes | no | yes |  |
| `/token-exchange-tester` | `pages/TokenExchangeTesterPage.jsx` | yes | no | yes (via child) |  |
| `/token-security` | `components/TokenSecurityTester.jsx` | yes | no | yes (via child) |  |
| `/tracing` | `pages/TracingPage.jsx` | yes | no | yes (via child) |  |
| `/transaction-consent` | `components/TransactionConsentPage.js` | yes | no | yes (via child) |  |
| `/transaction-trace` | `pages/TransactionTracePage.jsx` | yes | no | yes |  |
| `/transaction-trace/embed/:correlationId` | `pages/TransactionTraceEmbedPage.jsx` | no | no | yes |  |
| `/transactions` | `components/Transactions.js` | yes | no | yes (via child) |  |
| `/uhg-chatgpt-mcp-flow` | `pages/UhgChatgptMcpFlowPage.jsx` | yes | YES | yes (via child) | main fixed |
| `/ungoverned-agent` | `components/UngovernedAgentPage.js` | yes | no | yes (via child) |  |
| `/united-personal-agent-flow` | `pages/UnitedPersonalAgentFlowPage.jsx` | yes | YES | yes (via child) | main fixed |
| `/use-case-diagrams` | `components/UseCaseDiagramsGalleryPage.jsx` | yes | YES | yes (via child) | main fixed |
| `/use-case-diagrams/:ucId` | `components/UseCaseDiagramPage.jsx` | yes | YES | yes | main left: two mains, 3 test files |
| `/use-cases` | `pages/UseCaseLauncherPage.js` | yes | no | yes |  |
| `/use-cases/live` | `pages/LiveUseCaseWorkbenchPage.js` | yes | no | yes |  |
| `/user-accounts` | `components/UserAccounts.js` | yes | no | no | h1 left |
| `/users` | `components/Users.js` | yes | no | yes (via child) |  |
| `/weather-mcp` | `pages/McpShowcasePage.jsx` | yes | no | yes (via child) |  |
| `/webmcp` | `components/WebMcpExplainer.js` | yes | no | yes |  |
| `/welcome` | `components/LandingPage.js` | yes | no | yes |  |
| `/where-everything-runs` | `components/WhereEverythingRunsPage.jsx` | yes | no | yes (via child) |  |
| `/workload-agents` | `pages/WorkloadAgentsPage.jsx` | yes | no | yes (via child) |  |
| `a2a` | `components/A2AArchitecturePage.jsx` | yes | no | yes (via child) |  |
| `activity-log` | `components/ActivityLogPage.js` | yes | no | yes (via child) |  |
| `agent-flow` | `` | yes | no | no | h1 left |
| `api-activity` | `components/ActivityLogs.js` | yes | no | yes |  |
| `canvas` | `components/ArchitectureCanvasPage.jsx` | yes | no | no | h1 added |
| `flow` | `components/ArchitectureFlowPage.js` | yes | no | no | h1 left |
| `mcp-traffic` | `components/McpTrafficPage.js` | yes | no | yes |  |
| `observability` | `components/ObservabilityDiagramPage.jsx` | yes | no | yes (via child) |  |
| `overview` | `components/ArchitectureOverviewPage.js` | yes | no | yes |  |
| `phase-266` | `components/Phase266ArchitecturePage.jsx` | yes | no | yes (via child) |  |
| `pingfederate-id-jag` | `components/PingFederateIdJagPage.jsx` | yes | YES | yes (via child) | main fixed |
| `pingone` | `components/PingOneSetupGuidePage.js` | yes | no | yes |  |
| `poc-compare` | `components/ReactFlowPocComparePage.jsx` | yes | no | no | h1 added |
| `reactflow-poc` | `components/ReactFlowPocPage.jsx` | yes | no | no | h1 left |
| `server-topology` | `components/ServerTopologyPage.jsx` | yes | YES | yes | main left: 1025-line page with inline pageStyle and 2 test files |
| `system` | `components/ArchitectureTabsPanel.jsx` | yes | no | no | h1 left |
| `system-flow` | `components/SystemFlowMap.jsx` | yes | no | no | h1 left |
| `token-chain` | `components/TokenChainArchitecturePage.js` | yes | no | yes |  |
| `token-chain` | `components/TokenChainTraceRail.jsx` | yes | no | no | h1 left |
| `token-flow` | `components/ArchitectureTokenFlowPage.js` | yes | no | yes (via child) |  |
| `wizard` | `components/SetupWizard.js` | yes | no | yes |  |

## Notes for a later pass

- Nested `<main>` fixed in 25 page components (27 routes): the `<main>` became a `<div>` with the same className, data-testid and style. No stylesheet or test selects `main.<class>` for any of them.
- `<h1>` added on 6 routes by promoting the single `<h2>` page title; each stylesheet rule that targeted `<container> h2` now also targets `<container> h1`, so the look is unchanged.
- Not promoted on purpose: `MockAuthzRulesPage` (also embedded in `AuthorizeConfigPage`) and `PingOneProtectBrowserDemo` (also embedded in `PingAiProductPage`), where an h1 would duplicate the host page's; `UserAccounts` and `M2mCredentialsSamplePage`, whose h2 styling comes from rules that would change the look as an h1.
- Routes still without an h1 (about 46): most have no visible page title at all (AuditPage, AgentRegistryPage, IntentInspectorPage, LogViewerPage, SequenceDiagramPage, SecurityCenter, the DemoArchSlides routes, and others). Adding one is a design change, not a mechanical one, so they are listed, not touched.
- Open question for the owner: the SkipLink targets the first `<main>` in the document; after this PR that is always the shell's on the routes fixed here.

## Redirect-only routes (not audited)

`/demo-data`, `/standalone/cedar`, `/authz-test`, `/jev-demos`, `/mcp-inspector`, `/pinggateway-test`, `/pinggateway-inspector`, `/orchestration-sdk`, `/davinci-orchestration`, `/davinci-sdk-login`, `/davinci-login-guide`, `/servers`, `/ping-ai-test-lab`, `/login`, `/themes`, `/activity`, `/authorize-config`, `/mcp-gateway`, `/config`, `/mcp-tools`, `/privilege-cedar`, `api-explorer`

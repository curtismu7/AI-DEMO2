# Page Catalog

Every page in the side nav: what it does, what it teaches, what it demos. Grouped as in `demo_api_ui/src/config/navStructureCatalog.js`. Routes and auth levels come from `AdminSideNav.jsx` and `demo_api_server/config/auth-requirements.json`.

Notes: several nav labels differ from the page's own heading (recorded per page). Some entries are redirects or side-nav actions with no route. "unclear" means the page copy did not settle the answer. Generated 2026-09-30 from source; re-verify against the live app before quoting.

## Top-level

### Home
- **Route:** `/` · **Auth:** public
- **What it does:** Landing page with hero, core-capability cards, and buttons to the Admin Dashboard, Customer Dashboard, Use Cases and Setup.
- **What it teaches:** Identity shifting from "who are you?" to "what is this agent authorized to do?"; OIDC, CIBA, step-up, RFC 8693, MCP.
- **What it demos:** Nothing live itself; it is the entry point to the PingOne-secured AI banking demo (component LandingPage).

### Security Dashboard
- **Route:** `/security-dashboard` · **Auth:** admin
- **What it does:** Security and Risk Dashboard: evidence-backed posture across identity, policy, delegation, approvals and infrastructure.
- **What it teaches:** Reading posture from evidence (signal trends, control effectiveness, risk queue), not from a compliance claim.
- **What it demos:** Live aggregate data: signal trend, risk queue, 24-hour identity and token signals, trust boundaries, evidence timeline.

### Skin Studio
- **Route:** `/admin/skin-studio` · **Auth:** admin
- **What it does:** One place per vertical to edit colors, logo, and duplicate a vertical; theme changes apply live.
- **What it teaches:** Per-vertical branding and theming of the demo; not an identity standard.
- **What it demos:** Live re-skinning of the running app for a selected vertical, plus cloning it into a new vertical.

## Agent Privilege

### AI Guard
- **Route:** `/ai-gateway/shadow-ai-detector` · **Auth:** public
- **What it does:** Learning page (titled "Shadow AI Detector") documenting what the browser extension records about AI usage, OAuth-connected agents and sensitive data flows.
- **What it teaches:** Shadow AI signals, how event risk is scored (capped score to severity), and what the detector cannot see.
- **What it demos:** Static explainer of extension signals (AI sites, OAuth consent, extensions, clipboard/file transfers); no live call.

### Protocol Playground
- **Route:** `/protocol-playground` · **Auth:** user
- **What it does:** Steps through identity protocols one request at a time against the live backend, showing real requests, responses and decoded tokens.
- **What it teaches:** CIBA, DPoP, RFC 8693 token exchange and PAR, and why they keep agent access safe.
- **What it demos:** Live protocol runs with per-step request/response and token inspection.

### AI Guard Client
- **Route:** `/privilege-mcp-client` · **Auth:** public
- **What it does:** Titled "AI Agent Gateway Client — PingOne": a desktop-style MCP client that signs in to a gateway door, lists tools and chats.
- **What it teaches:** Per-tool, per-user access through the AI Agent Gateway, including sign-in modes (max_age, prompt) and policy denials.
- **What it demos:** Live tool discovery and calls through the gateway, with Access Denied detail when policy blocks. The A2A tab runs an access review from a main agent to a worker agent and its MCP tools, each hop through the gateway.

### LLM Gateway
- **Route:** `/llm-gateway` · **Auth:** user
- **What it does:** Page headed "AI Guard": sends prompts through a PingOne Privilege virtual key; provider key stays inside Privilege.
- **What it teaches:** Gateway-side policy can refuse an LLM call before the model sees the text; virtual keys hide provider credentials.
- **What it demos:** Live prompts across model lanes with a "Last decision" panel showing the verdict.

### Intent Inspector
- **Route:** `/intent-inspector` · **Auth:** admin
- **What it does:** Inspector where you pick a drift scenario and endpoint, then Evaluate against PingOne Authorize intent policies.
- **What it teaches:** Intent binding: comparing consented versus attempted intent, and how Authorize returns intent-* statements.
- **What it demos:** A live PingOne Authorize decision with Decision, Comparison, Response and Request tabs.

### Audit Agent
- **Route:** `/audit-agent` · **Auth:** public
- **What it does:** An agent restricted to PingOne's audit log by gateway scope, not by the page; ask questions or run allowed tools.
- **What it teaches:** Scope-limited agents: the gateway door's scope decides which tools the agent may call.
- **What it demos:** Live natural-language audit queries (about 7 days of history) and the tools table for that door.

### Agent Privilege Guide
- **Route:** `/privilege-mcp-learning` · **Auth:** public
- **What it does:** Long guide "AI Agent Gateway": overview, architecture, install, configuration, console setup, policies, troubleshooting, reference.
- **What it teaches:** Just-in-time, least-privilege MCP access governance and how it differs from PingOne Agent Gateway token mediation.
- **What it demos:** Static documentation with code blocks; nothing live.

### Agent Gateway Authorization
- **Route:** `/agent-gateway-authorization` · **Auth:** public
- **What it does:** Lesson "Make every agent action accountable" pairing Agent Gateway with PingOne Authorize, with live-story links and guided scenarios.
- **What it teaches:** Authentication versus authorization versus obligations; PERMIT, DENY and STEP-UP outcomes enforced by the gateway.
- **What it demos:** Guided requests sent through the BFF, showing the returned decision and live-response capture.

### Agent Privilege Diagrams
- **Route:** `/privilege-mcp-diagrams` · **Auth:** public
- **What it does:** Renders architecture and protocol flow diagrams for the AI Agent Gateway integration.
- **What it teaches:** How the gateway applies JIT least-privilege authorization to every MCP tool call.
- **What it demos:** Rendered diagrams; no live call.

### Agent IAM Core
- **Route:** `/ai-products/core` · **Auth:** public
- **What it does:** Product page on identity and tokens for AI agents: capabilities, agent runs, flow and takeaway.
- **What it teaches:** Distinct agent identity, scoped short-lived tokens, and RFC 8693 on-behalf-of delegation.
- **What it demos:** Links to live runs: Agent lifecycle (`/agent-lifecycle`) and Delegated commerce (`/delegated-commerce`).

### Agent Gateway
- **Route:** `/ai-products/gateway` · **Auth:** public
- **What it does:** Product page on the runtime enforcement point between agents and APIs, tools and MCP servers.
- **What it teaches:** Gateway validates token, audience, scopes and delegation chain, protects MCP discovery and calls, and records evidence.
- **What it demos:** Links to Weather MCP permit, Gateway inspector, and a live gateway deny.

### PingOne Authorize
- **Route:** `/ai-products/authorize` · **Auth:** public
- **What it does:** Product page on fine-grained, policy-based decisions for agent actions.
- **What it teaches:** Authentication says who; Authorize says what that caller may do in context, with permit, deny, step-up and obligations.
- **What it demos:** Links to the policy console (`/pingone-authorize`), a denied transfer, and intent binding.

### Agent Privilege · LLM
- **Route:** `/ai-products/privilege-llm` · **Auth:** public
- **What it does:** Product page "Privilege for AI — LLM protection" on controlling prompts, responses and agent actions.
- **What it teaches:** Treat the model interaction as a security boundary; inspect, allow, block, and keep identity in view.
- **What it demos:** Links to a blocked prompt-injection run, LLM Gateway, and the LLM request tester.

### Agent Privilege · MCP
- **Route:** `/ai-products/privilege-mcp` · **Auth:** public
- **What it does:** Product page "Privilege for AI — MCP protection" on protecting MCP discovery and tool invocation.
- **What it teaches:** MCP as a real application boundary: control both tools/list and tool calls against scope and delegation.
- **What it demos:** Links to the Privilege MCP client, MCP protection guide, and a Weather MCP scope deny.

### Protected RAG
- **Route:** `/code-search` · **Auth:** public
- **What it does:** Workspace to manage and inspect the indexed corpus and search or ask over code packages.
- **What it teaches:** Retrieval is a governed action: RFC 8693 delegation, the code:search scope, Agent Gateway and PingOne Authorize.
- **What it demos:** Live code search plus a retrieval authorization flow diagram; the Demo Steps chip runs the protected retrieval.

### Agent Privilege Demo
- **Route:** `/privilege-demo` · **Auth:** public
- **What it does:** SE presenter hub "PingOne Privilege - SE Demo Hub" listing personas, console links and an OAuth config panel.
- **What it teaches:** How to present the shared PingOne Privilege environment (Platform Admin, Privilege Admin, End User roles).
- **What it demos:** Persona cards, console/Kibana/MCP-observability links, and the live Privilege MCP OAuth configuration form.

## A2A

### A2A Access Review
- **Route:** `/privilege-a2a` · **Auth:** public
- **What it does:** Ask about an entitlement; the main agent hands the lookup to a worker agent, which checks access data through MCP. Every hop goes through the Agent Privilege gateway. The header path lights up from the run's real events, and the Agent trace and Step details show each hop with its request and response.
- **What it teaches:** Who acts for whom in an agent-to-agent handoff, which agent reads the data, and what the gateway records of the run.
- **What it demos:** Suggested questions per vertical (each vertical's own A2A chip first), a walkthrough, three "Break it" cases that stop, and a per-page Heuristics | llama.cpp toggle: Heuristics runs the same A2A and MCP hops with no model call.

### A2A Protocol & Identity
- **Route:** `/a2a-protocol-learning` · **Auth:** public
- **What it does:** Eight-section walkthrough: two meanings of A2A, live Agent Card fetch, bearer-gate probe, live or recorded delegation run, token chain and wire panes.
- **What it teaches:** Identity (RFC 8693 nested act claims) versus wire protocol (Linux Foundation A2A, Agent Card, JSON-RPC); cards describe capability, not authority.
- **What it demos:** Unauthenticated card fetch, a no-bearer POST refused, and a run showing act depth, scope shrink and the specialist handoff.

### A2A Architecture
- **Route:** `/a2a-architecture` · **Auth:** public
- **What it does:** "A2A Delegation — Architecture": a step-through of the delegation flow, the key distinction between the two layers called A2A, and the specialist registry.
- **What it teaches:** The identity layer (a nested RFC 8693 act chain approved by PingOne Authorize) is separate from the wire protocol layer (Agent Card discovery plus JSON-RPC over a separate bearer).
- **What it demos:** The delegation flow step by step and the registry of specialists per vertical.

### Delegation Chain Value
- **Route:** `/delegation-chain-value` · **Auth:** public
- **What it does:** Explainer page titled "Prove who acted, and who authorized it" with two Run buttons that invoke the agent live.
- **What it teaches:** Delegated agents create a trust gap; nested act claims give accountability and an actor-aware policy gives authorization.
- **What it demos:** "hand off to a specialist" mints a governed token chain; "simulate an agent identity mismatch" is denied for an unregistered agent.

### Malicious A2A
- **Route:** `/llm-gateway?tab=a2a` · **Auth:** user
- **What it does:** The "Malicious A2A" tab of the LLM Gateway page: pick an Agent Card (bundled samples or a live URL) and scan it for poisoned metadata.
- **What it teaches:** An Agent Card is untrusted text that an agent may follow; poisoned fields can carry hidden instructions or exfiltration.
- **What it demos:** A clean card, a blatant poisoned card and a subtle one that trips the secrecy and exfiltration detectors, scanned through the gateway.

### A2A Product Page
- **Route:** `/ai-products/privilege-a2a` · **Auth:** public
- **What it does:** Product page "Privilege for AI — A2A protection" on agent-to-agent handoff.
- **What it teaches:** Authenticated, policy-bound, accountable agent handoffs with the delegation context kept attached.
- **What it demos:** Links to the A2A access review through the gateway, the three-deep agent chain (Demo Step 26), the agent-to-agent architecture tab, the A2A protocol walkthrough and the delegation chain page.

## DaVinci

### DaVinci Widget
- **Route:** `/davinci-widget` · **Auth:** public
- **What it does:** Runs a live DaVinci journey in an embedded widget (or pop-out) with a call trace; paths are Sign in, Register, Recover.
- **What it teaches:** DaVinci-served screens versus app-rendered UI; how the widget journey moves forward call by call.
- **What it demos:** A live DaVinci flow, its recorded transitions, and the app session created on sign-in.

### DaVinci Login
- **Route:** `/davinci-login-guide` · **Auth:** public
- **What it does:** Redirects to `/davinci-widget`; same page as DaVinci Widget.
- **What it teaches:** Same as DaVinci Widget.
- **What it demos:** Same as DaVinci Widget.

### DaVinci SDK Login
- **Route:** `/davinci-sdk-login` · **Auth:** public
- **What it does:** Redirects to `/davinci-orchestration-sdk`; same page as DaVinci Orchestration SDK.
- **What it teaches:** Same as DaVinci Orchestration SDK.
- **What it demos:** Same as DaVinci Orchestration SDK.

### DaVinci Orchestration
- **Route:** `/davinci-orchestration` · **Auth:** public
- **What it does:** Redirects to `/davinci-sdk`, the DaVinci SDK explainer.
- **What it teaches:** Same as Orchestration SDK Guide.
- **What it demos:** Same as Orchestration SDK Guide.

### DaVinci Orchestration SDK
- **Route:** `/davinci-orchestration-sdk` · **Auth:** public
- **What it does:** Live sign-in where the SDK draws each DaVinci step as our own form, beside SDK calls, responses and collectors.
- **What it teaches:** How @forgerock/davinci-client collectors let the app render screens while the flow stays editable in DaVinci.
- **What it demos:** A real DaVinci sign-in with a frame-by-frame reel of code and response, and a "What just happened" summary.

### Orchestration SDK Guide
- **Route:** `/orchestration-sdk` · **Auth:** public
- **What it does:** Redirects to `/davinci-sdk`: static lesson on three ways to run a flow and the client lifecycle, linking to the live SDK login.
- **What it teaches:** Widget vs SDK vs redirect invocation, and the collector loop (read, write, next()) ending in success with an auth code.
- **What it demos:** Static diagram and code samples; the live demo is one click away at `/davinci-orchestration-sdk`.

### DaVinci Orchestration Overview
- **Route:** `/davinci-orchestration` · **Auth:** public
- **What it does:** Redirects to `/davinci-sdk`, the same DaVinci SDK explainer as Orchestration SDK Guide.
- **What it teaches:** Same as Orchestration SDK Guide.
- **What it demos:** Same as Orchestration SDK Guide.

## Ping products

### PingOne Protect
- **Route:** `/ai-products/protect` · **Auth:** public
- **What it does:** Standalone page that collects browser Signals, sends them through the BFF to PingOne Protect and shows the risk response.
- **What it teaches:** Browser risk evaluation with the Signals SDK; credentials and raw evaluation stay server-side.
- **What it demos:** A live Protect evaluation showing risk level, recommended action and bot-detection details; no sign-in started.

### Headless Identity / PingCLI
- **Route:** `/pingcli` · **Auth:** public
- **What it does:** PingCLI page with install steps and command cards you click to run live against the configured environment, or copy.
- **What it teaches:** Administering PingOne headlessly with the official PingCLI, without the console.
- **What it demos:** Live PingCLI commands run on the demo's worker credentials, with terminal-style output.

### SDK Login
- **Route:** `/sdk-login` · **Auth:** public
- **What it does:** Sandbox "OIDC Centralized Login - JavaScript SDK" (@forgerock/oidc-client): login, token inspection, revocation, MFA step-up in the browser.
- **What it teaches:** Browser-side authorization code + PKCE as a public client, token storage and revocation, acr_values/max_age step-up.
- **What it demos:** A real PingOne PKCE sign-in and live token view, revoke, and step-up re-authorization.

### M2M Client Credentials
- **Route:** `/samples/m2m-credentials` · **Auth:** public
- **What it does:** Sample page: what the M2M sample teaches plus its code in five stacks; a runner executes it against the environment.
- **What it teaches:** client_credentials for machine-to-machine calls; JWKS/RS256 token validation; check client_id not sub; Protect risk gating.
- **What it demos:** An end-to-end run against the configured environment (creates nothing) via the runner at `/m2m-sample`.

### Custom Admin Role
- **Route:** `/samples/custom-admin-role` · **Auth:** public
- **What it does:** Sample page for delegated administration: builds a narrow custom admin role, with code in five stacks and a runner.
- **What it teaches:** Custom admin roles, canBeAssignedBy for safe delegation, and ENVIRONMENT scope keeping the role from becoming global.
- **What it demos:** A live workflow creating a custom role and demo worker app, then deleting them afterwards by default.
## Identity Journeys

### Self-Service Registration
- **Route:** `/self-service` · **Auth:** public
- **What it does:** "Self-Service User Provisioning": create a demo account or manage your existing profile.
- **What it teaches:** Customer self-registration and profile management against a PingOne population.
- **What it demos:** Create Account and My Profile tabs, ending in an "Account Created Successfully" confirmation.

### User Registration
- **Route:** `/samples/user-registration` · **Auth:** public
- **What it does:** Runs the PingOne devdocs sample: register a user and verify their email with a one-time code, entirely server-side.
- **What it teaches:** Native flows (`response_mode=pi.flow`), vendor content types, and `/as/resume` converting a flow into an authorization code.
- **What it demos:** A live run registering a real test account; PingOne emails a code you type in, then the account can be deleted.

### Login with MFA
- **Route:** `/samples/mfa-demo` · **Auth:** public
- **What it does:** Runs the PingOne devdocs sample: sign in, handle an email MFA challenge, then resume for tokens, all server-driven.
- **What it teaches:** How a native flow signals MFA is required and why session cookies must be captured and replayed manually.
- **What it demos:** A live sign-in for a pre-provisioned test user; PingOne emails a passcode you enter to finish.

### Identity Journey Map
- **Route:** `/login-flow` · **Auth:** public
- **What it does:** Shows the identity journey (registration, authentication, MFA step-up, recovery, session complete) plus a live evidence panel of your last sign-in.
- **What it teaches:** The stages of a customer identity lifecycle and what OAuth 2.0 + PKCE looks like on the wire.
- **What it demos:** The real sequence the BFF recorded during your last PingOne OAuth 2.0 + PKCE login, with Refresh and Clear controls.

### OAuth Academy
- **Route:** `/oauth-academy` · **Auth:** public
- **What it does:** An interactive chat teacher for OAuth 2.0, 2.1 and OIDC: ask a question or pick a topic to run a flow live.
- **What it teaches:** PKCE, scopes, RFC 8693 token exchange, act/may_act delegation, and human-in-the-loop approval.
- **What it demos:** Live authorization flows run by the Academy agent with the actual token chain shown at every hop.

### OAS Demo
- **Route:** `/oas-demo` · **Auth:** public
- **What it does:** "PingOne API Security Contract": OpenAPI 3.1 specs whose operations carry `x-permission` and `x-public-api` annotations, with a Launch AI Agent button. Also listed under Utilities.
- **What it teaches:** Machine-readable API contracts that map operations to OAuth scopes enforced at the MCP gateway.
- **What it demos:** A security-flow diagram, spec metadata, per-operation required scopes, and the security scheme.

## Authorize

### P1AZ Inspector
- **Route:** `/pingone-authorize` · **Auth:** public
- **What it does:** Inspector with an Authorization Policies tree, decision-endpoint selector and presets (Transaction, MCP First Tool, Custom); links to the PAC editor.
- **What it teaches:** PingOne Authorize decision requests: parameters in, policy rules evaluated, PERMIT/DENY out.
- **What it demos:** Live decision calls to a PingOne Authorize endpoint with rule trees and result; a trace can open in Policy Decision Trace.

### PAC Editor
- **Route:** external `http://127.0.0.1:9099` (opens in new tab; not an app route) · **Auth:** n/a (local tool)
- **What it does:** Opens the local Policy-as-Code editor started by `scripts/pac-edit.sh`; the P1AZ Inspector shows whether it is detected.
- **What it teaches:** Authoring authorization policy as code rather than in the console.
- **What it demos:** A locally running policy editor; unclear beyond its launch, as no in-app copy describes its UI.

### Authorize Capabilities
- **Route:** `/pingone-authorize-capabilities` · **Auth:** public
- **What it does:** Capability audit titled "PingOne Authorize": cards naming each real behavior of the integration with the file and function implementing it.
- **What it teaches:** Contextual runtime authorization: real-time decisions, fine-grained attribute-driven policy, least-privilege permissions.
- **What it demos:** A checkable ledger of grouped capabilities tied to source code, not live calls.

### Policy Decision Trace
- **Route:** `/policy-decision-trace` · **Auth:** public
- **What it does:** Full-page view of the P1AZ decision path, reached from the PingOne Authorize page; falls back to the last saved run.
- **What it teaches:** How individual policies and rules combine into a final authorization decision.
- **What it demos:** A policy decision tree for the last PingOne Authorize run, with a notice when showing a saved (possibly stale) decision.

### Scope Audit
- **Route:** `/scope-audit` · **Auth:** admin
- **What it does:** "PingOne Scope Audit": verifies PingOne resources have the scopes your code expects, via a Run Audit button.
- **What it teaches:** Scope topology: code-expected scopes must match those defined on PingOne resource servers.
- **What it demos:** A live audit of PingOne resource servers and scopes fetched through the Management API.

### Scope Reference
- **Route:** `/scope-reference` · **Auth:** public
- **What it does:** Reference table of custom and built-in PingOne resource servers and their scopes, with SCOPE_VOCABULARY collapsible below. Also listed under Utilities.
- **What it teaches:** The scope vocabulary the demo uses across resources.
- **What it demos:** Live resource and scope counts pulled from PingOne (live data needs admin sign-in).

### Snapshot Import
- **Route:** `/snapshot-import` · **Auth:** user
- **What it does:** "P1AZ Snapshot Import & Validation": validate an uploaded PingOne Authorize snapshot against mock authz server policies, or download a regenerated import file. Also listed under Utilities.
- **What it teaches:** Keeping PingOne Authorize policy and the local mock authz server in sync.
- **What it demos:** Validation of an uploaded JSON snapshot and a generated Super Banking transaction snapshot download.

### Resource Server Checkpoint
- **Route:** `/resource-server-checkpoint` · **Auth:** public
- **What it does:** "The final check before your data": the resource server hands each request, token included, to PingOne Authorize over the AAM sideband. Also listed under Utilities.
- **What it teaches:** The last-hop Kong-pattern check: upstream gateways validate tokens, yet the resource server still authorizes via P1AZ AAM.
- **What it demos:** Why-cards and a walkthrough where banking data is touched only on PERMIT.

## Delegation & Consent

### Transaction Consent
- **Route:** `/transaction-consent` · **Auth:** public
- **What it does:** Opens the consent modal from a CIBA push deep link (`?challenge=`); with no challenge it shows a simulate page with scenarios.
- **What it teaches:** CIBA step-up consent: PingOne Authorize step-up obligation, backchannel push, user approve or deny.
- **What it demos:** Simulated scenarios of the consent modal (review details, enter OTP, approve or deny) without a live challenge.

### Actor Token Education
- **Route:** `/actor-token-education` · **Auth:** public
- **What it does:** "Understanding Actor (Agent) Token Delegation": explains actor tokens (same as agent tokens) with diagrams of how delegation works.
- **What it teaches:** Actor/agent tokens and the delegation concept behind RFC 8693 `act` claims.
- **What it demos:** Static explanatory diagrams and copy; no live calls seen in the component.

### Family Delegation
- **Route:** `/delegation` · **Auth:** admin
- **What it does:** Controls AI Agent Authorization (authorize or revoke an agent to act on your behalf) and grants access to a family member.
- **What it teaches:** OAuth 2.0 delegated authorization with PingOne and RFC 8693 `act` claim delegation.
- **What it demos:** An agent authorized/revoked badge, a Live Token Chain, an under-the-hood explainer and a Demo Talk Track.

## Utilities

### PingOne Test
- **Route:** `/pingone-test` · **Auth:** public
- **What it does:** "PingOne Integration Test Page" with worker-token configuration and a "Verify Resources & Scopes" section listing applications, resource servers, scopes and users.
- **What it teaches:** How the demo's PingOne worker token and Management API access are configured and verified.
- **What it demos:** Live PingOne Management API reads via a worker token, shown alongside the logged-in identity (admin or customer).

### MFA Test
- **Route:** `/mfa-test` · **Auth:** public
- **What it does:** "PingOne MFA Test Page": MFA configuration, enrolled Devices list, and a CIBA back-channel authentication test.
- **What it teaches:** PingOne MFA device management and CIBA push for step-up approval.
- **What it demos:** Live device listing and a push notification to the user's authenticator app, gated on MFA config and a valid worker token.

### OAuth Debug
- **Route:** `/oauth-debug-logs` · **Auth:** admin
- **What it does:** "OAuth debug log" viewer showing lines when Debug OAuth logging is On and the API processes OAuth traffic; also reachable as a Configure tab.
- **What it teaches:** What the BFF actually sends and receives during OAuth flows.
- **What it demos:** Live OAuth debug log lines from the API, with the storage backend in use.

### Token Exchange Tester
- **Route:** `/token-exchange-tester` · **Auth:** public
- **What it does:** "RFC 8693 Token Exchange Tester": exchanges your session subject token (plus agent actor token in 2-exchange mode) for a scoped MCP token.
- **What it teaches:** RFC 8693 token exchange, subject and actor tokens, one-exchange versus two-exchange delegation.
- **What it demos:** A real exchange against PingOne using real credentials, showing the resulting scoped MCP token.

### Management API Runner
- **Route:** `/mgmt-api` · **Auth:** public (page prompts for an admin session)
- **What it does:** Inspector with an operation tree, parameter form and Response/curl tabs over a catalog of read and create-cleanup PingOne Management API operations.
- **What it teaches:** PingOne Management API operations and their request shapes.
- **What it demos:** Live Management API calls run through the BFF `/api/admin/mgmt-api/run`, showing the response and equivalent curl.

### PingOne MCP Setup
- **Route:** `/pingone-setup` · **Auth:** public
- **What it does:** "PingOne MCP Setup": provision PingOne worker credentials for MCP connectivity via an Enter Credentials form pre-filled from server config.
- **What it teaches:** Worker app credentials needed for the hosted PingOne MCP server.
- **What it demos:** A credentials form for worker client settings; unclear what it validates or saves.

### MCP Discovery
- **Route:** `/mcp-discovery` · **Auth:** user
- **What it does:** "Runtime inventory": read-only discovery across host processes, local listeners, Compose services and configured remote URLs. Same route as "MCP Runtime Inventory" in MCP & Integrations.
- **What it teaches:** Locating which MCP servers actually run in an environment, including unregistered ones.
- **What it demos:** A live scan with a "Last scan" timestamp listing discovered MCP endpoints.

### Health Check
- **Route:** `/check` · **Auth:** user
- **What it does:** "Demo check": pre-demo readiness covering stack health, a real PERMIT path and a DENY proof, in cards, stepper, checklist or rail views.
- **What it teaches:** How to verify the stack and policy enforcement before a talk.
- **What it demos:** A live readiness run per vertical (default Super Sports) ending in a verdict: Ready, Ready with warnings, or Not ready.

## PingFederate ID-JAG

### Run ID-JAG Demo
- **Route:** `/pingfederate-id-jag/demo` · **Auth:** public
- **What it does:** Renders "Enterprise-Managed MCP Authorization": IT decides centrally which employees reach which MCP servers.
- **What it teaches:** ID-JAG: the identity provider evaluates policy and signs an ID-JAG that the MCP authorization server redeems for an access token.
- **What it demos:** A run where an entitled employee gets an access token with no per-server consent screen, and an unentitled one gets none.

### How ID-JAG Works
- **Route:** `/pingfederate-id-jag` · **Auth:** public
- **What it does:** Explainer "How the ID-JAG demo works" with links to run the demo and open the diagram.
- **What it teaches:** How PingFederate carries user identity across the MCP trust boundary without a second consent screen.
- **What it demos:** Explanatory copy with a short definition; no live calls, only links to the demo and diagram.

### ID-JAG Diagram
- **Route:** `/pingfederate-id-jag/diagram` · **Auth:** public
- **What it does:** "ID-JAG token journey" diagram with two lanes: issuance and grant redemption, and gateway policy and protected resource.
- **What it teaches:** The chain upstream refresh token, PingFederate ID-JAG (`urn:ietf:params:oauth:token-type:id-jag`), then MCP access token.
- **What it demos:** A static diagram with learning notes; no live calls.

## Developer Tools

### Code Explorer
- **Route:** `/code-explorer` · **Auth:** public
- **What it does:** Chat over the codebase, "Powered by CodeGraph", with a rebuild-index button.
- **What it teaches:** Semantic code knowledge graphs indexing symbols, files and dependencies for AI-assisted exploration.
- **What it demos:** Questions about flows, architecture and patterns answered with real, current code context.

### Graphify
- **Route:** `/graphify` · **Auth:** public
- **What it does:** "Codebase knowledge graph — query, path, and explain before you grep": sections What it is, Try it, How agents use it here, Related.
- **What it teaches:** Graph-based repo context for agents, with EXTRACTED versus INFERRED edge labels and the query/path/explain verbs.
- **What it demos:** Offline canned demos of Graphify commands; no live graph queries.

### Postman Collections
- **Route:** `/postman` · **Auth:** admin
- **What it does:** Lists downloadable Postman collections and environment files for testing the Demo API and OAuth flows.
- **What it teaches:** Calling the demo API and OAuth endpoints outside the UI.
- **What it demos:** Downloadable collections with descriptions and pre-configured requests.

### API Docs (Swagger)
- **Route:** `/api/docs` (BFF-served, opens in new tab; not an app route) · **Auth:** unclear (not in routes list)
- **What it does:** Opens the BFF's Swagger UI for the REST API.
- **What it teaches:** The OpenAPI-described REST API surface of the demo backend.
- **What it demos:** An interactive OpenAPI reference served by the API server; content beyond the launch link unclear.

### API Reference (Scalar)
- **Route:** `/api/reference` (BFF-served, opens in new tab; not an app route) · **Auth:** unclear (not in routes list)
- **What it does:** Opens the Scalar-rendered OpenAPI reference for the REST API.
- **What it teaches:** The OpenAPI-described REST API surface of the demo backend.
- **What it demos:** A Scalar API reference served by the API server; content beyond the launch link unclear.

### llama-vscode Guide
- **Route:** `/llama-vscode-guide` · **Auth:** user
- **What it does:** In-app host for the beginner "llama-vscode Setup Guide", an embedded HTML file with Download and open/print actions. Also listed under Architecture & Learning.
- **What it teaches:** Setting up llama-vscode for local LLM code completion.
- **What it demos:** An embedded static setup guide, no live calls.

### PromptFoo Evals
- **Route:** `/promptfoo` · **Auth:** public
- **What it does:** "PromptFoo Evaluations": runs allow-listed eval suites against the live agent endpoint via `npx promptfoo` on the BFF.
- **What it teaches:** LLM evaluation: correctness checks against real store values and red-team probes for secret or system-prompt leakage.
- **What it demos:** Live eval runs against the agent showing pass/fail results.
## AI Experiences

### Weather MCP
- **Route:** `/weather-mcp` · **Auth:** public
- **What it does:** Shows an agent calling a third-party weather MCP server through the Agent Gateway, with runnable permit/deny queries and a free-form location box.
- **What it teaches:** The gateway enforces a geographic scope policy the weather server knows nothing about; the policy is read live, so results flip mid-demo without restart.
- **What it demos:** Austin, TX is permitted; Miami is denied before the third party sees it; the agent geocodes first, so the policy checks coordinates.

### Brave Search MCP
- **Route:** `/brave-mcp` · **Auth:** public
- **What it does:** Shows an agent calling the real Brave Search API (brave_news_search) via a third-party MCP server fronted by the Agent Gateway.
- **What it teaches:** The gateway inspects the query and blocks terms before the request leaves the perimeter; the blocklist is fixed in the gateway script.
- **What it demos:** A normal news search is permitted; a query containing bitcoin, cryptocurrency or crypto is denied at the gateway.

### Use Cases
- **Route:** `/use-cases` · **Auth:** user
- **What it does:** Full use-case catalog grouped by track (foundations, attacks, human-in-the-loop, controls, NHI, learn, tools) with Run buttons, flag gates and a per-vertical switcher.
- **What it teaches:** Each card ties a buyer problem to the PingOne control that answers it, with OWASP and Ping product tags.
- **What it demos:** Chip use cases run in the agent on /dashboard; attack cases fire live attack simulations; link cases open the relevant page.

Use cases in the registry (`demo_api_server/config/useCases.js`):

| ID | Name | Demos |
|---|---|---|
| UC1 | Delegated access (consent only) | Every agent action traces back to a real human's consent. |
| UC2 | A2A delegation | Generalist-to-specialist handoff carries proof of the user's authorization. |
| UC2.5 | A2A Orchestrator — Interactive Learning | Generalist agent routes tasks to specialist sub-agents using RFC 8693 delegation. |
| UC2.6 | A2A generalist mismatch | Same user, unregistered agent identity: real agent permitted, then the imposter denied. |
| UC2.7 | A2A end to end — protocol + identity | Real A2A artifacts (tokens, Agent Card, JSON-RPC) shown on the wire. |
| UC3 | act gate | Agent acts for a user only if that user explicitly authorized it. |
| UC19 | Non-human (agent) identity lifecycle | Calls from a retired or orphaned agent identity fail. |
| UC20 | Agent observability and traceability | Every action attributable: who the agent was, who it acted for, what it did. |
| UC33 | My mortgage | Same delegated-access proof applies to every account type, not just everyday banking. |
| UC34 | Spot unusual patterns | Agent reasons over live activity through the same governed path. |
| UC35 | Why was that blocked? | Agent explains a fired control in plain language backed by real evidence. |
| UC4 | Overscoped agent | An agent holding more scope than the task needs is a privilege-escalation risk. |
| UC6 | Authz denied | Policy-violating action (amount over limit) is denied before the tool runs. |
| UC7 | MFA step-up (HITL) | High-value action requires the human to complete MFA. |
| UC8 | MFA + HITL consent | Consequential actions require human-in-the-loop consent plus MFA. |
| UC9 | Group / entitlement check | User not in the required group is denied regardless of token scopes. |
| UC21 | Entitlement-tiered capability | Premium-tier user's agent gets higher-value tools; standard tier does not see them. |
| UC22 | CIBA out-of-band approval | Sensitive action approved on the user's own device, since an agent has no browser. |
| UC23 | Progressive trust demo — presenter guide | Personal agent moves from public to authenticated, step-up, out-of-band approval, hard deny. |
| UC24 | Act 1 — Public catalog access | Explore low-risk information before signing in. |
| UC26 | Proof of enforcement — live verdict on every use case | Every enforcement decision proven on screen, not just claimed in chat. |
| UC5 | Wrong / insufficient scope | Wrong-scope agent never reaches the tool. |
| UC10 | Resource-ownership / account takeover | Agent cannot act on another user's resources even with a valid token. |
| UC11 | Bad client → agent gateway | Malformed or stolen token never reaches the tools. |
| UC12 | Token theft / replay defense | Audience and DPoP key binding make a stolen token unusable. |
| UC13 | Confused-deputy actor injection | Rogue agent forcing itself into the act claim is caught. |
| UC14 | PAR + RAR intent violation | Agent exceeding the pushed amount or payee (RFC 9126) is denied. |
| UC14b | PAR + RAR intent verified | Transfer within its PAR authorization cap is permitted. |
| UC15 | Intent-token tampering | Tampered or expired intent token is detected before it authorizes anything. |
| UC16 | Impersonation blocked (OBO required) | Token with user as sub but no act claim is rejected. |
| UC16b | Raw user-token forwarding blocked | Agent may only forward scoped, exchanged tokens, never the user's raw token. |
| UC17 | JIT / ephemeral credentials | Short-lived tokens so a captured one dies within minutes. |
| UC18 | Rate-limit / resource-overload defense | Flooding the gateway with tool calls is throttled. |
| UC29 | OAuth introspection outage — fail closed | Gateway rejects every call if token validation goes down. |
| UC30 | Third-party MCP server, scoped at the gateway | Third-party tool constrained to the business's footprint (weather). |
| UC31 | Third-party MCP server — out-of-scope call denied | Out-of-footprint call stopped before the third-party tool runs. |
| UC32 | Live-reconfigure the gateway's scope policy | Change the policy rule live, without redeploy, and see the verdict flip. |
| UC41 | Third-party search server, filtered at the gateway | Web-search agent permitted for acceptable queries (Brave). |
| UC42 | Third-party search server — blocked query denied | Blocked query denied before the request leaves the perimeter. |
| UC-TOOL1 | Protected RAG | Code retrieval where the agent cannot widen its own access to indexed source. |
| UC-TOOL2 | Code Explorer | Ask about flows and architecture with real, current code context. |
| UC-TOOL3 | LLM Gateway | Shows what the Agent Privilege decided about an LLM call. |
| UC46 | Privilege A2A access review | Analyst asks an agent to review access via Privilege-protected tools. |
| UC47 | Privilege A2A three-deep agent chain | Main agent, LangChain agent and a specialist, each hop checked by the Agent Privilege. |
| UC-NHI1 | Live agent NHI inventory | One governed roster of agents authenticating through Ping, with identity state. |
| UC-NHI2 | Agent lifecycle export (JML) | Agent join/move/leave events shaped for an IGA tool such as SailPoint. |
| UC-LEARN1 | OAuth Academy | Interactive teacher for OAuth 2.0/2.1 and OIDC with live flows. |
| UC-LEARN2 | PingOne MCP Inspector | Browse and invoke the hosted PingOne MCP server's live tools. |
| UC-LEARN3 | Generic MCP Inspector | Explore the demo's banking MCP server like any MCP endpoint. |
| UC-LEARN4 | MCP Tools | Explains how MCP tools, schemas and invocations fit together. |
| UC-LEARN5 | Learning Hub | Curated landing page for learning material and walkthroughs. |
| UC-LEARN6 | Token Flow (Interactive) | Step-by-step delegation and token chain, hop by hop. |
| UC-LEARN7 | The Ungoverned Agent (OpenCLI) | The "before" picture: agent rides a browser session with full user power and no identity. |
| UC-PAM-SETUP | Privilege Demo — SE Setup | SE checklist to onboard VMs, install the Privilege Agent and enroll MFA. |
| UC-PAM-SCRIPT | Privilege Demo — Request Access Script | JIT access to AWS roles, S3, VPC bundles via four-eyes approval. |
| UC-LEARN8 | Enterprise-Managed MCP Authorization | IT controls which MCP servers employees use, without per-server consent. |
| UC-LEARN9 | ID-JAG / Cross-App Access | Portable identity assertion for cross-app agent access. |
| UC-LEARN10 | Orchestration SDK (Custom UI) | Custom sign-in UI while keeping flow orchestration server-side. |
| UC-LEARN12 | PingFederate DaVinci Integration Kit | PingFederate policy runs a DaVinci flow and keeps the session. |
| UC-LEARN11 | Privilege LLM — prompt injection blocked | Instruction-override prompt is blocked by the Privilege LLM. |
| UC25 | Enterprise-managed MCP access | Corporate SSO plus IT pre-approved MCP servers; no per-agent connect step. |
| UC39 | Centralized MCP revocation | Revoke a leaver's MCP access in one console. |
| UC40 | Enterprise-Managed MCP Authorization (native ID-JAG) | Central per-employee, per-server MCP grants via ID-JAG. |
| UC27 | HITL consent bypass attempt | Client claiming "consent already given" cannot skip human approval. |
| UC28 | Tool set as the authorization boundary | Agent cannot promise anything it has no tool to do (Air Canada pattern). |
| UC37 | Verified Trust — signed agent assertion on A2A delegation | Signed assertion lets the receiving org verify an agent handoff offline. |
| UC38 | Workload Agent: MFA-gated protected action | Digital assistant needs proof of identity and scoped delegation. |
| UC43 | Consumer & Partner Agent — CIMD registration | Discoverable CIMD registration path (facade) for customer-facing agents. |
| UC44 | Workload Agent: OBO customer-data read | Hosted assistant acts for a customer without merging identities. |
| UC45 | SaaS-Embedded Agent — Website Worker | Embedded worker acts for a signed-in customer with its own workload identity. |

### Use Cases (Live)
- **Route:** `/use-cases/live` · **Auth:** user
- **What it does:** Live workbench: a "Demo script" drawer of use-case cards (15-Min Security Demo, more demos) beside a single agent, token chain trace and vertical switcher.
- **What it teaches:** Each step shows what to expect and the enforcement verdict, with the real token chain shown as it runs.
- **What it demos:** Run a card in the agent, fire a sim, or open a linked page; the drawer's 15-Min Security Demo group runs in order.

### Guided Demo Track
- **Route:** `/demo-track` · **Auth:** public
- **What it does:** Presenter page with two acts and stepped scenarios; each step has a GREEN (permit) and RED (deny) run, live or archived run history, and a "Say this" talk track.
- **What it teaches:** Every capability ends in a permit and a deny with decision evidence; Act 2 shows the same rails govern admin AI.
- **What it demos:** Runs each step's chips against the agent, then an attack gauntlet ("Run all 6 attacks") scoring blocked attacks.

### Group Policy Board
- **Route:** `/group-policy` · **Auth:** user
- **What it does:** Table of one live PingOne Authorize decision per vertical for its group-gated tool, with a group-membership toggle and Re-check button.
- **What it teaches:** Scopes are not entitlements; directory group membership is re-read per call and decides.
- **What it demos:** Flip membership and every row moves together between PERMIT and DENY, with the statement code proving which rule answered.

### Demo Script
- **Route:** none (side-nav action fires the `demo-script-toggle` event; overlay mounted for all users) · **Auth:** public (not listed in auth-requirements.json)
- **What it does:** Floating, draggable teleprompter for the 15-minute security-leader demo with preflight, intro, acts, A-/A+ text size, pop-out for a second screen and Run/Go buttons.
- **What it teaches:** A scripted narrative for security leaders: who the agent is, what limits apply, and what happens when it is abused.
- **What it demos:** Follows the workbench selection and can trigger use cases on /use-cases/live; the closer navigates to the kill switch.

### Agentic Control Plane
- **Route:** `/control-plane` · **Auth:** user
- **What it does:** Live overview of the agent landscape in five zones (catalog, registry, discovery, governance, observability) with Landscape and Triage views.
- **What it teaches:** One place to see every non-human identity, scope drift and gaps, read live rather than cached; structural gaps are declared explicitly.
- **What it demos:** KPIs (identities, needs attention, scope drift), triage findings by severity, and links into registry, kill switch, platform gaps and Grafana.

### Agent Kill Switch
- **Route:** `/ai-control-plane` · **Auth:** user
- **What it does:** Roster page titled "Ping - Agent Kill Switch" with buttons to stop a live agent instance or fully disable its PingOne app, plus a restore path.
- **What it teaches:** Agents get identity and tokens from Ping; stop revokes the token, disables the app and writes an immutable audit record, whatever vendor or LLM runs it.
- **What it demos:** A live kill of a real agent, optionally with PingOne SSO session termination, showing central containment.

### Agent Registry
- **Route:** `/agent-registry` · **Auth:** user
- **What it does:** Inspector-style list of identities from PingOne apps, demo workload clients and A2A specialists, with detail and Scopes / Lifecycle tabs.
- **What it teaches:** Registry means scope drift (granted versus scope-topology expected) and per-source degradation; unverified is not the same as clean.
- **What it demos:** Selecting an identity shows granted versus expected scopes with match, drift or unverified status.

### PingOne Agent Builder
- **Route:** `/agent-builder` · **Auth:** user
- **What it does:** Creation workspace: build your own AI agent as a PingOne OIDC app, grant it resources and scopes, or copy setup from an existing agent.
- **What it teaches:** An agent gets its own identity distinct from yours; tokens carry your sub as subject and the agent as actor.
- **What it demos:** Real PingOne objects created via the BFF: You, Your AI Agent, Resources and scopes, with resource creation and deletion.

### Agent & Token Flow History
- **Route:** `/agent-flow-inspector` · **Auth:** public
- **What it does:** Master-detail history: past agent runs from every execution path on the left, the selected run's timeline detail on the right.
- **What it teaches:** How to review what an agent did and the token flow behind it after the fact.
- **What it demos:** Inspection of past runs only (prompt, time, duration); it does not start new runs.

### Autonomous Agents
- **Route:** `/autonomous-agents` · **Auth:** public
- **What it does:** Explains worker versus autonomous agents, has an on/off switch (ff_autonomous_agents), buttons to run Fraud Watch and Balance Sweep, and run history with token-chain replay.
- **What it teaches:** Autonomous agents authenticate as themselves (client credentials, no act claim), are bounded by a standing mandate, and are stopped by cancelling the schedule.
- **What it demos:** Fraud Watch (read only, 02:00) and Balance Sweep (06:00): in-mandate is silent, over it parks for CIBA, past the limit is refused.

### Personal Agent
- **Route:** `/personal-agent` · **Auth:** public
- **What it does:** Chat-first studio for a personal digital assistant (airlines vertical by default) with selectable client skins (Privilege, Claude, Terminal, ChatGPT, Gemini) and a security rail.
- **What it teaches:** Personal agent gates: MFA required, gateway token validation (audience, act claim, introspection), then PingOne Authorize policy.
- **What it demos:** Gate cards change permit, deny or checking as tool calls run; workload scenarios (UC38, UC44) can be run from the page.

### Agent Onboarding Flow (Node)
- **Route:** `/agent-onboarding-flow` · **Auth:** public
- **What it does:** Step-through diagram "Enterprise AI Onboarding & Governance Architecture" with flows for Enterprise Users, Developers, and Cloud Discovery admins, plus a public share link.
- **What it teaches:** Proposed target state: any AI agent becomes a managed enterprise identity with governance and privileges applied across its lifecycle.
- **What it demos:** A scripted walkthrough, not a live trace; the page states most shown components are not yet built in this demo.

### Agent Onboarding Flow Subway (Node)
- **Route:** `/agent-onboarding-flow-subway` · **Auth:** public
- **What it does:** Subway-map view of the same onboarding flows: pick a persona flow and walk it station by station with Back, Continue and Play story cards.
- **What it teaches:** The same onboarding architecture oriented as a pipeline, one persona's journey at a time.
- **What it demos:** Each step's title and narrative on the station map; illustrative, not a live trace.

### Agent Lifecycle (guided demo)
- **Route:** `/agent-lifecycle` · **Auth:** admin
- **What it does:** Walks four slots: register an agent with scoped consent, call a retail MCP tool, approve a step-up purchase, then self-service revoke.
- **What it teaches:** An agent's whole life (register, delegate, step-up, revoke) is governed by scoped, revocable tokens and a kill switch.
- **What it demos:** A live list_orders call, a $600 checkout needing CIBA approval, and a real kill-switch revoke.

### Delegated Commerce (guided demo)
- **Route:** `/delegated-commerce` · **Auth:** admin
- **What it does:** One workspace titled "Register. Delegate. Approve. Revoke." with four steps, a consent modal, preflight, and Run current step.
- **What it teaches:** A shopping agent acts only within consented read/write scopes; sensitive purchases still need human approval, and revocation denies instantly.
- **What it demos:** The AF Personal Shopping Agent: register, protected list_orders, CIBA-gated checkout, then revoke and retry to prove denial.

### LangChain Agent
- **Route:** `/langchain` · **Auth:** public
- **What it does:** Shows the default banking AG-UI runtime (langchain_agent on :8888), its LangGraph code sample, live config status, and framework and brain inventory.
- **What it teaches:** The same Ping delegated-OAuth / MCP / Authorize / HITL model applies whichever agent framework or brain (Heuristics, Gemini, llama.cpp) is used.
- **What it demos:** A read-only view of the active LLM provider and available agent frameworks; no live attack or transaction.

### Ungoverned Agent
- **Route:** `/ungoverned-agent` · **Auth:** public
- **What it does:** Presents the "before" picture: an AI agent (e.g. OpenCLI) riding a logged-in browser session, with a governed-vs-ungoverned comparison and Recent Transfers widget.
- **What it teaches:** Session-riding agents have full user power and no identity, scope, consent or audit, leaving OWASP threats T2, T3, T8 and T9 unmitigated.
- **What it demos:** A transfer made through the user's session, stored indistinguishable from the human, versus the RFC 8693 act-chain approach.

### Prompt Injection
- **Route:** none (side-nav action opens the AI Attacks education drawer, Prompt Injection tab) · **Auth:** n/a (not a route)
- **What it does:** Explains prompt injection and the demo attack, where a malicious transaction description hides an instruction the agent reads.
- **What it teaches:** Content an agent reads (database, email, API) can carry commands the LLM may obey as legitimate.
- **What it demos:** A poisoned transaction description that the agent surfaces, with a run-this-attack button in the drawer.

### HITL Bypass
- **Route:** none (side-nav action opens the AI Attacks drawer, HITL Bypass tab) · **Auth:** n/a (not a route)
- **What it does:** Describes a request posting consentGiven: true to /api/demo-agent/message, which the old pre-flight service treated as an instant PERMIT.
- **What it teaches:** Client-supplied consent flags must never skip token exchange, policy checks or human-in-the-loop; the hardening removed that path.
- **What it demos:** The removed vulnerable pre-flight code and the attack that skipped the whole gate, with cross-links to HITL and PingOne Authorize.

### Indirect Injection
- **Route:** none (side-nav action opens the AI Attacks drawer, Indirect Injection tab) · **Auth:** n/a (not a route)
- **What it does:** Explains injection planted in fields the agent reads (account name, payee note, customer record), citing the 2024 Slack AI incident.
- **What it teaches:** The attack surface is everything the agent reads, not just what the user says.
- **What it demos:** A planted instruction in stored data that fires on a later agent interaction; exact payload and outcome unclear beyond the drawer intro.

### Unauthorized Commitments
- **Route:** none (side-nav action opens the AI Attacks drawer, Unauthorized Commitments tab) · **Auth:** n/a (not a route)
- **What it does:** Explains the Air Canada pattern, where a chatbot promised a discount not in policy and the company was held responsible.
- **What it teaches:** What an agent says must be separable from what it is mechanically able to do, or the company is bound by its words.
- **What it demos:** An agent making a commitment it has no tool to fulfil; specific demo steps unclear beyond the drawer intro.

### Scope Abuse
- **Route:** none (side-nav action opens the AI Attacks drawer, Scope Abuse tab) · **Auth:** n/a (not a route)
- **What it does:** Describes an agent on a read-scoped token told to call freeze_account, which needs admin:write and users:manage.
- **What it teaches:** Scope checks must be enforced server-side, using tools/list filtering by scope, not only in the UI.
- **What it demos:** The freeze_account attempt being blocked by the MCP server's scope controls.

### Intent Bypass
- **Route:** none (side-nav action; fires a banking-attack-demo event, opens the agent, falls back to /dashboard) · **Auth:** n/a (not a route)
- **What it does:** Triggers a live call where an Intent Token bound to view_balance is used to call create_transfer.
- **What it teaches:** The prompt-bound Intent Token lets the gateway deny a tool outside the stated intent, so an agent cannot widen its own authorization.
- **What it demos:** A 403 intent_mismatch from the gateway (mock authz Rule 4b), with the token chain shown in Token Chain.

### IGA for AI
- **Route:** `/iga-for-ai` · **Auth:** public
- **What it does:** Preview page listing every agent in one inventory with source, owner, status (pending, governed, certified) and a Certify action.
- **What it teaches:** Non-human agent identities need the same inventory, lifecycle and certification governance as human identities, however they were onboarded.
- **What it demos:** A mock-store state view fed by Agent Studio and Discovery, with counts and certify buttons; simulated, not live.

### Discovery
- **Route:** `/discovery-preview` · **Auth:** public
- **What it does:** Preview stepper with two stories (Browser & Device, Cloud), sixteen steps total, ending with a pending unmanaged agent.
- **What it teaches:** Unmanaged shadow AI agents on endpoints and cloud platforms can be found and pulled into governance.
- **What it demos:** A simulated discovery of "cursor-shadow-session" or "vertex-batch-agent" that appears as pending on IGA for AI.

### Agent Privilege (Preview)
- **Route:** `/privileges-gateway-preview` (nav label is "AI Agent Gateway (Preview)"; page heading "AI Agent Gateway") · **Auth:** public
- **What it does:** Preview view of every governed agent tool call, permitted or denied, with summary counts and a sample audit log.
- **What it teaches:** An MCP-aware gateway provides enforcement, step-up and audit for each tool call.
- **What it demos:** Hardcoded mock numbers (1,204 calls, 17 denied, 9 step-ups) and five sample permit/deny rows; static.

### Platform Gaps
- **Route:** `/platform-gaps` · **Auth:** public
- **What it does:** Lists five Ping Identity platform-level gaps: unified Agent Studio portal, IGA for AI, agent discovery, distinct AI Agent Gateway, federated Agent Identity.
- **What it teaches:** These are gaps in the platform, not the demo; the Agent Studio previews simulate what closing each would enable.
- **What it demos:** Five static cards, each marked "Not a Ping product today"; nothing interactive.

### AI Security Academy
- **Route:** `/academy/journey` · **Auth:** public
- **What it does:** A 15-step guided customer journey with progress, skip, restart, tenant readiness strip, and a final evidence summary.
- **What it teaches:** How one customer story goes from business risk to evidence that every agent action stayed governed, across login, delegation, MCP, Authorize, HITL, A2A and threat defense.
- **What it demos:** Live or simulated lesson runs per step, labelled LIVE CLOUD, LIVE LOCAL, RECORDED or SIMULATED.

### Academy Standalone Demos
- **Route:** `/academy/demos` · **Auth:** public
- **What it does:** A "Standalone demo launcher" with category filters and a readiness strip to pick a short customer story and open its live surface.
- **What it teaches:** Individual AI-security stories can be presented alone, with the source verified, without the full guided journey.
- **What it demos:** A catalog of short demos launching live surfaces; specific demo list unclear (catalog-driven).

### Agentic Trust
- **Route:** `/agentic-trust` · **Auth:** public
- **What it does:** Education page "Agentic Trust: Securing AI Interactions" with a trust-chain diagram (user, chat/BFF, agent, and further hops), pillar detail and a presentation video link.
- **What it teaches:** Security must be validated at every hop of the agent chain; the demo implements six security pillars.
- **What it demos:** How this demo maps each pillar to a mechanism, e.g. PKCE login and client-credentials agent identity.

### Agent Guardrails
- **Route:** `/agent-guardrails` · **Auth:** public
- **What it does:** Shows a reference diagram, "How Ping keeps an AI agent from doing bad things", with a scenario selector and a link to a public copy.
- **What it teaches:** The control chain of identity, delegated access, per-action enforcement, runtime risk detection and human oversight keeps agents inside explicit guardrails.
- **What it demos:** An interactive diagram across scenarios; no live calls.

### OWASP Agent Risks
- **Route:** `/owasp` · **Auth:** public
- **What it does:** Learner's guide "OWASP: Securing Agentic Applications" linking the OWASP Gen AI Security Project guide v1.0 and threats companion.
- **What it teaches:** The OWASP agentic threat framework (T-numbered threats) and how this demo maps to it.
- **What it demos:** A threat catalog mapped to demo controls; exact interactive elements unclear.

### Agent Privilege for AI
- **Route:** `/privilege-for-ai` (nav label renamed from "Privilege for AI"; page title "Privilege for AI - Hostile MCP") · **Auth:** public
- **What it does:** A static lesson on a deliberately hostile MCP server run behind the Agent Privilege; sections: threats, defense in depth, scanner, demo steps, reference.
- **What it teaches:** The gateway stops harmful actions and malicious prompts, but not poisoned tool metadata, which mcp-scanner catches at ingest.
- **What it demos:** No live calls; concept and runbook for the hostile MCP, LibreChat, gateway log and mcp-scanner.
## MCP & Integrations

### MCP Inspector
- **Route:** `/pingone-mcp-inspector` · **Auth:** public
- **What it does:** Lists and calls MCP tools across sources: the app's banking MCP server, hosted PingOne MCP, saved profiles, raw protocol methods, and Agent Gateway servers.
- **What it teaches:** How MCP tools, resources and prompts look on the wire, and how different MCP servers scope access.
- **What it demos:** Executing real tools against the banking MCP server and inspecting request and response.

### Agent Gateway Inspector
- **Route:** `/agent-gateway-inspector` · **Auth:** public
- **What it does:** Pick a gateway and tool, execute it, and see the result, with a log panel of gateway policy decisions below.
- **What it teaches:** The gateway steps: identify the caller, authorize, enforce PERMIT/STEP-UP/DENY, audit.
- **What it demos:** Gateway request and response shape (simulated results) plus live PingOne Agent Gateway P1AZ decisions.

### Enterprise-Managed MCP Auth
- **Route:** `/demo/enterprise-mcp` · **Auth:** public
- **What it does:** Runs an agent through enterprise-managed MCP authorization, either live via PingFederate ID-JAG (login required) or as a mock replay.
- **What it teaches:** IT-controlled MCP access: IdP policy check, signed ID-JAG, redemption for an MCP token, no per-server consent screen.
- **What it demos:** Four-step flow: policy at IdP, ID-JAG issued, redeemed, token calls the tool.

### Ping AI Test Lab
- **Route:** `/ping-ai-test-lab` · **Auth:** public
- **What it does:** Redirects to `/check`, the Health Check page (that page's copy was not read).
- **What it teaches:** unclear
- **What it demos:** unclear

### Capability Tour
- **Route:** `/agent-gateway-capabilities` · **Auth:** public
- **What it does:** Renders the Agent Gateway Tester in two-step mode, with an "Authorize then execute" button.
- **What it teaches:** Gateway authorization decision comes first, then tool execution; per Inspector copy, the tester gives live gateway evidence.
- **What it demos:** Live gateway calls where authorize and execute are separate steps.

### MCP Runtime Inventory
- **Route:** `/mcp-discovery` · **Auth:** user
- **What it does:** Read-only discovery of MCP servers across host processes, local listeners, Compose services and configured remote URLs, with tool lists.
- **What it teaches:** What MCP servers are actually running, and how heuristic metadata findings flag suspicious tool descriptions and schemas.
- **What it demos:** A scan-driven server list, server details, and a "Metadata findings" security panel.

### MCP Scanner
- **Route:** `/mcp-scanner` · **Auth:** public
- **What it does:** Scans MCP tools, resources and prompts (the hostile MCP server, or pasted tools/list JSON) for poisoned content in the browser.
- **What it teaches:** The gateway polices tool calls, not MCP content, so poisoned metadata reaches agents unless scanned first.
- **What it demos:** A blue-team scan of the hostile server's get_weather, account-verification and account_review.

### Personal Agent Clients
- **Route:** `/personal-agent` · **Auth:** public
- **What it does:** "Digital Assistant" studio with Privilege, Claude, Terminal, ChatGPT and Gemini skins, split and pop-out views, and client-choice cards.
- **What it teaches:** The client owns the conversation; Ping owns identity, consent, policy and protected tools.
- **What it demos:** A personal agent chat with a security rail: MFA, gateway token validation, PingOne Authorize gates.

### LibreChat (browser)
- **Route:** external link (`http://localhost:3080`, opens new tab; no app route) · **Auth:** public
- **What it does:** Opens the separate LibreChat app in a new browser tab; local only.
- **What it teaches:** An off-the-shelf browser chat client as a personal MCP client through Privilege.
- **What it demos:** LibreChat calling MCP tools through the Privilege gateway (inferred from nav search alias).

### LM Studio (Mac)
- **Route:** `/privilege-mcp-client?client=lm-studio` · **Auth:** public
- **What it does:** Opens the Privilege MCP client page for LM Studio setup, with gateway path selection and console policy views.
- **What it teaches:** Path choice: direct to MCP, Agent Privilege, or through the façade, and what policy each applies.
- **What it demos:** A local Mac LM Studio client connecting to MCP doors, with sign-in and per-tool denial behavior.

## Observability

### Audit Trail
- **Route:** `/audit` · **Auth:** admin
- **What it does:** Floating "MCP Audit Trail" window with an events feed, filters (type, outcome, agent, operation), auto-refresh and a Compliance Report export.
- **What it teaches:** Every MCP tool call's PERMIT/DENY outcome, scope, group and ACR are recorded for compliance.
- **What it demos:** Filterable audit events and a formal compliance report of agent tool decisions.

### Learning Log
- **Route:** `/logs?mode=learn` (popup window, no side-nav route) · **Auth:** public
- **What it does:** Opens the log viewer in a popup on its Learn tab, alongside a Debug tab.
- **What it teaches:** Plain-language reading of what the app is doing, with learning-oriented log colors.
- **What it demos:** A live log stream in learn mode.

### Activity Log
- **Route:** `/monitoring/activity-log` · **Auth:** public
- **What it does:** Opens a floating "Application Activity" panel streaming live app events (OAuth, MCP, HITL and more).
- **What it teaches:** How one action fans out into OAuth, MCP and consent events as they occur.
- **What it demos:** A real-time application event stream.

### API Activity
- **Route:** `/monitoring/api-activity` · **Auth:** public
- **What it does:** "Application Activity" table of persisted API activity and audit records, with filters and grouped buckets.
- **What it teaches:** The stored history of HTTP calls and audit records, distinct from the live stream.
- **What it demos:** Filtering persisted API activity after the fact.

### Run Reports
- **Route:** `/reports` · **Auth:** public
- **What it does:** Lists and downloads reports from your agent runs; admins get a bulk export. Sign-in needed to see reports.
- **What it teaches:** Agent runs leave reviewable, downloadable evidence.
- **What it demos:** Generating a report by running the demo flow, then downloading it.

### Error Audit Log
- **Route:** `/error-audit` · **Auth:** admin
- **What it does:** Admin list of recorded error events with tag, flow ID and user details.
- **What it teaches:** Failures are captured with flow and user context for diagnosis.
- **What it demos:** Browsing recorded errors, or "No events recorded" when clean.

### New Relic
- **Route:** `/monitoring/new-relic` · **Auth:** public
- **What it does:** Dashboard titled "Identity pipeline as observed telemetry", built from New Relic data.
- **What it teaches:** Identity pipeline stages such as introspection and gateway observed as telemetry.
- **What it demos:** Identity pipeline metrics pulled from New Relic.

### PingOne Events
- **Route:** `/monitoring/pingone-events` · **Auth:** public
- **What it does:** Live list of PingOne events (up to 200) with status icons, expandable rows, and a light/dark toggle.
- **What it teaches:** PingOne emits audit events for identity activity as it happens.
- **What it demos:** Streaming pingone/event entries; shows "No events received yet" when idle.

### PingOne Authorize Decisions
- **Route:** `/monitoring/p1az` · **Auth:** public
- **What it does:** Dashboard titled "PingOne Authorize", showing decisions and gate posture from New Relic.
- **What it teaches:** How PingOne Authorize policy decisions and gates are distributed over time.
- **What it demos:** P1AZ decision telemetry.

### Token Exchange
- **Route:** `/monitoring/token-exchange` · **Auth:** public
- **What it does:** Dashboard of RFC 8693 token exchanges, sourced from New Relic, listing exchange client IDs.
- **What it teaches:** How often and by whom RFC 8693 exchanges occur.
- **What it demos:** Token-exchange telemetry from New Relic.

### System Flow
- **Route:** `/monitoring/system-flow` · **Auth:** public
- **What it does:** Node map of the system that lights up the hops of the live agent run, with zoom and replay of recent runs.
- **What it teaches:** Which components an agent request traverses and the authorization decision along the path.
- **What it demos:** A live or replayed run story on the system map.

### Service Graph
- **Route:** `/telemetry` · **Auth:** public
- **What it does:** Shows every service and dependency aggregated across recent traffic, with a Detailed mode for one trace.
- **What it teaches:** The whole system topology as observed, not as drawn.
- **What it demos:** An aggregated service dependency graph from traces.

### Tracing
- **Route:** `/tracing` · **Auth:** user
- **What it does:** Shows how one request travels across services, with call path and latency; links to Token Chain.
- **What it teaches:** Where time is spent across services in distributed traces.
- **What it demos:** Generate traffic (sign in, use the agent, transfer), then inspect the trace.

### Transaction Trace
- **Route:** `/transaction-trace` · **Auth:** user
- **What it does:** Shows one agent turn hop by hop: who acted, under whose delegation, with what authorization.
- **What it teaches:** Delegation and authorization at each hop of an agent turn.
- **What it demos:** A per-turn trace of an agent transaction.

### MCP Observability
- **Route:** `/mcp-observability` · **Auth:** user
- **What it does:** "MCP traffic, with the why attached": live server health, tool performance and authorization outcomes, with request explorer; refreshes every 15s.
- **What it teaches:** Why MCP requests were permitted or denied, ranked by tool impact.
- **What it demos:** Traffic health, request explorer and tool health for agent gateway traffic.

### Grafana
- **Route:** external link (`http://localhost:3000` locally, `/grafana` otherwise; opens new tab; no app route) · **Auth:** public
- **What it does:** Opens Grafana in a new tab; nav notes it holds PingOne Agent Gateway metrics and is where traces open.
- **What it teaches:** Metrics dashboards over Prometheus for the gateway.
- **What it demos:** Gateway metrics dashboards (Grafana content itself not read).
## Architecture & Learning

### System Diagram (Node)
- **Route:** `/architecture/system` · **Auth:** public
- **What it does:** Tabbed panel showing the System Architecture diagram, a live Token Exchange Flow that follows the 1- or 2-exchange mode, What's Happening, and CIBA Step-Up.
- **What it teaches:** How the demo's components connect and how RFC 8693 token exchange changes with the exchange mode.
- **What it demos:** The authoritative system picture, plus a live exchange-flow diagram that re-renders when the exchange mode toggles.

### Overview Diagram (Node)
- **Route:** `/architecture/overview` · **Auth:** public
- **What it does:** Titled "PingOne AI [Vertical] Architecture"; pick a flow, then play or step through the request path across PingOne, PingGateway, BFF vault, agents and resource servers.
- **What it teaches:** The complete end-to-end request path and which component handles each hop.
- **What it demos:** An animated walkthrough of the full architecture for the current vertical, with a PNG export and link to the sequence diagram.

### Token Flow (Interactive) (Node)
- **Route:** `/architecture/token-flow` · **Auth:** public
- **What it does:** A 15-step simulation over a token-flow diagram, with a token card per step, RFC badges, an audience trail and Prev/Pause/Next controls.
- **What it teaches:** How each token (ID, access, exchanged) changes audience, scope and actor at every hop, including both RFC 8693 exchanges.
- **What it demos:** Live token transformation across user, agent, gateway, PingOne, HITL and MCP servers.

### Token Chain Architecture (Node)
- **Route:** `/architecture/token-chain` · **Auth:** public
- **What it does:** Zoomable, pannable diagram of PingOne auth, Agent, Token Exchange, Agent Gateway, Authorization and Resource Servers; clicking a node shows its role and mock token.
- **What it teaches:** Which token each component holds and its role in the chain.
- **What it demos:** The full token chain as a clickable node graph with per-node mock token notes.

### Interactive Flow (Node)
- **Route:** `/architecture/flow` · **Auth:** public
- **What it does:** "Interactive Architecture Flow": Simulate Flow, pause at any step to read the token card, with node badges showing aud and act claims.
- **What it teaches:** How aud and act claims evolve as the request moves through the compliance flow.
- **What it demos:** A stepped, pausable simulation of the live compliance flow (referenced elsewhere as 13 compliance steps).

### Sequence Diagram (Node)
- **Route:** `/sequence-diagram` · **Auth:** public
- **What it does:** "Sequence Diagram — i4ai Token Exchange Flow": 44-step interactive sequence across User, Chatbot, Agent, LLM, PingOne, Agent Gateway, Ping Authorize, MCP and Resource Server, with scenarios and Mermaid view.
- **What it teaches:** The detailed ordered message flow of the i4ai reference architecture, including token exchange and authorization.
- **What it demos:** A simulated 44-step run with scenario selection, token cards and Mermaid export.

### Canvas Diagram (Node)
- **Route:** `/architecture/canvas` · **Auth:** public
- **What it does:** Editable "Architecture Canvas": drag nodes, double-click to rename, select and delete arrows, add nodes; exports Mermaid or LucidChart files.
- **What it teaches:** Architecture layers (client, gateway, and so on) as an editable diagram the presenter can reshape.
- **What it demos:** A whiteboard-style architecture diagram built for live customization and export.

### Delegated Access Proof
- **Route:** `/academy/delegation/guided` · **Auth:** public
- **What it does:** Guided-mode Academy lesson "OAuth delegated agent access" for the delegation lesson, in three steps: subject, acting agent, constrained result.
- **What it teaches:** The subject token carries the person, the act claim records the agent, and RFC 8693 narrows scope and audience.
- **What it demos:** Comparing sub and act in the token-chain trace and the delegated token's audience, scopes and expiry.

### Demo Steps Lifeline Audit
- **Route:** `/demo-steps-lifeline-audit` · **Auth:** public
- **What it does:** Static audit of the 24 Demo steps against the live sequence diagram: which reach it, which show what they demonstrate, and a ranked fix order.
- **What it teaches:** Where the trace builder, chat stream handler and simulators drop evidence, and which steps claim more than they do.
- **What it demos:** A coverage strip, fix list, cross-step gaps and a per-step table, each finding marked checked or agent-reported.

### Invest Dual-Auth (MM)
- **Route:** `/invest-dual-auth` · **Auth:** public
- **What it does:** Mermaid diagram "Invest Service: Bearer Token vs API Key" with two flows to the same backend, and export options.
- **What it teaches:** OAuth token exchange over WebSocket MCP (Resource Server pattern) versus a vault-managed API key over HTTP REST (Backend App pattern).
- **What it demos:** Two credential paths into demo_mcp_resource_server, drawn side by side.

### Agent Privilege (MM)
- **Route:** `/privilege-mcp-diagrams` · **Auth:** public
- **What it does:** "AI Agent Gateway Diagrams" (renamed Agent Privilege in the nav): tabbed Mermaid diagrams of the gateway integration architecture and protocol flow.
- **What it teaches:** How the AI Agent Gateway applies just-in-time least-privilege authorization to every MCP tool call.
- **What it demos:** Architecture and protocol-flow diagrams for the AI Agent Gateway integration.

### Agent Privilege Enforcement (Node)
- **Route:** `/privilege-first-gateway` · **Auth:** public
- **What it does:** SVG target architecture "Privilege first, Agent Gateway for the rest" (nav rename of Privilege-First Gateway), routing callers through Privilege into LLM and MCP lanes.
- **What it teaches:** Privilege owns credentials and human-governed policy; the Agent Gateway behind it keeps per-tool delegated authorization.
- **What it demos:** A target-architecture diagram: LLM lane to cloud providers via virtual key, MCP lane to the Agent Gateway; local models on 8090 stay outside.

### Gateway vs P1AZ Enforcement (MM)
- **Route:** `/gateway-enforcement-map` · **Auth:** public
- **What it does:** "Enforcement Map — Gateway + P1AZ": clickable diagram of 5 checks enforced at the gateway, generated from the real source, plus "What each check stops".
- **What it teaches:** P1AZ decides business policy (amount, tier, group, step-up, HITL); the gateway PEP enforces token-claim and call-parameter checks.
- **What it demos:** Each of the 5 checks branching to its enforcing gateway and reconverging on one decision, with click-through status.

### Resource Server Placement (MM)
- **Route:** `/resource-server-placement` · **Auth:** public
- **What it does:** "Resource Server Placement": diagram of the last hop with the Kong-mock checkpoint, plus tables "Token work per hop" and "Placement rules this locks in".
- **What it teaches:** The resource server validates only the step-9 token addressed to it, handing it to PingOne Authorize over the AAM sideband.
- **What it demos:** The Kong-pattern checkpoint where the store is reachable only on PERMIT, with clickable nodes.

### Learning Hub
- **Route:** `/learning` · **Auth:** public
- **What it does:** Categorized card index of topics on OAuth, agents and MCP, with an Academy journey entry, a guided-path panel, and a Live Token Chain Demo below.
- **What it teaches:** OAuth, agent security, MCP and token concepts through grouped learning topics.
- **What it demos:** A guided customer story from agent identity through policy, MCP enforcement, approval and audit, with live token transformation.

### SPIFFE → PingOne Bridge (TODO)
- **Route:** `/spiffe-pingone-bridge` · **Auth:** public
- **What it does:** Implementation-preview page flagged "TODO / simulated" with an interactive handoff demo, "What is here now", "What remains" and a configuration-shape section.
- **What it teaches:** Translating a workload identity into a PingOne-compatible client assertion, without PingOne understanding SPIFFE directly.
- **What it demos:** A simulated bridge handoff: one identity crossing two trust systems.

## Administration

### Feature Flags
- **Route:** `/configure?tab=feature-flags` · **Auth:** public (route level; the tab itself is marked as requiring sign-in)
- **What it does:** Feature Flags tab of the Configuration page, described as enabling or disabling experimental features with immediate effect.
- **What it teaches:** Which demo capabilities are switchable and how they gate behavior.
- **What it demos:** Toggling experimental features live without a restart.

### LLM Config
- **Route:** `/llm-config` · **Auth:** admin
- **What it does:** "LLM Provider" page: select and configure the language model the banking agent uses, with per-provider panels (Google, Anthropic, llama.cpp, LM Studio, Helix).
- **What it teaches:** The agent's LLM backend is swappable and separately configured per provider.
- **What it demos:** Switching the banking agent between cloud and local LLM providers.

### Secret Rotation
- **Route:** `/secret-rotation` · **Auth:** user
- **What it does:** Lists PingOne apps with auth method; select one and rotate its client secret behind a confirmation dialog, with run log and fingerprint.
- **What it teaches:** Rotating a secret is irreversible and immediate; the worker app's rotation breaks all PingOne calls until demo-api-server restarts.
- **What it demos:** A live client-secret rotation verified by fingerprint, never showing the secret value.

### App Configuration
- **Route:** `/configure` · **Auth:** public
- **What it does:** Unified Configuration page with tabs including Quick Start, Export / Import, PingOne Setup, Demo Data, LM Studio and Helix Setup, Agent Settings, Advanced, IDP Setup and Authorize.
- **What it teaches:** How the demo is wired to PingOne, LLM providers and agent settings.
- **What it demos:** Setup of PingOne region and environment, OAuth clients, sample data, debug logging and RSA keypairs.

### Security Settings
- **Route:** `/settings` · **Auth:** admin
- **What it does:** Live security configuration, "no restart required": step-up MFA enable, threshold, ACR value, transaction types, method, plus a change history.
- **What it teaches:** How step-up MFA policy (amount thresholds, ACR, method) governs high-value transactions.
- **What it demos:** Changing step-up settings live, for example requiring MFA on all withdrawals, with a last-50-changes audit list.

### CIMD Simulation
- **Route:** `/client-registration` · **Auth:** admin
- **What it does:** Form for client identity, OAuth flow, redirect URIs and contact in Client ID Metadata Document format; the backend creates the PingOne app and hosts the document.
- **What it teaches:** How a client identifies itself by metadata document (CIMD) rather than manual registration.
- **What it demos:** Creating a PingOne application from CIMD-style metadata.

### Demo Config
- **Route:** `/demo-config` · **Auth:** admin
- **What it does:** Customizes the side nav: show or hide groups, drag to reorder groups and children, move children between groups, and save named configs.
- **What it teaches:** The sidebar is presenter-configurable by intent, grouped under Core, AI and demos, Security and identity, Operations.
- **What it demos:** Tailoring the navigation for an audience, with a Sidebar Customization ON/OFF indicator.

### PingOne Admin
- **Route:** `/admin/pingone` · **Auth:** admin
- **What it does:** Admin dashboard with PingOne Admin access toggle, customer panel, Key metrics, recent activity, token and API-call views, and bootstrap export and account reset actions.
- **What it teaches:** Admin identity is group-based in PingOne, and demo data can be exported or reset.
- **What it demos:** Admin group membership toggle, KPI stats, and resetting demo accounts to a $5,000 balance.

### Banking Ops
- **Route:** `/admin/banking` · **Auth:** admin
- **What it does:** Support console for banking: look up by holder name, username, email or account number, with case queue, identity gate, and actions such as Seed charge and Delete.
- **What it teaches:** Support actions are scope- and verification-gated (transactions:write after identity verification).
- **What it demos:** A support agent working a banking customer with a jump-to-token-chain link.

### Healthcare Ops
- **Route:** `/admin/healthcare` · **Auth:** admin
- **What it does:** Support console for healthcare: look up a patient by name, email or id; actions include Cancel, Pay bill, Refill and Release.
- **What it teaches:** Actions need verification, and Release needs approval on sensitive:read.
- **What it demos:** A support agent handling a patient record with permission-gated actions.

### Retail Ops
- **Route:** `/admin/retail` · **Auth:** admin
- **What it does:** Support console for retail: look up a shopper; actions include Cancel order, Cancel sub, Resolve and Approve.
- **What it teaches:** Each action maps to a scope and gate; Resolve needs only general:write with no gate.
- **What it demos:** A support agent handling a shopper's orders and subscriptions.

### Sporting Goods Ops
- **Route:** `/admin/sporting-goods` · **Auth:** admin
- **What it does:** Support console for Super Sports: look up a member; actions include Cancel order, Return, Resolve and Cancel coaching.
- **What it teaches:** Verification-gated support actions in the default demo vertical.
- **What it demos:** A support agent handling a sporting-goods member's orders and coaching.

### Workforce Ops
- **Route:** `/admin/workforce` · **Auth:** admin
- **What it does:** Support console for workforce: look up an employee by name, email or id; Approve and Deny require approval on transactions:write.
- **What it teaches:** Approval-gated actions in an employee-facing scenario.
- **What it demos:** A support agent handling an employee request with approval-gated decisions.

### Vertical Editor
- **Route:** `/admin/verticals` · **Auth:** admin
- **What it does:** Edits a vertical's manifest JSON in Monaco with live validation, overlay badges, brand fetch by domain, Clone vertical and Save state.
- **What it teaches:** Verticals are manifest-driven; overlays sit on base manifests and banking and admin-console are protected.
- **What it demos:** Editing, cloning and theming a vertical, with a pipeline map, without code changes.

### Mortgage Path
- **Route:** `/path/mortgage` · **Auth:** public
- **What it does:** Shows a mortgage account with loan details, a "Credential swap" card and a "Token chain — Learning path" trace; shows "Mortgage data not loaded" if absent.
- **What it teaches:** The gateway swaps the user's OAuth bearer for a service API key, so the bearer never reaches banking_api_resource_server.
- **What it demos:** A live RFC 8693 token chain with masked API key (last 4 chars) and X-API-Key auth mechanism.

### Users
- **Route:** `/users` · **Auth:** admin
- **What it does:** "Search and manage user accounts": User Management table with search and per-user delete.
- **What it teaches:** Unclear beyond user administration.
- **What it demos:** Admin listing, searching and deleting demo users.

### Accounts
- **Route:** `/accounts` · **Auth:** public
- **What it does:** "View bank accounts in the demo environment": admins see Account Management; non-admins get their own accounts view.
- **What it teaches:** Unclear beyond viewing account data by role.
- **What it demos:** The bank accounts held in the demo environment.

### Transactions
- **Route:** `/transactions` · **Auth:** public
- **What it does:** "Review transfers, deposits, and withdrawals": Transaction History list for admins, with an empty state when none exist.
- **What it teaches:** Unclear beyond viewing transaction history.
- **What it demos:** Transfers, deposits and withdrawals recorded in the demo.

### OIDC Resource Server
- **Route:** `/resource-server` · **Auth:** public
- **What it does:** Shows token claims (aud, scope with glossary tooltips) on the resource server: login hop by default, or the gateway TX hop when in flow.
- **What it teaches:** Which audience the session access token carries versus the MCP exchange target.
- **What it demos:** The /api/resource-server path the agent dual_token flow calls, with decoded claims.

### CC Resource Server
- **Route:** `/resource-server-cc` · **Auth:** public
- **What it does:** "Client Credentials Resource Server": service-to-service view with client_id/client_secret, no user context, token claims, and an "OIDC vs Client Credentials" comparison.
- **What it teaches:** Client-credentials tokens carry no user identity, unlike OIDC user tokens.
- **What it demos:** A service-account token and its claims side by side with the OIDC flow; links to the OIDC version.

# Education Panels — Learning Content Catalog

All slide-out learning panels available in the demo UI. Panels open from the education
drawer (book icon) or from contextual links within pages.

---

## Identity & OAuth Fundamentals

### How you sign in (`LoginFlowPanel`)
The OIDC Authorization Code + PKCE login flow from the user's perspective. Covers redirect,
code exchange, token custody in the BFF, and session cookie model.
**Tabs:** How it works · PKCE details · Session model · In this repo

### Token introspection — RFC 7662 (`IntrospectionPanel`)
What token introspection is, why resource servers use it, the `/as/introspect` endpoint
shape, active/inactive response, and caching strategy.
**Tabs:** Overview · Request/response · In this repo

### OpenID Connect 2.1 (`Oidc21Panel`)
What changed from OIDC Core 1.0: mandatory PKCE, removal of implicit/hybrid, updated
security profile, and why it matters for AI agent flows.
**Tabs:** What changed · Security profile · AI agent relevance

### JWT client authentication — RFC 7523 (`JwtClientAuthPanel`)
Private key JWT as a stronger alternative to client secrets. Key claims (`iss`, `sub`, `jti`,
`exp`), JWKS registration in PingOne, and when to prefer it over `client_secret_post`.
**Tabs:** Overview · JWT shape · PingOne config · vs client_secret

### Pushed Authorization Requests — RFC 9126 (`PARPanel`)
PAR: pushing the authorization request to the AS before the browser redirect. Benefits for
high-security flows, parameter integrity, and reduced front-channel exposure.
**Tabs:** What PAR solves · Request/response · PingOne support · FAPI 2.0

---

## Token Exchange & Delegation

### RFC 8693 Token Exchange (`RFC8693Panel`)
Full reference for OAuth 2.0 Token Exchange. Covers all request parameters, response format,
the `act` claim structure, multi-hop delegation, and the PingOne SPEL expression that gates
`act` based on `may_act.sub == actorToken.client_id`.
**Tabs:** Overview · Protocol details · Act claim structure · Exchange hops · Security · Examples · Troubleshooting

### How the AI acts on your behalf (`MayActPanel`)
Plain-English explanation of `may_act` and `act` claims for non-technical audiences.
Includes step-by-step delegation lifecycle, security guarantees, the RFC 8693 standard,
PingOne AI Agent app type (grant types, auth methods, `client_secret_post` requirement),
and where it appears in code.
**Tabs:** Plain English · Step by step · Why it's secure · The standard · AI Agent App type · In this repo

### Token Flow — end-to-end delegation (`TokenFlowPanel`)
Walkthrough of the full 2-exchange RFC 8693 delegation chain: User Token → GW Delegated
Token → Backend Token. Shows audience, scope, and `act` claim at each hop.
**Tabs:** 2-Token Exchange Flow · Before/After · Token payloads

### Token Chain — delegation tracking (`TokenChainEducationPanel`)
How the live Token Chain panel works: what each row represents, status indicators, and
how to read the decoded claims.
**Tabs:** Overview · Reading the chain · Troubleshooting

### Rich Authorization Requests — RFC 9396 (`RARPanel`)
RAR: structured `authorization_details` as an alternative to flat scopes. JSON shape,
use in banking (transfer amount + account), PingOne support status, and comparison to
scope-based enforcement.
**Tabs:** RAR in one sentence · Request shape · Banking use case · vs Scopes · Sensitive data pattern

---

## MCP Protocol

### How the AI banking assistant works (`McpProtocolPanel`)
Comprehensive MCP guide for the banking demo. Covers the JSON-RPC handshake, all available
tools, server discovery, OAuth security model, auth challenge flow, MFA gate on tools/list,
step-up for high-value calls, Streamable HTTP headers (`Mcp-Session-Id`, `Last-Event-ID`,
`isError`, `notifications/tools/list_changed`), and live inspector link.
**Tabs:** How it works · Available tools · Server discovery · Security & sign-in · Two AI paths · Auth challenge · MFA gate · Handshake sequence · Live inspector · In this repo

### PingGateway — Securing MCP Servers (`PingGatewayMcpPanel`)
Why a gateway in front of MCP matters. Covers the official PingGateway MCP filter chain
(`McpAuditFilter` → `McpProtectionFilter` → `McpValidationFilter`), `streamingEnabled`,
`resourceIdPointer`, `soTimeout` for SSE, deployment topologies, custom vs PingGateway
comparison, and configuration examples.
**Tabs:** Overview · Architecture · MCP Filters · Custom vs PingGateway · Configuration

### WebMCP — Browser-Native MCP Access (`WebMcpEduPanel`)
BFF-proxy pattern for exposing MCP tools to browser-based agents. Tokens stay server-side;
the browser only holds a session cookie. Covers the browser → BFF → MCP call chain.
**Tabs:** Overview · Call chain · Security model

### OAuth Client ID Metadata Document — CIMD (`CimdPanel`)
CIMD vs Dynamic Client Registration (DCR). How agents self-describe their identity and
capabilities via a published metadata document. PingOne support and limitations.
**Tabs:** CIMD vs DCR · Document format · PingOne config

---

## Agent Security & Authorization

### Agent Gateway pattern — RFC 8707 + RFC 9728 (`AgentGatewayPanel`)
Resource Indicators (RFC 8707) and Protected Resource Metadata (RFC 9728) in the context
of an agent gateway. How the audience is enforced at each exchange hop.
**Tabs:** Overview · RFC 8707 · RFC 9728 · Agent request flow · In this repo

### PingOne Authorize — Policy-Based Authorization (`PingOneAuthorizePanel`)
Using PingOne Authorize as an external policy decision point for MCP tool calls.
PERMIT/DENY decision API, `authorization_details`, how to wire PA alongside scope enforcement,
and how to inspect recent decisions.
**Tabs:** Overview · Decision API · Wiring to MCP · Recent decisions · Gaps

### Human-in-the-loop — agent safety (`HumanInLoopPanel`)
The HITL consent pattern: why high-impact agent actions require human approval, the
428/consent challenge flow, CIBA-based approval, and the transaction consent modal.
**Tabs:** Why HITL · Consent flow · CIBA approval · This demo

### Step-up MFA (`StepUpPanel`)
Step-up authentication for high-value tool calls. `acr_values`, DaVinci CIBA flow setup
(the `acr_values` value IS the DaVinci policy ID), polling `auth_req_id`, and the
approve-from-phone UX.
**Tabs:** What it is · CIBA flow · DaVinci setup · Approve from phone

### Intent-Bound, Constraint-Based Delegation (`IntentDelegationPanel`)
AP2 pattern: verifiable intent tied to the delegation grant. Consent verification,
challenge binding, and how this demo implements the pattern vs. the full standard.
**Tabs:** The pattern · Verifiable intent · This demo · Gaps

### Sensitive Data & Selective Disclosure (`SensitiveDataPanel`)
Field-level scopes (`sensitive:read`), the least-data principle, masking patterns,
and the relationship between sensitive data enforcement and RAR.
**Tabs:** Why it matters · Field-level scopes · Masking patterns · RAR-adjacent pattern

### AuthZEN — Standardized Authorization API (`AuthZenPanel`)
OpenID Foundation AuthZEN working group: standardizing the PEP/PDP authorization API.
`is_authorized` request shape, PERMIT/DENY, relationship to PingOne Authorize and OPA.
**Tabs:** What is AuthZEN · API 1.0 · PingOne & env · Policy & AI/MCP security

---

## AI Agent Architecture & Maturity

### Agentic Maturity Model (`AgenticMaturityPanel`)
PingOne's three-level model for agent identity controls: public/anonymous (L1), token or
credential (L2), delegation + dynamic auth + HITL (L3). Where this demo sits and what L3 requires.
**Tabs:** The model · Level 1 · Level 2 · Level 3 · This demo

### PingOne — AI Agent Best Practices (`BestPracticesPanel`)
PingOne's five official best-practice categories: identify & classify agents, assign sponsors,
manage lifecycle, identify agentic sessions, apply specific IAM controls (CUA). Includes 15
specific practices across the categories.
**Tabs:** Best practices (single scrollable view with expandable cards)

### Computer Use Agent — CUA (`ComputerUseAgentPanel`)
Screen-observing agent loop vs structured tool-use (MCP). How CUA differs from MCP agents,
specific IAM controls for CUA, and when to use each approach.
**Tabs:** CUA vs MCP · How it works · IAM controls

### ID-JAG / Cross-App Access — XAA (`IdJagPanel`)
Identity Assertion JWT Authorization Grant (IETF draft). How it solves cross-app identity
without full federation, PingOne SSO integration, current limitations, and the implementation
pattern.
**Tabs:** Why it exists · The grant · PingOne implementation · Limitations

### Intent-Bound Delegation (`IntentDelegationPanel`)
See "Agent Security & Authorization" above.

---

## Frameworks & Landscapes

### AI and Agentic Systems — Technical Primer (`AiPrimerPanel`)
Technical enablement guide covering AI terminology, foundations, prompt engineering, agentic
workflows, and identity/security considerations. Includes the authoring context and prompt
history for the guide itself.
**Tabs:** Context · Foundations · Prompts · Workflow · About/Prompts used

### LangChain 0.3.x (`LangChainPanel`)
LCEL, multi-provider LLM switching, agent architecture, and how the LangChain agent in this
demo integrates with PingOne for delegated banking tool calls.
**Tabs:** Overview · LCEL · Multi-provider · Agent architecture · This demo

### Agent Builder Landscape (`AgentBuilderLandscapePanel`)
Survey of agent frameworks: LangChain, open-source alternatives, and commercial platforms.
Comparison table and guidance on when to use each.
**Tabs:** Landscape · Open-source · Commercial · Comparison · When to recommend each

### LLM Landscape (`LlmLandscapePanel`)
Commercial and open-source models, capability overview, and vendor comparison across
Anthropic, OpenAI, Google, AWS, IBM, and others.
**Tabs:** Landscape · Commercial · Open-source · Comparison

### AI Platform Landscape (`AiPlatformLandscapePanel`)
AWS, Microsoft, Google, IBM, Anthropic, OpenAI — platform-level tooling for building
AI agents. What each platform offers and how they relate to identity.
**Tabs:** Landscape · AWS · Google · IBM · Anthropic · Comparison

---

## Standards Reference

### RFC & Spec Index (`RFCIndexPanel`)
Quick-reference table of all RFCs and IETF drafts referenced in this demo, with links and
one-line descriptions.

### IETF Standards: Agentic Identity (`IETFStandardsPanel`)
Deep-dive on emerging IETF work for agent identity: RFC7523bis, Identity Chaining,
JAG-IR, AIMS, WIMSE, SD-JWT VC, PQ/T JOSE. Current draft status and relevance to PingOne.
**Tabs:** Overview · RFC7523bis · Identity Chaining · JAG-IR · AIMS · WIMSE · SD-JWT VC · PQ/T JOSE · Standard/protocol gaps

### Glean + PingOne Integration (`GleanPanel`)
Enterprise AI assistant integration pattern: PingFed, PingAuthorize, CIBA, and MCP
Gateway. How Glean's identity model maps to PingOne's delegation controls.
**Tabs:** Overview · Integration pattern · CIBA · MCP Gateway

---

## Architecture & Diagrams

### C4 Architecture Diagram (`ArchitectureDiagramPanel`)
Top-down C4 architecture of the banking demo at 4 levels: Context, Container, Component,
Code. Interactive navigation between levels.
**Tabs:** Diagram overview · Context · Container · Component · Code

### Flow Diagrams (`FlowDiagramsPanel`)
Technical sequence diagrams with RFC annotations showing the full token exchange chain,
agent delegation flow, and CIBA step-up flow.
**Tabs:** Overview · Exchange flow · Agent request flow · CIBA flow

### Architecture Tabs (`ArchitectureTabsPanel`)
The architecture workspace above the diagram-regenerate toolbar. The **CIBA Step-Up** tab
teaches the frontend-driven 428 bridge (gate returns 428 → frontend initiates + polls),
the approval-channel matrix (email / SMS / FIDO2 = no app; push = PingID app), and shows
the backchannel-granted token live from the token chain. Canonical source:
`ciba-stepup-sequence.mmd`. See `docs/ARCHITECTURE-TRUTHS.md` T-13.
**Tabs:** System Architecture · Token Exchange Flow · What's Happening · CIBA Step-Up

---

## Count

**43 panels** across 8 categories. All panels are accessible from the education drawer
(book icon in the top navigation) and from contextual "Learn more" links throughout the UI.

---

*Auto-generated from `demo_api_ui/src/components/education/educationIds.js` and panel source files.*
*Last updated: 2026-05-20*

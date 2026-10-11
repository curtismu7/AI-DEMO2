# Learning Hub training audit

**Date:** 2026-09-20  
**Updated:** 2026-10-11 — diagram-fit pass added walkthrough diagrams, movie reels, and token chains to six teaching surfaces (see "2026-10-11 diagram-fit sync" near the end).  
**Scope:** `demo_api_ui/src/components/LearningHub.tsx`, its education panel host and panels, the registered routes in `App.js`, and the existing live demo surfaces.  
**Purpose:** Identify where the Learning Hub can teach through a working example against the app, where a deterministic mock is more honest, and what should be built next.

## Executive summary

This report records the audit baseline and the implementation priorities that followed it. The first implementation tranche is now complete in this branch: the Hub has a recommended live path, visible lesson status, metadata-aware search, and four runnable simulated protocol labs. The remaining findings below describe the next improvements rather than claiming those baseline gaps are still wholly unchanged.

The Learning Hub is a strong catalog and a useful entry point, but it currently behaves more like a topic launcher than a guided training system.

What is already good:

- There are **59 topics across 8 categories**.
- All 59 current topics have a click action in `categoryActionMap`; there are no obvious inert cards in the current catalog.
- The app already has credible live surfaces for token exchange, PingOne Authorize decisions, MCP inspection, A2A delegation, Agent Gateway authorization, WebMCP, HITL/CIBA, attack demos, and audit/token traces.
- Many education drawers identify the relevant repository implementation, which makes them useful for technical enablement.
- Search works across the topic label and description and is simple enough to use.

Where the baseline training experience fell short:

- The UI does not tell a learner whether a topic is **live**, **simulated**, **illustrative**, **reference-only**, or **configuration-dependent**.
- A large portion of the catalog opens a drawer containing prose, diagrams, and snippets but no executable action.
- A few panels are “live” only as observers: they fetch status or recent decisions but do not let the learner create the event they are observing.
- The training journey is not sequenced. A learner can read about tokens, policy, MCP, and agent identity, but the Hub does not show the shortest path through them.
- The action contract is implicit. If a catalog item is added without an action-map entry, `handleItemClick` silently does nothing.
- Some examples are explicitly mock or illustrative, but that status is not visible from the card or search result.
- The Hub’s search is topic text search, not training search: it does not index prerequisites, routes, tools, standards, product names, or “live/mock” status.

### Recommended direction

Keep the Learning Hub as the catalog, but turn every topic into a small lesson contract:

```text
Topic card → lesson type/status → explanation → Run this example → evidence → next lesson
```

The first customer-facing path should be the existing end-to-end Agent Gateway story:

```text
Agent identity
  → delegated/scoped token
  → MCP tool request
  → Gateway enforcement
  → PingOne Authorize decision
  → step-up or human approval when required
  → protected tool result
  → token/audit trace
```

That path gives the Hub a coherent spine and lets the other topics attach to a real moment in the story.

## Current inventory

### Catalog shape

| Category | Topics | Current behavior | Training assessment |
|---|---:|---|---|
| Getting Started | 3 | Education drawer or guided tour | Good orientation; needs a clear first runnable lab |
| OAuth & Identity | 13 | Mix of education drawers, live token/decision observers, and protocol examples | Highest-value area for runnable examples; currently mixed without labels |
| MCP & Agents | 13 | Mix of drawers plus direct routes to A2A, Agent Gateway authorization, and Shadow AI | Strongest live-demo potential; should become the main journey |
| Ping AI Products | 6 | Direct product/positioning pages | Good marketing layer; not yet a hands-on training layer |
| Standards & Architecture | 9 | Primarily education drawers and architecture explanations | Good reference material; needs small deterministic exercises |
| Project Reference | 2 | Education drawers | Useful for developers, but no “inspect this in the running app” action |
| AI Ecosystem | 6 | Education drawers | Reference/landscape material; should remain clearly non-executable |
| Special Topics | 7 | Mix of direct pages and education drawers | Valuable, but the live/mock distinction varies by topic |

The catalog and action wiring live together in `LearningHub.tsx` (`LEARNING_CATEGORIES` and `categoryActionMap`). Panel registration is centralized in `EducationPanelsHost.js` (`PANEL_MAP`). This makes the current system easy to extend, but it also means content, action, status, route, and evidence are not represented as one data record.

### What is already genuinely runnable

These are the best candidates for “Run this example” links today.

| Training topic | Existing working surface | What a learner can prove |
|---|---|---|
| Guided Demo Tour | Demo tour context | A guided sequence through the app |
| Token Exchange (RFC 8693) | `TokenExchangePanel` fetches the current session status and exposes live-token content | A user/session token exists and the BFF keeps browser token custody |
| PingOne Authorize | `PingOneAuthorizePanel` reads evaluation status and recent decisions, with simulated/live source selection | The policy engine path and decision history are observable; live mode is configuration-dependent |
| MCP Protocol | The panel links to the in-app MCP Inspector | Tool discovery and tool invocation can be inspected through the app |
| Agent-to-Agent (A2A) | `/a2a-protocol-learning` | Agent Card, delegation, nested actor chain, and specialist handoff behavior |
| Agent Gateway Authorization | `/agent-gateway-authorization` | Read, step-up, and deny scenarios with links to the live agent, gateway inspector, Authorize tester, and trace |
| WebMCP | WebMCP education panel contains a runnable handler/example path | Browser-native tool exposure and BFF protection concepts |
| Human-in-the-loop | Existing banking/agent flow and consent infrastructure | A sensitive operation can pause for consent rather than silently execute |
| CIBA (OOB) | CIBA panel/event path and approval route | Out-of-band authentication/approval behavior when the environment is configured |
| AI Attacks | Existing attack panel and dashboard return path | Prompt injection/attack scenarios and corresponding controls |
| Agent Kill Switch | Existing run registry/stop mechanisms | Session-scoped interruption and audit behavior; some identity semantics remain explicitly incomplete |
| Shadow AI Detector | `/ai-gateway/shadow-ai-detector` | A separate product surface for observed AI usage and risk signals |

These examples should be promoted as the Hub’s first-class **Live** track, with a visible prerequisite and a “what to look for” checklist.

### Topics that are currently explanation-first

These topics have useful content but do not consistently give the learner a runnable interaction from the card or drawer:

- Agentic Maturity Model
- PKCE Deep Dive
- `may_act` / `act` claims
- Actor Token (Agent)
- Step-up MFA
- Introspection (RFC 7662)
- Agent Gateway pattern
- Computer Use Agent
- PingOne Agent Gateway Security
- SPIFFE / SVID Workload Identity
- ID-JAG / Cross-App Access
- Architecture Diagram
- Token Chain (education)
- Sensitive Data & Disclosure
- Gateway vs P1AZ Decision Split
- Server Capabilities
- Agent Tech Comparison
- LangChain / agent framework / LLM / platform landscape topics
- Glean + PingOne
- AuthZEN
- Agentic Trust
- Agent Guardrails
- OWASP Agentic
- Gartner Machine IAM Survey

This is not a defect for all of them. Reference topics should remain reference topics. The problem is that the UI does not distinguish a reference lesson from a lab.

### Topics that are explicitly illustrative or configuration-dependent

The implementation already signals this in several panels via `EduImplIntro mock` or copy explaining configuration boundaries:

- PAR (RFC 9126): explicitly an example pattern rather than the demo’s current login path.
- RAR (RFC 9396): example/flag/configuration-dependent authorization details.
- JWT Client Auth (RFC 7523): mock example because the BFF currently uses client-secret authentication on token endpoints.
- Step-up MFA: implementation pattern is shown, but the panel’s snippet is marked mock.
- Enterprise-Managed Auth: a real signed ID-JAG path requires enterprise IdP configuration; otherwise RFC 8693 stands in.
- PingOne Authorize: live decision retrieval exists, but the actual live engine depends on configuration; simulated mode is a valid fallback.
- SPIFFE/SVID, DPoP, transaction-token, and similar advanced controls: useful real code exists in parts of the repo, but the Hub does not expose a single self-contained run that proves the concept.

These topics should not be made to look live by adding a button that only changes local state. They should either receive a deterministic mock lab or carry an explicit “Illustrative”/“Requires configuration” badge.

## Findings by learner experience

### Implementation update

Completed in the current tranche:

- The Hub now exposes `LIVE`, `LIVE / CONFIG`, `SIMULATED`, and `REFERENCE` status badges.
- Search now includes status and protocol/product/tool metadata for the highest-value topics.
- A recommended four-step Agent Gateway customer path links to the live routes.
- PAR, RAR, JWT client authentication, and step-up MFA each have a deterministic runnable lab at `/learning-lab/:lab`.

Still recommended for follow-up:

- Move every catalog item from the remaining implicit category/label action map into the lesson registry.
- Add in-drawer evidence checklists and next-lesson links to the live/configured panels.
- Add prerequisites and learner-progress state for customer, developer, and architect tracks.

### 1. The Hub has no status vocabulary

A topic card has `label`, `description`, and `icon`. The learner cannot tell whether clicking it will:

- open a live route,
- open a local education drawer,
- fetch current server state,
- run a simulated policy engine,
- require sign-in/configuration,
- or open a reference-only explanation.

**Recommendation:** add a compact status and action vocabulary:

| Status | Meaning | Example |
|---|---|---|
| `LIVE` | Calls the running app/service or opens a real interactive route | Agent Gateway Authorization |
| `LIVE / CONFIG` | Real path exists but needs a flag, environment, or external provider | PingOne Authorize, CIBA, Enterprise-Managed Auth |
| `SIMULATED` | Deterministic local behavior models the protocol or policy | RAR, PAR, JWT Client Auth |
| `REFERENCE` | Explanation, source map, or standards content | LLM Landscape, Gartner survey |

Show the status on the card, in search results, and at the top of the drawer. Use plain text or the existing allowed product/security glyphs; do not introduce a new emoji vocabulary.

### 2. The action map is a silent failure boundary

`handleItemClick` looks up an action by category and label and simply does nothing if it cannot find one. That makes catalog drift look like an unresponsive card.

**Recommendation:** replace the implicit map with a registry entry that contains the action itself and add a test that every catalog item has exactly one action. If a lesson is intentionally reference-only, its action should still open a reference panel rather than silently returning.

Suggested test contract:

```text
for every category/item:
  item.id exists
  item.status exists
  item.action exists
  action target is a registered panel or route
  live items expose an evidence target
```

### 3. Search finds prose, not learning paths

The current search matches only `item.label` and `item.description`. It does not find a topic by:

- route (`/agent-gateway-authorization`),
- standard (`RFC 8693`),
- product (`P1AZ`, Agent Gateway, Agent IAM Core),
- tool (`create_transfer`, `get_account_balance`),
- outcome (`PERMIT`, `DENY`, `STEP-UP`),
- or status (`live`, `mock`, `reference`).

**Recommendation:** add hidden searchable metadata such as `keywords`, `standards`, `products`, `tools`, and `status`. Display the matched reason, for example: `Matched standard: RFC 8693` or `Matched live tool: create_transfer`.

### 4. The Hub is not yet a course

The eight categories are useful shelves, but the app does not currently answer “what should I do next?” A customer or SE has to infer the correct order.

**Recommendation:** add a “Recommended path” at the top with three tracks:

#### Customer story: secure one agent action

1. Agent Gateway Authorization — run read, step-up, and deny.
2. Token Exchange — inspect the delegated/scoped token.
3. Agent Gateway — inspect MCP audience, scopes, and enforcement.
4. PingOne Authorize — compare simulated/live decisions.
5. Human-in-the-loop / CIBA — approve the sensitive branch.
6. Transaction Trace — prove the final outcome.

#### Developer story: build the boundary

1. MCP Protocol — tools and auth boundary.
2. Agent Gateway — audience and per-tool scopes.
3. Token Exchange — BFF custody and RFC 8693.
4. Gateway vs P1AZ — PEP/PDP responsibility split.
5. MCP Inspector — invoke and inspect a tool.

#### Architect story: choose the control

1. Agent IAM Core.
2. Agent Gateway.
3. PingOne Authorize.
4. Privilege for AI — LLM, A2A, and MCP.
5. Standards & Architecture reference panels.

Each path should end with a “You proved” summary and a next route, not just a drawer close button.

## Recommended runnable labs

These are the highest-value additions because they reuse existing app behavior instead of inventing a second simulator.

### P0 — Make the existing Agent Gateway story the Hub’s canonical lab

Create a prominent four-step lesson card that launches:

1. `/agent-flow-inspector` — agent identity and token flow.
2. `/agent-gateway-inspector?subtab=tester` — gateway request and enforcement.
3. `/pingone-authorize?tab=guided` — policy context and decision.
4. `/transaction-trace` — token, policy, gateway, approval, and tool evidence.

The current Agent Gateway authorization page already has the right narrative and live links. The missing work is to make it the default training path and expose the same run from the Hub without forcing the learner to infer where to go next.

### P0 — Add a live “read / step-up / deny” lab contract

Use the existing scenarios:

| Scenario | Expected result | Evidence |
|---|---|---|
| `get_account_balance` | PERMIT | tool result, token chain, gateway event |
| `create_transfer` for `$500` | STEP-UP | obligation/approval state, retry/result |
| blocked payee transfer | DENY | policy reason, no protected-resource execution |

The lab should present the expected result before the run, then show the actual result and a “why” panel. That makes the example testable and teachable rather than a free-form demo.

### P1 — Add a “token custody and delegation” lab

Use the existing `TokenExchangePanel` live session-token fetch and connect it to the existing Token Chain rail. The learner should be able to:

- see that the browser holds a session cookie rather than a raw access token,
- see the BFF exchange context,
- compare user subject, agent actor, audience, and scope,
- open the next MCP tool call,
- and see the narrowed tool scope.

Success criterion: one click produces a trace containing `sub`, `act`, `aud`, and scopes without displaying raw secrets.

### P1 — Add a “MCP tool boundary” lab

Reuse the MCP Inspector and existing `/api/mcp/tool` path. Provide three safe presets:

- read balance,
- create transfer,
- sensitive account details.

For each preset show:

- requested tool,
- required scope,
- gateway result,
- Authorize result,
- whether the MCP server was reached,
- and the corresponding trace link.

This is the clearest working example for the product distinction: Agent Gateway protects the call boundary; Authorize evaluates the action in context.

### P1 — Add a real approval lab

Connect the Human-in-the-loop card to the existing transfer threshold and CIBA/HITL controls. The learner should run a sensitive action, see the pause, approve or deny it, and then see the final trace.

The UI must state which mode is active:

- local consent mock,
- CIBA with PingOne,
- or configured external approval.

Do not present a local confirmation modal as CIBA unless the CIBA path actually ran.

### P1 — Add an “attack before/after control” lab

The AI Attacks panel already has runnable attack dispatch. Give each attack a paired control outcome:

```text
Prompt injection → detected/blocked → protected tool not reached
Scope abuse      → gateway/P1AZ denial → no write performed
HITL bypass      → approval required → action paused
```

The evidence should include the attempted input, control that fired, decision, and whether the downstream tool ran.

### P2 — Build deterministic protocol sandboxes for the mock topics

For PAR, RAR, and JWT Client Auth, a local mock is more useful than a code block alone. Each sandbox should accept a small form, validate it, and display a deterministic result.

Examples:

- **PAR:** enter client ID, redirect URI, and PKCE challenge; issue a short-lived `request_uri`; show the authorize request using only the reference.
- **RAR:** enter amount, currency, payee, and tool; show the authorization details and test whether an attempted tool call is a subset of the grant.
- **JWT Client Auth:** generate a sample assertion from fixed local values; validate `iss`, `sub`, `aud`, `exp`, and signature mode; label it as local simulation.

These examples do not need to call PingOne. They do need deterministic inputs, validation, expected failures, reset, and a clear “simulated” label.

## Suggested metadata model

The current parallel arrays (`LEARNING_CATEGORIES` + `categoryActionMap`) should evolve into one registry. A minimal shape is:

```js
{
  id: "agent-gateway-authorization",
  category: "mcp-agents",
  label: "Agent Gateway Authorization",
  description: "Run a delegated agent action through gateway and policy enforcement.",
  status: "LIVE",
  kind: "route",
  target: "/agent-gateway-authorization",
  keywords: ["delegated access", "MCP", "P1AZ", "step-up", "deny"],
  standards: ["RFC 8693", "RFC 8707"],
  products: ["Agent IAM Core", "Agent Gateway", "PingOne Authorize"],
  evidence: ["token-chain", "gateway-decision", "authorize-decision", "tool-result"],
  next: "token-exchange",
}
```

Benefits:

- Search and filtering become metadata-driven.
- Status is honest and visible.
- Tests can prove every lesson is actionable.
- The same registry can drive the Learning Hub, side-nav aliases, a “recommended path,” and a future completion tracker.
- Routes and panels can be checked at build/test time.

## Recommended delivery plan

### Phase 1 — Trustworthy catalog (small, high leverage)

- Add `status`, `kind`, `keywords`, `standards`, and `products` metadata.
- Render a status badge on every card and drawer.
- Add registry coverage tests for action/target completeness.
- Add search across metadata.
- Add a four-step “Secure one agent action” path using the existing live routes.

### Phase 2 — End-to-end labs

- Promote Agent Gateway Authorization to the canonical live lab.
- Add the token custody/delegation lab.
- Add the MCP tool boundary lab.
- Add HITL/CIBA mode labeling and approval evidence.
- Add attack/control evidence cards.

### Phase 3 — Working protocol mocks

- PAR sandbox.
- RAR subset/grant sandbox.
- JWT Client Auth assertion sandbox.
- DPoP/sender-constrained token sandbox.
- SPIFFE/SVID verifier/consumer boundary sandbox.

### Phase 4 — Course experience

- Recommended tracks.
- Per-lesson “You proved” state stored per browser/session.
- Reset progress control.
- Completion links from every live example to its trace.
- Exportable demo run summary for SE/customer conversations.

## Acceptance criteria for future changes

A Learning Hub enhancement is ready when:

- The card states whether it is live, configuration-dependent, simulated, or reference-only.
- Clicking the card always produces a visible result; no silent no-op actions.
- A live example identifies its actual route/API and its prerequisites.
- A simulated example has deterministic inputs, validation, expected outcomes, reset, and an explicit simulation label.
- The learner can answer “what happened?” and “where is the evidence?” without leaving the training flow.
- The lesson links to the next logical topic.
- Focused tests cover catalog registration, search, action/route wiring, and the expected decision/result.
- The UI continues to use existing theme tokens and the project’s emoji allowlist.

## 2026-10-11 diagram-fit sync

The diagram-fit audit (see `docs/diagram-fit-audit` notes and the merged commit
`feat(ui): add walkthrough diagrams, reels and token chains to teaching pages`)
upgraded six teaching surfaces with the app's three shared visualization
families — walk-based `StaticFlowDiagram` (which attaches the Play/Step bar and
movie reel itself), `SequenceFlowDiagram` lifelines, and `TokenChainTraceRail`:

| Surface | What changed | Card/guide action |
| --- | --- | --- |
| `/oauth-token-exchange` (OAuth teaching) | walk-based exchange walkthrough (Browser → BFF → PingOne → MCP) with reel | card "Token Exchange (RFC 8693)" routes to `/architecture/token-flow` (unchanged) — the lesson page itself is reachable from that architecture page and the OAuth Academy path |
| `/delegation-chain-value` | runs now feed the trace store; a token chain panel mounts after the first run, including the identity-mismatch DENY | guide updated to point at the in-page chain panel |
| `/pingfederate-ai-agent` | each captured flow (CIMD, exchange, RAR, CIBA) renders a lifeline sequence + reel above its ProtocolTrace | guide step added ("Read the sequence before the traffic") |
| `/agent-gateway-authorization` | hand-rolled stage chips replaced by a walk-based diagram; same click-to-focus, reel attached | guide's "Walk the request flow" step updated (Play/Step + reel, node click still focuses) |
| `/privilege-mcp-learning` | three-box div chain replaced by a walk-based request-flow diagram | guide step added ("Walk the request flow diagram") |
| `/agent-flow-inspector` | selected run's stored token events replay into the token chain rail | no guide existed; the page's own section heading ("Token chain, replayed") is self-explanatory |

Education-drawer panels gained visuals too: `may_act / act claims` now opens
its Step-by-step tab with the audience chain drawn (`TokenAudienceChain`), the
A2A drawer's In-this-demo tab renders the recorded delegation as packets
(`A2AFlowVisualizer`), and the PAR drawer's Full-flow tab opens with a PAR +
PKCE lifeline sequence. No card labels, statuses, or action-map entries
changed — every card action still resolves to the same target, so the
catalog itself needed no edit for this pass.

## Source references

- [Learning Hub catalog and action map](../demo_api_ui/src/components/LearningHub.tsx)
- [Education panel registry](../demo_api_ui/src/components/education/EducationPanelsHost.js)
- [Education panel identifiers](../demo_api_ui/src/components/education/educationIds.js)
- [Live route registrations](../demo_api_ui/src/App.js)
- [MCP education panel and live inspector link](../demo_api_ui/src/components/education/McpProtocolPanel.js)
- [Token exchange live session/status path](../demo_api_ui/src/components/education/TokenExchangePanel.js)
- [Authorize recent-decision and engine-status paths](../demo_api_ui/src/components/education/PingOneAuthorizePanel.js)
- [Agent Gateway authorization lesson](../demo_api_ui/src/pages/AgentGatewayAuthorizationLessonPage.jsx)

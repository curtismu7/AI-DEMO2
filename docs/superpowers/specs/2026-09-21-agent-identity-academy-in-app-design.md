# Agent Identity and Security Academy — In-App Integration Design

**Status:** Ready for implementation

**Audience:** The agent implementing the Academy experience, UI reviewers, and sales-engineering demo owners.

**Source curriculum:** The requested Agent Identity and Security use cases (13 lessons).

**Related design:** `docs/superpowers/specs/2026-09-20-academy-real-agent-lessons-design.md` contains the broader real-agent execution and BFF contract. This document focuses on integrating that curriculum into the existing app and turning the current HTML mock into a real in-app experience.

## Boundary with the other Academy development

There are two related but different developments. They should share contracts and lesson IDs, but they should not duplicate ownership.

| Development | Primary ownership | Expected output | Must not duplicate |
|---|---|---|---|
| **Real-Agent Lessons** (`academy-real-design`) | Execution architecture and server-side behavior | BFF Academy endpoints, readiness, scenario adapters, live/recorded/mock run contract, event correlation, redaction, safe reset, real product integrations | Academy navigation, lesson presentation, duplicate inspectors, browser-side product calls |
| **In-App Academy Integration** (this document) | User-facing Academy experience | Academy home, 13-lesson catalog, guided and standalone routes, lesson shell, diagrams, presenter flow, source/provenance controls, evidence timeline, product map, links to existing inspectors | A second agent runtime, authorization engine, token exchange implementation, broad tenant mutation, competing BFF APIs |

The other development answers: **“How does a bounded Academy scenario execute safely and produce trustworthy evidence?”**

This development answers: **“How does a user learn that scenario, launch it, understand each frame, and move to the right existing inspector?”**

Integration rules:

1. Use the other development's run/readiness/evidence contract rather than inventing a UI-specific API.
2. Use the same canonical lesson IDs and catalog metadata in the guided journey, standalone launcher, and lesson routes.
3. Keep live execution behind the BFF. The UI only starts, observes, cancels, and resets an owned run through the bounded API.
4. Keep this work's Evidence Timeline and Ping Product Map as presentation components over evidence supplied by the execution layer; they must not independently infer or fabricate policy, token, or product events.
5. Link to existing inspectors for deep evidence. Do not copy inspector logic into Academy components.
6. If a real scenario is not yet available, render the lesson with Mock or Recorded provenance and a readiness explanation; do not create a second partial live implementation in the UI.

The static HTML mock belongs to this integration development as a visual reference. It is not a competing execution path and should remain clearly labeled as a mock/review artifact until the React lesson route replaces it.

## Reviewable mock

Open the current standalone HTML mock in a browser:

[Open `academy-preview.html`](file:///Users/cmuir/Development/AI-DEMO2/demo_api_ui/public/academy-preview.html)

Repository path: [`demo_api_ui/public/academy-preview.html`](../../../demo_api_ui/public/academy-preview.html)

The mock is a visual reference for the Academy layout, concept switching, guided versus five-minute presentation modes, mock versus real source selection, movie-reel evidence, and links into existing live surfaces. It is not itself the implementation and must not be presented as live execution.

## Problem

The application already contains useful authentication, authorization, agent, MCP, A2A, Privilege, lifecycle, and evidence surfaces. They are difficult to present as one customer story because the explanation, execution, and evidence are spread across separate pages.

The Academy should provide a guided path from:

`person → agent identity → authentication → delegation → policy → approval → protocol → tool → evidence`

The Academy is a teaching and orchestration layer. It does not replace inspectors or product configuration pages. It explains the security decision, starts a bounded demo where the application already supports it, and links to the authoritative inspector when deeper debugging is required.

## Goals

- Make all 13 requested use cases discoverable from one in-app Academy experience.
- Support both a sequential guided journey and independently launchable lessons.
- Reuse existing live app routes and inspectors rather than cloning their behavior.
- Make Mock, Recorded, Live Local, Live Cloud, and Unsupported behavior explicit.
- Make the Evidence Timeline and Ping Product Map a first-class lesson and a shared component across all lessons.
- Keep browser-token custody in the BFF and keep raw credentials out of the UI.
- Preserve the existing theme system, responsive behavior, keyboard accessibility, and emoji allowlist.

## Non-goals

- Do not build a second agent runtime or a second authorization engine.
- Do not make browser code call PingOne, Authorize, MCP, A2A, Privilege, or management APIs directly.
- Do not claim that an external personal agent is controlled by the enterprise.
- Do not make a mock replay look like a live tenant result.
- Do not replace existing inspectors, deep-dive pages, configuration pages, or product pages.
- Do not add broad tenant reset or unrestricted tool execution to Academy.

## Customer-facing curriculum

The Academy contains 13 lessons. The first item in the user's list is unnumbered; the remaining items are numbered 1–12, so the implementation should treat the total as thirteen lessons.

### 1. Agent Landscape and Identity

Explain CIAM versus Workforce and distinguish Consumer/Personal Agents, Customer Service/Digital Assistants, Employee Assistants, and Third-Party Agents. The lesson identifies the person, agent, owner, requested action, and protected boundary without implying that a language model is an authorization system.

### 2. PingOne Login, OIDC, and PKCE

Show the authorization redirect, PKCE exchange, identity claims, callback, and BFF session boundary. Raw authorization codes and tokens remain server-side.

### 3. OAuth Delegated Agent Access

Show RFC 8693 delegation and the difference between the user subject and acting agent: `sub`, `act`, scopes, audience, and resource-specific access. The lesson should demonstrate both a permitted protected read and a denied request when a delegation boundary is wrong.

### 4. Consumer Agent: Personal Agent

Explain external agents such as ChatGPT, Claude Desktop, and LM Studio. Cover detection, CIMD/DCR, OAuth connection, consent, and per-tool authentication. The app observes the protected interaction; it does not pretend to control the external agent's reasoning.

### 5. Customer Service Agent: Digital Assistant

Use the enterprise-controlled assistant scenario to search for cheap flights, establish explicit delegation, request granular consent, and access customer data within a bounded task. Booking, spending, or itinerary changes require approval or step-up.

### 6. MCP Discovery and Tool Execution

Show server discovery, tool catalog, schema and arguments, authentication requirements, gateway validation, invocation, and the returned result. Discovery evidence must be visibly separate from execution evidence.

### 7. PingOne Authorize: Permit and Deny

Run one permitted and one denied request. Show sanitized policy input, decision, reason, obligations, and enforcement point. Simulated decisions must never be labeled as live PingOne Authorize evidence.

### 8. Human Approval, CIBA, Consent, and Step-Up

Pause a high-impact action, show the approval or stronger-authentication requirement, resume only after approval, and include denial, expiration, mismatch, and replay outcomes.

### 9. A2A Agent Delegation

Show Agent Card discovery, specialist handoff, A2A task/message exchange, nested RFC 8693 delegation, policy evaluation, specialist tool use, and the returned result. Keep protocol behavior separate from OAuth authority.

### 10. Privilege MCP Protection

Show a protected MCP connection, temporary access, credential isolation, execution through the relay, session end/refresh, and audit evidence. The browser and agent never receive the protected credential.

### 11. AI Threat Defense

Demonstrate prompt injection, replay, scope escalation, audience mismatch, and prohibited-tool attempts. Show which boundary stopped the request: model, gateway, policy service, MCP server, or downstream tool.

### 12. Agent Detection, Lifecycle, and Revocation

Move an observed agent from unknown to known, show ownership, suspend or revoke the bounded demo agent, and demonstrate a denied retry. Mutations must be restricted to the demo agent owned by the current run.

### 13. Evidence Timeline and Ping Product Map

Assemble person, agent, tokens, policy, approvals, protocols, tools, results, audit identifiers, and product ownership in chronological order. This is both a standalone lesson and a shared evidence view embedded in every other lesson.

## Information architecture

### Entry surfaces

1. **Academy home / Education Hub** — explains the curriculum, readiness, modes, and product coverage.
2. **Guided journey** — presents all 13 lessons in sequence with progress, skip, restart, and final evidence summary.
3. **Standalone launcher** — filters and launches one lesson with its own presenter script, readiness, timing, and reset guidance.
4. **Lesson route** — the canonical implementation for both guided and standalone presentation.

The dynamic lesson route remains:

```text
/academy/:lessonId/:mode
```

`mode` is `guided` or `standalone`. Mock/Recorded/Real is a separate source selector inside the lesson; it must not create separate lesson implementations.

### Existing routes to reuse

The Academy should link to, and where appropriate launch, the existing surfaces:

- `/oauth-academy`
- `/academy/delegation/guided`
- `/token-exchange-tester`
- `/a2a-protocol-learning`
- `/agent-gateway-capabilities`
- `/agent-gateway-authorization`
- existing MCP, Privilege, CIBA, lifecycle, threat, and product deep-dive pages discovered during implementation

Do not create duplicate inspectors. A lesson may summarize an inspector result and link to it for full request, trace, log, performance, or policy evidence.

## Lesson layout

Every lesson uses the same shell, with lesson-specific content and adapters:

1. Customer outcome and lesson framing.
2. Tenant and dependency readiness.
3. Source selector: Mock, Recorded, Real, or Hybrid where supported.
4. Safe scenario inputs and run controls.
5. Agent workspace or external-agent observation panel.
6. Movie-reel sequence of the run.
7. Evidence drawer with redacted claims, policy data, protocol details, and correlation IDs.
8. Evidence Timeline and Ping Product Map.
9. Presenter script with short and extended versions.
10. Reset, next lesson, deep-dive, Education Hub, and authoritative references.

The first frame must explain what the user is about to learn. An empty output panel is not an acceptable initial state; it should contain the scenario explanation and a clear action such as `Run mock`, `Start real lesson`, or `Observe external agent`.

## Execution model

All sources normalize into one lesson-run model:

```text
AcademyRun
  id
  lessonId
  presentationMode       guided | standalone
  executionSource         mock | recorded | live-local | live-cloud | hybrid
  status                  ready | running | paused | completed | denied | failed | expired | cancelled
  actorSummary            person, agent, owner, category
  frames[]
    id, sequence, phase, title, status
    provenance
    summary
    evidence[]
    productRoles[]
    correlationIds[]
  result                  outcome, decision, customerSafeSummary
  warnings[]
  resetCapabilities[]
```

Allowed provenance labels:

- `LIVE CLOUD`
- `LIVE LOCAL`
- `RECORDED`
- `MOCK`
- `UNSUPPORTED BY PINGONE`

Each frame owns its provenance. A hybrid lesson may contain live and mock frames, but the UI must show that split and explain why.

### Mock

Deterministic, bundled, versioned fixtures. Mock is always available and uses the same frame and evidence UI as live execution.

### Recorded

Sanitized evidence from a known successful run. It must show capture metadata and must never imply current tenant readiness.

### Live

The browser starts a bounded BFF-owned scenario. The BFF invokes existing application agents and services, correlates events, redacts evidence, and returns a run identifier. The browser polls or subscribes to sanitized events.

### External-agent observation

For Personal Agent lessons, the app provides a protected connection and a bounded observation window. It displays what the enterprise can observe and enforce, not hidden reasoning or controls the external agent does not possess.

## BFF boundary

The BFF remains the sole browser-token custodian. Academy APIs should be narrow, allowlisted, and owned by the current authenticated session:

```text
GET    /api/academy/readiness
GET    /api/academy/lessons/:lessonId/readiness
POST   /api/academy/runs
GET    /api/academy/runs/:runId
GET    /api/academy/runs/:runId/events
POST   /api/academy/runs/:runId/cancel
POST   /api/academy/runs/:runId/reset
```

`POST /api/academy/runs` accepts only an allowlisted lesson ID, scenario ID, source, and lesson-specific safe input. It is not a general prompt endpoint, URL fetcher, arbitrary tool executor, or tenant mutation endpoint.

The UI must never receive raw bearer tokens, authorization codes, refresh tokens, client secrets, Privilege credentials, session cookies, or unrestricted request bodies. Redaction occurs before evidence is persisted or streamed.

## Readiness and failure behavior

Readiness is lesson-specific. A missing optional product must disable only the affected Real action and explain the exact setup or deep-dive page needed. Real must never silently fall back to Mock or Recorded.

Expected security outcomes are teaching outcomes:

- policy denial;
- expired approval;
- rejected replay;
- audience mismatch;
- scope escalation;
- revoked-agent retry.

Unexpected failures preserve completed frames, mark the failed frame, identify the boundary that failed, and provide Retry only when safe. Reset must clear the Academy run and may mutate only a specifically allowlisted demo resource.

## Implementation boundaries

### UI

Likely areas to modify after implementation inspection:

- Academy route shell and lesson route components.
- Academy lesson catalog/configuration.
- Guided journey and standalone launcher integration.
- Shared frame/evidence/timeline/product-map components.
- Academy-specific unit and route tests.
- Navigation/Education Hub links.

The implementation should follow existing component and route conventions instead of rewriting `App.js` or creating a parallel router. Themeable colors, backgrounds, and font sizes belong in stylesheets using `--th-*` tokens; do not introduce themeable inline styles.

### BFF

Only add or extend BFF endpoints when an existing route cannot safely provide the bounded scenario. Reuse existing agent, gateway, authorization, approval, MCP, A2A, Privilege, lifecycle, and evidence services. Keep the BFF responsible for authentication, authorization, run ownership, redaction, and correlation.

### Content

Keep lesson content in one canonical catalog. Guided journey cards, standalone launcher cards, lesson titles, readiness text, presenter scripts, product map labels, and static preview links should derive from or reference that catalog to avoid drift.

## Acceptance criteria

- All 13 lessons are reachable from Academy home, guided journey, or standalone launcher.
- Every lesson has an explanation, scenario, source state, run control, evidence view, product map, and next/deep-dive links.
- Mock mode works without PingOne or optional products.
- Real mode is disabled with an honest readiness explanation when dependencies are absent.
- No mock output is labeled as live.
- Real execution uses the BFF and existing services; browser code does not hold product credentials.
- Evidence Timeline and Ping Product Map appears in every lesson and has its own lesson route.
- OAuth evidence shows `sub`, `act`, scope, audience, and decision without raw tokens.
- A2A evidence separates Agent Card/protocol events from OAuth authority and policy decisions.
- Human approval lessons show pending, approved, denied, expired, and replay outcomes where supported.
- Threat and lifecycle lessons fail closed and scope mutations to the current demo run.
- The Academy works in light and dark themes, at 320 CSS pixels, and with keyboard navigation.
- The standalone HTML mock remains available as a review artifact but is not presented as the live implementation.

## Verification requirements

For UI changes:

```bash
cd demo_api_ui
npm run test:unit
npm run build
```

For route/auth changes, also run the focused BFF tests and repository-required checks described in `CLAUDE.md` and `REGRESSION_PLAN.md` §0–§1. Before claiming completion, verify the rendered page in both themes and confirm that the canonical browser origin is `https://local.ping-devops.com:4000`.

## Handoff recommendation

Implement in vertical slices rather than attempting all thirteen live scenarios at once:

1. Academy shell, catalog, guided/standalone routing, and shared evidence timeline/product map.
2. Agent landscape, Login/OIDC/PKCE, and OAuth delegation.
3. MCP discovery, Authorize permit/deny, and the customer-service assistant.
4. Personal-agent observation and external-agent registration/consent surfaces.
5. Human approval/CIBA/step-up and A2A delegation.
6. Privilege MCP, threat defense, lifecycle/revocation, and final product-map polish.

Each slice must retain Mock mode, use the same frame contract, and be independently demonstrable.

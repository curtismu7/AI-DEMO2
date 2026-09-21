# AI Security Academy Real-Agent Lessons

## Problem

The application contains working PingOne, OAuth, agent, MCP, A2A, Authorize, CIBA, Privilege, lifecycle, and evidence flows, but they are spread across deep-dive pages and use-case surfaces. The existing Academy framework supplies a guided journey, standalone launcher, lesson shell, tenant readiness strip, and an approved OAuth/A2A visual mock. Most Academy actions currently observe recent evidence rather than initiating and following a bounded scenario.

Sales engineers need one teaching experience that works in two contexts:

- a sequential customer story that explains why each identity control exists; and
- short, independent demonstrations that can start at any lesson.

Every lesson must remain presentable when the PingOne tenant or an optional product is not configured. At the same time, a configured environment must show the real application agent and real security controls instead of a mock that merely looks live.

## Goals

- Build one reusable Academy experience for thirteen approved lessons.
- Offer explicit Mock and Real modes on every lesson.
- Run supported real scenarios through the BFF and the application's agents, never directly from browser code.
- Observe external personal agents without pretending the application controls them.
- Label live, local, recorded, mocked, hybrid, and unsupported behavior honestly at frame level.
- Preserve server-side token custody and redact sensitive evidence.
- Reuse the same lessons in the guided journey and standalone demo launcher.
- Keep Academy, Education Hub, navigation, use-case cards, and relevant deep-dive pages synchronized.
- Support light and dark themes, narrow screens, keyboard use, and short presenter scripts.

## Non-goals

- Implementing native PingOne support for standards or product capabilities PingOne does not currently support.
- Claiming that CIMD, native ID-JAG, PingOne Credentials, Protect, DaVinci, or Privilege is live when the configured tenant cannot execute it.
- Replacing existing inspector, configuration, control-plane, or product pages.
- Exposing raw bearer tokens, authorization codes, client secrets, Privilege credentials, or unrestricted tenant mutation in the Academy UI.
- Building a new agent runtime when an existing application agent or external-client integration already owns the behavior.
- Treating a visual replay as proof that a live action occurred.

## Naming and taxonomy

The Academy follows the terminology in the customer-facing ID4AI overview deck.

### CIAM: Agent Identity for Customer Experience

- **Consumer Agents / Personal Agents** are external agents selected or controlled by customers. Examples include ChatGPT, Claude Desktop, and LM Studio. The enterprise controls its resource boundary, registration requirements, OAuth connection, consent, policy, and audit evidence, but does not control the agent's reasoning or interface.
- **Customer Service Agents / Digital Assistants** are agents the enterprise builds and controls to serve customers and access customer data. The cheap-flight assistant is a Digital Assistant, not a Personal Agent and not a CIAM Worker Agent.

### Workforce: Agent Identity for Employee Productivity

- **Employee Assistant Agents** are enterprise-built Digital Assistants that help employees access company resources.
- **Third-Party Agents** are external Personal Agents, Digital Assistants, or Digital Workers used by employees.

“Worker agent” will not be used as the CIAM label. Where the application teaches autonomous execution or client credentials, it will describe the execution model directly rather than changing the customer-facing agent category.

## Approved page set

The Academy contains three entry surfaces and thirteen lesson pages.

### Entry surfaces

1. **Education Hub / Academy home** — browse the curriculum, modes, product coverage, and related learning.
2. **Guided customer journey** — run the thirteen lessons in sequence with progress, skip, restart, and final evidence summary.
3. **Standalone demo launcher** — filter and launch short sales demonstrations with readiness, timing, outcome, script, and reset guidance.

### Lessons

1. **Agent Landscape and Identity**
   - Teach the CIAM and Workforce agent categories.
   - Run the application's controlled agent once to identify the person, agent, requested action, and protected boundary.
   - Contrast governed and ungoverned access without implying that a model is an authorization system.

2. **PingOne Login, OIDC, and PKCE**
   - Start a real PingOne authorization flow when configured.
   - Show the authorization redirect, callback, server-side code exchange, identity claims, and BFF session boundary without exposing the code or tokens.
   - Show DaVinci orchestration only when enabled and configured.

3. **OAuth Delegated Agent Access**
   - Ask the controlled agent to perform a protected read action.
   - Show RFC 8693 subject, actor, audience, and scope narrowing through the real token chain.
   - Explain delegation rather than impersonation.

4. **Consumer Agent: Personal Agent**
   - Treat ChatGPT, Claude Desktop, LM Studio, or another customer-controlled client as external.
   - Present MCP resource discovery, client identification, registration, PingOne OAuth, consent, per-tool authentication, protected invocation, and agent detection.
   - Use live observation mode for an external client and mock client skins only when an external client is unavailable.
   - Demonstrate CIMD as a standards-correct mock or hybrid because PingOne does not natively complete the CIMD authorization-server flow. Real metadata publishing and fetching may still be shown.

5. **Customer Service Agent: Digital Assistant**
   - Use the application's controlled agent to find flights matching customer constraints.
   - Show explicit delegation, granular consent, customer-data access, and task-specific limits.
   - Allow read-only searching within the standing task boundary; require approval or CIBA before booking, spending, or changing an itinerary.

6. **MCP Discovery and Tool Execution**
   - Discover a real MCP server and tool catalog through the BFF.
   - Show schema selection, arguments, authentication requirements, gateway validation, invocation, and result.
   - Distinguish tool discovery evidence from tool execution evidence.

7. **PingOne Authorize: Permit and Deny**
   - Run one permitted and one denied request through the controlled agent.
   - Show sanitized policy input, decision, reason, obligations, and gateway enforcement.
   - Never let a simulated engine appear as PingOne Authorize live cloud evidence.

8. **Human Approval, CIBA, Consent, and Step-Up**
   - Start a high-impact action through the controlled agent.
   - Pause the run for consent or stronger authentication, display the user-controlled approval channel, and resume only the approved request.
   - Include denial, expiration, mismatch, and replay outcomes.

9. **A2A Agent Delegation**
   - Ask the application's primary agent to involve a specialist.
   - Show Agent Card discovery, A2A task/message exchange, nested RFC 8693 delegation, policy evaluation, specialist tool use, and returned result.
   - Keep protocol behavior separate from OAuth authority.

10. **Privilege MCP Protection**
    - Show OAuth discovery and connection to the configured Privilege-protected MCP door.
    - List protected tools, invoke one through the relay, refresh or end the bounded session, and show audit evidence.
    - Make credential isolation explicit: the agent and browser never receive the protected credential.

11. **AI Threat Defense**
    - Demonstrate prompt injection, replay, scope escalation, audience mismatch, and prohibited tool attempts.
    - Show whether the model, gateway, policy service, MCP server, or downstream tool was reached.
    - Use real controls where implemented and deterministic mocks for unsupported product behavior.

12. **Agent Detection, Lifecycle, and Revocation**
    - Move an observed agent from unknown to known, relate ownership, and show inventory and lifecycle state.
    - Suspend or revoke a bounded demo agent and show the next attempt fail closed.
    - Include lifecycle and audit events without changing unrelated tenant agents.

13. **Evidence Timeline and Ping Product Map**
    - Assemble person, agent, delegation, tokens, policy, approvals, MCP/A2A messages, Privilege activity, tool result, and audit identifiers from the journey.
    - Map each control point to the responsible Ping product or open standard.
    - Distinguish captured evidence from explanatory content and from unsupported mock frames.

## Experience model

The dynamic route remains the canonical lesson URL:

```text
/academy/:lessonId/:mode
```

`mode` is `guided` or `standalone`. A separate source selector inside the lesson chooses Mock or Real. Guided and standalone modes change presenter chrome, pacing, and navigation; they do not create different lesson implementations.

Each lesson uses the approved movie-reel layout:

1. Lesson framing and customer outcome.
2. Tenant and dependency readiness.
3. Mock/Real selector with explicit provenance explanation.
4. Scenario controls and safe inputs.
5. Agent workspace or external-agent connection monitor.
6. Movie reel showing the active frame and full run sequence.
7. Redacted evidence drawer.
8. Ping product and standards mapping.
9. Presenter script with short and extended versions.
10. Reset, next lesson, deep-dive, Education Hub, and authoritative external links.

All Academy surfaces follow the repository theme system, support light and dark mode, avoid themeable inline styles, remain usable at 320 CSS pixels, and comply with the project emoji allowlist.

## Execution adapters

Every lesson declares one or more adapters that normalize into the same run contract.

### Mock adapter

- Runs deterministically from bundled, versioned scenario fixtures.
- Requires no PingOne or optional-product configuration.
- Uses the same movie-reel and evidence components as a live run.
- Labels every frame `MOCK`; it never emits a live provenance label.

### Recorded adapter

- Replays sanitized evidence captured from a known successful run.
- Records capture metadata and age without retaining bearer material.
- Labels every frame `RECORDED` and never claims current tenant readiness.

### Live runner

- Calls a bounded BFF Academy endpoint that invokes the application's controlled agent or existing scenario service.
- Returns a run identifier immediately and streams or polls sanitized correlated events.
- Supports running, paused-for-approval, completed, denied, failed, expired, and cancelled states.
- Does not make OAuth, PingOne Management, Authorize, MCP, A2A, or Privilege calls from browser code.

### Live observer

- Creates a bounded observation window for activity initiated by an external Personal Agent.
- Displays the protected MCP endpoint, connection requirements, and correlation instructions.
- Correlates OAuth and MCP events using server-generated run/session identifiers where supported.
- Does not claim control over the external agent or fabricate its hidden reasoning.

## Run and evidence contract

Mock, recorded, live-runner, and live-observer results normalize to this conceptual contract:

```text
AcademyRun
  id
  lessonId
  presentationMode
  executionSource
  status
  startedAt / updatedAt / completedAt
  actorSummary
    customer
    agent
    owner
    agentCategory
  frames[]
    id / sequence / phase / title / status
    provenance
    summary
    evidence[]
    productRoles[]
    correlationIds[]
  result
    outcome / decision / customerSafeSummary
  warnings[]
  resetCapabilities[]
```

Each frame owns its provenance. Allowed presentation labels are:

- `LIVE CLOUD`
- `LIVE LOCAL`
- `RECORDED`
- `MOCK`
- `UNSUPPORTED BY PINGONE`

A hybrid run can contain multiple provenance values. The overall run summary reports the lowest-confidence material provenance and explains the split.

Evidence may include redacted claims, audiences, scopes, actor chains, policy inputs and results, protocol methods, tool names, timestamps, counts, and correlation or audit identifiers. Evidence must not include raw bearer tokens, authorization codes, refresh tokens, client secrets, Privilege credentials, session cookies, or unrestricted request bodies.

## BFF boundaries and API shape

The BFF remains the browser-token custodian and owner of Academy execution.

The implementation should converge on a small bounded API rather than exposing every underlying product endpoint to the lesson UI:

```text
GET    /api/academy/readiness
GET    /api/academy/lessons/:lessonId/readiness
POST   /api/academy/runs
GET    /api/academy/runs/:runId
GET    /api/academy/runs/:runId/events
POST   /api/academy/runs/:runId/cancel
POST   /api/academy/runs/:runId/reset
```

The exact event transport may reuse the application's existing SSE/event infrastructure. The contract, correlation, redaction, and lifecycle semantics are required; a second streaming subsystem is not.

`POST /api/academy/runs` accepts an allowlisted lesson ID, scenario ID, execution source, and lesson-specific safe input. It dispatches only registered scenario adapters. It is not a general URL fetcher, arbitrary tool executor, or arbitrary agent prompt endpoint.

## Real and mock capability policy

Every lesson exposes Mock. Real is enabled only when its declared dependencies pass readiness checks.

- A missing dependency disables the Real start button and lists the exact setup or deep-dive page that resolves it.
- Real never silently falls back to Mock or Recorded.
- The presenter may switch modes explicitly without losing the explanation of why Real was unavailable.
- Optional products do not block unrelated lessons.
- PingOne unsupported capabilities use standards-correct mock frames and the `UNSUPPORTED BY PINGONE` label.
- Hybrid lessons identify live and mock frames individually.

Examples:

- **CIMD:** metadata document publishing/fetching may be live local; PingOne authorization-server registration is mocked.
- **ID-JAG:** the native standards path is mocked; the application's RFC 8693 stand-in can be run live and is labeled as a stand-in.
- **Privilege MCP:** live when its door, OAuth client, relay, and target are ready; otherwise Mock remains available.
- **DaVinci, Protect, Credentials:** live only when feature flags and product-specific readiness prove the configured path; otherwise mock or recorded with honest labels.

## Readiness

Readiness is calculated per lesson from existing service health, feature flags, tenant configuration, and optional-product status. A global Academy banner summarizes the environment; lesson checks determine whether a specific Real run can start.

Dependency states are:

- `available`
- `configured-not-verified`
- `not-configured`
- `not-enabled`
- `unsupported`
- `unavailable`

Readiness responses contain no secrets and distinguish PingOne cloud validation from local service liveness. A stale readiness result is visibly timestamped and refreshed immediately before a Real run.

## Error handling and reset

Errors are part of the lesson evidence when they arise from an expected security decision. A policy denial, expired approval, rejected replay, or audience mismatch is a completed teaching outcome, not a generic application failure.

Unexpected failures use a consistent recovery model:

- Preserve completed frames and mark the failed frame.
- Explain whether the failure happened in the Academy runner, PingOne, the agent, gateway, MCP/A2A service, Privilege, or evidence stream.
- Offer Retry only when the action is safe to repeat.
- Offer Cancel for active or paused runs.
- Keep Mock available without relabeling the failed Real run.
- Provide a deep link to the relevant configuration or inspector page.

Reset clears the Academy run and view by default. Tenant or product mutations require a lesson-specific, allowlisted restore capability and explicit confirmation. Lifecycle lessons may restore only the demo agent they changed. Privilege lessons may end only their own temporary session. Approval lessons may cancel only their own pending challenge. No lesson exposes a broad PingOne reset.

## Content and synchronization

Academy content has one canonical lesson catalog. The following consumers derive from or reference it instead of maintaining competing titles and descriptions:

- guided journey;
- standalone demo launcher;
- Academy lesson routes;
- Education Hub cards and matching panel links;
- relevant Agent, AI Products, OAuth, MCP, A2A, and Privilege navigation entries;
- use-case catalog entries;
- presenter scripts and readiness descriptions;
- static Academy preview.

Existing deep-dive pages remain authoritative for configuration and advanced inspection. Academy lessons link to them with a clear purpose. The Education Hub and Academy link to each other and to official Ping documentation and protocol specifications when a strong match exists.

## Security and privacy

- Preserve the BFF as sole browser-token custodian.
- Apply existing auth requirements to each lesson and run operation.
- Authorize run, cancel, reset, and evidence access against the current session and run ownership.
- Use allowlisted scenarios and bounded inputs.
- Redact secrets before persistence or streaming, not only before rendering.
- Bind event access to a high-entropy run identifier plus the authenticated session where applicable.
- Expire external-agent observation windows and prevent cross-session event leakage.
- Rate-limit scenario starts and external observation endpoints.
- Record who initiated lifecycle, approval, and restore operations.
- Never log raw bearer tokens or Privilege credentials in Academy evidence.

## Testing and verification

### Catalog and routing

- Every approved lesson ID resolves in guided and standalone modes.
- The guided journey and launcher consume the canonical catalog.
- Unknown lessons and modes redirect safely.
- Navigation, Education Hub, and use-case links resolve to existing routes.

### Mock and recorded execution

- Every lesson has a deterministic Mock scenario.
- Mock frames use only Mock provenance.
- Recorded fixtures pass schema and redaction validation.
- Reset returns the lesson to its initial state without external mutation.

### Live execution

- Each adapter has focused BFF tests for dispatch, correlation, cancellation, timeout, denial, failure, and redaction.
- Browser tests verify live readiness gating and ensure unavailable Real mode never auto-runs Mock.
- Long-running CIBA and external-agent flows cover pause, resume, expiration, and cancellation.
- Personal Agent observation tests prove session isolation.
- Lifecycle and Privilege reset tests prove target and session isolation.

### Presentation

- Light and dark modes pass computed-style checks.
- The movie reel, evidence drawer, controls, and links fit at 320 CSS pixels without horizontal page overflow.
- Keyboard navigation, focus order, status announcements, and reduced-motion behavior are covered.
- Presenter short and extended scripts render from the canonical lesson definition.
- External links use safe new-window attributes and internal links preserve app navigation.

### Regression verification

- UI unit suite and production build.
- Focused BFF tests for Academy routes and each touched execution adapter.
- Existing OAuth, token-exchange, session, Authorize, MCP, A2A, CIBA, Privilege, and lifecycle tests for any protected surface changed.
- Topology and authorization verification when routes or auth requirements change.
- Browser validation against `https://local.ping-devops.com:4000` for real sign-in and session behavior.

## Rollout sequence

Implementation should proceed in vertical slices so each checkpoint leaves a usable Academy:

1. Canonical catalog, naming migration, shared run schema, and Mock execution for all lessons.
2. Shared movie-reel/evidence experience, readiness, source selector, theming, and responsive behavior.
3. Real runner foundation and first complete vertical slice: OAuth Delegated Agent Access.
4. PingOne login, MCP, and Authorize real adapters.
5. CIBA and Customer Service Digital Assistant real adapters.
6. A2A and Privilege MCP real adapters.
7. Personal Agent external-observer flow and CIMD/DCR/OAuth hybrid teaching path.
8. Threat defense, lifecycle, revocation, and final evidence/product map.
9. Education Hub, navigation, use-case catalog, related-learning, static preview, and presenter-content synchronization.
10. Full cross-surface verification and local demo handoff.

## Acceptance criteria

- All thirteen lessons are reachable in guided and standalone modes.
- Every lesson can complete a deterministic Mock run without PingOne configuration.
- A configured lesson can start a Real run through the BFF and display correlated, sanitized evidence.
- The UI never silently substitutes Mock or Recorded evidence for a requested Real run.
- Personal Agent lessons describe and observe an external consumer-controlled agent; Digital Assistant lessons run the application-controlled customer-service agent.
- CIMD, ID-JAG, and other unsupported product steps are visibly and accurately labeled.
- Privilege MCP protection has both a deterministic Mock and a readiness-gated Real path.
- Guided progress and final evidence summary reflect the actual source and outcome of each lesson.
- Academy, Education Hub, use-case catalog, navigation, and related links use the approved ID4AI terminology.
- Light/dark, accessibility, mobile-width, redaction, auth, and session-isolation checks pass.

# CIAM Demo Across Agent Types

## Goal

Present one coherent CIAM story across three agent experiences without creating
separate identity architectures:

1. Personal Agent — a user-owned, durable non-human identity.
2. Digital Assistant — a user-facing conversational channel that invokes the
   user's personal agent.
3. Agent Network — a generalist agent delegating to specialist agents.

The existing PingOne-backed token, authorization, gateway, CIBA, lifecycle,
and NHI inventory paths remain the execution foundation. CIMD remains a mocked
registration facade only because the target PingOne environment does not
support CIMD/DCR.

## Demo model

The Digital Assistant is a channel, not a second independent personal-agent
identity. Its request path is:

```text
User -> CIAM session -> Digital Assistant -> Personal Agent
     -> RFC 8693 delegated token -> Agent Gateway -> PingOne Authorize -> Tool
```

The Agent Network path adds a second delegation hop:

```text
User -> Digital Assistant -> Generalist Agent -> Specialist Agent -> Tool
```

Each lane exposes the same control-plane facts in a different context: who the
human is, which agent acted, what was delegated, what policy decided, whether
step-up was required, and what lifecycle record was emitted.

## Demo lanes

### Personal Agent

Entry point: Agent Builder / Personal Agent Studio.

Narrative:

- The user creates an agent.
- PingOne creates the real `AI_AGENT` application, with `WEB_APP` fallback
  where required.
- The BFF automatically performs the mocked CIMD facade in the background.
- The UI labels CIMD as mocked and exposes the safe metadata document.
- The NHI inventory shows the owner, PingOne agent id, registration status, and
  metadata URL.
- An invocation uses the real PingOne-backed identity and RFC 8693 exchange.

Primary CIAM controls: agent registration, ownership, delegated access,
traceability, lifecycle, and revocation.

### Digital Assistant

Entry point: an assistant/chat experience.

Narrative:

- The user authenticates through the normal CIAM session.
- The assistant receives a natural-language request.
- The assistant invokes the user's already-registered personal agent.
- The BFF performs the real delegated token exchange.
- Gateway and Authorize evaluate user, agent, tool, scope, and resource
  ownership.
- A sensitive action demonstrates step-up or CIBA.
- The activity view shows user -> assistant -> agent -> tool attribution.

Primary CIAM controls: session authentication, on-behalf-of delegation,
authorization, progressive trust, CIBA, and audit.

### Agent Network

Entry point: A2A orchestration / multi-agent learning flow.

Narrative:

- The Digital Assistant or personal agent receives a complex request.
- A generalist delegates to a specialist.
- The specialist receives narrowed authority and a nested `act` chain.
- A mismatched or unregistered specialist is denied.
- Inventory and lifecycle views show both non-human identities and the
  delegation relationship.

Primary CIAM controls: agent-to-agent trust, least privilege, actor identity,
confused-deputy prevention, and end-to-end auditability.

## Existing use-case mapping

| Lane | Existing use cases |
| --- | --- |
| Personal Agent | UC38, UC1, UC17, UC-NHI1, UC-NHI2 |
| Digital Assistant | UC1, UC6, UC7, UC8, UC10, UC22, UC26 |
| Agent Network | UC2, UC2.5, UC2.6, UC2.7, UC3, UC4, UC13 |

Add explicit catalog entries for Personal Agent and Digital Assistant. Keep the
existing security use cases as reusable evidence cards rather than duplicating
them under every agent type.

## Lifecycle requirements

The CIMD facade must behave like a lifecycle component, not a one-time demo
log:

- A `pending` or `failed` registration is retryable on the next state read or
  agent invocation.
- A failed registration is shown as failed, never as completed.
- Deleting or upgrading the PingOne agent revokes/removes the corresponding
  mocked registration and association.
- Display names are sanitized before passing through the existing registry
  validator.
- Optional CIMD provenance must never make the entire PingOne inventory fail.

## Implementation boundaries

- Reuse `agentBuilderService`, `agentInvokeRoute`, A2A routes, and the existing
  token/gateway evidence surfaces.
- Add catalog metadata and navigation/entry links only where the existing UI
  has a stable pattern.
- Do not create a second assistant credential model.
- Do not claim live CIMD/DCR support; label the facade explicitly.

## Verification

- Catalog tests verify both new entries and their evidence mappings.
- Personal Agent tests verify automatic mocked registration, retry, cleanup,
  sanitization, and real-agent preservation.
- Digital Assistant tests verify that the assistant path reaches the existing
  PingOne-backed exchange and renders the attribution chain.
- UI tests verify lane labels, mocked CIMD disclosure, failure state, and links
  to inventory/lifecycle evidence.
- BFF focused tests and UI unit/build checks must pass before handoff.

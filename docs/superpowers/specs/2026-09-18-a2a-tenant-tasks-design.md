# A2A Tenant Isolation and Durable Tasks

## Goal

Make the A2A specialist surface safe for shared-organization use by issuing an explicit PingOne tenant claim, enforcing tenant ownership on Agent Cards and task state, and fixing the existing Learning Log regression.

## Scope

This change has three deliverables:

1. PingOne provisioning and runtime support for the `a2a_tenant_id` access-token claim.
2. Tenant-keyed durable A2A task state with authenticated tenant-specific Agent Cards and task polling/follow-up support.
3. A focused UI test-label correction for the existing `🪟 Learning Log` control.

Streaming and push notifications remain disabled. They are documented as future capabilities, not silently advertised as implemented.

## Identity and claim contract

- PingOne user attribute: `a2aTenantId`.
- Access-token claim: `a2a_tenant_id`.
- Mapping expression: `${user.a2aTenantId}`.
- Provisioning source: the configured PingOne environment/organization identifier, written to the demo users that participate in A2A flows.
- The claim must be present and non-empty on a tenant-aware A2A bearer. Missing or malformed values are rejected with the same generic unauthorized response used by the existing bearer gate.
- The verified issuer remains a secondary trust check; it is not the tenant isolation key once the custom claim is enabled.
- The claim is mapped on every A2A audience resource used by Exchange #1, Exchange #2, and the gateway path so delegation preserves the same tenant identity.
- Raw tenant identifiers must not be rendered in public Agent Cards or logged in bearer errors.

## Agent Card behavior

Public discovery continues to return a minimal, signed card containing only non-sensitive identity, skills, interfaces, and authentication requirements.

An authenticated card request presents the validated A2A bearer and returns a signed tenant-specific card. Its `supportedInterfaces[].tenant` value is an opaque tenant handle derived from `a2a_tenant_id`; it does not contain user PII or secrets. The card URL, signature, and JWKS trust boundary remain unchanged.

The generalist client verifies the card signature and sends the same tenant handle in the SDK request. The specialist verifies that the request tenant matches the bearer’s verified `a2a_tenant_id` before loading or creating task state.

## Durable task model

Create a dedicated LMDB store named `a2aTasks`. A task record contains:

```js
{
  taskId,
  contextId,
  tenantId,
  vertical,
  userSub,
  specialistAppKey,
  state,
  message,
  artifacts,
  createdAt,
  updatedAt,
  expiresAt
}
```

The store must:

- partition every lookup by `tenantId` and `userSub`;
- reject cross-tenant and cross-user reads, updates, and follow-ups;
- retain terminal tasks for a bounded TTL;
- support lookup by `taskId` and related work by `contextId`;
- return sanitized task data without bearer tokens, actor tokens, or raw secrets;
- use the SDK task-store boundary where possible, with a small adapter for tenant/user authorization.

The existing one-shot `message/send` flow remains valid. A specialist may return a completed task for work that is now persisted, while immediate messages remain available for stateless replies. No new LLM orchestration behavior is required for this milestone.

Add authenticated polling for the task identified by `taskId`, and allow a follow-up message to create a new task under the same `contextId`. A terminal task is immutable; refinements create a new task.

## UI behavior

The A2A learning page should continue to show public Agent Card discovery, and add a clearly labeled authenticated card/task lesson when a signed-in session is available. Existing live/replay provenance labels remain unchanged.

The Learning Log test must query the accessible name `🪟 Learning Log`, matching the project emoji allowlist and current control label.

## Error and security behavior

- Missing/invalid `a2a_tenant_id`: HTTP 401 with generic `invalid_token` semantics.
- Valid bearer with mismatched tenant handle: HTTP 403 with generic `insufficient_scope` semantics.
- Unknown task or task owned by another tenant/user: HTTP 404 to avoid disclosure.
- No bearer is accepted for tenant-specific cards or task endpoints.
- Public card responses never include tenant-specific skills, endpoints, or routing metadata.
- Existing actor-chain, audience, scope, signature, issuer, expiry, and skill allowlist checks remain in force.

## Verification

- Unit tests for claim extraction and fail-closed validation.
- Provisioning tests for the `a2aTenantId` attribute and `a2a_tenant_id` mappings.
- Store tests for tenant/user partitioning, terminal immutability, context follow-ups, TTL pruning, and secret redaction.
- A2A route tests for public vs authenticated cards, tenant mismatch, polling, and follow-ups.
- Existing A2A bearer/card/signature suites remain green.
- UI focused test for the A2A lesson and Learning Log label.
- `cd demo_api_ui && npm run test:unit && npm run build`.
- Focused BFF Jest tests for all changed server files.
- `npm run topology:verify` after generated/configured topology changes.

## Non-goals

- No live PingOne provisioning/reset is run as part of code implementation.
- No SSE streaming or webhook push implementation in this milestone.
- No change to RFC 8693 actor-chain semantics or token custody.
- No public exposure of raw tenant IDs, user IDs, or access tokens.

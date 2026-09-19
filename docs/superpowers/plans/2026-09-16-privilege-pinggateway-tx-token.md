# Privilege-First PingGateway Transaction-Token Plan

## Goal

Make the inline gateway chain explicit and consistent:

```text
caller/BFF
  Authorization: Privilege session token
  tx-token:     demo user/delegation token
        |
        v
Privilege AI Gateway
  evaluates Authorization and its own policy
  forwards tx-token unchanged
        |
        v
PingGateway / Agent Gateway
  ignores the Privilege Authorization value for user authorization
  evaluates and exchanges tx-token
  sends the exchanged token downstream
```

Privilege remains the coarse, first gate for the Agentic App, tools, approvals,
time-box, and recording. PingGateway remains the fine-grained gate for the
transaction-token identity, audience, scopes, actor chain, token exchange, and
PingOne Authorize decision.

## Current state

The repository already has `ff_mcp_gateway_privilege_first`, a Privilege
gateway session, a shared bridge secret, and bridge handling in both the Node
gateway and PingGateway. The earlier bridge called the second credential
`X-Subject-Token`; the implemented contract uses `tx-token` and keeps the two
credentials in separate roles.

The existing Privilege measurement established that custom headers survive the
Privilege backend hop unchanged and that the backend `Authorization` value is
the configured Static Token. The static token is therefore the bridge
credential; it is never decoded as the user.

## Implementation

1. Define one shared semantic contract in code comments and tests:
   - `Authorization` is the Privilege session/static bridge credential.
   - `tx-token` is the opaque transaction/delegation token forwarded by
     Privilege and consumed by the downstream gateway.
   - actor, vertical, use-case, RAR, and correlation headers retain their
     existing trust boundaries.

2. Update the BFF Privilege transport:
   - change `mcpGatewayTransport.js` to send the caller's exchanged token as
     `tx-token`;
   - keep the Privilege session token as the `Authorization` bearer;
   - prevent the legacy `X-Subject-Token` name from being sent on the new path;
   - preserve the existing missing-session error and audit ordering.

3. Update the Node gateway bridge:
   - change `privilegeBridge.ts` to read `tx-token`;
   - use the bridge secret check before JWT validation;
   - validate the transaction token with the existing audience and signature
     checks, then continue through the existing P1AZ and exchange pipeline;
   - update both HTTP and WebSocket ingress paths;
   - preserve strict handling of repeated, empty, and oversized headers and
     ignore/strip `tx-token` from non-bridge callers.

4. Update PingGateway:
   - change `privilege-bridge.groovy` to read and remove `tx-token` only after
     the bridge credential matches;
   - replace `Authorization` with the transaction token before
     `McpProtectionFilter`, introspection, and token exchange;
   - leave ordinary callers on the existing Authorization path;
   - update all route/config comments and static source checks.

5. Update operational and explanatory references:
   - `privilege/CURRENT-CONFIGURATION.md`;
   - Privilege-first flag descriptions;
   - refresh-service-env comments and gateway `.env.example` comments;
   - tests and any current plan/reference text that names
     `X-Subject-Token` as the active contract.

## Security invariants

- A valid `tx-token` must not bypass Privilege policy.
- A valid Privilege credential must not be treated as the end-user identity.
- A caller cannot assert identity by sending `tx-token` without the trusted
  bridge credential.
- No audience, expiry, signature, scope, actor-chain, P1AZ, offered-tool,
  HITL, or downstream token-custody check is relaxed.
- The transaction token and all derived tokens are never logged or returned.
- The bridge secret remains in the secrets path only.

## Verification

Run focused tests for the BFF transport, Node bridge, and PingGateway route
source; then run gateway build/tests and the repository topology/hygiene/authz
checks. In SE, verify one permitted and one denied call and confirm the audit
trail identifies Privilege and PingGateway as separate enforcement layers.

Required negative cases:

- missing or invalid Privilege credential;
- missing, repeated, oversized, expired, wrong-audience, and insufficient-scope
  `tx-token`;
- non-bridge caller attempting to use `tx-token`;
- Privilege policy denial before PingGateway is reached.

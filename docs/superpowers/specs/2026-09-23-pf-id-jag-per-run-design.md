# PingFederate ID-JAG Per-Run Design

## Goal

Make ordinary PingFederate agent calls follow the normal delegated access-token
path. Use PingFederate ID-JAG only for the explicit Enterprise-Managed MCP
Authorization demo run (UC40). Keep all demo setup scoped to that run so it
cannot change another user's provider behavior or leave the session altered.

## Current behavior

`agentMcpTokenService.resolveMcpAccessTokenWithEvents` selects the PF ID-JAG
issue-and-redeem path for every tool call whenever `OAUTH_PROVIDER` is
`pingfederate`. The PF branch returns early, before the standard RFC 8693
access-token exchange. This means ordinary tools inherit ID-JAG configuration
and failures. The PF branch also depends on a process-wide enable flag.

UC40 currently arms `ff_enterprise_managed_mcp_auth` through the shared feature
flag store. That flag affects the BFF and gateway configuration, and the UI
keeps it on until a user presses Reset. This is global state and can change
unrelated calls while a demo is running.

The gateway already distinguishes verified ID-JAG-redeemed tokens using their
issuer and audience. It forwards a token unchanged only when the audience
matches the selected backend. That behavior does not require a global feature
flag change, so the per-run change can leave the gateway configuration alone.

## Design

### Run selection

The UC40 page dispatches its demo prompt with the catalog use-case ID
`enterprise-managed-mcp-authorization`. Existing `agentRunContext` carries that
ID from the browser run into the internal BFF tool callback. The BFF treats
that validated run context as the opt-in for enterprise policy and the PF
ID-JAG exchange. Ordinary calls without that use-case ID never enter the
ID-JAG branch.

The run context is already removed when the AG-UI response closes. No feature
flag or provider setting is toggled, so completion, errors, disconnects, and
overlapping runs cannot leave a shared setting enabled.

### Provider exchange lanes

- PingOne behavior remains unchanged.
- PF ordinary calls use the existing standard RFC 8693 access-token path with
  PF-specific exchange credentials, not the ID-JAG client. The provider
  configuration must distinguish this standard exchanger from the ID-JAG
  issuer. Existing actor/delegation semantics remain in force where the PF
  deployment supports them.
- PF UC40 calls use the existing ID-JAG issue-and-redeem path and its dedicated
  PF ID-JAG client/configuration. The path remains fail-closed and does not
  fall back to PingOne or a simulated exchange.

The implementation will add the smallest PF configuration surface needed to
select the standard exchanger independently. It will document required PF
connection behavior. It will not provision or mutate a live PingFederate
environment.

### Enterprise policy and session state

For UC40, the BFF runs the existing enterprise group/population policy check
using the per-run opt-in. The policy checker will accept that explicit context
without consulting or changing `ff_enterprise_managed_mcp_auth`. Any temporary
session state created only to support auto-connect will be scoped to the
current run and restored when the run ends. Existing sessions and other
enterprise-managed use cases keep their current flag-driven behavior.

The UC40 page will launch the run directly with its use-case ID. It will no
longer arm or reset the global enterprise-managed feature flag. Its explanatory
and token-chain surfaces remain, with copy updated to describe the run-scoped
setup and cleanup.

## Security invariants

- The browser never receives user tokens, actor tokens, ID-JAGs, or exchange
  credentials; the BFF remains the token custodian.
- Ordinary PF runs cannot select the ID-JAG exchange through message text,
  tool arguments, or a user-controlled feature flag. Selection comes only from
  the validated UC40 catalog use-case context.
- ID-JAG redeemed tokens remain restricted to their verified target audience;
  gateway D-05, act-chain, and tool authorization checks remain enforced.
- No shared feature flag or process-wide provider state changes during a run.
- Exchange errors remain visible as failed token events and cannot fall back
  to PingOne or a local mock.

## Files and verification scope

Expected surfaces are the BFF token service/config and policy service, the
AG-UI run context tests, the UC40 page and its tests, plus a UC40 UI copy update
where needed. Add focused tests for ordinary PF access-token exchange,
UC40-only ID-JAG selection, run cleanup on success/failure, and unchanged
PingOne behavior. Run the touched BFF suites and UI unit/build gates. Gateway
source changes are not expected unless verification shows its existing
verified-token path does not satisfy the audience-bound forwarding contract.

## Acceptance criteria

- UC40 alone performs the ID-JAG issue-and-redeem exchange. Its token has the
  intended user subject, target audience, and requested scopes; the gateway
  forwards only to that audience's backend.
- Every other catalog demo step runs with the ordinary PF access-token exchange
  lane, and emits no ID-JAG issue or redeem event. Build a provider-parity
  matrix from the canonical use-case catalog and scope/tool topology; do not
  treat one successful ordinary tool as evidence for every vertical or step.
- User login, callback, and session behavior remain the same in PF mode with or
  without UC40. PingOne behavior remains unchanged.
- UC40 setup leaves no feature-flag changes, persistent consent/auto-connect
  state, stale run context, or other per-user state after success, failure,
  cancellation, or overlapping runs.
- Where a catalog step cannot use the ordinary PF lane because of a known PF
  product or environment limitation, name that step and reason in the matrix.
  Do not claim full PF parity until each catalog step is either covered or
  explicitly identified as unsupported with evidence.

## Open deployment requirement

The PF deployment must have distinct configuration for a standard access-token
exchanger and the ID-JAG issuer. Tests will cover both choices with mocked PF
responses. A live PF provisioning change is out of scope and must be handled
separately by the environment owner. Full real-provider parity requires a
read-only PF run through the generated non-ID-JAG demo matrix; mocked tests
alone cannot prove the external PF connections and policies are provisioned
correctly.

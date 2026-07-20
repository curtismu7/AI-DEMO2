# Agent Lifecycle Demo — Design

**Date:** 2026-07-20
**Status:** Approved (design), pending implementation plan
**Vertical:** retail
**Scope:** new standalone page + supporting backend, composed almost entirely
from existing subsystems. No changes to the existing `delegated-access-with-proof`
(UC1) use case.

## Goal

Demonstrate a full AI-agent access lifecycle in the retail vertical, as four
observable steps in one page:

1. Register an AI agent and have a user delegate account access via a scoped
   consent screen.
2. Have the agent call a protected MCP server/API using a scoped, revocable
   token.
3. Trigger human step-up approval (CIBA / push) for a sensitive action (a
   retail purchase).
4. Have the user revoke the agent from a self-service portal; show the token
   stops working immediately and an audit entry is created.

## Existing coverage (reuse, not rebuild)

Confirmed by codebase survey before this design:

| Step | Existing subsystem | Status |
|---|---|---|
| 2 | RFC 8693 token exchange + MCP gateway (`agentMcpTokenService.js`, `demo_mcp_gateway/src/auth/*`) | Fully built, reuse as-is |
| 3 | Retail `checkout` tool + amount-threshold gate → STEP_UP/HITL/CIBA (`simulatedAuthorizeService.js`, UC7/UC8/UC22 patterns, `CIBAPanel.js`, `CibaStepUpFlowPanel.jsx`) | Fully built, reuse as-is |
| 4 | Kill-switch revoke (`killSwitchService.js`), delegation hard-revoke (`routes/delegation.js` `DELETE /admin/:id/hard`), audit log (`AuditPage.js`, `auditLogService.js`) | Fully built, needs wiring only |
| 1 (partial) | `routes/delegation.js` / `services/delegationService.js` grant-revoke model | Grant/revoke skeleton exists, but grants a human delegate by email — not an agent identity |

`delegated-access-with-proof` (UC1) is a separate, unrelated read-only demo
(proves `act=` attribution via one `get_balance`/equivalent call). It has no
registration, consent, or revoke path and is not modified by this work. The
uncommitted deletions of its banking/retail goldens in the working tree are
local WIP from an unrelated golden recapture — not touched here.

No first-class "AI agent" PingOne app type exists anywhere in the repo today.
Agents that call MCP currently authenticate via pre-provisioned client-credential
apps configured in env/config, not apps created per end-user action.

## Non-goals

- Not modifying UC1 (`delegated-access-with-proof`) or its goldens.
- Not building a general dynamic client-registration framework (no DCR
  protocol, no admin UI for managing arbitrary app types) — just enough to
  create one PingOne app per registered demo agent.
- Not adding a new authz gate for retail checkout — the existing
  amount-threshold STEP_UP/HITL/CIBA classifier is reused untouched.
- Not changing the existing human-to-human delegation flow
  (`DelegationPage.js`, email-based grants) — the agent-grant path is additive
  to the same service/store, not a replacement.
- Not adding secret rotation, app-secret display/management UI, or any
  PingOne app lifecycle beyond create + (via existing kill-switch) disable.

## Architecture

### New page: `/agent-lifecycle` (retail vertical)

A standalone orchestrator page, `demo_api_ui/src/pages/AgentLifecyclePage.jsx`,
walking the four steps top-to-bottom, composing existing components:

```
Step 1  AgentRegistrationPanel (new)      → register + consent
Step 2  existing token-chain viewer       → scoped MCP call
Step 3  CIBAPanel / CibaStepUpFlowPanel   → step-up on checkout
Step 4  DelegationPage-style revoke row   → self-service revoke + audit link
```

Route added in `demo_api_ui/src/App.js`, linked from the same nav tier as
`/delegation`, `/audit`, `/ai-control-plane`.

### Step 1 — Register agent + scoped consent (new)

**Backend:** `demo_api_server/routes/agentRegistration.js`
`POST /api/agent-lifecycle/register { agentName, purpose, requestedScopes }`

- Creates a real PingOne application via the Management API, using the same
  request pattern already used by `pingOneAgentUserService.js` (worker-token
  auth, existing env-configured PingOne environment) — no new auth plumbing.
- Persists `client_id` (and secret, server-side only) alongside the grant
  record.
- Calls `delegationService.grant()` with an extended record shape (additive
  fields only, existing human-delegate records unaffected):

```js
{
  // existing fields unchanged: id, grantorId, status, createdAt, ...
  granteeType: 'agent',        // new; existing records default to 'human'
  agentName: string,
  agentClientId: string,       // PingOne app client_id
  purpose: string,
  requestedScopes: string[],
}
```

**Frontend:** `AgentRegistrationPanel.jsx` (new) — form for agent name /
purpose / scope checklist, then a consent screen adapted from
`AgentConsentModal.js`'s existing "legacy agent-access" mode (agent name +
purpose + requested scopes, Approve/Deny). Approve calls the register
endpoint above.

### Step 2 — Agent calls MCP with scoped token (reuse + wire)

`routes/agentDelegation.js` (`POST /api/agent/delegate`) already does the
RFC 8693 exchange with scope intersection against a delegation record. Change
needed: accept the new `granteeType: 'agent'` record as a valid source
(currently implicitly assumes a human-delegate record) and use its
`requestedScopes`/`agentClientId` for the exchange. No changes to the
exchange logic itself, the gateway, or `agentMcpTokenService.js`.

UI reuses the existing token-chain display component to show the issued
token and fires one retail read call (order history) through it to prove the
scoped token works.

### Step 3 — Step-up on purchase (reuse, zero backend change)

Page triggers `checkout headphones for $650` using the step-2 agent token.
This is an amount above the existing retail step-up threshold
(`AMOUNT_PRIMARY_TOOL_BY_VERTICAL.retail = 'checkout'`,
`simulatedAuthorizeService.js`), so it already routes to STEP_UP/HITL/CIBA
exactly as UC7/UC8/UC22 do today. The page embeds the existing `CIBAPanel`/
`CibaStepUpFlowPanel` to show the push-approval UI and outcome. No backend
change.

### Step 4 — Self-service revoke + immediate failure + audit (reuse, wire only)

- Page lists the step-1 agent grant using the same self-service pattern as
  `DelegationPage.js`, with a Revoke button calling the existing hard-revoke
  route (`DELETE /admin/:id/hard`), which already kills the live token via
  `killSwitchService`.
- Immediately after revoke, the page re-issues step 2's read call to show it
  now fails (401/invalid_token) — proving live revocation, not just UI state.
- Page links to `AuditPage.js` pre-filtered to this agent's grant id, showing
  the revoke event.

## Data model change

`delegationService.js` / `delegationStore.lmdb.js`: add optional fields
(`granteeType`, `agentName`, `agentClientId`, `purpose`, `requestedScopes`) to
the existing grant record shape. `granteeType` defaults to `'human'` for all
existing/legacy records — no migration needed, no behavior change for the
existing `DelegationPage.js` flow.

## Testing / verification plan

- Unit: `agentRegistration.js` route (mock PingOne app-create call), extended
  `delegationService.js` grant/list/revoke with `granteeType: 'agent'`.
- Integration: full step 1→4 sequence against the real local stack — register
  agent (real PingOne app created), scoped MCP call succeeds, checkout over
  threshold triggers real CIBA/HITL, revoke kills the token live, audit entry
  appears.
- Regression: existing `/delegation` human-delegate flow unaffected (grant,
  list, revoke all still work with `granteeType: 'human'` / legacy records
  with no `granteeType` at all). Existing retail UC7/UC8/UC22 checkout
  goldens unaffected — no changes to the checkout gating logic itself.
- Per `REGRESSION_PLAN.md` §1, this touches protected areas (token exchange,
  delegation/session data, banking-adjacent UI patterns reused in retail) —
  run `regression-guard` before implementation and again before merge; UI
  build gate required before calling any step done.

## Open questions for implementation planning

- Exact PingOne app type to create per agent (Worker vs. Native/Service) —
  needs to match what `agentDelegation.js`'s token exchange expects as an
  actor client; confirm during planning against `GatewayTokenPolicy.ts`'s
  accepted actor client types.
- Where exactly `/agent-lifecycle` sits in nav (top-level vs. under an
  "Agent" or "Admin" group) — cosmetic, decide during planning.

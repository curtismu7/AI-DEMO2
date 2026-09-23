# Workload Agents Page Design

## Goal

Give presenters one clear place to understand and run real workload-agent
scenarios. The page must make the difference between UC38 and UC44 obvious
before a run starts, and let UC38 run in every supported demo vertical.

## Current gap

Mission Control classifies UC38 and UC44 under related Personal Agent and
Digital Assistant lanes, but their titles do not explain the difference. Both
currently use `/personal-agent` and `redeem_miles`. The Personal Agent Studio
hardcodes `vertical: 'airlines'` and `useCaseId:
'workload-digital-assistant-obo'`. The BFF also applies the MFA pre-check to both
use-case IDs. As a result, the current UI and execution path do not distinguish
the stories users are expected to choose between.

## Proposed experience

Add a `/workload-agents` page with a vertical selector and two demo cards. Each
card explains its focus, displays the selected vertical's action, and has a
`Run this demo` action. Selecting a card loads that scenario's execution
surface on the same page. When a run starts, the selected UC and vertical
remain visible beside the live identity and authorization evidence. Visitors
can read and select a scenario before signing in; invoking it uses the existing
customer authentication and authorization requirements.

The page explains the shared model once: a real, pre-registered workload agent
acts for an authenticated customer; the customer remains `sub`, the agent is
`act`, and the BFF, gateway, and Authorize enforce the delegated request.

### UC38 — MFA-gated workload action

- Available across all 11 supported demo verticals.
- Requires customer MFA before the BFF delegates authority to the agent.
- Uses the existing UC7 per-vertical step-up action and prompt mapping, which
  has an action for banking and each of the other ten verticals. The selected
  vertical's own tool, scopes, and authorization policy remain authoritative.
- The registered agent executes the selected action through the existing
  gateway and Authorize path after the MFA claim is verified.
- The card's decision cue is: “Choose this to demonstrate identity step-up
  before a workload agent makes a protected change.”

### UC44 — OBO customer-data read

- Demonstrates on-behalf-of identity and customer attribution without using
  UC38's step-up write action.
- Uses the selected vertical's existing customer-owned read action, including
  the default banking read action, so the user sees actual protected data
  returned through the delegated path.
- Does not add a blanket MFA pre-check; any extra assurance requirement remains
  driven by the active vertical's authorization policy.
- Preserves policy-driven authorization; a policy can still require additional
  assurance when configured.
- The card's decision cue is: “Choose this to demonstrate who authorized the
  request, which workload agent acted, and what data it could access.”

## Routing and integration

- Mission Control's Workload Agent group links to `/workload-agents`.
- UC38 and UC44 deep links carry their use-case ID and selected vertical, for
  example `/workload-agents?useCase=UC38&vertical=banking`.
- The new page loads the reusable Personal Agent Studio with explicit run
  context. Existing `/personal-agent` and `/personal-agent/client` routes
  remain available for their existing callers.
- The BFF receives the selected vertical and canonical use-case ID. It resolves
  the action from the use-case catalog rather than accepting a tool name from
  the browser.
- UC38 and UC44 get distinct pre-check and action behavior. UC38 requires MFA
  and invokes the selected vertical's UC7 step-up action; UC44 invokes the
  selected vertical's customer-owned read action and follows OBO plus normal
  gateway/Authorize policy. Tokens remain in the BFF and are never exposed to
  the browser.

## Scope and verification

Update the Mission Control catalog, page and route, UC38/UC44 catalog entries,
the BFF invocation path, and focused tests. Regenerate any generated use-case
documentation through the owning script. Preserve existing login, token
exchange, session, gateway, and authorization invariants.

Verification will include focused UI and BFF tests, checks that every vertical
has the required UC38 write and UC44 read mapping, existing use-case catalog
and authz checks as applicable, and `cd demo_api_ui && npm run build`.

## Acceptance criteria

1. A presenter can select any of the 11 supported verticals and see which
   action UC38 and UC44 will execute before starting either demo.
2. UC38 requires MFA and runs the selected vertical's protected write through
   the real registered workload agent, token exchange, gateway, and policy
   path.
3. UC44 runs a distinct customer-owned read through the real delegated OBO
   path and shows the customer subject, agent actor, authorization decision,
   and returned result.
4. UI copy states each scenario's purpose and distinguishes the action type.
5. UC38 and UC44 never silently fall back to Airlines or to the other scenario's
   use-case ID.
6. Existing `/personal-agent` callers and non-workload-agent flows continue to
   work.

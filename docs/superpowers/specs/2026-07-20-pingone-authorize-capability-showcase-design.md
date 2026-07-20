# PingOne Authorize — Capability Showcase

## Problem

PingOne Authorize's own framing is "Contextual Runtime Authorization: uses the
PingOne Authorize engine to grant dynamic, least-privilege permissions in
real-time"
([p1az_overview.html](https://docs.pingidentity.com/pingone/authorization_using_pingone_authorize/p1az_overview.html)).
An audit of [`demo_api_server/services/pingOneAuthorizeService.js`](../../../demo_api_server/services/pingOneAuthorizeService.js)
(1359 lines, real) confirmed 8 underlying capabilities are implemented, but:

1. **Coverage is invisible.** `/pingone-authorize` shows the console (evaluate /
   policies / decisions tabs) — nothing states what the product claims and ties
   it to what actually runs. Nothing on `/use-cases` groups the PingOne
   Authorize-relevant walkthrough steps together.
2. **No precedent exists yet, only a plan.** The same problem was diagnosed for
   Agent Gateway earlier today (`docs/superpowers/specs/2026-07-20-agent-gateway-capability-showcase-design.md`,
   `worktree-agent-gateway-capability-showcase`, unmerged, spec+plan only, zero
   code). This design reuses that pattern — capability ledger config → standalone
   tour page → additive `/use-cases` strip — but generalizes the two shared
   pieces (ledger shape, `CapabilityShowcasePage`, `CapabilityCallout`) instead of
   duplicating them, since PingOne Authorize is being built first.

## Why not extend the existing `/pingone-authorize` page instead

Considered adding capability content as a new tab on the existing console page.
Rejected: `PingOneAuthorizePage.jsx` is mid-conversion to the new InspectorShell
three-pane layout in a **locked, active worktree**
(`worktree-pingone-authorize-inspector-shell`, unmerged, ahead of main by 7
commits including `docs(plans): fix 3 test-assertion bugs in the
PingOneAuthorizePage plan`). Any edit to that file here would conflict with
in-flight work. A new, separate route has zero collision surface and matches
what was just approved for Agent Gateway (its own separate
`/agent-gateway-capabilities` route, not a tab bolted onto an existing page).

## Design

### Capability Ledger — grounded in real code, 8 entries / 3 groups

New file `demo_api_ui/src/config/capabilityLedgers/pingOneAuthorizeCapabilities.js`:

```js
export const PINGONE_AUTHORIZE_GROUPS = [
  { id: 'realtime-decisioning', label: 'Real-time, contextual decisions' },
  { id: 'fine-grained-policy',  label: 'Fine-grained, attribute-driven policy' },
  { id: 'operations-audit',     label: 'Operations & audit' },
];

export const PINGONE_AUTHORIZE_CAPABILITIES = [
  {
    id: 'decision-endpoints',
    group: 'realtime-decisioning',
    title: 'Real-time decision evaluation',
    oneLiner: 'Every transaction/tool call is evaluated live against PingOne Authorize — PERMIT, DENY, or INDETERMINATE, never assumed.',
    evidence: { code: 'demo_api_server/services/pingOneAuthorizeService.js — evaluateTransaction, _postDecisionEndpoint' },
    relatedUCIds: ['UC1', 'UC6'],
  },
  {
    id: 'mcp-first-tool-gate',
    group: 'realtime-decisioning',
    title: 'Dynamic least-privilege for agent tool calls',
    oneLiner: 'The literal "Contextual Runtime Authorization" claim: DecisionContext=McpFirstTool grants/denies each MCP tool call dynamically, not via a static scope grant.',
    evidence: { code: 'demo_api_server/services/pingOneAuthorizeService.js — evaluateMcpToolDelegation' },
    relatedUCIds: ['UC1', 'UC10', 'UC13'],
  },
  {
    id: 'fail-closed-resilience',
    group: 'realtime-decisioning',
    title: 'Fail-closed resilience',
    oneLiner: 'Circuit breaker + bounded retry + effect normalization: an unrecognized or errored response collapses to DENY, never a silent PERMIT.',
    evidence: { code: 'demo_api_server/services/pingOneAuthorizeService.js — _evaluateWithBreaker, _normalizeDecision' },
    relatedUCIds: ['UC6'],
  },
  {
    id: 'trust-framework-attributes',
    group: 'fine-grained-policy',
    title: 'Attribute-driven least privilege',
    oneLiner: 'RAR amount/payee ceiling, entitlement tier, group membership, and resource-owner binding all flow into the same decision as named Trust Framework attributes.',
    evidence: { code: 'demo_api_server/services/pingOneAuthorizeService.js — evaluateMcpToolDelegation parameters' },
    relatedUCIds: ['UC14b', 'UC9', 'UC21'],
  },
  {
    id: 'policy-tree-visibility',
    group: 'fine-grained-policy',
    title: 'Policy tree visibility',
    oneLiner: 'Policy Set → Policy → Rule, fetched live or from the repo’s import snapshot when the worker token can’t reach the policy-editor API.',
    evidence: { code: 'demo_api_server/services/pingOneAuthorizeService.js — getAuthorizationPolicies, getAuthorizationPoliciesFromSnapshot' },
    relatedUCIds: ['UC6'],
  },
  {
    id: 'obligations-response-shaping',
    group: 'fine-grained-policy',
    title: 'Obligations shape the response, not just permit/deny',
    oneLiner: 'A decision can carry step-up, HITL, or consent obligations — the runtime context changes what happens next, not only whether it happens.',
    evidence: { code: 'demo_api_server/services/authorizeObligations.js — classifyObligations' },
    relatedUCIds: ['UC7', 'UC8'],
  },
  {
    id: 'recent-decisions-audit',
    group: 'operations-audit',
    title: 'Recent-decisions audit trail',
    oneLiner: 'The last 20 decisions on a configured endpoint are queryable directly from PingOne — an independent verification surface, not just app-side logs.',
    evidence: { code: 'demo_api_server/services/pingOneAuthorizeService.js — getRecentDecisions' },
    relatedUCIds: ['UC20'],
  },
  {
    id: 'coarse-fine-split',
    group: 'operations-audit',
    title: 'One engine, two enforcement points',
    oneLiner: 'The same PingOne Authorize engine backs both the Agent Gateway’s coarse allow/deny gate and this BFF’s fine-grained per-tool gate — not two competing systems.',
    evidence: { code: 'demo_mcp_gateway/src/auth/PingOneAuthorizeClient.ts (coarse) + demo_api_server/services/pingOneAuthorizeService.js evaluateMcpToolDelegation (fine)' },
    relatedUCIds: ['UC1'],
  },
];

export function allRelatedUCIds() {
  const seen = new Set();
  for (const cap of PINGONE_AUTHORIZE_CAPABILITIES) {
    for (const id of cap.relatedUCIds) seen.add(id);
  }
  return Array.from(seen);
}
```

File:line evidence is deliberately left at file/function granularity here — the
Agent Gateway design's own line-range citations drifted and were corrected
during plan-writing (see that design's "Addendum" section); precise citations
belong in the implementation plan, verified against the checked-out code at
that time, not guessed at design time.

### Shared, generic infra (built here, reusable by the Agent Gateway showcase later)

- `demo_api_ui/src/config/capabilityLedgers/` — the ledger *shape* is generic
  (`{id, group, title, oneLiner, evidence, relatedUCIds}` + a `GROUPS` array +
  an `allRelatedUCIds()` per ledger file). No PingOne-Authorize-specific typing
  leaks into the shape.
- `demo_api_ui/src/components/CapabilityShowcasePage.jsx` — generic, takes
  `{ledger, groups, title, intro}` props and renders the card grid grouped by
  `groups` order. No product-specific logic inside it.
- `demo_api_ui/src/components/CapabilityCallout.jsx` — generic, takes a
  `capability` object directly (not a ledger id / registry lookup — simplest
  contract, caller already has the object from its own ledger import) and
  renders a small link-out chip with the one-liner + a link to the tour page
  anchor. **Not wired into any existing panel in this plan** (see Out of scope)
  — built and unit-tested standalone so it's ready when a panel wants it.
- `demo_api_ui/src/pages/PingOneAuthorizeCapabilitiesPage.jsx` — thin wrapper:
  `<CapabilityShowcasePage ledger={PINGONE_AUTHORIZE_CAPABILITIES} groups={PINGONE_AUTHORIZE_GROUPS} title="PingOne Authorize" intro="Contextual Runtime Authorization ..."/>`
  at route `/pingone-authorize-capabilities`, nav entry beside the existing
  `/pingone-authorize` link.

### `/use-cases` group

Same additive-strip pattern the Agent Gateway plan specified for its own
`/use-cases` group (`UseCaseLauncherPage.js`, following the existing "Happy
Paths" / "Demo" strip precedent exactly): a new `<section>` labeled "PingOne
Authorize" rendered above the track-grouped grid, filtered by
`allRelatedUCIds()` from the new ledger. Does not reassign any use case's
existing `track` — purely additive, a UC can appear in both its original track
and this strip.

## Out of scope

- **No edits to `PingOneAuthorizePage.jsx`** or any other file touched by the
  locked `worktree-pingone-authorize-inspector-shell` branch.
- **No `CapabilityCallout` wired into any existing panel** — the component is
  built and tested, but adding it to a live panel is a separate, later change
  once the InspectorShell conversion merges and the collision risk is gone.
- **No changes to `pingOneAuthorizeService.js`, `authorizeObligations.js`, or
  any enforcement/decision logic** — this is UI + config only, reading
  already-existing behavior.
- **No retrofit of the Agent Gateway showcase onto the new shared components**
  — that stays exactly as already spec'd/planned in its own worktree; this
  design only ensures the shared pieces built here don't preclude that reuse
  later.
- **No live dual-engine toggle or synthetic decisions fired for demo purposes**
  beyond what existing UC chips already do.

## Testing

- Unit test: ledger has 8 capabilities, each with a unique id, a group in
  `PINGONE_AUTHORIZE_GROUPS`, and non-empty `relatedUCIds`; groups split 3/3/2.
- Unit test: `allRelatedUCIds()` returns a deduped union.
- Render test: `CapabilityShowcasePage` renders one card per ledger entry,
  grouped under the correct headers in `groups` order.
- Render test: `CapabilityCallout` renders a capability's one-liner + link, and
  degrades to nothing (not a crash) for a `null`/undefined capability.
- Render test: `/use-cases` shows a "PingOne Authorize" section containing the
  expected UC ids (mirrors the Agent Gateway plan's own test for its strip).
- Route test: `/pingone-authorize-capabilities` resolves and renders without
  hitting any live PingOne endpoint (ledger is static config, no fetch).

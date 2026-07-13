# Policy Rule Test Generator — Design

Date: 2026-07-12
Status: Approved (brainstorming), pending implementation plan

## Problem

The PingOne Authorize Live Policy Console (`/pingone-authorize`) shows a
read-only "Authorization Policies" tree (Policy Set → Policy → Rule) and a
separate "Evaluate" panel where the user manually builds a parameter set
(Transaction preset, MCP preset, or free-form Custom rows) and sends a live
decision request. There is no link between the two: a user who wants to see
"what does the Deny Large Transactions rule actually do?" has to already know
that Amount > 2000 triggers it and hand-build the request.

Goal: let the user click on a rule in the policy tree and get a ready-to-run
test for that specific rule, so the console teaches PingOne Authorize policy
behavior instead of requiring it to already be understood.

## Data availability

The policy tree rendered by this console is sourced from
`getAuthorizationPoliciesFromSnapshot()` in
`demo_api_server/services/pingOneAuthorizeService.js`, which reads
`snapshots/Super_Banking_Transaction_Authorization_P1AZ.snapshot.json`. This is
the **only** source in practice: the live `GET /authorizationPolicies` call
(`getAuthorizationPolicies()`) 403s for worker (client_credentials) tokens on
this deployment regardless of role/license (documented in an existing code
comment), so the route always falls back to the snapshot. This design targets
the snapshot shape only.

The snapshot is a flat array of entries (`PolicySet`, `Policy`, `Rule`,
`CONDITION`, `ATTRIBUTE`, plus package framing entries) linked by id
references. Each `Rule` entry's `effectSettings.condition` is a boolean tree of
`and` / `or` / `not` / `reference` (→ a `CONDITION` entry) / `comparison`
nodes. Every comparison found in the current snapshot uses one of exactly
three operators — `GreaterThan`, `Equals`, `NotEquals` — against a `constant`
value, on an attribute resolved via `ATTRIBUTE` entries (`Amount`,
`TransactionType`, `UserId`, `Acr`, `ToolName`, `TokenAudience`, `ActClientId`,
`NestedActClientId`, `ActChainDepth`, `HitlApproved`, `UserTier`,
`RequiredGroup`, `InRequiredGroup`, etc). Two rules ("Permit Standard
Transactions", "MCP Permit Valid Tool Invocation") have an empty/always-true
condition — there is nothing meaningful to trigger or avoid for these.

This is a small, fully-enumerated grammar — no general-purpose policy language
support is being built, just a solver over the operators/combinators actually
present.

## Design

### 1. Backend: condition-tree solver

**File:** `demo_api_server/services/pingOneAuthorizeService.js`, in/near
`getAuthorizationPoliciesFromSnapshot()`.

Add a solver that, for a given condition-tree node, can produce a parameter
override set that makes the node true (`satisfy`) or false (`violate`):

- **comparison leaf** `attr OP const`:
  - `GreaterThan`: satisfy → `const + 1` (numeric constants only, matches
    Amount/ActChainDepth usage); violate → `const`.
  - `Equals`: satisfy → `const`; violate → a fixed sentinel value distinct
    from `const` (reuse the attribute's existing preset default when that
    default itself differs from `const`, else a placeholder like
    `"__not_" + const`).
  - `NotEquals`: satisfy → the same distinct-sentinel logic as Equals-violate;
    violate → `const`.
- **`and(children)`**: satisfy → satisfy every child, merging override sets
  (last-write-wins on key collision, none expected in this snapshot); violate
  → violate exactly one child (the first leaf comparison encountered via a
  depth-first walk — keeps the "avoid" case a minimal, single-attribute diff
  from the "trigger" case wherever possible).
- **`or(children)`**: satisfy → satisfy the first child only; violate →
  violate every child.
- **`not(child)`**: satisfy → violate(child); violate → satisfy(child).
- **`reference(id)`**: resolve the id against the snapshot's `CONDITION`
  entries and recurse with the same satisfy/violate call — a reference is
  transparent, not a negation.
- **empty (`{}`)**: no-op; caller (see below) treats the whole rule as
  "always applies", producing `testCases: null`.

Each `Rule` node's `effectSettings.condition` (falling back to `.condition`
for parity, though observed data always populates `effectSettings.condition`)
is fed through `satisfy()` and `violate()` once each, producing two override
maps: `{ AttributeName: value }`.

### 2. Backend: preset/domain selection + base defaults

Given the set of attribute names a rule's condition touches, classify the rule
into one of three domains by checking against the existing preset field sets
already defined in `PingOneAuthorizePage.jsx`:

- **`transaction`** domain: touches only `Amount`, `TransactionType`,
  `UserId`, `Acr`.
- **`mcp`** domain: touches only `ToolName`, `TokenAudience`, `ActClientId`,
  `UserId`, `HitlApproved`, `McpResourceUri`, `DecisionContext`.
- **`custom`** domain: touches anything else (`UserTier`, `RequiredGroup`,
  `InRequiredGroup`, `ActChainDepth`, `NestedActClientId`, ...) — these are the
  UC9/UC21/A2A rules, which are "inert unless the BFF explicitly sends the
  attribute" per their own descriptions in the snapshot.

Base parameter values (before the rule's own overrides are applied) mirror the
existing tuned-to-PERMIT defaults already hardcoded in `EvaluatePanel`'s
component state (`amount`, `txType`, `acr`, `userId` for the `transaction`
preset; `toolName`, `tokenAudience`, `actClientId`, `mcpResourceUri`,
`hitlApproved`, `userId` for the `mcp` preset) — duplicated as a small constant
object server-side (`PRESET_BASE_DEFAULTS`) so the backend doesn't need to
import frontend state. For `custom`-domain rules, base off the `mcp` defaults
(broadest realistic identity/actor context) plus explicit inert baselines for
the extra attributes: `UserTier: 'PrivateBanking'`, `RequiredGroup: 'none'`,
`InRequiredGroup: true`, `ActChainDepth: 1`, `NestedActClientId: ''` — chosen
so none of the tier/group/A2A-generalist deny rules fire by default, matching
each rule's own "inert unless..." documentation.

The rule's `satisfy()`/`violate()` override map is merged on top of this base
to produce the final `parameters` object for `trigger` / `avoid`.

### 3. Backend: node shape

`getAuthorizationPoliciesFromSnapshot()`'s `toNode()` gains, for `Rule` nodes
only:

```js
testCases: hasCondition
  ? {
      trigger: { preset: domain, parameters: {...} },
      avoid:   { preset: domain, parameters: {...} },
    }
  : null
```

`hasCondition` is false for the two always-true rules — `testCases` is `null`
and the frontend renders no buttons for them.

### 4. Frontend: `PolicyNode` (PingOneAuthorizePage.jsx)

- `PingOneAuthorizePage` passes a callback `onTestRule(testCase)` down through
  `PoliciesCard` → `PolicyNode`.
- When `node.kind === 'RULE' && node.testCases`, render two small inline text
  actions next to the rule name/effect badge: **"Trigger →"** and **"Avoid
  →"**, styled like the existing `iconBtn` link style already used elsewhere
  on this page.
- Clicking either calls `onTestRule({ ruleName: node.name, case: 'trigger'|'avoid', ...node.testCases[case] })`.

### 5. Frontend: page-level wiring

- `PingOneAuthorizePage` holds a new bit of state,
  `pendingTest: { ruleName, case, preset, parameters } | null`.
- `onTestRule` sets `pendingTest` and scrolls the Evaluate card into view
  (`document.getElementById('evaluate-card').scrollIntoView({behavior:'smooth'})`
  — add that id to the existing Evaluate `S.card` div).
- `EvaluatePanel` gains a `pendingTest` prop (in addition to its existing
  `endpointId`/`autoPreset`/`policies` props). A `useEffect` keyed on
  `pendingTest` applies it: sets `preset` to `pendingTest.preset`, and sets the
  matching preset's field state (`amount`/`txType`/`acr`/`userId` for
  `transaction`; `toolName`/`tokenAudience`/`actClientId`/`hitlApproved`/etc
  for `mcp`; `customRows` for `custom`, built as `Object.entries(parameters)`).
  Does **not** call `run()` — the user still clicks the existing "Evaluate
  (live)" button, per the approved design.
- A small label appears above the preset tabs when `pendingTest` is set:
  `Testing: <ruleName> — <trigger|avoid>`, clearable by switching presets
  manually or picking another rule/case.

### 6. Out of scope

- Live (non-snapshot) policy API shape — unreachable today (403), not handled.
- Policy Set / Policy-level buttons — only leaf Rules have condition data.
- Auto-running the evaluation on click — explicitly rejected during
  brainstorming in favor of prefill + manual "Evaluate (live)".
- Any change to how the actual decision endpoints combine/evaluate rules —
  this only affects what the console's Evaluate panel is prefilled with.

## Testing

- Unit tests for the solver (`satisfy`/`violate`) against each condition
  shape actually present in the snapshot (`GreaterThan`, `Equals`,
  `NotEquals`, nested `and`/`or`/`not`, `reference` resolution, empty
  condition) — table-driven, asserting the produced parameter overrides.
- A snapshot-level test that calls `getAuthorizationPoliciesFromSnapshot()`
  and asserts every non-empty-condition Rule gets a `testCases` object with
  both `trigger` and `avoid` populated, and that the two always-true rules get
  `testCases: null`.
- One frontend test (existing UI test patterns for this page, if any) or
  manual verification: clicking "Trigger →" on "Deny Large Transactions"
  switches to the Transaction preset with `Amount` > 2000 and everything else
  at defaults; "Avoid →" switches to `Amount` at/below 2000.

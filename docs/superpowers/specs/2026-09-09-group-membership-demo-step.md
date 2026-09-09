# Group-membership demo step — UC9 / UC21 across every vertical

**Status:** spec, not implemented
**Date:** 2026-09-09
**Origin:** decision **D1** in the 2026-09-08 live UI pass. UC9 and UC21 declare
outcomes their triggers cannot produce, and the two cards are inconsistent
across verticals.

---

## 1. Problem

`UC9` (Group / entitlement check, `DENY`) and `UC21` (Entitlement-tiered
capability, `PERMIT`) both trigger on a dollar amount — banking
`transfer $600 from checking to savings`, sporting-goods
`extend my rental $600`. Neither can produce its declared outcome:

- **The amount decides before entitlement does.** `confirm_threshold_usd=250`
  and `mfa_threshold_usd=500`, so `$600` raises a consent or step-up gate and
  the group check never gets to be the reason for anything. UC7, UC9, UC21 and
  UC27 share that one phrase while declaring STEP_UP / DENY / PERMIT /
  HITL_REQUIRED — only one of the four can ever be right.
- **UC9's denial is unreachable.** Group enforcement works, but every vertical
  manifest puts `demoUser` in `privileged`, so the policy permits. There is no
  amount and no account that denies this user.
- **Moving UC21 under the threshold breaks UC22.** Measured 2026-09-09: at
  `$200` UC21 completes a payment, and healthcare and government seed exactly
  **one** outstanding bill/fee which UC22 already consumes. `useCases.chipCompletes`
  catches it (`government/UC22: "pay the $150 fee" -> { error: "no outstanding fees" }`).

Since the proof strip renders a verdict on every run, both cards now display a
standing `mismatch` in front of the room — the surface working correctly and
reporting that the card's claim does not match reality.

## 2. Goal

One mechanism, identical in shape in all 12 eligible verticals, where the
**group** is the thing that decides — reachable in both directions from a chip.

- UC21: user **in** the group -> **PERMIT**
- UC9: user **out** of the group -> **DENY**

No dollar amount is involved in either, which is what removes the threshold
collisions and the UC22 seed-state collision at the same time.

## 3. What already exists — leverage, do not change

The 2026-09-09 survey found this already built and working. **This spec adds no
new endpoint, no manifest change, and no change to the `/group-policy` board.**

| Piece | Contract | Notes |
|---|---|---|
| `POST /api/groups/membership/toggle` | body `{ inGroup: boolean, category?: string='privileged' }`; vertical from session | Real PingOne write via `pingOneGroupMembershipService.setUserGroupMembership`. **Reads membership back from PingOne** rather than echoing the request. Returns `{ verticalId, username, groupName, category, requested, changed, inGroup, groups, userTier, verified }`. Errors: `user_not_toggleable` (403), `group_not_found` (404), `live_lookup_unavailable` (503, worker creds absent), `unknown_group_category` (400), `unknown_vertical` (404). |
| `GET /api/groups/membership` | — | Current membership for the session user. |
| `GET /api/groups/decision-board` | — | One live Authorize decision per vertical for that vertical's group-gated tool. Deliberately not manifest-derived. |
| `GroupMembershipToggle` (component) | — | Already used by `/group-policy`. |
| `groupPolicy.js` | `requiredGroupForTool(tool, vertical)`, `groupNameForCategory`, `resolveUserTier`, `getTierDefinitions`, `isEnabled(configStore)` | Enforcement gated by `ff_authorize_group_policy` (default OFF). |
| `demoStepPrerequisites.js` | `checkChipPrerequisites(uc, vertical, cfg)`, `requiredFlagsForUseCase(uc)` | Server-side SoT for what a chip needs armed. Mirrored client-side by `demo_api_ui/src/utils/requiredDemoFlags.js`. |

**Boundary to respect.** `GroupPolicyBoardPage`'s docstring states the board's
purpose: *"The point of the page is the transition, not the table: flip the
toggle and every row moves together. No single use-case chip can show that,
because a chip is one vertical and one decision."* This spec does not try to
make a chip do the board's job. The chip proves one vertical honestly; the board
proves they move together.

### 3.1 The per-vertical tool already exists

Every eligible vertical manifest already declares exactly one group-restricted
tool, with `demoUser` in `privileged`. This is the map the chips use — no new
data:

| vertical | restricted tool | vertical | restricted tool |
|---|---|---|---|
| banking | `get_sensitive_account_details` | manufacturing | `sensitive_supplier_contract` |
| sporting-goods | `sensitive_membership_details` | government | `sensitive_tax_record` |
| healthcare | `sensitive_patient_records` | university | `sensitive_student_finance` |
| retail | `sensitive_order_history` | workforce | `sensitive_payroll_details` |
| abercrombie-fitch | `sensitive_order_history` | admin | `sensitive_customer_identity` |
| investment | `sensitive_holdings` | airlines | `sensitive_airline_bookings` (also has `sensitive_passenger_record` — pick the first, see §7.2) |

**Not eligible (3):** `admin-console` and `oauth-teaching` have no `groups`
block; `pingone-admin` has an empty `restrictedTools` and `demoUser` is not in
`privileged`. These must be declared N/A the same way `REQUEST_ONLY_NOT_APPLICABLE`
already does it, not silently skipped.

Banking additionally has a `premiumTier` category. UC21 is literally
"entitlement-tiered capability", so banking MAY use `premiumTier` while the
other 11 use `privileged` — see the open question in §7.1.

## 4. Design — a declarative lever, armed through the existing endpoint

Mirrors `stepUpMethod`, which is the precedent for "one catalog field that
changes what a use case does" (`getUseCaseStepUpMethod`, `useCases.js:2056`,
consumed by `mcpToolAuthorizationService` and `mcpToolPipeline`).

### 4.1 Catalog field

```js
// demo_api_server/config/useCases.js — UC21
requiresGroup: 'in',
// UC9
requiresGroup: 'out',
```

Resolved by a new accessor beside the existing one:

```js
/** @returns {'in'|'out'|null} */
function getUseCaseGroupRequirement(slug) {
  if (!slug || typeof slug !== 'string') return null;
  const uc = USE_CASES.find((u) => u.useCaseId === slug);
  return (uc && (uc.requiresGroup === 'in' || uc.requiresGroup === 'out'))
    ? uc.requiresGroup
    : null;
}
```

Exported from `useCases.js` alongside `getUseCaseStepUpMethod`.

### 4.2 Arming, at Run time

The launcher already arms feature flags before firing a chip
(`requiredFlagsForUseCase` -> `requiredDemoFlags.js`). Group membership arms the
same way, one extra pre-Run step:

1. Read `getUseCaseGroupRequirement(useCaseId)`. Null -> nothing to do (every
   other use case is unaffected).
2. `POST /api/groups/membership/toggle` with `{ inGroup: requirement === 'in' }`.
3. **Gate on the response's `verified` and `inGroup` fields, not on HTTP 200.**
   The endpoint reads back from PingOne precisely so a write that did nothing
   cannot report success; the caller must honour that. If `verified !== true`,
   abort the run and surface why rather than firing a chip whose verdict would
   be meaningless.
4. Fire the chip.

`503 live_lookup_unavailable` (no worker credentials) is an expected
environment state, not a bug: the chip must refuse to run and say so, because
without the toggle the run cannot demonstrate what it claims.

### 4.3 Restore

Leaving `demoUser` out of `privileged` is not local to this use case:

- `sensitive_membership_details` is also UC2's and UC37's tool — a stranded
  `out` state breaks A2A cards.
- `/group-policy` turns red for everyone else on the shared cluster.

So an `out` run **must** restore membership afterwards. This is the same class
of problem as decision **D4** (running a flag-gated use case arms flags
globally) and should be solved the same way, whatever is chosen there.

### 4.4 Prerequisite reporting

`checkChipPrerequisites(uc, vertical, cfg)` gains one more thing it reports:
whether the group requirement can be satisfied in this environment
(`ff_authorize_group_policy` on, worker credentials present, vertical has the
category). Client mirror `requiredDemoFlags.js` stays in sync — the comment in
`requiredFlagsForUseCase` already declares that contract.

Note `ff_authorize_group_policy` defaults **OFF**, and UC9's `maturity` is
already `flag:ff_authorize_group_policy`, so it is armed by the existing path.
UC21's maturity is `works` and would need the same flag added.

## 5. What changes, file by file

| File | Change |
|---|---|
| `demo_api_server/config/useCases.js` | `requiresGroup` on UC9/UC21; `getUseCaseGroupRequirement` + export; retarget both to the per-vertical restricted tool; drop the amount from both triggers; per-vertical `primaryTool` entries; mark the 3 ineligible verticals N/A |
| `demo_api_server/services/demoStepPrerequisites.js` | report group-requirement satisfiability |
| `demo_api_ui/src/utils/requiredDemoFlags.js` | mirror, per its stated sync contract |
| launcher Run path (`UseCaseLauncherPage` / `AIAgent` arming) | the §4.2 pre-Run toggle + `verified` gate + restore |
| `demo_api_server/tests/useCases.primaryTool.test.js` | per-vertical entries are gated here (129 checks) |
| `demo_api_server/tests/stepVerification.<vertical>.test.js` | 12 files already exist — one per vertical, which is exactly the cross-vertical consistency gate this needs |

**No change to:** the toggle endpoint, `groupPolicy.js`, any manifest,
`GroupPolicyBoardPage`, or the board API.

## 6. Why this fixes what it claims

- UC21 PERMITs because the user is in the group, with **no amount**, so it
  cannot trip a threshold gate and cannot consume healthcare/government's single
  seeded bill.
- UC9 DENYs because the user was really removed from the group in PingOne —
  the decision is real, not declared. It stays honest under the strengthened
  `computeVerdict` shipped in PR #3013, which demotes any verdict whose dispatch
  errored unless the use case is deny-like.
- All 12 verticals get the same shape because each manifest already names its own
  restricted tool.

## 7. Open questions — decide before implementing

### 7.1 Does banking use `premiumTier` for UC21?
It is the only vertical with a tier group, and UC21's title is
"entitlement-tiered capability". Using it is more faithful to the card and makes
banking the one vertical that differs. Using `privileged` everywhere is
uniform and simpler. **Recommendation: `privileged` everywhere for v1**, with
`premiumTier` a later refinement, because a single shape across 12 verticals is
the thing being asked for.

### 7.2 Airlines has two restricted tools
`sensitive_airline_bookings` and `sensitive_passenger_record`. Pick one for the
chip. **Recommendation: `sensitive_airline_bookings`.**

### 7.3 Restore policy
Automatic after the run, or presenter-driven with a visible "restore
membership" affordance? Automatic is safer on shared infrastructure; manual
makes the transition visible, which is the teaching point. **Recommendation:
automatic restore, plus the existing `GroupMembershipToggle` on the page for a
presenter who wants to drive it by hand.** Tie-break with D4.

### 7.4 Does UC9 keep `expectedOutcome: 'DENY'`?
Yes under this design — the denial becomes reachable, so no re-scoping is
needed. This supersedes the "re-scope UC9 like UC19/UC39" suggestion in PR #3015,
which was written before the toggle endpoint was found.

## 8. Verification

- 12 `stepVerification.<vertical>.test.js` suites — the cross-vertical gate.
- `useCases.primaryTool.test.js` — per-vertical primaryTool contract (129 checks).
- `useCases.chipCompletes.test.js` — the suite that caught the UC22 seed
  collision; must stay green, and is the specific proof that removing the amount
  fixed it.
- `useCaseConformance`, `useCaseMatchReachability`, `scenarioDistinctness`,
  `verticalChipCoverage`, `secondaryTools`.
- Live: run UC21 then UC9 in Super Sports, confirm PERMIT then DENY, confirm
  membership is restored afterwards, and confirm `/group-policy` is unchanged.

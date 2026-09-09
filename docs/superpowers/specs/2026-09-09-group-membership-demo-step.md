# Group-membership demo step — UC9 / UC21 across every vertical

**Status:** spec, decisions settled 2026-09-09, not implemented
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

## 3. What already exists — leverage; and the one thing that does change

The 2026-09-09 survey found this already built and working. **This spec adds no
new endpoint and no change to the `/group-policy` board.** It DOES change every
eligible manifest — see §3.2 — which is a deliberate, decided departure from the
original "change nothing" framing.

| Piece | Contract | Notes |
|---|---|---|
| `POST /api/groups/membership/toggle` | body `{ inGroup: boolean, category?: string='privileged' }`; vertical from session | Real PingOne write via `pingOneGroupMembershipService.setUserGroupMembership`. **Reads membership back from PingOne** rather than echoing the request. Returns `{ verticalId, username, groupName, category, requested, changed, inGroup, groups, userTier, verified }`. Errors: `user_not_toggleable` (403), `group_not_found` (404), `live_lookup_unavailable` (503, worker creds absent), `unknown_group_category` (400), `unknown_vertical` (404). |
| `GET /api/groups/membership` | — | Current membership for the session user. |
| `POST /api/groups/provision` (admin) | body `{ verticalId? }` | `provisionVerticalGroups` -> `provisionVerticalGroupsFromManifest`. Creates the vertical-scoped PingOne groups and seeds demo-user membership **straight from the manifests, with no full bootstrap**. This is what makes §3.2 cheap. |
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
| investment | `sensitive_holdings` | airlines | `sensitive_passenger_record` (decided — it also has `sensitive_airline_bookings`) |

**Not eligible (3):** `admin-console` and `oauth-teaching` have no `groups`
block; `pingone-admin` has an empty `restrictedTools` and `demoUser` is not in
`privileged`. These must be declared N/A the same way `REQUEST_ONLY_NOT_APPLICABLE`
already does it, not silently skipped.

### 3.2 Manifest change — `premiumTier` becomes the gate

**Decided 2026-09-09.** Banking is currently the only vertical with a
`premiumTier` category. Every eligible vertical gains one, and **the sensitive
tool above is re-pointed to require `premiumTier` instead of `privileged`**, so
the tier is what actually decides rather than something the card merely narrates.

Per eligible manifest:

1. Add a `premiumTier` entry to `groups.categories` (banking's is the template).
2. Change that vertical's `restrictedTools` value from `privileged` to `premiumTier`.
3. Seed `demoUser` into `premiumTier` in `groups.userMemberships`.
4. Run `POST /api/groups/provision` to create the groups in PingOne.

⚠️ **Step 3 is load-bearing, not housekeeping.** The sensitive tool is shared:
`sensitive_membership_details` is also UC2's and UC37's `primaryTool`. If the
tool starts requiring `premiumTier` and `demoUser` is not seeded into it, those
A2A cards begin denying — a regression well outside this use case. The same
applies in every vertical that reuses its sensitive tool elsewhere.

`privileged` is left in place and untouched; it simply stops being this tool's
gate. Nothing else that reads it changes.

## 4. Design — a declarative lever, armed through the existing endpoint

Mirrors `stepUpMethod`, which is the precedent for "one catalog field that
changes what a use case does" (`getUseCaseStepUpMethod`, `useCases.js:2056`,
consumed by `mcpToolAuthorizationService` and `mcpToolPipeline`).

### 4.1 Catalog field

```js
// demo_api_server/config/useCases.js — UC21
requiresGroup: 'in',      // category: premiumTier (see §3.2)
// UC9
requiresGroup: 'out',
```

Both use the `premiumTier` category, so one field is enough — the category comes
from the tool's `restrictedTools` entry rather than being restated per use case.

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
2. `POST /api/groups/membership/toggle` with `{ inGroup: requirement === 'in', category: 'premiumTier' }`.
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

**Decided 2026-09-09: automatic restore after the run, plus a
restore-on-session-end backstop.** The backstop is the part that matters — an
interrupted or abandoned run (browser closed, session expired, error thrown
between toggle and restore) is exactly how a shared cluster gets stranded in a
denied state, and the post-run restore alone does not cover it. Restore is
therefore idempotent and safe to run when membership is already correct.

Same class of problem as decision **D4** (running a flag-gated use case arms
flags globally); solving it here does not solve it there.

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
| `demo_api_server/config/useCases.js` | `requiresGroup` on UC9/UC21; `getUseCaseGroupRequirement` + export; retarget both to the per-vertical restricted tool; drop the amount from both triggers; per-vertical `primaryTool` entries; UC9 `expectedOutcome: 'DENY_403'`; mark the 3 ineligible verticals N/A |
| `demo_api_server/config/verticals/<v>/manifest.json` (12 files) | add `premiumTier` category, re-point `restrictedTools` to it, seed `demoUser` into it (§3.2) |
| `demo_api_server/services/demoStepPrerequisites.js` | report group-requirement satisfiability |
| `demo_api_ui/src/utils/requiredDemoFlags.js` | mirror, per its stated sync contract |
| launcher Run path (`UseCaseLauncherPage` / `AIAgent` arming) | the §4.2 pre-Run toggle + `verified` gate + restore |
| `demo_api_server/tests/useCases.primaryTool.test.js` | per-vertical entries are gated here (129 checks) |
| `demo_api_server/tests/stepVerification.<vertical>.test.js` | 12 files already exist — one per vertical, which is exactly the cross-vertical consistency gate this needs |

**No change to:** the toggle endpoint, `groupPolicy.js`, `GroupPolicyBoardPage`,
or the board API. Manifests DO change (§3.2) — that is decision #1/#5, not an
oversight. `privileged` stays defined and untouched; it just stops being the
sensitive tool's gate.

**Operational step, not a code change:** `POST /api/groups/provision` must run
after the manifest edits to create the new groups in PingOne.

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

## 7. Decisions — settled 2026-09-09

All five were put to the user with options and recommendations; the user chose
against the recommendation in every case, and two of those recommendations were
based on claims that turned out to be **wrong**. Both corrections are recorded
here because they are the reason the decisions are safe.

| # | Decision | Notes |
|---|---|---|
| 1 | **Add `premiumTier` to every eligible vertical and make it the gate** (§3.2) | Recommendation had been `privileged` everywhere, on the grounds that adding a group "needs a bootstrap run". **That was wrong** — `POST /api/groups/provision` provisions vertical groups straight from the manifests with no bootstrap, so the uniform-and-faithful option is also the cheap one. |
| 2 | **Airlines uses `sensitive_passenger_record`** | The more sensitive record of the two, and the stronger story for an identity audience. |
| 3 | **Automatic restore + restore-on-session-end backstop** (§4.3) | The backstop covers the interrupted run, which post-run restore alone does not. |
| 4 | **UC9 declares `DENY_403`** | Recommendation had been generic `DENY`, warning that a specific code could re-create D1 in miniature. **That was wrong** — `EXPECTED_OUTCOME_FAMILY` maps `DENY`/`DENY_401`/`DENY_403`/`DENY_429`/`DENY_503` all to the family `'DENY'`, and `computeVerdict` compares families, not codes. `DENY_403` is behaviourally identical to `DENY` and strictly more informative to a reader. |
| 5 | **Re-point the sensitive tool to `premiumTier`** (§3.2) | Follows from #1: with one shared tool, UC9 and UC21 cannot gate on different categories, so the tier has to be the tool's actual requirement for UC21's claim to be proof rather than prose. |

## 8. Verification

There are **16** `stepVerification.*.test.js` suites, of which 11 are per-vertical
(`airlines`, `banking`, `government`, `healthcare`, `investment`, `manufacturing`,
`pingone-admin`, `retail`, `sporting-goods`, `university`, `workforce`) and 5 are
cross-cutting. Two of the cross-cutting ones bear directly on this change and
must be read before touching either trigger:

- **`stepVerification.amountGateBand.test.js`** — asserts behaviour per amount
  band. UC9/UC21 are losing their amounts entirely, so this suite is the one
  most likely to encode an assumption about them.
- **`stepVerification.uc22.test.js`** — UC22 has its own suite, and UC22 is the
  case the reverted `$200` attempt broke.

Note `abercrombie-fitch` and `admin` are eligible verticals with **no**
`stepVerification` suite of their own; they are covered only by the catalog-wide
suites. Adding coverage for them is optional and out of scope here — but do not
mistake their silence for a pass.

Also run:

- `useCases.primaryTool.test.js` — per-vertical primaryTool contract (129 checks).
- `useCases.chipCompletes.test.js` — the suite that caught the UC22 seed
  collision; must stay green, and is the specific proof that removing the amount
  fixed it.
- `useCaseConformance`, `useCaseMatchReachability`, `scenarioDistinctness`,
  `verticalChipCoverage`, `secondaryTools`.
- **UC2 and UC37 regression check — the highest-risk consequence of §3.2.** They
  share `sensitive_membership_details` with UC9/UC21. Re-pointing that tool to
  `premiumTier` without seeding `demoUser` into the new group makes both A2A
  cards deny. Run them explicitly, in a vertical whose manifest was changed,
  before believing this is done.
- Live: run UC21 then UC9 in Super Sports, confirm PERMIT then DENY_403, confirm
  membership is restored afterwards, confirm the restore also fires when the run
  is abandoned mid-way, and confirm `/group-policy` still reads correctly.
- `POST /api/groups/provision` must be run against the changed manifests before
  any live check, or every re-pointed tool denies for want of a group that does
  not exist yet.

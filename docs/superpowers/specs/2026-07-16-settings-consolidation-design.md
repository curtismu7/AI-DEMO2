# Settings consolidation (step-up threshold + ACR value) — Design

**Date:** 2026-07-16
**Status:** Approved in brainstorming; awaiting written-spec review
**Related:** `project-process-review-2026-07` memory note ("10+ duplicate token mints"
class of finding); `ISSUES_REPORT_7_15.md` item 13 (`/settings` — "settings all
over the place")

## Problem

The demo's step-up MFA config is writable from more places than it should be,
and not all of those places are duplicates for the same reason:

- **`SecuritySettings.js`** (`/settings`) — writes the **global default** for
  `stepUpAmountThreshold` and `stepUpAcrValue` via `PUT /api/admin/settings` →
  `runtimeSettings.js`.
- **`DemoSetupPanel.js`** (`/configure` → Demo Data tab) — writes a genuine
  **per-user override** for `stepUpAmountThreshold` via `demoScenarioStore.js`
  (LMDB-backed, keyed by `userId`, falls back to the global default when
  unset). This is a real, distinct feature — not an accident.
- **`ThresholdControls.js`** — a floating widget mounted globally on
  `TopNav.js` and `Dashboard.js` — *also* writes the **global default**
  (`POST /api/config/thresholds` → `configStore.mfa_threshold_usd`, mirrored
  into `runtimeSettings.stepUpAmountThreshold`). This is the actual
  duplicate: a second, redundant global writer with its own persistence path,
  reachable from every dashboard page.
- **`stepUpAcrValue`** additionally has the literal string `'Multi_Factor'`
  hardcoded independently in `SetupPage.js`, `SetupWizardTab.js`, and
  `SetupWizard.js` (6 occurrences total across the 3 files — 2 initial-state
  literals, 1 `.env` template fallback, 2 JSX placeholder attributes, plus
  `SetupWizard.js`'s dual controlled/uncontrolled `internalCreds` default)
  — one-time initial-setup-wizard code, not a live runtime writer, but still
  multiple places that can drift from each other and from
  `runtimeSettings.js`'s own default.

An operator using `ThresholdControls` on one dashboard, `DemoSetupPanel` on
another, and `SecuritySettings` on a third has no way to tell which one is
authoritative, and the setup wizard's copy of the ACR default can silently go
stale relative to the others.

**Second, more serious problem found while re-verifying the design (2026-07-16):**
"the step-up threshold" is actually **two disconnected values** in the
backend, not one:

- `runtimeSettings.stepUpAmountThreshold` — written by all three UIs above
  (directly by `SecuritySettings`/`ThresholdControls`; mirrored by
  `POST /api/config/thresholds`). Read by `mcpLocalTools.js`'s
  `checkLocalStepUp()` — the step-up gate for the **local MCP tool path**
  (the AI agent calling a tool directly).
- `configStore`'s `confirm_stepup_threshold_usd` key — read by
  `transactionConsentChallenge.js`'s local `getStepUpThreshold()`, which
  gates the **real browser-based transfer/HITL consent flow** when
  `hitl_consent_mfa_mode` is `'device_picker'`. **No UI writes this key at
  all.** It always falls back to a hardcoded `500` from
  `scopeTopology.stepUpThresholdUsd()`, silently ignoring whatever any
  settings UI has set. (Not reachable in the default `mfaMode: 'onetime'`
  configuration — only matters once `device_picker` mode is selected — but
  silent when it does matter.)

So today, changing "the" step-up threshold in any UI reliably changes local
MCP tool behavior, but never changes the `device_picker` HITL flow's actual
gate. This is the concrete version of "does adjusting the value actually
change what the app does?" — the answer for one real flow was no.

## Decisions (from brainstorming)

| Topic | Choice |
| --- | --- |
| Global default writer | **`SecuritySettings.js` only** — unchanged, already correct |
| Per-user override (`DemoSetupPanel`) | **Keep as-is** — distinct, intentional feature |
| `ThresholdControls` global thresholds + feature flags | **Read-only** — display + link to `/settings` / `/feature-flags`; those two write paths removed |
| `ThresholdControls` per-vertical thresholds | **Unchanged** — stays fully editable in place; no duplicate exists elsewhere |
| ACR default duplication in setup wizard | **Consolidate** the 3 hardcoded copies onto one shared frontend constant |
| `runtimeSettings.js`'s own `'Multi_Factor'` fallback | **Leave alone** — already a single line in one file, not scattered |
| `DemoDataPage.js` (confirmed dead code found during investigation) | **Out of scope** — unrelated file, not touched by this change |
| Orphaned `confirm_stepup_threshold_usd` key | **Fold in now** — wire it to the same consolidated value so `device_picker` mode's gate actually respects what `/settings` sets, using the exact "dual-store bridge" pattern `routes/admin.js` already uses for `maxTransactionAmount` |

## Goals

- Exactly one live write path for the global step-up default
  (`SecuritySettings.js` → `/api/admin/settings`).
- Preserve the per-user demo-scenario override feature in `DemoSetupPanel.js`
  unchanged.
- `ThresholdControls`' global threshold and feature-flag sections still tell
  the operator the current effective values at a glance from any
  dashboard — they just link out to `/settings` / `/feature-flags` to
  change them, instead of duplicating the write path inline. Its
  per-vertical section is untouched and stays fully editable in place — it
  has no duplicate elsewhere.
- `stepUpAcrValue`'s setup-wizard default exists in exactly one place in the
  frontend bundle.
- Setting the step-up threshold in `/settings` actually changes both real
  enforcement paths (local MCP tool gate AND the `device_picker` HITL
  consent gate), not just one of them silently.

## Non-Goals

- Changing `runtimeSettings.js`'s server-side default/env-var fallback logic.
- Adding per-user override support for `stepUpAcrValue` (only
  `stepUpAmountThreshold` has that today; not extending scope).
- Touching `DemoDataPage.js` or any other dead code found incidentally.
- Changing what `/configure` → Demo Data tab's UI looks like beyond what's
  needed to keep it working (no redesign).

## Architecture

```text
SecuritySettings.js  (/settings)
    │  PUT /api/admin/settings
    ▼
routes/admin.js  PUT /settings handler
    │
    ├──► runtimeSettings.update(...)         GLOBAL default, live in-process
    │       (already happens today)
    │
    └──► NEW dual-store bridge, only when req.body.stepUpAmountThreshold set:
         configStore.setConfig({
           mfa_threshold_usd,
           confirm_stepup_threshold_usd,      ← closes the orphaned-key gap
           SIMULATED_AUTHORIZE_STEPUP_AMOUNT,
           step_up_amount_threshold,
         })
             │                                          │
             ▼                                          ▼
  mcpLocalTools.js                        transactionConsentChallenge.js
  checkLocalStepUp()                      getStepUpThreshold()
  reads runtimeSettings directly          reads configStore.confirm_stepup_threshold_usd
  (local MCP tool gate)                   (device_picker HITL gate)

demoScenarioStore.js  ◄── DemoSetupPanel.js  (/configure, Demo Data tab)
    │  PER-USER override (stepUpAmountThreshold only), LMDB-backed
    │  fallback when unset: the global default above
    ▼
GET /api/config/thresholds  (effective = per-user override ?? global default)
    ▲
    │  read-only
ThresholdControls.js  (floating widget, every dashboard)
```

`ThresholdControls` keeps calling the existing `GET` that already computes
the effective value (per-user override falling back to global) — no new
endpoint needed, since `demoScenarioStore.getStepUpThreshold(userId,
runtimeDefault)` already implements exactly that resolution and something in
the current read path must already expose it (the widget currently displays
*some* current value before editing).

The dual-store bridge is the same pattern already in `routes/admin.js` for
`maxTransactionAmount` (see the existing code comment there: *"Dual-store
bridge (write side)... Without this write-through the setting is dead"*) —
this design adds a second instance of that pattern for
`stepUpAmountThreshold`, it does not invent a new mechanism.

## Component changes

### `demo_api_server/routes/admin.js` — `PUT /settings` dual-store bridge

This file's `PUT /settings` handler and `transactionConsentChallenge.js`
(reached indirectly, via the `configStore` key this handler writes) are
listed in REGRESSION_PLAN §1 ("Transfer HITL enforcement",
"`configStore` / Config UI"). **What this change will NOT break:** the
actual HITL enforcement *logic* — amount comparisons, which `mfaMode`
branches fire, the 428 status-code enforcement in `routes/transactions.js`
— is untouched. This is a write-side mirror only: it makes an already-read
key (`confirm_stepup_threshold_usd`) actually receive a value, the same way
`maxTransactionAmount` already does for `MAX_TRANSACTION_AMOUNT` three lines
above where this new block goes.

- **Prerequisite found while verifying `setConfig()`'s behavior:**
  `configStore.setConfig()` silently drops any key not registered in its
  `FIELD_DEFS` map (`if (!(key in FIELD_DEFS)) continue;`).
  `confirm_stepup_threshold_usd` is **not currently registered** — this is
  a second, independent reason it's orphaned, not just "no UI writes it."
  Must add `confirm_stepup_threshold_usd: { public: true, default: '500' }`
  to `FIELD_DEFS` (`demo_api_server/services/configStore.js`, in the
  existing "Step-up / HITL thresholds (USD)" group, alongside
  `confirm_threshold_usd`/`mfa_threshold_usd`/`step_up_amount_threshold`)
  *before* the write-side bridge below can work at all. Default `'500'`
  matches the sibling keys and `scopeTopology.stepUpThresholdUsd()`'s
  existing fallback, so nothing's effective value changes for anyone not
  yet using this design's bridge.
- Add a new block in the `PUT /settings` handler (`demo_api_server/routes/admin.js`),
  alongside the existing `maxTransactionAmount` dual-store bridge: when
  `req.body.stepUpAmountThreshold` is present and a positive finite number,
  call `configStore.setConfig({ mfa_threshold_usd, confirm_stepup_threshold_usd,
  SIMULATED_AUTHORIZE_STEPUP_AMOUNT, step_up_amount_threshold })` with that
  value (all four keys, matching what `routes/thresholds.js`'s POST handler
  already writes for the equivalent case — see its `mfa_threshold_usd` branch).
- `runtimeSettings.update(...)` (already called earlier in the same handler)
  is unchanged — this is additive.

### `ThresholdControls.js` / `ThresholdControls.css`

**Correction after reading the actual file:** this component is a larger
"Demo Controls" popover with three independent sections, not a single
threshold field. Scope is narrower than originally written — only two of
the three sections change:

1. **Step-up Thresholds section** (`confirm`/`mfa` state, `saveThresholds()`,
   the "Save Thresholds" button) — **becomes read-only.** Remove the two
   `<input>` fields and the "Save Thresholds" button/`saveThresholds()` call.
   Replace with plain display text for the current `confirm`/`mfa` values
   (still sourced from the existing `GET /api/config/thresholds` call in
   `loadAll()` — unchanged) plus an "Edit in Settings →" link to `/settings`.
2. **Per-Vertical Thresholds section** (`selectedVertical`, `vertConfirm`,
   `vertMfa`, `saveVerticalThresholds()`) — **unchanged, stays fully
   editable.** Per user decision: no other page has per-vertical threshold
   overrides, so there's nothing to redirect to. Keep this section, its
   state, and its `POST /api/config/thresholds` call exactly as they are.
3. **Feature Flags section** (`toggleFlag()`, the 6 `IMPORTANT_FLAG_IDS`
   checkboxes) — **becomes read-only**, same reasoning as thresholds:
   `FeatureFlagsPage.js` (`/feature-flags`) already calls the identical
   `PATCH /api/admin/feature-flags` endpoint for the full flag set, so this
   is a genuine, safe-to-redirect duplicate. Replace checkboxes with a
   plain listing of each flag's current state (label + on/off) plus an
   "Edit in Feature Flags →" link to `/feature-flags`. Keep `loadAll()`'s
   existing `GET /api/admin/feature-flags` call so the display still shows
   live state.
4. `toggleSection()`, `openSections` state, and the collapsible section
   chevrons stay as-is for all three sections (structure unchanged, only
   the editable controls inside sections 1 and 3 become display-only).

**REGRESSION_PLAN §1 correction:** its "Demo Controls diagnose" row claims
`ThresholdControls.js` has a `data.checks?.userAttribute?.pass`-shaped
diagnose panel. Reading the current file (391 lines, full read) — no such
code exists. This invariant appears stale (the code it protects was
apparently removed in an earlier change without updating the table). Part
of this change: delete that stale row from REGRESSION_PLAN.md §1 so a
future agent doesn't try to "protect" nonexistent code. If live testing
turns up a diagnose panel this design missed, stop and re-add the row
instead of deleting it.

### `DemoDataPage.js` calling the same thresholds endpoint

- Per the earlier investigation, `DemoDataPage.js` is dead code (zero
  importers) that also calls `POST /api/config/thresholds`. Since it's
  unreachable, it needs no functional change for this design — noting it
  here only so a future cleanup pass knows it references an endpoint whose
  write-capable consumer set is shrinking.

### `demo_api_server/routes/thresholds.js` (`POST /api/config/thresholds`)

- No longer called by any *reachable* frontend surface once `ThresholdControls`
  goes read-only (`DemoDataPage.js` is already unreachable). Leave the route
  itself in place (not deleting backend surface as part of a frontend-scoped
  change) — a natural follow-up once nothing calls it, out of scope here.

### `SecuritySettings.js`

- No behavior change. Optionally add one line noting per-user overrides live
  in Setup → Demo Data, for discoverability — small, additive, not required
  for correctness.

### Setup wizard family (`SetupPage.js`, `SetupWizardTab.js`, `SetupWizard.js`)

- New file: `demo_api_ui/src/config/setupDefaults.js` exporting
  `DEFAULT_STEP_UP_ACR_VALUE = 'Multi_Factor'`.
- All 6 occurrences (`SetupPage.js:45`, `SetupWizard.js:89,118,482`,
  `SetupWizardTab.js:19,393`) import and use this constant instead of a
  literal string. (`SetupWizardTab.js:398`'s help-text prose mentioning
  "Multi_Factor" as an example is left as-is — it's descriptive text, not a
  code default.)

## Error handling

- `ThresholdControls`' `GET` already has existing error handling (shows
  "not run yet" style empty state) — unchanged.
- No new failure modes introduced: removing a write path removes error cases
  (invalid input, save failure) rather than adding any.

## Testing

- New: a test on `PUT /api/admin/settings` confirming that setting
  `stepUpAmountThreshold` results in `configStore.getEffective('confirm_stepup_threshold_usd')`
  reflecting the new value (the dual-store bridge actually bridges).
- New: a test on `transactionConsentChallenge.js` confirming
  `getStepUpThreshold()` returns the value set via the bridge above instead
  of the `scopeTopology.stepUpThresholdUsd()` fallback, once
  `confirm_stepup_threshold_usd` is set (extends the existing
  `transactionConsentChallenge.test.js`, which already mocks this key).
- Update `ThresholdControls`' existing tests: remove assertions on the
  global-threshold save flow and the feature-flag toggle flow; add
  assertions that the "Edit in Settings" and "Edit in Feature Flags" links
  point at `/settings` and `/feature-flags` respectively. **Do not** remove
  or weaken any existing per-vertical threshold test — that section's
  behavior is unchanged and must keep passing as-is.
- `SecuritySettings.js` write-path tests are unaffected (no behavior change).
- New/updated: a test on the setup-wizard family confirming all three import
  `DEFAULT_STEP_UP_ACR_VALUE` rather than a literal, so a future edit to one
  can't silently diverge from the others.
- Manual: confirm `/configure` Demo Data tab's per-user override still works
  end-to-end (set an override, see it reflected in `ThresholdControls`'
  read-only display, confirm it beats the global default).

## Out of scope for this change

- Deleting the now-unreachable-from-the-UI `POST /api/config/thresholds`
  server route.
- `DemoDataPage.js` removal.
- Any change to `stepUpAcrValue`'s per-request/live resolution logic.
- Any change to HITL enforcement decision logic itself (amount comparisons,
  428 status handling, `mfaMode` branch selection) — only the *value* one
  branch reads is being fixed, not the branching logic.
- Making `confirm_threshold_usd` (the separate "does this transfer need
  consent at all" key — distinct from the step-up/MFA threshold this design
  touches) editable from `SecuritySettings.js`. Not currently exposed there;
  not part of this design.

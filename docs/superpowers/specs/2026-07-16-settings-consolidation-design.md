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
  `SetupWizard.js` (4 occurrences total, across form initial-state and a
  generated `.env` template) — one-time initial-setup-wizard code, not a live
  runtime writer, but still four places that can drift from each other and
  from `runtimeSettings.js`'s own default.

An operator using `ThresholdControls` on one dashboard, `DemoSetupPanel` on
another, and `SecuritySettings` on a third has no way to tell which one is
authoritative, and the setup wizard's copy of the ACR default can silently go
stale relative to the others.

## Decisions (from brainstorming)

| Topic | Choice |
| --- | --- |
| Global default writer | **`SecuritySettings.js` only** — unchanged, already correct |
| Per-user override (`DemoSetupPanel`) | **Keep as-is** — distinct, intentional feature |
| `ThresholdControls` | **Read-only** — becomes a display of the *effective* threshold with a link to `/settings`; its write path is removed |
| ACR default duplication in setup wizard | **Consolidate** the 3 hardcoded copies onto one shared frontend constant |
| `runtimeSettings.js`'s own `'Multi_Factor'` fallback | **Leave alone** — already a single line in one file, not scattered |
| `DemoDataPage.js` (confirmed dead code found during investigation) | **Out of scope** — unrelated file, not touched by this change |

## Goals

- Exactly one live write path for the global step-up default
  (`SecuritySettings.js` → `/api/admin/settings`).
- Preserve the per-user demo-scenario override feature in `DemoSetupPanel.js`
  unchanged.
- `ThresholdControls` still tells the operator the threshold that's actually
  in effect (global or per-user override) at a glance from any dashboard —
  it just can't change it anymore from there.
- `stepUpAcrValue`'s setup-wizard default exists in exactly one place in the
  frontend bundle.

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
runtimeSettings.js  ── GLOBAL default (stepUpAmountThreshold, stepUpAcrValue)
    ▲
    │  fallback when no per-user override
    │
demoScenarioStore.js  ◄── DemoSetupPanel.js  (/configure, Demo Data tab)
    │  PER-USER override (stepUpAmountThreshold only), LMDB-backed
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

## Component changes

### `ThresholdControls.js` / `ThresholdControls.css`

- Remove the editable input, the "Save" action, and the
  `POST /api/config/thresholds` call entirely.
- Keep the existing `GET` (effective threshold display) and the diagnose
  panel (`data.checks?.userAttribute?.pass` shape — protected by
  REGRESSION_PLAN §1, must not change its shape).
- Add an "Edit in Settings →" link/button that navigates to `/settings`.
- No component/file rename. Only user-facing copy change: wherever the
  widget currently implies it's editable (e.g. an input or a "Save"-adjacent
  label), replace with plain display text plus the "Edit in Settings →"
  link. Exact wording is an implementation-time call within that constraint,
  not a design decision.

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
- All 4 occurrences (form initial state ×3, `.env` template line) import and
  use this constant instead of a literal string.

## Error handling

- `ThresholdControls`' `GET` already has existing error handling (shows
  "not run yet" style empty state) — unchanged.
- No new failure modes introduced: removing a write path removes error cases
  (invalid input, save failure) rather than adding any.

## Testing

- Update `ThresholdControls`' existing tests to reflect read-only behavior:
  remove assertions on the save/write flow, add an assertion that no
  `POST /api/config/thresholds` call fires from this component and that the
  "Edit in Settings" link points at `/settings`.
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

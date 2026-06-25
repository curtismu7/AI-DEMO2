# Cleaner User Dashboard via `ff_show_banking_in_middle_agent`

**Date:** 2026-05-16
**Status:** Approved (design)

## Problem

The customer dashboard (`banking_api_ui/src/components/UserDashboard.js`) shows a
banking-info column in all three agent placement modes. The goal is a cleaner
dashboard: banking information should come **only** from the agent response or a
popout when the agent occupies the center column. The banking column must be
hideable behind a feature flag that lives on the setup page alongside the
existing flags.

## Behavior Matrix (confirmed with user)

| Agent mode | Token Chain | Agent | Banking column |
|---|---|---|---|
| **Middle** (`placement === "middle"` + `middleAgentOpen`) | shown | shown (center) | **Hidden** when FF off (default); shown when FF on |
| **Floating** (`placement === "none"`) | shown | shown (FAB / popout) | Always visible (unchanged) |
| **Bottom** (`placement === "bottom"`) | shown | shown (full-width dock) | Always visible (unchanged) |

The middle-mode agent already renders with `embeddedFocus="banking"` and
`showPopOut`, so banking answers and the popout are already available there. No
agent component changes are required.

## Feature Flag Semantics

A new boolean flag `ff_show_banking_in_middle_agent`:

- **OFF (default):** middle-agent layout hides the banking column — the clean
  out-of-box state.
- **ON:** middle-agent layout also shows the banking column (legacy behavior).
- Floating and bottom modes are **not affected** by this flag — they always show
  the banking column.

Default `false` makes the clean dashboard the default; existing demos that want
the column back flip one setup-page toggle (no rebuild — configStore-backed).

## Components

### 1. Backend: register the flag

File: `banking_api_server/routes/featureFlags.js`

Add one entry to `FLAG_REGISTRY`:

- `id: 'ff_show_banking_in_middle_agent'`
- `name:` short label, e.g. `'Dashboard — Show Banking Column With Centered Agent'`
- `category: 'UI / Dashboard'` (new category; the GET route derives the category
  list from the registry, so it appears as its own group on the setup page with
  no extra wiring)
- `description:` explains that when ON the banking column is shown alongside the
  centered agent; when OFF banking info comes only from the agent / popout.
- `impact:` one-line summary of the visible difference.
- `type: 'boolean'`
- `defaultValue: false`

No changes to `serializeFlag`, `resolveFlag`, or the GET/PUT routes — they
operate generically over the registry. The setup-page UI
(`UnifiedConfigurationPage.tsx`) renders flags generically from
`/api/admin/feature-flags`, so the flag appears automatically.

### 2. Frontend: read the flag in the dashboard

File: `banking_api_ui/src/components/UserDashboard.js`

Mirror the existing pattern already used in `BankingAgent.js` for
`ff_heuristic_enabled`:

- One `useState` (`showBankingInMiddle`, initial `false`).
- One `useEffect` that does
  `fetch("/api/admin/feature-flags", { credentials: "include" })`, finds the
  flag by `id === "ff_show_banking_in_middle_agent"`, sets state from
  `flag.value`. On any error, leave state `false` (fail to the clean default).

The GET endpoint returns flags without requiring an admin session (only PUT
updates require admin), so the customer dashboard can read it — exactly as
`BankingAgent.js:2755` already does.

### 3. Frontend: conditional render of the banking column

File: `banking_api_ui/src/components/UserDashboard.js`, the middle-agent branch
beginning at line ~2615 (`agentPlacement === "middle" && middleAgentOpen`).

That branch renders three children inside
`.ud-body--dashboard-split3`: the token rail `<aside>`, the agent
`<section className="ud-agent-column">`, and
`<main className="ud-center ud-banking-column">{renderBankingMain()}</main>`.

- Render the `<main className="ud-center ud-banking-column">` block only when
  `showBankingInMiddle` is true.
- When hidden, add a modifier class
  (`ud-body--dashboard-split3--no-banking`) to the container so the CSS grid
  collapses to two tracks (token rail + agent column) instead of three.

The `else` branch (bottom / floating / float-mode) is left **entirely
untouched**.

### 4. CSS: two-track grid modifier

File: `banking_api_ui/src/components/UserDashboard.css`

Add a single modifier rule for `ud-body--dashboard-split3--no-banking` that
overrides `grid-template-columns` so the layout reads as token rail + agent
column (no third banking track), keeping the agent column at a comfortable
width. This is the only CSS change.

## Regression / Do-Not-Break (REGRESSION_PLAN check)

- **Token custody:** no token handling touched. The flag read is a
  cookie-credentialed GET identical to the existing `ff_heuristic_enabled`
  read — no tokens in the browser.
- **Floating & bottom modes:** zero behavior change; they live in the separate
  `else` render branch which is not modified.
- **Agent component:** no props changed. Middle agent keeps
  `embeddedFocus="banking"` and `showPopOut`, so banking answers + popout still
  work when the column is hidden.
- **Default `false`:** the clean dashboard is the out-of-box state; no migration
  needed. Demos wanting the old layout flip one setup-page toggle.
- **Minimal diff:** one registry entry, one state hook, one effect, one
  conditional + one container class, one CSS modifier rule. No refactor of the
  3603-line component.

A Bug Fix Log entry is not required (this is a feature, not a bug fix). If any
incidental fix is made in a touched file, it gets a `REGRESSION_PLAN.md` §4
entry per the template.

## Success Criteria

- `cd banking_api_ui && npm run build` exits **0**.
- Middle mode, FF **off**: only Token Chain + Agent visible; no banking column;
  agent answers banking questions and the popout works.
- Middle mode, FF **on** (toggled from the setup page, no rebuild): banking
  column reappears.
- Bottom mode: banking column visible regardless of FF (unchanged).
- Floating mode: banking column visible regardless of FF (unchanged).
- The new flag appears on the setup page under a "UI / Dashboard" group and
  persists across reloads via configStore.

## Scope Boundary

No changes to `BankingAgent`, the agent service, token flow, the setup-page
component, or the bottom/floating render path. The change is: one backend flag
registry entry + one frontend flag read + one conditional render + one CSS
modifier rule.

# Admin UI: New Ping Console Skin (ping2026) — Design

**Date:** 2026-06-12
**Status:** Approved (user-validated via brainstorming)
**Scope:** Admin section visual skin only, behind a runtime feature flag

## Goal

Restyle the demo's admin section to match the redesigned PingOne admin console
(light sidebar, new Ping Identity visual language), switchable at runtime so we
can revert instantly without a redeploy.

## Decisions (user-confirmed)

1. **Scope: admin section only.** The sidebar (`AdminSideNav`) and admin layout
   chrome. No restyle of the rest of the app (dashboard, agent UI, login).
2. **Revert path: runtime feature flag.** Both skins ship; a flag switches them.
3. **Fidelity: visual skin only.** Nav items, groups, routes, role filtering,
   and all behavior stay exactly as-is. No information-architecture changes.
4. **Default: new skin ON.** `ff_admin_skin_ping2026` defaults to `true`.
   Revert = toggle the flag off in the Feature Flags admin page.

## Approach (chosen: skin class + override stylesheet)

When the flag is on, a modifier class `admin-skin-p1` is added to the
`.admin-layout` wrapper. All new styling lives in **one new CSS file** scoped
entirely under `.admin-skin-p1`. The existing `AdminSideNav.css`,
`AdminLayout.css`, and `Admin.css` are **not modified** — the classic skin
stays pixel-identical, preserving the existing "sidebar appearance frozen"
guarantee for the classic look.

Rejected alternatives:

- CSS-variable refactor of the existing sidebar CSS — rewrites the frozen
  classic stylesheet, weakening the revert guarantee.
- Forked `AdminSideNavV2.jsx` — a 1,380-line fork that drifts on every nav
  change.

## Components

### 1. Feature flag (backend)

- Register `ff_admin_skin_ping2026` (boolean, **default `true`**) in the
  demo_api_server feature-flag registry, exposed through the existing
  `/api/admin/feature-flags` GET/PUT endpoints and visible in the Feature
  Flags admin page like any other flag.

### 2. `useAdminSkin()` hook (frontend)

- Small hook that fetches `/api/admin/feature-flags` (same
  credentials-included pattern `UserDashboard.js` already uses) and toggles
  the `admin-skin-p1` class on `document.body`; no return value.
- While loading and on fetch error it keeps the flag's registered default
  (new skin on), so behavior is deterministic and there is no skin flash on
  the happy path.

### 3. Skin class application (as built)

- `useAdminSkin()` is called once in the always-mounted `AppWithAuth`
  component in `App.js`; all skin CSS is scoped under `body.admin-skin-p1`.
  No edits to `AppShell.js` or the per-route `AdminSideNav` render sites were
  needed, and the sidebar itself has no JS knowledge of the active skin (the
  brand header is gated by CSS `display`, not a JSX conditional).

### 4. New stylesheet `adminSkinPing2026.css`

All rules scoped under `.admin-skin-p1`. Visual targets (from the new console
screenshot):

- **Sidebar:** white background; Ping Identity wordmark + red square mark at
  top; dark-gray (#2d2d2d-range) labels; outline-style icons; chevron
  indicators on expandable groups; light-blue rounded active-item
  highlight; thin divider lines between groups; light-gray
  hover state.
- **Mobile/responsive:** inherit existing breakpoints; only colors/spacing
  change.
- Content-area background tint was dropped during review: the only content
  wrapper (`.main-content`) is shared with customer/login pages, so tinting
  it would exceed the approved admin-sidebar scope.

### 5. JSX edits (minimal, no logic changes)

- `AdminSideNav.jsx`: conditional logo block (Ping logo on light skin),
  conditional root class. No changes to nav arrays, role filtering,
  expansion-index logic, kill switch, vertical picker, or any handler.

## Out of scope

- Per-page admin content restyling (Environment-Properties-style card
  layouts), breadcrumb/env-picker header, nav regrouping to the new console IA
  (Overview/Directory/Applications/AI Agents/…). Any of these can be a
  follow-up.

## Error handling

- Flag fetch failure → fall back to the flag's registered default (new skin),
  never a broken in-between state; the class is either present or absent.

## Testing / success criteria

1. Flag **off** → classic admin UI is byte-identical in appearance and
   behavior; existing `uiRegression` / `buttonRouting` tests pass unmodified.
2. Flag **on** (default) → sidebar matches the new Ping console look; all nav
   items route exactly as before.
3. Toggling the flag in the Feature Flags page switches skins without a
   redeploy (refresh is acceptable).
4. `cd demo_api_ui && npm run build` exits 0.
5. Backend flag-registry test covers the new flag's default value.

## Affected files

| File | Change |
| --- | --- |
| demo_api_server feature-flag registry (+ its test) | register `ff_admin_skin_ping2026`, default true |
| `demo_api_ui/src/hooks/useAdminSkin.js` (new) | flag fetch hook |
| `demo_api_ui/src/components/adminSkinPing2026.css` (new) | all new-skin styles, scoped |
| `demo_api_ui/src/components/AdminSideNav.jsx` | conditional class + logo only |
| `demo_api_ui/src/routes/AppShell.js`, `demo_api_ui/src/App.js` | wrapper class |

Existing `AdminSideNav.css` / `AdminLayout.css` / `Admin.css`: **zero changes.**

# Design: Quick Flags Pill — Header Switcher for Demo Feature Flags

**Date:** 2026-07-03
**Status:** Approved (brainstorming session)

## Problem

Mid-demo, switching between JWKS local validation and token introspection (and
other headline behaviors) requires navigating to the admin Feature Flags page.
SEs need a one-click, always-visible switcher — and the audience should see the
current mode at a glance.

## Decisions Made

- **Shape:** visible mode pill in the top header + click-to-open dropdown with
  a curated set of switches (not menu-only, not a single-purpose switch).
- **Home:** `TopNav`'s right cluster, next to `VerticalSwitcher` — appears on
  every page that mounts `TopNav`, including customer-facing demo pages.
- **Curated lineup (10 switches, grouped):**
  - *Token & Gateway:* `ff_mcp_gateway_jwks` (Token Validation: JWKS ↔
    Introspection — drives the pill), `ff_mcp_gateway_pinggateway` (Gateway:
    PingOne ↔ Demo; env-pinned aware), `introspectionProvider` (enum:
    pinggateway ↔ p1az), `ff_skip_token_exchange`
  - *AuthN/AuthZ:* `ff_authorize_simulated` (Simulated ↔ Real P1AZ),
    `ff_id_token_exchange`, `ff_token_auth_private_key_jwt`, `ciba_enabled`
  - *Agent:* `ff_heuristic_enabled`, `ff_agent_results_panel`
- All 10 already exist in `FLAG_REGISTRY` (verified — including
  `introspectionProvider` at `featureFlags.js:406`), so no registry additions.

## Components

### 1. `demo_api_ui/src/components/QuickFlagsPill.js` (+ `.css`) — new

- **Pill:** compact chip showing live validation mode — `🔐 JWKS` when
  `ff_mcp_gateway_jwks` is on, `🔎 Introspect` when off. Click toggles the
  dropdown.
- **Dropdown:** rendered via `createPortal` (same pattern as
  `ThresholdControls.js:214`), closed on outside-click/Escape. Three labeled
  groups per the lineup above.
- **Controls:** two-mode flags (`ff_mcp_gateway_jwks`,
  `ff_mcp_gateway_pinggateway`, `ff_authorize_simulated`,
  `introspectionProvider`) render as segmented A/B controls with both mode
  labels visible; the rest are compact toggle switches.
- **Curation:** a single `QUICK_FLAGS` constant at the top of the file — id,
  group, control style, mode labels. Adding switch #11 is a one-entry change.
- **Pinned flags:** when the API reports `pinned: true`, the control renders
  locked (lock icon, disabled) with tooltip "Pinned by <ENV_VAR> in
  docker-compose — change the env to flip".
- **Non-admin:** pill and current states visible; controls disabled with an
  "Admin session required" hint. A PATCH 403 flips the component into this
  state (mirrors `ThresholdControls.js:200-202`).

### 2. `demo_api_ui/src/components/TopNav.js` — modify

Mount `<QuickFlagsPill user={user} />` in the right cluster next to
`VerticalSwitcher` (`TopNav.js:105` area). No other TopNav changes.

### 3. `demo_api_server/routes/featureFlags.js` — modify (small)

`serializeFlag` (line ~730) gains two optional fields:

- `pinned: true` when the flag has an env alias set in `process.env`
  (resolved via the same alias names configStore uses — implemented as a
  small `PINNED_ENV_ALIASES` map for the registry ids, e.g.
  `ff_mcp_gateway_pinggateway → FF_MCP_GATEWAY_PINGGATEWAY`).
- `pinnedBy: '<ENV_VAR_NAME>'` naming the controlling variable.

PATCH behavior unchanged (accepts writes even for pinned flags — they're
ineffective by design; the UI simply doesn't offer them).

## Data Flow

- Mount: `GET /api/admin/feature-flags` (credentials include) → pill state +
  dropdown states. Re-fetched each time the dropdown opens (cheap; keeps
  states honest across sessions/tabs).
- Flip: `PATCH /api/admin/feature-flags` body `{ updates: { [id]: value } }`,
  optimistic update with rollback on error, reconcile from the response's
  `flags` (exact `FeatureFlagsPage.js:259-279` pattern).
- Effect: `ff_mcp_gateway_jwks` and `ff_authorize_simulated` are carried
  per-request via the `X-Token-Validation` / `X-Authz-Simulated` headers, so
  the flip takes effect on the next tool call with no restarts — the pill
  re-renders immediately.

## Error Handling

- GET failure → pill renders in a muted "–" state, dropdown shows a retry row.
- PATCH failure → rollback + inline error toast in the dropdown.
- 403 → non-admin state (controls disabled, hint shown).

## Testing

- Jest (`demo_api_ui/src/components/__tests__/QuickFlagsPill.test.jsx`,
  following `SimpleStepperBar.test.jsx` conventions): pill label derives from
  flag value; segmented control PATCH payload shape; pinned flag renders
  locked and fires no PATCH; 403 flips to non-admin state.
- Server: jest test asserting `serializeFlag` emits `pinned`/`pinnedBy` when
  the env var is set and omits them when not.
- Manual live check: flip Token Validation in the pill → next MCP tool call's
  response header `X-Token-Validation-Mode` changes accordingly.

## Out of Scope

- No changes to FeatureFlagsPage or ThresholdControls.
- No unpinning mechanism for env-pinned flags (surfaced honestly instead).
- No customer-role write access — reads only.
